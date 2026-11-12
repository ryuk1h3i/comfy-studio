import io
from PIL import Image
import pytest
from app.db import initialize, session, Asset
from app.storage import store, location


def test_storage_and_dedup():
    initialize()
    output = io.BytesIO()
    Image.new("RGBA", (20, 10), (200, 20, 30, 128)).save(output, "PNG")
    with session() as database:
        first = store(database, output.getvalue(), "../test.png")
        second = store(database, output.getvalue(), "second.png")
        assert first.id == second.id
        assert first.name == "test.png"
        assert location(first).read_bytes() == output.getvalue()
        assert Image.open(location(first, "thumb")).size == (20, 10)
    with session() as database:
        with pytest.raises(Exception):
            store(database, b"not an image", "fake.png")


def test_outputs_have_separate_pixel_limit(monkeypatch):
    import app.storage as storage
    monkeypatch.setattr(storage, "MAX_PIXELS", 100)
    output = io.BytesIO()
    Image.new("RGB", (40, 20), "red").save(output, "PNG")
    with session() as database:
        with pytest.raises(ValueError):
            store(database, output.getvalue(), "oversize.png")
        asset = store(database, output.getvalue(), "upscale.png", kind="edit")
        assert asset.width == 40