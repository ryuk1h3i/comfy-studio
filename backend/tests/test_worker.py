import io
import uuid
import httpx
import pytest
from PIL import Image
from sqlalchemy import select
from app.db import Asset, Job, JobTiming, initialize, session
from app.jobs import enqueue
from app.schemas import JobInput
from app.worker import execute, monitor
from app.worker import progress_event


def test_progress_is_scoped_to_remote_job():
    initialize()
    with session() as database:
        job = enqueue(database, JobInput(token=uuid.uuid4().hex, instruction="progress test"))
    progress_event(job.id, "remote-progress", {"type": "progress", "data": {"prompt_id": "remote-progress", "value": 3, "max": 10}})
    progress_event(job.id, "remote-progress", {"type": "progress", "data": {"prompt_id": "other", "value": 9, "max": 10}})
    progress_event(job.id, "remote-progress", {"type": "progress", "data": {"prompt_id": "remote-progress", "value": 9, "max": 0}})
    with session() as database:
        assert database.get(Job, job.id).progress == "Passi 3/10"


@pytest.mark.asyncio
async def test_worker_stores_output_once_and_recovers_without_resubmit():
    initialize()
    with session() as database:
        job = enqueue(database, JobInput(token=uuid.uuid4().hex, instruction="A landscape"))
    image = io.BytesIO()
    Image.new("RGB", (32, 24), "blue").save(image, "PNG")
    submissions = []
    def handler(request):
        if request.url.path == "/prompt":
            submissions.append(request)
            return httpx.Response(200, json={"prompt_id": "remote-123"})
        if request.url.path == "/history/remote-123":
            return httpx.Response(200, json={"remote-123": {"status": {"completed": True}, "outputs": {"19": {"images": [{"filename": "result.png"}]}}}})
        if request.url.path == "/view":
            return httpx.Response(200, content=image.getvalue())
        raise AssertionError(request.url.path)
    async with httpx.AsyncClient(base_url="http://comfy", transport=httpx.MockTransport(handler)) as client:
        await execute(client, job)
        await monitor(client, job)
    with session() as database:
        assert database.get(Job, job.id).status == "succeeded"
        timing = database.get(JobTiming, job.id)
        assert timing.finished >= timing.started
        assert len(list(database.scalars(select(Asset).where(Asset.job_id == job.id)))) == 1
    assert len(submissions) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("mode,expected", [("connection", "needs_attention"), ("rejected", "failed")])
async def test_no_blind_retry(mode, expected):
    initialize()
    with session() as database:
        job = enqueue(database, JobInput(token=uuid.uuid4().hex, instruction="test"))
    calls = []
    def handler(request):
        calls.append(request)
        if mode == "connection":
            raise httpx.ReadTimeout("uncertain", request=request)
        return httpx.Response(400, json={"error": "bad workflow"})
    async with httpx.AsyncClient(base_url="http://comfy", transport=httpx.MockTransport(handler)) as client:
        await execute(client, job)
    with session() as database:
        assert database.get(Job, job.id).status == expected
    assert len(calls) == 1