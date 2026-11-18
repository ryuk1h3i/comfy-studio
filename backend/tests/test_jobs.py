import uuid
import pytest
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


@pytest.mark.parametrize("operation", ["create", "edit"])
def test_flux3_repeat_and_variation(operation):
    initialize()
    with session() as database:
        original = Asset(kind="original", name="input.png", checksum="flux3", width=32, height=32, mime="image/png", extension="png")
        database.add(original)
        database.flush()
        source = enqueue(database, JobInput(token=uuid.uuid4().hex, operation=operation,
                         input_id=original.id if operation == "edit" else None,
                         instruction="A landscape", settings={"workflow": "flux3"}))
        output = Asset(kind="edit", name="result.png", checksum="flux3-result", width=32, height=32, mime="image/png", extension="png", job_id=source.id)
        database.add(output)
        database.flush()
        repeated = enqueue(database, JobInput(token=uuid.uuid4().hex, input_id=output.id, action="repeat"))
        assert repeated.operation == operation
        assert repeated.settings["workflow"] == "flux3"
        assert repeated.settings["seed"] != source.settings["seed"]
        assert repeated.workflow["13"]["inputs"]["seed"] == repeated.settings["seed"]
        assert "noise_seed" not in repeated.workflow["13"]["inputs"]
        variation = enqueue(database, JobInput(token=uuid.uuid4().hex, input_id=output.id, action="vary", instruction="Night"))
        assert variation.settings["workflow"] == "flux3"
        assert variation.workflow["7"]["inputs"]["value"] == "Night"