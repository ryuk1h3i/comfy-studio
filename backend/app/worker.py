import argparse
import asyncio
import copy
from contextlib import suppress
import fcntl
import hashlib
import json
import logging
import time
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import httpx
from websockets.asyncio.client import connect
from sqlalchemy import select, text

from .config import COMFYUI_URL, DATA, JOB_TIMEOUT
from .db import Asset, Job, JobTiming, engine, initialize, now, session
from .jobs import claim
from .storage import location, store

LOGGER = logging.getLogger("studio.worker")


def update(job_id, **values):
    with session() as database:
        job = database.get(Job, job_id)
        for key, value in values.items():
            setattr(job, key, value)
        job.updated = now()
        if values.get("status") in {"succeeded", "failed"}:
            timing = database.get(JobTiming, job_id)
            if timing and timing.finished is None:
                timing.finished = job.updated


async def recover(client):
    with session() as database:
        pending = list(database.scalars(select(Job).where(Job.status.in_(["submitting", "running", "needs_attention"]))))
    for job in pending:
        if job.comfy_id:
            await monitor(client, job)
        else:
            update(job.id, status="needs_attention", progress="Invio incerto",
                   error="Verifica coda e history ComfyUI. Nessuna risottomissione automatica.")


async def execute(client, job):
    with session() as database:
        if not database.get(JobTiming, job.id):
            database.add(JobTiming(job_id=job.id))
    graph = copy.deepcopy(job.workflow)
    try:
        if job.input_id:
            with session() as database:
                asset = database.get(Asset, job.input_id)
                data = location(asset, "working").read_bytes()
            uploaded = await client.post("/upload/image", files={"image": (f"studio-{job.id}.png", data, "image/png")},
                                         data={"type": "input", "overwrite": "false"})
            uploaded.raise_for_status()
            item = uploaded.json()
            graph["1" if job.operation == "upscale" else "4"]["inputs"]["image"] = "/".join(filter(None, [item.get("subfolder"), item["name"]]))
    except Exception as error:
        update(job.id, status="failed", error=f"Upload fallito: {type(error).__name__}")
        return
    update(job.id, workflow=graph, workflow_hash=hashlib.sha256(json.dumps(graph, sort_keys=True).encode()).hexdigest(), progress="Invio a ComfyUI")
    try:
        response = await client.post("/prompt", json={"prompt": graph, "client_id": job.id,
                                                    "extra_data": {"studio_job_id": job.id}})
        if 400 <= response.status_code < 500:
            update(job.id, status="failed", error=f"Workflow rifiutato: HTTP {response.status_code}. {response.text[:1800]}")
            return
        response.raise_for_status()
        job.comfy_id = response.json()["prompt_id"]
        update(job.id, comfy_id=job.comfy_id, status="running", progress="In coda ComfyUI / elaborazione")
    except Exception as error:
        update(job.id, status="needs_attention", error=f"Invio incerto: {type(error).__name__}. Controlla ComfyUI prima di risolvere il job.")
        return
    await monitor(client, job)


def progress_event(job_id, comfy_id, message):
    data = message.get("data", {})
    if data.get("prompt_id") != comfy_id:
        return
    if message.get("type") == "progress":
        value, maximum = data.get("value"), data.get("max")
        if isinstance(value, (int, float)) and isinstance(maximum, (int, float)) and 0 <= value <= maximum and maximum > 0:
            update(job_id, progress=f"Passi {int(value)}/{int(maximum)}")
    elif message.get("type") == "executing" and data.get("node") is not None:
        update(job_id, progress="Elaborazione nodo " + str(data["node"]))


async def watch_progress(job):
    parts = urlsplit(COMFYUI_URL)
    query = urlencode([*parse_qsl(parts.query), ("clientId", job.id)])
    address = urlunsplit(("wss" if parts.scheme == "https" else "ws", parts.netloc, parts.path.rstrip("/") + "/ws", query, ""))
    while True:
        try:
            async with connect(address, open_timeout=10, max_size=2 * 1024 * 1024) as websocket:
                async for message in websocket:
                    if isinstance(message, str):
                        try:
                            progress_event(job.id, job.comfy_id, json.loads(message))
                        except (ValueError, TypeError, AttributeError):
                            continue
        except Exception as error:
            LOGGER.debug("Avanzamento live non disponibile: %s", type(error).__name__)
            await asyncio.sleep(3)


async def monitor(client, job):
    listener = asyncio.create_task(watch_progress(job))
    try:
        await monitor_history(client, job)
    finally:
        listener.cancel()
        with suppress(asyncio.CancelledError):
            await listener


async def monitor_history(client, job):
    deadline = time.monotonic() + JOB_TIMEOUT
    try:
        while time.monotonic() < deadline:
            response = await client.get(f"/history/{job.comfy_id}")
            response.raise_for_status()
            history = response.json().get(job.comfy_id)
            if history:
                status = history.get("status", {})
                errors = [data for event, data in status.get("messages", []) if event in {"execution_error", "execution_interrupted"}]
                if status.get("status_str") == "error" or errors:
                    message = "\n".join(str(item.get("exception_message", "Esecuzione interrotta")) for item in errors)
                    if any(marker in message.lower() for marker in ("out of memory", "outofmemory", "allocation")):
                        message = "Memoria insufficiente: riduci risoluzione o fattore upscale. " + message
                    update(job.id, status="failed", error=message[:2000] or "Errore ComfyUI")
                    return
                if status.get("completed"):
                    images = history.get("outputs", {}).get("9" if job.operation == "upscale" else "19", {}).get("images", [])
                    if not images:
                        update(job.id, status="failed", error="Il workflow non ha restituito immagini")
                        return
                    update(job.id, progress="Salvataggio risultati")
                    for index, image in enumerate(images):
                        output_key = f"{job.id}:{index}"
                        with session() as database:
                            if database.scalar(select(Asset.id).where(Asset.output_key == output_key)):
                                continue
                        result = await client.get("/view", params={key: image[key] for key in ("filename", "subfolder", "type") if key in image})
                        result.raise_for_status()
                        with session() as database:
                            store(database, result.content, image["filename"], "edit", job, output_key)
                    update(job.id, status="succeeded", progress="Completato", error="")
                    return
            await asyncio.sleep(2)
        update(job.id, status="needs_attention", error="Tempo massimo superato. Il lavoro potrebbe essere ancora attivo.")
    except Exception as error:
        LOGGER.warning("Recupero job %s: %s", job.id, type(error).__name__)
        update(job.id, status="needs_attention", error=f"Recupero necessario: {type(error).__name__}. La generazione non verra ripetuta automaticamente.")


async def generation_loop():
    async with httpx.AsyncClient(base_url=COMFYUI_URL, timeout=60) as client:
        await recover(client)
        while True:
            with session() as database:
                job = claim(database)
            if job:
                await execute(client, job)
            else:
                await asyncio.sleep(2)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["generation", "analysis"])
    args = parser.parse_args()
    initialize()
    lock_number = 913743 if args.mode == "generation" else 913744
    with engine.connect() as connection, (DATA / f".{args.mode}.lock").open("a") as lock:
        if engine.dialect.name == "postgresql":
            if not connection.execute(text("SELECT pg_try_advisory_lock(:key)"), {"key": lock_number}).scalar():
                raise RuntimeError("Worker gia attivo")
        else:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.mode == "analysis":
            from .ml import analysis_loop
            asyncio.run(analysis_loop())
        else:
            asyncio.run(generation_loop())


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    main()