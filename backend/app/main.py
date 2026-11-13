import asyncio
import copy
import io
import json
import time
from contextlib import asynccontextmanager

import httpx
from fastapi import Depends, FastAPI, File, HTTPException, Query, Request, Response, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from PIL import Image, UnidentifiedImageError
from sqlalchemy import func, inspect, or_, select, text
from sqlalchemy.exc import IntegrityError

from . import auth
from .config import COMFYUI_URL, COOKIE_SECURE, IMMICH_ML_URL, MAX_UPLOAD, PRODUCTION
from .db import Asset, AssetTag, Face, Job, JobTiming, Person, Prompt, PromptVersion, Settings, Tag, engine, initialize, now, session
from .jobs import current_settings, enqueue
from .schemas import JobInput, LoginInput, PromptBulkInput, PromptInput
from .storage import location, store
from .workflows import validate_settings


def serialize(row):
    return {column.key: getattr(row, column.key) for column in inspect(row).mapper.column_attrs}


def get(database, model, identity):
    row = database.get(model, identity)
    if not row:
        raise HTTPException(404, "Elemento non trovato")
    return row


def job_data(job):
    return {key: value for key, value in serialize(job).items() if key not in {"workflow", "token"}}


def asset_data(database, asset):
    result = {key: value for key, value in serialize(asset).items() if key not in {"embedding", "checksum", "output_key", "extension"}}
    result.update(thumb=f"/api/assets/{asset.id}/file/thumb", preview=f"/api/assets/{asset.id}/file/preview")
    if asset.job_id:
        job = database.get(Job, asset.job_id)
        result.update(operation=job.operation, prompt_id=job.prompt_id)
    return result


@asynccontextmanager
async def lifespan(_):
    initialize()
    yield


app = FastAPI(title="Comfy Studio", lifespan=lifespan)


@app.exception_handler(ValueError)
async def invalid(_, error):
    from fastapi.responses import JSONResponse
    return JSONResponse({"detail": str(error)}, status_code=400)


