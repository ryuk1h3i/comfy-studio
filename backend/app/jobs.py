import copy
from sqlalchemy import select
from fastapi import HTTPException

from .config import DEFAULTS
from .db import Asset, Job, Prompt, Settings, now
from .workflows import build, new_seed, validate_settings


def current_settings(database):
    row = database.get(Settings, 1)
    return copy.deepcopy({**DEFAULTS, **(row.value if row else {})})


def enqueue(database, payload):
    existing = database.scalar(select(Job).where(Job.token == payload.token))
    if existing:
        return existing
    operation = payload.operation
    settings = current_settings(database)
    settings.update(payload.settings)
    settings = validate_settings(settings)
    asset = database.get(Asset, payload.input_id) if payload.input_id else None
    if payload.input_id and (not asset or asset.deleted):
        raise HTTPException(404, "Immagine non disponibile")
    source = database.get(Job, asset.job_id) if asset and asset.job_id else None
    instruction, addition = payload.instruction.strip(), payload.instruction.strip()
    prompt_id, version = None, None
    template = None
    if payload.action in {"repeat", "vary"}:
        if not source:
            raise HTTPException(400, "Questa azione richiede un risultato")
        settings = copy.deepcopy(source.settings)
        settings["seed"] = new_seed(settings["seed"])
        if payload.action == "repeat":
            operation, instruction = source.operation, source.instruction
            prompt_id, version, addition = source.prompt_id, source.prompt_version, source.addition
            asset = database.get(Asset, source.input_id) if source.input_id else None
            template = source.workflow
        else:
            operation = "edit"
    elif operation == "upscale" and source:
        settings = copy.deepcopy(source.settings)
        settings.update(payload.settings)
        settings = validate_settings(settings)
    if payload.action == "normal" and operation != "upscale":
        selected_id = payload.prompt_id
        if not selected_id and payload.use_active:
            selected_id = settings.get("quick_slots", {}).get(settings.get("active_slot", "0"))
        if selected_id:
            preset = database.get(Prompt, selected_id)
            if not preset or preset.archived:
                raise HTTPException(404, "Prompt non disponibile")
            prompt_id, version = preset.id, preset.version
            instruction = "\n\n".join(part for part in (preset.text, instruction) if part)
    if operation != "create" and not asset:
        raise HTTPException(400, "Seleziona un'immagine")
    if operation == "create" and asset:
        raise HTTPException(400, "Create non usa immagini di ingresso")
    if operation != "upscale" and not instruction:
        raise HTTPException(400, "Scrivi un prompt")
    if operation == "upscale":
        instruction, addition, prompt_id, version = "", "", None, None
    if template is not None:
        import hashlib
        import json
        graph, snapshot = copy.deepcopy(template), settings
        seed_node, seed_key = ("66:54", "seed") if operation == "upscale" else ("13", "noise_seed")
        graph[seed_node]["inputs"][seed_key] = settings["seed"]
        if asset:
            graph["1" if operation == "upscale" else "4"]["inputs"]["image"] = "__STUDIO_INPUT__"
        digest = hashlib.sha256(json.dumps(graph, sort_keys=True).encode()).hexdigest()
    else:
        graph, snapshot, digest = build(operation, settings, instruction)
    root = asset.id if asset and asset.kind == "original" else asset.root_id if asset else None
    job = Job(token=payload.token, operation=operation, input_id=asset.id if asset else None,
              root_id=root, prompt_id=prompt_id, prompt_version=version, instruction=instruction,
              addition=addition, settings=snapshot, workflow=graph, workflow_hash=digest)
    database.add(job)
    database.flush()
    return job


def claim(database):
    if current_settings(database).get("queue_paused"):
        return None
    blocked = database.scalar(select(Job.id).where(Job.status.in_(["submitting", "running", "needs_attention"])).limit(1))
    if blocked:
        return None
    job = database.scalar(select(Job).where(Job.status == "queued").order_by(Job.priority.desc(), Job.created).with_for_update(skip_locked=True).limit(1))
    if job:
        job.status, job.progress, job.updated = "submitting", "Preparazione", now()
    return job