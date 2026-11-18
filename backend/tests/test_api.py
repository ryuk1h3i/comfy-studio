import io
import uuid
from fastapi.testclient import TestClient
from PIL import Image
from app.config import ADMIN_PASSWORD
from app.main import app


def test_workflow_selection_preserves_shared_settings():
    with TestClient(app) as client:
        login = client.post("/api/login", json={"password": ADMIN_PASSWORD})
        client.headers["x-csrf-token"] = login.json()["csrf"]
        original = client.get("/api/settings").json()
        shared = {
            "edit_resolution": 0.6, "generation_resolution": [1024, 512],
            "upscale_factor": 2.5, "loras": [{"name": "custom.safetensors", "weight": 0.5}],
            "active_slot": "0", "quick_slots": {},
        }
        try:
            assert client.put("/api/settings", json=shared).status_code == 200
            for workflow in ("flux3", "flux2"):
                assert client.put("/api/settings", json={"workflow": workflow}).status_code == 200
                saved = client.get("/api/settings").json()
                assert saved["workflow"] == workflow
                assert all(saved[key] == value for key, value in shared.items())
            assert client.put("/api/settings", json={"workflow": "invalid"}).status_code == 400
            assert client.get("/api/settings").json()["workflow"] == "flux2"
        finally:
            client.put("/api/settings", json=original)


def test_retry_rebuilds_graph_after_workflow_change():
    from app.db import Job, session

    with TestClient(app) as client:
        login = client.post("/api/login", json={"password": ADMIN_PASSWORD})
        client.headers["x-csrf-token"] = login.json()["csrf"]
        original = client.get("/api/settings").json()
        try:
            for source_workflow, selected_workflow in (("flux2", "flux3"), ("flux3", "flux2")):
                response = client.post("/api/jobs", json={"token": uuid.uuid4().hex, "operation": "create",
                                       "instruction": "A landscape", "use_active": False,
                                       "settings": {"workflow": source_workflow, "loras": []}})
                assert response.status_code == 200
                source_id = response.json()["id"]
                with session() as database:
                    source = database.get(Job, source_id)
                    source.status = "failed"
                    original_seed = source.settings["seed"]
                assert client.put("/api/settings", json={"workflow": selected_workflow}).status_code == 200
                token = uuid.uuid4().hex
                retry = client.post(f"/api/jobs/{source_id}/retry", json={"token": token})
                assert retry.status_code == 200
                with session() as database:
                    result = database.get(Job, retry.json()["id"])
                    assert result.settings["workflow"] == selected_workflow
                    assert result.settings["seed"] == original_seed
                    expected_loader = "UNETLoader" if selected_workflow == "flux3" else "UnetLoaderGGUF"
                    assert result.workflow["1"]["class_type"] == expected_loader
                    assert database.get(Job, source_id).settings["workflow"] == source_workflow
                assert client.post(f"/api/jobs/{source_id}/retry", json={"token": token}).json()["id"] == retry.json()["id"]
        finally:
            client.put("/api/settings", json=original)


def test_prompt_and_image_edit_uses_saved_flux3_workflow():
    from app.db import Job, session

    with TestClient(app) as client:
        login = client.post("/api/login", json={"password": ADMIN_PASSWORD})
        client.headers["x-csrf-token"] = login.json()["csrf"]
        original = client.get("/api/settings").json()
        try:
            assert client.put("/api/settings", json={"workflow": "flux3"}).status_code == 200
            prompt = client.post("/api/prompts", json={"title": "Flux3 edit", "text": "Change the sky"}).json()
            image = io.BytesIO()
            Image.new("RGB", (32, 24), "green").save(image, "PNG")
            asset = client.post("/api/assets", files={"file": ("flux3-edit.png", image.getvalue(), "image/png")}).json()
            for overrides in ({}, {"workflow": "flux3"}):
                response = client.post("/api/jobs", json={"token": uuid.uuid4().hex, "operation": "edit",
                                       "input_id": asset["id"], "prompt_id": prompt["id"], "settings": overrides})
                assert response.status_code == 200
                with session() as database:
                    result = database.get(Job, response.json()["id"])
                    assert result.settings["workflow"] == "flux3"
                    assert result.workflow["1"]["class_type"] == "UNETLoader"
                    assert result.workflow["7"]["inputs"]["value"] == "Change the sky"
                    assert result.workflow["4"]["inputs"]["image"] == "__STUDIO_INPUT__"
                    assert not any(node["class_type"] == "UnetLoaderGGUF" for node in result.workflow.values())
        finally:
            client.put("/api/settings", json=original)


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


def test_prompt_list_shows_latest_available_thumbnail():
    from datetime import timedelta
    from app.db import Job, now, session
    from app.storage import store

    with TestClient(app) as client:
        login = client.post("/api/login", json={"password": ADMIN_PASSWORD})
        client.headers["x-csrf-token"] = login.json()["csrf"]
        title = f"Thumbnail-{uuid.uuid4().hex}"
        preset = client.post("/api/prompts", json={"title": title, "text": "A landscape"}).json()

        def listed_prompt():
            return client.get("/api/prompts", params={"q": title}).json()["items"][0]

        assert listed_prompt()["latest_thumb"] is None
        job = client.post("/api/jobs", json={"token": uuid.uuid4().hex, "operation": "create", "prompt_id": preset["id"]}).json()
        image = io.BytesIO()
        Image.new("RGB", (32, 24), "green").save(image, "PNG")
        with session() as database:
            row = database.get(Job, job["id"])
            older = store(database, image.getvalue(), "older.png", "edit", row, f"{row.id}:0")
            older.created = now() - timedelta(minutes=1)
            latest = store(database, image.getvalue(), "latest.png", "edit", row, f"{row.id}:1")
        assert listed_prompt()["latest_thumb"] == f"/api/assets/{latest.id}/file/thumb"
        assert client.get(listed_prompt()["latest_thumb"]).status_code == 200
        client.patch(f"/api/assets/{latest.id}", json={"deleted": True})
        assert listed_prompt()["latest_thumb"] == f"/api/assets/{older.id}/file/thumb"
        client.patch(f"/api/assets/{older.id}", json={"deleted": True})
        assert listed_prompt()["latest_thumb"] is None


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