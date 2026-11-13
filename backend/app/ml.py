import asyncio
import base64
import json
import logging
import time

import httpx
import numpy as np
from sklearn.cluster import DBSCAN
from sqlalchemy import select, text, update

from .config import CLIP_MODEL, FACE_MODEL, IMMICH_ML_URL, ML_PROTOCOL, ML_TIMEOUT, MODEL_REVISION
from .db import Asset, AssetTag, Face, Job, Person, Tag, engine, session
from .storage import location

MODEL = f"{CLIP_MODEL}@{MODEL_REVISION}"
FACE_VERSION = f"{FACE_MODEL}@{MODEL_REVISION}"
logger = logging.getLogger(__name__)
DEFAULT_TAGS = (
    ("Ritratto", "A portrait of a person, face and shoulders"),
    ("Persone", "A photo of people"),
    ("Paesaggio", "A landscape with natural scenery"),
    ("Montagna", "A landscape with mountains"),
    ("Mare", "A photo of the sea, ocean or beach"),
    ("Bosco", "A forest with trees"),
    ("Fiori", "A photo of flowers"),
    ("Animali", "A photo of animals"),
    ("Cani", "A photo of a dog"),
    ("Gatti", "A photo of a cat"),
    ("Architettura", "A photo of buildings and architecture"),
    ("Citta", "A city street with buildings"),
    ("Interni", "An interior room with furniture"),
    ("Cibo", "A photo of food or a meal"),
    ("Veicoli", "A photo of a car, motorcycle or other vehicle"),
    ("Illustrazione", "A drawing or digital illustration"),
    ("Pittura", "A painting or painted artwork"),
    ("Bianco e nero", "A black and white photograph"),
)


def initialize_tag_vocabulary():
    with session() as database:
        if database.scalar(select(Tag.id).limit(1)) is not None:
            return
        for name, description in DEFAULT_TAGS:
            database.add(Tag(name=name, description=description, threshold=0.25, automatic=False))
        database.execute(update(Asset).where(Asset.deleted.is_(False)).values(
            analysis="pending", analysis_attempts=0, analysis_after=0, analysis_error=""))
    logger.info("Creato vocabolario iniziale di %s tag e riaccodate le immagini", len(DEFAULT_TAGS))


def vector(value):
    try:
        if isinstance(value, str):
            value = value.strip()
            if value.startswith("["):
                result = np.asarray(json.loads(value), dtype=np.float32)
            else:
                result = np.frombuffer(base64.b64decode(value, validate=True), dtype="<f4").copy()
        else:
            result = np.asarray(value, dtype=np.float32)
    except (ValueError, TypeError, OverflowError) as error:
        raise ValueError("Embedding remoto non valido: atteso array numerico, array JSON o float32 Base64") from error
    if result.ndim != 1 or not 16 <= len(result) <= 8192 or not np.isfinite(result).all() or np.linalg.norm(result) == 0:
        raise ValueError("Embedding remoto non valido")
    return (result / np.linalg.norm(result)).tolist()


async def predict(image=None, query=None, faces=False):
    if not IMMICH_ML_URL:
        raise ValueError("IMMICH_ML_URL non configurato")
    if ML_PROTOCOL != "pipeline":
        raise ValueError("IMMICH_ML_PROTOCOL non supportato")
    side = "visual" if image is not None else "textual"
    entries = {"clip": {side: {"modelName": CLIP_MODEL, "options": {}}}}
    if faces:
        entries["facial-recognition"] = {
            "detection": {"modelName": FACE_MODEL, "options": {"minScore": 0.7}},
            "recognition": {"modelName": FACE_MODEL, "options": {}},
        }
    data = {"entries": json.dumps(entries)}
    files = {"image": ("preview.webp", image, "image/webp")} if image is not None else None
    if query is not None:
        data["text"] = query
    async with httpx.AsyncClient(timeout=ML_TIMEOUT) as client:
        response = await client.post(f"{IMMICH_ML_URL}/predict", data=data, files=files)
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as error:
            try:
                body = response.json()
            except ValueError:
                body = response.text
            detail = body.get("detail", body) if isinstance(body, dict) else body
            detail = str(detail).strip()[:800] or "Nessun dettaglio restituito dal server ML"
            models = f"CLIP={CLIP_MODEL}" + (f", volti={FACE_MODEL}" if faces else "")
            phase = "immagine e volti" if faces else "immagine" if image is not None else "testo"
            raise ValueError(f"Immich ML HTTP {response.status_code}, analisi {phase} ({models}): {detail}. Consultare i log del servizio Immich ML per la causa del fallimento.") from error
        payload = response.json()
    return vector(payload["clip"]), payload.get("facial-recognition", []), payload


def similarity(first, second):
    if len(first) != len(second):
        raise ValueError("Spazi embedding incompatibili: reindicizza con il modello corrente")
    return float(np.dot(first, second))


