import hashlib
import io
import os
import shutil
import warnings
from pathlib import Path

from PIL import Image, ImageOps

from .config import DATA, DISK_RESERVE, MAX_OUTPUT_PIXELS, MAX_PIXELS, MAX_UPLOAD
from .db import Asset, identifier

Image.MAX_IMAGE_PIXELS = max(MAX_PIXELS, MAX_OUTPUT_PIXELS)


def location(asset, variant="original"):
    extension = asset.extension if variant == "original" else "png" if variant == "working" else "webp"
    return DATA / "assets" / asset.id / f"{variant}.{extension}"


def atomic_write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("wb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)


def store(database, data, name, kind="original", job=None, output_key=None):
    if len(data) > (MAX_UPLOAD if kind == "original" else 150 * 1024 * 1024):
        raise ValueError("File troppo grande")
    if shutil.disk_usage(DATA).free < DISK_RESERVE + len(data) * 4:
        raise ValueError("Spazio su disco insufficiente")
    checksum = hashlib.sha256(data).hexdigest()
    if kind == "original":
        existing = database.query(Asset).filter_by(kind="original", checksum=checksum, deleted=False).first()
        if existing:
            return existing
    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        with Image.open(io.BytesIO(data)) as image:
            pixel_limit = MAX_PIXELS if kind == "original" else MAX_OUTPUT_PIXELS
            if image.format not in {"JPEG", "PNG", "WEBP"} or image.width * image.height > pixel_limit:
                raise ValueError("Usa JPEG, PNG o WebP entro il limite di pixel")
            extension = {"JPEG": "jpg", "PNG": "png", "WEBP": "webp"}[image.format]
            mime = Image.MIME[image.format]
            image.verify()
        with Image.open(io.BytesIO(data)) as source:
            image = ImageOps.exif_transpose(source)
            image = image.convert("RGBA" if "A" in image.getbands() or "transparency" in image.info else "RGB")
            image.info.clear()
            asset = Asset(id=identifier(), kind=kind, name=Path(name).name[:200] or "immagine",
                          checksum=checksum, width=image.width, height=image.height, mime=mime,
                          extension=extension, job_id=job.id if job else None, output_key=output_key,
                          input_id=job.input_id if job else None, root_id=job.root_id if job else None)
            atomic_write(location(asset), data)
            working = io.BytesIO()
            image.save(working, "PNG")
            atomic_write(location(asset, "working"), working.getvalue())
            for variant, edge in (("preview", 1920), ("thumb", 480)):
                resized = image.copy()
                resized.thumbnail((edge, edge))
                output = io.BytesIO()
                resized.save(output, "WEBP", quality=83)
                atomic_write(location(asset, variant), output.getvalue())
    database.add(asset)
    database.flush()
    return asset