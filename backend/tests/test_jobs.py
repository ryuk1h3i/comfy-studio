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
        repeated = enqueue(database, JobInput(token=uuid.uuid4().hex, input_id=output.id, action="repeat", settings={"workflow": "flux3"}))
        assert repeated.operation == operation
        assert repeated.settings["workflow"] == "flux3"
        assert repeated.settings["seed"] != source.settings["seed"]
        assert repeated.workflow["13"]["inputs"]["seed"] == repeated.settings["seed"]
        assert "noise_seed" not in repeated.workflow["13"]["inputs"]
        variation = enqueue(database, JobInput(token=uuid.uuid4().hex, input_id=output.id, action="vary", instruction="Night", settings={"workflow": "flux3"}))
        assert variation.settings["workflow"] == "flux3"
        assert variation.workflow["7"]["inputs"]["value"] == "Night"


@pytest.mark.parametrize("selected_workflow", ["flux2", "flux3"])
@pytest.mark.parametrize("action", ["repeat", "vary"])
def test_result_actions_use_selected_workflow(selected_workflow, action):
    initialize()
    with session() as database:
        source_workflow = "flux3" if selected_workflow == "flux2" else "flux2"
        source = enqueue(database, JobInput(token=uuid.uuid4().hex, instruction="A landscape",
                         settings={"workflow": source_workflow, "loras": []}))
        output = Asset(kind="edit", name="result.png", checksum="switch", width=32, height=32,
                       mime="image/png", extension="png", job_id=source.id)
        database.add(output)
        database.flush()
        from app.db import Settings
        saved = database.get(Settings, 1)
        previous = saved.value if saved else None
        if not saved:
            saved = Settings(id=1)
            database.add(saved)
        saved.value = {"workflow": selected_workflow}
        database.flush()
        try:
            result = enqueue(database, JobInput(token=uuid.uuid4().hex, input_id=output.id,
                             action=action, instruction="Night"))
            assert result.settings["workflow"] == selected_workflow
            expected_loader = "UNETLoader" if selected_workflow == "flux3" else "UnetLoaderGGUF"
            assert result.workflow["1"]["class_type"] == expected_loader
            assert source.settings["workflow"] == source_workflow
        finally:
            if previous is None:
                database.delete(saved)
            else:
                saved.value = previous