def write_vector(database, asset):
    if engine.dialect.name == "postgresql":
        database.execute(text("INSERT INTO asset_vectors(asset_id, model, embedding) VALUES (:id,:model,CAST(:vector AS vector)) ON CONFLICT(asset_id) DO UPDATE SET model=excluded.model, embedding=excluded.embedding"),
                         {"id": asset.id, "model": asset.model, "vector": json.dumps(asset.embedding)})


def cluster_faces(database):
    faces = list(database.scalars(select(Face).where(Face.model == FACE_VERSION)))
    eligible = []
    for face in faces:
        asset = database.get(Asset, face.asset_id)
        job = database.get(Job, asset.job_id) if asset.job_id else None
        if not job or job.operation != "upscale":
            eligible.append(face)
    labels = DBSCAN(eps=0.4, min_samples=3, metric="cosine").fit_predict([face.embedding for face in eligible]) if len(eligible) >= 3 else []
    for label in set(labels):
        if label == -1:
            continue
        members = [face for face, assigned in zip(eligible, labels) if assigned == label]
        locked_people = {face.person_id for face in members if face.locked and face.person_id}
        if len(locked_people) > 1:
            continue
        person_id = next(iter(locked_people), None) or next((face.person_id for face in members if face.person_id), None)
        if not person_id:
            person = Person()
            database.add(person)
            database.flush()
            person_id = person.id
        for face in members:
            if not face.locked:
                face.person_id = person_id
    assigned = [face for face in faces if face.person_id]
    for face in faces:
        if face.person_id or face.locked or not assigned:
            continue
        candidate = max(assigned, key=lambda match: similarity(face.embedding, match.embedding))
        if similarity(face.embedding, candidate.embedding) >= 0.65:
            face.person_id = candidate.person_id


async def analyze(asset_id):
    with session() as database:
        asset = database.get(Asset, asset_id)
        data = location(asset, "preview").read_bytes()
    embedding, faces, payload = await predict(image=data, faces=True)
    with session() as database:
        tags = list(database.scalars(select(Tag)))
    for tag in tags:
        if tag.model != MODEL or tag.embedding is None:
            tag.embedding, _, _ = await predict(query=tag.description)
            tag.model = MODEL
            with session() as database:
                current = database.get(Tag, tag.id)
                current.embedding, current.model = tag.embedding, tag.model
    with session() as database:
        asset = database.get(Asset, asset_id)
        asset.embedding, asset.model = embedding, MODEL
        write_vector(database, asset)
        existing = list(database.scalars(select(Face).where(Face.asset_id == asset.id)))
        locked = [face for face in existing if face.locked]
        if not locked:
            for face in existing:
                database.delete(face)
            for detected in faces:
                box = detected["boundingBox"]
                scale_x = asset.width / payload.get("imageWidth", asset.width)
                scale_y = asset.height / payload.get("imageHeight", asset.height)
                box = {key: int(value * (scale_x if key.startswith("x") else scale_y)) for key, value in box.items()}
                database.add(Face(asset_id=asset.id, box=box, embedding=vector(detected["embedding"]), model=FACE_VERSION))
        for tag in tags:
            score = similarity(embedding, tag.embedding)
            assignment = database.get(AssetTag, (asset.id, tag.id))
            if assignment and assignment.state in {"accepted", "rejected", "manual"}:
                continue
            if score >= tag.threshold:
                if assignment is None:
                    assignment = AssetTag(asset_id=asset.id, tag_id=tag.id)
                    database.add(assignment)
                assignment.state = "accepted" if tag.automatic else "suggested"
                assignment.score, assignment.model = score, MODEL
            elif assignment:
                database.delete(assignment)
        asset.analysis, asset.analysis_error, asset.analysis_attempts = "done", "", 0
        database.flush()
        cluster_faces(database)


async def analysis_loop():
    initialize_tag_vocabulary()
    while True:
        if not IMMICH_ML_URL:
            await asyncio.sleep(10)
            continue
        with session() as database:
            asset = database.scalar(select(Asset).where(Asset.deleted.is_(False), Asset.analysis.in_(["pending", "failed"]),
                                                       Asset.analysis_attempts < 5, Asset.analysis_after <= time.time()).order_by(Asset.created).limit(1))
            asset_id = asset.id if asset else None
        if not asset_id:
            await asyncio.sleep(3)
            continue
        try:
            await analyze(asset_id)
        except Exception as error:
            logger.exception("Analisi ML fallita per immagine %s", asset_id)
            with session() as database:
                asset = database.get(Asset, asset_id)
                asset.analysis_attempts += 1
                asset.analysis = "failed"
                asset.analysis_error = f"{type(error).__name__}: {str(error)[:1500]}"
                asset.analysis_after = time.time() + min(3600, 30 * 2**asset.analysis_attempts)
            await asyncio.sleep(5)