@app.middleware("http")
async def security_headers(request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "same-origin"
    response.headers["X-Frame-Options"] = "DENY"
    if request.url.path.startswith("/api"):
        response.headers["Cache-Control"] = "private, no-store"
    return response


@app.get("/api/health")
def health():
    with engine.connect() as connection:
        connection.execute(text("SELECT 1"))
    return {"status": "ok"}


@app.post("/api/login")
def login(payload: LoginInput, request: Request, response: Response):
    origin = request.headers.get("origin")
    if origin and origin.rstrip("/") != str(request.base_url).rstrip("/"):
        raise HTTPException(403, "Origine non consentita")
    value = auth.login(request, payload.password)
    response.set_cookie("studio", auth.signer.dumps(value), httponly=True, secure=COOKIE_SECURE,
                        samesite="strict", max_age=604800)
    return value


@app.get("/api/session")
def user(value=Depends(auth.authenticated)):
    return {**value, "development": not PRODUCTION}


@app.post("/api/logout", dependencies=[Depends(auth.authenticated)])
def logout(response: Response):
    response.delete_cookie("studio")
    return {"ok": True}


@app.get("/api/settings", dependencies=[Depends(auth.authenticated)])
def settings():
    with session() as database:
        return current_settings(database)


@app.put("/api/settings", dependencies=[Depends(auth.authenticated)])
def save_settings(payload: dict):
    with session() as database:
        value = validate_settings({**current_settings(database), **payload})
        for prompt_id in value.get("quick_slots", {}).values():
            if prompt_id:
                get(database, Prompt, prompt_id)
        row = database.get(Settings, 1)
        if not row:
            row = Settings(id=1)
            database.add(row)
        row.value = value
        return value


@app.get("/api/prompts", dependencies=[Depends(auth.authenticated)])
def prompts(q: str = "", favorite: bool = False, offset: int = Query(0, ge=0), limit: int = Query(60, ge=1, le=100)):
    with session() as database:
        statement = select(Prompt).where(Prompt.archived.is_(False))
        if q:
            if engine.dialect.name == "postgresql":
                statement = statement.where(text("to_tsvector('simple', title || ' ' || text) @@ plainto_tsquery('simple', :query)")).params(query=q)
            else:
                statement = statement.where(or_(Prompt.title.icontains(q, autoescape=True), Prompt.text.icontains(q, autoescape=True), Prompt.category.icontains(q, autoescape=True)))
        if favorite:
            statement = statement.where(Prompt.favorite.is_(True))
        rows = list(database.scalars(statement.order_by(Prompt.updated.desc(), Prompt.id).offset(offset).limit(limit + 1)))
        result = []
        for row in rows[:limit]:
            value = serialize(row)
            value["results"] = database.scalar(select(func.count()).select_from(Asset).join(Job, Job.id == Asset.job_id).where(Job.prompt_id == row.id, Asset.deleted.is_(False)))
            result.append(value)
        return {"items": result, "next": offset + limit if len(rows) > limit else None}


@app.post("/api/prompts", dependencies=[Depends(auth.authenticated)])
def add_prompt(payload: PromptInput):
    with session() as database:
        row = Prompt(**payload.model_dump(exclude={"version"}))
        database.add(row)
        database.flush()
        database.add(PromptVersion(prompt_id=row.id, version=1, text=row.text, title=row.title))
        return serialize(row)


@app.post("/api/prompts/bulk", dependencies=[Depends(auth.authenticated)])
def add_prompts_bulk(payload: PromptBulkInput):
    with session() as database:
        result = []
        for item in payload.items:
            row = Prompt(**item.model_dump(exclude={"version"}))
            database.add(row)
            database.flush()
            database.add(PromptVersion(prompt_id=row.id, version=1, text=row.text, title=row.title))
            result.append(serialize(row))
        return {"items": result}


@app.get("/api/prompts/{identity}", dependencies=[Depends(auth.authenticated)])
def prompt_detail(identity: str):
    with session() as database:
        value = serialize(get(database, Prompt, identity))
        value["versions"] = [serialize(row) for row in database.scalars(select(PromptVersion).where(PromptVersion.prompt_id == identity).order_by(PromptVersion.version.desc()))]
        return value


@app.put("/api/prompts/{identity}", dependencies=[Depends(auth.authenticated)])
def edit_prompt(identity: str, payload: PromptInput):
    with session() as database:
        row = database.scalar(select(Prompt).where(Prompt.id == identity).with_for_update())
        if not row:
            raise HTTPException(404, "Prompt non trovato")
        if payload.version is not None and payload.version != row.version:
            raise HTTPException(409, "Prompt modificato: riaprilo prima di salvare")
        changed = row.text != payload.text or row.title != payload.title
        for key, value in payload.model_dump(exclude={"version"}).items():
            setattr(row, key, value)
        if changed:
            row.version += 1
            database.add(PromptVersion(prompt_id=row.id, version=row.version, text=row.text, title=row.title))
        row.updated = now()
        return serialize(row)


@app.delete("/api/prompts/{identity}", dependencies=[Depends(auth.authenticated)])
def archive_prompt(identity: str):
    with session() as database:
        get(database, Prompt, identity).archived = True
    return {"ok": True}


@app.post("/api/assets", dependencies=[Depends(auth.authenticated)])
async def upload(file: UploadFile = File()):
    data = await file.read(MAX_UPLOAD + 1)
    try:
        with session() as database:
            asset = store(database, data, file.filename or "clipboard.png")
            return asset_data(database, asset)
    except (UnidentifiedImageError, Image.DecompressionBombError, Image.DecompressionBombWarning, OSError):
        raise HTTPException(400, "Immagine non valida o troppo grande") from None


@app.get("/api/assets", dependencies=[Depends(auth.authenticated)])
async def assets(kind: str = "original", q: str = "", semantic: bool = False, favorite: bool = False,
                 root_id: str | None = None, prompt_id: str | None = None, input_id: str | None = None,
                 tag_id: str | None = None, person_id: str | None = None, operation: str | None = None, job_id: str | None = None,
                 deleted: bool = False, offset: int = Query(0, ge=0), limit: int = Query(60, ge=1, le=100)):
    query_vector = None
    if semantic and q.strip():
        from .ml import predict
        try:
            query_vector, _, _ = await predict(query=q)
        except (httpx.HTTPError, ValueError, KeyError) as error:
            raise HTTPException(503, f"Ricerca semantica non disponibile: {type(error).__name__}. Usa la ricerca testuale.") from None
    with session() as database:
        statement = select(Asset).where(Asset.kind == kind, Asset.deleted == deleted)
        if favorite:
            statement = statement.where(Asset.favorite.is_(True))
        if root_id:
            statement = statement.where(Asset.root_id == root_id)
        if input_id:
            statement = statement.where(Asset.input_id == input_id)
        if job_id:
            statement = statement.where(Asset.job_id == job_id)
        if prompt_id or operation or (q and not semantic):
            statement = statement.outerjoin(Job, Job.id == Asset.job_id)
        if prompt_id:
            statement = statement.where(Job.prompt_id == prompt_id)
        if operation:
            statement = statement.where(Job.operation == operation)
        if q and not semantic:
            statement = statement.where(or_(Asset.name.icontains(q, autoescape=True), Job.instruction.icontains(q, autoescape=True)))
        if tag_id:
            statement = statement.where(Asset.id.in_(select(AssetTag.asset_id).where(AssetTag.tag_id == tag_id, AssetTag.state.in_(["accepted", "manual"]))))
        if person_id:
            statement = statement.where(Asset.id.in_(select(Face.asset_id).where(Face.person_id == person_id)))
        if query_vector:
            from .ml import MODEL, similarity
            statement = statement.where(Asset.model == MODEL)
            if engine.dialect.name == "postgresql":
                statement = statement.order_by(text("(SELECT embedding <=> CAST(:search_vector AS vector) FROM asset_vectors WHERE asset_id=assets.id AND model=:search_model) ASC NULLS LAST"))
                page = list(database.scalars(statement.params(search_vector=json.dumps(query_vector), search_model=MODEL).offset(offset).limit(limit + 1)))
            else:
                rows = sorted(database.scalars(statement), key=lambda row: similarity(query_vector, row.embedding), reverse=True)
                page = rows[offset:offset + limit + 1]
        else:
            page = list(database.scalars(statement.order_by(Asset.created.desc(), Asset.id).offset(offset).limit(limit + 1)))
        return {"items": [asset_data(database, asset) for asset in page[:limit]], "next": offset + limit if len(page) > limit else None}


@app.get("/api/assets/{identity}/file/{variant}", dependencies=[Depends(auth.authenticated)])
def asset_file(identity: str, variant: str, download: bool = False):
    if variant not in {"original", "preview", "thumb"}:
        raise HTTPException(404)
    with session() as database:
        asset = get(database, Asset, identity)
        return FileResponse(location(asset, variant), media_type=asset.mime if variant == "original" else "image/webp",
                            filename=asset.name if download else None)


@app.get("/api/assets/{identity}", dependencies=[Depends(auth.authenticated)])
def detail(identity: str):
    with session() as database:
        asset = get(database, Asset, identity)
        value = asset_data(database, asset)
        value["job"] = job_data(database.get(Job, asset.job_id)) if asset.job_id else None
        value["original"] = asset_data(database, database.get(Asset, asset.root_id)) if asset.root_id else None
        value["input"] = asset_data(database, database.get(Asset, asset.input_id)) if asset.input_id else None
        value["faces"] = [{"id": row.id, "box": row.box, "person_id": row.person_id, "locked": row.locked} for row in database.scalars(select(Face).where(Face.asset_id == identity))]
        value["tags"] = [{"id": tag.id, "name": tag.name, "state": assignment.state, "score": assignment.score} for assignment, tag in database.execute(select(AssetTag, Tag).join(Tag).where(AssetTag.asset_id == identity, AssetTag.state != "rejected"))]
        return value


@app.patch("/api/assets/{identity}", dependencies=[Depends(auth.authenticated)])
def patch_asset(identity: str, payload: dict):
    with session() as database:
        asset = get(database, Asset, identity)
        for key in ("favorite", "deleted"):
            if key in payload:
                setattr(asset, key, bool(payload[key]))
        if payload.get("reanalyze"):
            asset.analysis, asset.analysis_attempts, asset.analysis_after = "pending", 0, 0
            asset.analysis_error = ""
        return asset_data(database, asset)


@app.get("/api/jobs", dependencies=[Depends(auth.authenticated)])
def jobs():
    with session() as database:
        active = list(database.scalars(select(Job).where(Job.status.in_(["queued", "submitting", "running", "needs_attention"])).order_by(Job.priority.desc(), Job.created)))
        recent = list(database.scalars(select(Job).where(Job.status.in_(["succeeded", "failed", "cancelled"])).order_by(Job.updated.desc()).limit(100)))
        rows = active + recent
        identities = [job.id for job in rows]
        timings = {timing.job_id: timing for timing in database.scalars(select(JobTiming).where(JobTiming.job_id.in_(identities)))}
        outputs = {}
        for asset in database.scalars(select(Asset).where(Asset.job_id.in_(identities), Asset.deleted.is_(False)).order_by(Asset.created, Asset.id)):
            outputs.setdefault(asset.job_id, []).append({"id": asset.id, "name": asset.name, "thumb": f"/api/assets/{asset.id}/file/thumb"})
        result = []
        for job in rows:
            timing = timings.get(job.id)
            duration = max(0, (timing.finished - timing.started).total_seconds()) if timing and timing.finished else None
            result.append({**job_data(job), "outputs": outputs.get(job.id, []), "duration_seconds": duration})
        return result


@app.post("/api/jobs", dependencies=[Depends(auth.authenticated)])
def add_job(payload: JobInput):
    try:
        with session() as database:
            return job_data(enqueue(database, payload))
    except IntegrityError:
        with session() as database:
            row = database.scalar(select(Job).where(Job.token == payload.token))
            if row:
                return job_data(row)
        raise HTTPException(409, "Conflitto: ricarica la coda") from None


@app.patch("/api/jobs/{identity}", dependencies=[Depends(auth.authenticated)])
def patch_job(identity: str, payload: dict):
    with session() as database:
        job = database.scalar(select(Job).where(Job.id == identity).with_for_update())
        if not job:
            raise HTTPException(404)
        action = payload.get("action")
        if action == "cancel" and job.status == "queued":
            job.status = "cancelled"
        elif action == "priority" and job.status == "queued":
            job.priority = min(100, max(-100, int(payload.get("priority", 0))))
        elif action == "resolve" and job.status == "needs_attention" and payload.get("confirmed"):
            job.status, job.error = "failed", "Risolto manualmente dopo verifica ComfyUI"
        else:
            raise HTTPException(409, "Azione non disponibile nello stato corrente")
        job.updated = now()
        return job_data(job)


@app.post("/api/jobs/{identity}/retry", dependencies=[Depends(auth.authenticated)])
def retry_job(identity: str, payload: dict):
    request_token = str(payload.get("token", ""))
    if not 8 <= len(request_token) <= 100:
        raise HTTPException(400, "Token di richiesta non valido")
    with session() as database:
        existing = database.scalar(select(Job).where(Job.token == request_token))
        if existing:
            return job_data(existing)
        source = get(database, Job, identity)
        if source.status not in {"failed", "cancelled"}:
            raise HTTPException(409, "Verifica prima che il lavoro non sia attivo")
        retry = Job(token=request_token, operation=source.operation, input_id=source.input_id, root_id=source.root_id,
                    prompt_id=source.prompt_id, prompt_version=source.prompt_version, instruction=source.instruction,
                    addition=source.addition, settings=copy.deepcopy(source.settings), workflow=copy.deepcopy(source.workflow),
                    workflow_hash=source.workflow_hash)
        database.add(retry)
        database.flush()
        return job_data(retry)


@app.post("/api/jobs/{identity}/recover", dependencies=[Depends(auth.authenticated)])
async def recover_job(identity: str):
    from .worker import monitor
    with session() as database:
        job = get(database, Job, identity)
        if job.status != "needs_attention" or not job.comfy_id:
            raise HTTPException(409, "Nessun invio confermato da recuperare")
        job.status = "running"
    async with httpx.AsyncClient(base_url=COMFYUI_URL, timeout=60) as client:
        await monitor(client, job)
    return {"ok": True}


@app.get("/api/events", dependencies=[Depends(auth.authenticated)])
async def events(request: Request):
    async def stream():
        while not await request.is_disconnected():
            yield "event: refresh\ndata: {}\n\n"
            await asyncio.sleep(4)
    return StreamingResponse(stream(), media_type="text/event-stream", headers={"X-Accel-Buffering": "no"})


@app.get("/api/diagnostics", dependencies=[Depends(auth.authenticated)])
async def diagnostics():
    result = {}
    async with httpx.AsyncClient(timeout=8) as client:
        for name, url in (("comfyui", f"{COMFYUI_URL}/system_stats"), ("immich_ml", f"{IMMICH_ML_URL}/ping" if IMMICH_ML_URL else "")):
            try:
                if not url:
                    raise ValueError("Endpoint non configurato")
                response = await client.get(url)
                response.raise_for_status()
                result[name] = {"ok": True}
            except Exception as error:
                result[name] = {"ok": False, "error": type(error).__name__}
    return result


@app.post("/api/diagnostics/ml", dependencies=[Depends(auth.authenticated)])
async def diagnostic_inference():
    from .ml import MODEL, predict
    try:
        embedding, _, _ = await predict(query="Una fotografia di un paesaggio")
        return {"ok": True, "model": MODEL, "dimensions": len(embedding)}
    except Exception as error:
        raise HTTPException(503, f"Inferenza non riuscita: {type(error).__name__}") from None


@app.get("/api/loras", dependencies=[Depends(auth.authenticated)])
async def loras():
    try:
        async with httpx.AsyncClient(base_url=COMFYUI_URL, timeout=10) as client:
            response = await client.get("/object_info/LoraLoaderModelOnly")
            response.raise_for_status()
            return response.json()["LoraLoaderModelOnly"]["input"]["required"]["lora_name"][0]
    except Exception:
        return []


@app.get("/api/tags", dependencies=[Depends(auth.authenticated)])
def tags():
    with session() as database:
        return [{key: value for key, value in serialize(row).items() if key != "embedding"} for row in database.scalars(select(Tag).order_by(Tag.name))]


@app.post("/api/tags", dependencies=[Depends(auth.authenticated)])
def save_tag(payload: dict):
    name = str(payload.get("name", "")).strip()[:80]
    threshold = float(payload.get("threshold", 0.25))
    if not name or not -1 <= threshold <= 1:
        raise HTTPException(400, "Nome e soglia (-1..1) obbligatori")
    with session() as database:
        row = database.scalar(select(Tag).where(Tag.name == name))
        if not row:
            row = Tag(name=name)
            database.add(row)
        row.description = str(payload.get("description") or name)[:300]
        row.threshold = threshold
        if "automatic" in payload:
            row.automatic = bool(payload["automatic"])
        row.embedding, row.model = None, ""
        for asset in database.scalars(select(Asset).where(Asset.deleted.is_(False))):
            asset.analysis, asset.analysis_after, asset.analysis_attempts = "pending", 0, 0
        database.flush()
        return {"id": row.id, "name": row.name}


@app.put("/api/assets/{identity}/tags/{tag_id}", dependencies=[Depends(auth.authenticated)])
def assign_tag(identity: str, tag_id: str, payload: dict):
    state = payload.get("state", "manual")
    if state not in {"manual", "accepted", "rejected"}:
        raise HTTPException(400)
    with session() as database:
        get(database, Asset, identity)
        get(database, Tag, tag_id)
        row = database.get(AssetTag, (identity, tag_id))
        if not row:
            row = AssetTag(asset_id=identity, tag_id=tag_id)
            database.add(row)
        row.state = state
    return {"ok": True}


@app.get("/api/people", dependencies=[Depends(auth.authenticated)])
def people():
    with session() as database:
        result = []
        for person in database.scalars(select(Person)):
            faces = list(database.scalars(select(Face).where(Face.person_id == person.id)))
            if faces:
                result.append({"id": person.id, "name": person.name, "count": len({face.asset_id for face in faces}),
                               "asset_id": faces[0].asset_id})
        return result


@app.patch("/api/people/{identity}", dependencies=[Depends(auth.authenticated)])
def edit_person(identity: str, payload: dict):
    with session() as database:
        person = get(database, Person, identity)
        if payload.get("name"):
            person.name = str(payload["name"])[:100]
        if payload.get("merge_into"):
            target = get(database, Person, payload["merge_into"])
            if target.id == identity:
                raise HTTPException(400)
            for face in database.scalars(select(Face).where(Face.person_id == identity)):
                face.person_id, face.locked = target.id, True
            database.delete(person)
    return {"ok": True}


@app.patch("/api/faces/{identity}", dependencies=[Depends(auth.authenticated)])
def assign_face(identity: str, payload: dict):
    with session() as database:
        face = get(database, Face, identity)
        person_id = payload.get("person_id")
        if payload.get("new_person"):
            person = Person(name=str(payload["new_person"])[:100])
            database.add(person)
            database.flush()
            person_id = person.id
        if person_id:
            get(database, Person, person_id)
        face.person_id, face.locked = person_id, True
    return {"ok": True}