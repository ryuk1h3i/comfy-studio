import uuid
from app.config import DEFAULTS
from app.db import Asset, Job, initialize, session
from app.jobs import enqueue
from app.schemas import JobInput


def test_repeat_zero_loras_and_variation_lineage():
    initialize()
    with session() as database:
        source = enqueue(database, JobInput(token=uuid.uuid4().hex, instruction="A landscape", settings={"loras": []}))
        source.status = "succeeded"
        output = Asset(kind="edit", name="test.png", checksum="x", width=32, height=32, mime="image/png", extension="png", job_id=source.id)
        database.add(output)
        database.flush()
        repeated = enqueue(database, JobInput(token=uuid.uuid4().hex, input_id=output.id, action="repeat"))
        assert repeated.input_id is None and repeated.operation == "create"
        assert repeated.settings["seed"] != source.settings["seed"]
        assert repeated.instruction == source.instruction and "20" not in repeated.workflow
        variation = enqueue(database, JobInput(token=uuid.uuid4().hex, input_id=output.id, action="vary", instruction="Night"))
        assert variation.instruction == "Night" and variation.input_id == output.id
        assert variation.root_id is None and variation.operation == "edit"