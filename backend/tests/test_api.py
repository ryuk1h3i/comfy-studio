import io
import uuid
from fastapi.testclient import TestClient
from PIL import Image
from app.config import ADMIN_PASSWORD
from app.main import app


def test_bulk_prompts_are_validated_and_versioned():
    with TestClient(app) as client:
        login = client.post("/api/login", json={"password": ADMIN_PASSWORD})
        client.headers["x-csrf-token"] = login.json()["csrf"]
        response = client.post("/api/prompts/bulk", json={"items": [{"title": "Bulk uno", "text": "Prima istruzione"}, {"title": "Bulk due", "text": "Seconda istruzione"}]})
        assert response.status_code == 200
        assert len(response.json()["items"]) == 2
        for item in response.json()["items"]:
            detail = client.get(f"/api/prompts/{item['id']}").json()
            assert detail["versions"][0]["text"] == item["text"]
        invalid = client.post("/api/prompts/bulk", json={"items": [{"title": "Valid", "text": "valid"}, {"title": "Invalid", "text": ""}]})
        assert invalid.status_code == 422
        assert client.post("/api/prompts/bulk", json={"items": []}).status_code == 422
        client.headers.pop("x-csrf-token")
        assert client.post("/api/prompts/bulk", json={"items": [{"title": "Uno", "text": "Test"}]}).status_code == 403


def test_reanalyze_resets_previous_failure():
    from app.db import Asset, session

    with TestClient(app) as client:
        login = client.post("/api/login", json={"password": ADMIN_PASSWORD})
        client.headers["x-csrf-token"] = login.json()["csrf"]
        image = io.BytesIO()
        Image.new("RGB", (32, 24), "green").save(image, "PNG")
        asset = client.post("/api/assets", files={"file": ("analysis.png", image.getvalue(), "image/png")}).json()
        with session() as database:
            row = database.get(Asset, asset["id"])
            row.analysis = "failed"
            row.analysis_attempts = 5
            row.analysis_after = 9999999999
            row.analysis_error = "Previous ML error"
        response = client.patch(f"/api/assets/{asset['id']}", json={"reanalyze": True})
        assert response.status_code == 200
        assert response.json()["analysis"] == "pending"
        assert response.json()["analysis_error"] == ""
        with session() as database:
            row = database.get(Asset, asset["id"])
            assert row.analysis_attempts == 0
            assert row.analysis_after == 0


def test_job_results_and_duration():
    from datetime import timedelta
    from app.db import Job, JobTiming, now, session
    from app.storage import store

    with TestClient(app) as client:
        login = client.post("/api/login", json={"password": ADMIN_PASSWORD})
        client.headers["x-csrf-token"] = login.json()["csrf"]
        job = client.post("/api/jobs", json={"token": uuid.uuid4().hex, "instruction": "Result test"}).json()
        image = io.BytesIO()
        Image.new("RGB", (32, 24), "yellow").save(image, "PNG")
        with session() as database:
            row = database.get(Job, job["id"])
            row.status = "succeeded"
            started = now() - timedelta(seconds=125)
            database.add(JobTiming(job_id=row.id, started=started, finished=started + timedelta(seconds=125)))
            asset = store(database, image.getvalue(), "generated.png", "edit", row, f"{row.id}:0")
        listed = next(item for item in client.get("/api/jobs").json() if item["id"] == job["id"])
        assert listed["duration_seconds"] == 125
        assert listed["outputs"] == [{"id": asset.id, "name": "generated.png", "thumb": f"/api/assets/{asset.id}/file/thumb"}]
        client.patch(f"/api/assets/{asset.id}", json={"deleted": True})
        listed = next(item for item in client.get("/api/jobs").json() if item["id"] == job["id"])
        assert listed["outputs"] == []


def test_end_to_end_archive_queue_and_snapshot():
    with TestClient(app) as client:
        assert client.get("/api/settings").status_code == 401
        result = client.post("/api/login", json={"password": ADMIN_PASSWORD})
        assert result.status_code == 200
        client.headers["x-csrf-token"] = result.json()["csrf"]
        preset = client.post("/api/prompts", json={"title": "Cielo", "text": "Cielo sereno"}).json()
        image = io.BytesIO()
        Image.new("RGB", (32, 24), "green").save(image, "PNG")
        original = client.post("/api/assets", files={"file": ("photo.png", image.getvalue(), "image/png")}).json()
        payload = {"token": uuid.uuid4().hex, "operation": "edit", "input_id": original["id"], "prompt_id": preset["id"], "instruction": "Senza nuvole"}
        first = client.post("/api/jobs", json=payload)
        assert first.status_code == 200, first.text
        job = first.json()
        assert job["root_id"] == original["id"]
        assert job["instruction"] == "Cielo sereno\n\nSenza nuvole"
        assert client.post("/api/jobs", json=payload).json()["id"] == job["id"]
        assert client.put(f"/api/prompts/{preset['id']}", json={"title": "Cielo", "text": "Pioggia", "version": 1}).status_code == 200
        assert client.put(f"/api/prompts/{preset['id']}", json={"title": "Cielo", "text": "stale", "version": 1}).status_code == 409
        assert next(row for row in client.get("/api/jobs").json() if row["id"] == job["id"])["instruction"] == job["instruction"]
        assert client.get(f"/api/assets/{original['id']}/file/preview").status_code == 200
        tag_response = client.post("/api/tags", json={"name": f"Mare-{uuid.uuid4().hex[:6]}", "description": "Una fotografia del mare", "threshold": 0.3})
        assert tag_response.status_code == 200
        tag = tag_response.json()
        assert client.get("/api/tags").status_code == 200
        assert client.put(f"/api/assets/{original['id']}/tags/{tag['id']}", json={"state": "manual"}).status_code == 200
        details = client.get(f"/api/assets/{original['id']}")
        assert details.status_code == 200, details.text
        assert details.json()["tags"][0]["state"] == "manual"
        assert client.get(f"/api/assets?tag_id={tag['id']}").json()["items"][0]["id"] == original["id"]
        assert client.get("/api/people").status_code == 200
        assert client.patch(f"/api/jobs/{job['id']}", json={"action": "cancel"}).status_code == 200
        assert client.post("/api/jobs", json={"token": uuid.uuid4().hex, "operation": "create", "instruction": "Test"}).json()["root_id"] is None
        assert client.post("/api/assets", files={"file": ("fake.png", b"broken", "image/png")}).status_code == 400
        client.headers.pop("x-csrf-token")
        assert client.post("/api/jobs", json=payload).status_code == 403