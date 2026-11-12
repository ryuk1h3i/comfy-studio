import os
from pathlib import Path

DATA = Path(os.getenv("DATA_DIR", "data")).resolve()
DATA.mkdir(parents=True, exist_ok=True)
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{DATA / 'studio.db'}")
PRODUCTION = os.getenv("ENVIRONMENT", "development") == "production"
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "studio-local-change-me" if not PRODUCTION else "")
SESSION_SECRET = os.getenv("SESSION_SECRET", "")
if not SESSION_SECRET and not PRODUCTION:
    secret_file = DATA / ".session-secret"
    if not secret_file.exists():
        import secrets
        descriptor = os.open(secret_file, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(descriptor, "w") as stream:
            stream.write(secrets.token_hex(32))
    SESSION_SECRET = secret_file.read_text()
if not ADMIN_PASSWORD or len(SESSION_SECRET) < 32:
    raise RuntimeError("Impostare ADMIN_PASSWORD e SESSION_SECRET (almeno 32 caratteri).")
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "true" if PRODUCTION else "false").lower() == "true"
COMFYUI_URL = os.getenv("COMFYUI_URL", "http://127.0.0.1:8188").rstrip("/")
IMMICH_ML_URL = os.getenv("IMMICH_ML_URL", "").rstrip("/")
ML_PROTOCOL = os.getenv("IMMICH_ML_PROTOCOL", "pipeline")
CLIP_MODEL = os.getenv("CLIP_MODEL", "ViT-B-32__xlm-roberta-base-ViT-B-32")
FACE_MODEL = os.getenv("FACE_MODEL", "buffalo_l")
MODEL_REVISION = os.getenv("ML_MODEL_REVISION", "configured-v1")
WORKFLOWS = Path(os.getenv("WORKFLOW_DIR") or Path(__file__).resolve().parent.parent.parent / "workflows")
MAX_UPLOAD = int(os.getenv("MAX_UPLOAD_MB", "19")) * 1024 * 1024
MAX_PIXELS = int(os.getenv("MAX_IMAGE_PIXELS", "25000000"))
MAX_OUTPUT_PIXELS = int(os.getenv("MAX_OUTPUT_IMAGE_PIXELS", "100000000"))
JOB_TIMEOUT = int(os.getenv("JOB_TIMEOUT_SECONDS", "1200"))
ML_TIMEOUT = int(os.getenv("ML_TIMEOUT_SECONDS", "120"))
DISK_RESERVE = int(os.getenv("DISK_RESERVE_MB", "256")) * 1024 * 1024
DEFAULTS = {
    "edit_resolution": 2.0,
    "generation_resolution": [768, 768], "upscale_factor": 3.5,
    "loras": [{"name": os.getenv("LORA_NAME", "FLUX2_KLEIN_UNLOCKED_V2.safetensors"), "weight": 0.8}],
    "quick_slots": {}, "active_slot": "0", "queue_paused": False,
}