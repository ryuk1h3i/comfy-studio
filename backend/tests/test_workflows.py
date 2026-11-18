import copy
import pytest
from app.config import DEFAULTS
from app.workflows import build, new_seed, validate_settings


@pytest.mark.parametrize("operation", ["create", "edit", "upscale"])
def test_workflow_contract(operation):
    settings = validate_settings(DEFAULTS)
    graph, snapshot, digest = build(operation, settings, "Un cielo sereno")
    assert len(digest) == 64
    assert "seed" in snapshot and "seed" not in settings
    if operation == "upscale":
        assert graph["1"]["inputs"]["image"] == "__STUDIO_INPUT__"
        assert snapshot["seed"] > 2**32
    else:
        assert graph["7"]["inputs"]["text"] == "Un cielo sereno"
        assert graph["12"]["inputs"]["model"] == ["20", 0]


def test_standard_edit_no_lora_and_order():
    settings = copy.deepcopy(DEFAULTS)
    settings.update(loras=[])
    graph, _, _ = build("edit", settings, "test")
    assert "20" not in graph
    settings["loras"] = [{"name": "first", "weight": 0.5}, {"name": "second", "weight": -1}]
    graph, _, _ = build("edit", settings, "test")
    last_id = graph["12"]["inputs"]["model"][0]
    assert last_id != "20"
    assert graph[last_id]["inputs"]["model"] == ["20", 0]
    assert graph[last_id]["inputs"]["lora_name"] == "second"


def test_validation_and_seed():
    for weight in [float("nan"), float("inf"), 5]:
        value = copy.deepcopy(DEFAULTS)
        value["loras"][0]["weight"] = weight
        with pytest.raises(ValueError):
            validate_settings(value)
    assert new_seed(42) != 42


def test_workflow_validation_and_legacy_settings():
    settings = copy.deepcopy(DEFAULTS)
    settings.pop("workflow")
    assert validate_settings(settings)["workflow"] == "flux2"
    settings["workflow"] = "unknown"
    with pytest.raises(ValueError, match="Workflow"):
        validate_settings(settings)


@pytest.mark.parametrize("operation", ["create", "edit", "upscale"])
def test_flux3_shared_settings(operation):
    settings = copy.deepcopy(DEFAULTS)
    settings.update(workflow="flux3", seed=123, edit_resolution=0.8, generation_resolution=[1024, 512])
    graph, snapshot, digest = build(operation, validate_settings(settings), "Una camicia rossa")
    assert len(digest) == 64
    assert snapshot == settings
    if operation == "upscale":
        assert graph["66:54"]["inputs"]["seed"] == 123
        assert graph["66:57"]["inputs"]["resize_type.multiplier"] == settings["upscale_factor"]
    else:
        assert graph["7"]["inputs"]["value"] == "Una camicia rossa"
        assert graph["13"]["inputs"]["seed"] == 123
        assert not any(node["class_type"] == "LoraLoaderModelOnly" for node in graph.values())
        if operation == "edit":
            assert graph["5"]["inputs"]["megapixels"] == 0.8
            assert graph["4"]["inputs"]["image"] == "__STUDIO_INPUT__"
        else:
            assert graph["18"]["inputs"] == {"width": 1024, "height": 512, "batch_size": 1}
            assert not any(node["class_type"] == "LoadImage" for node in graph.values())
        for node in graph.values():
            for value in node["inputs"].values():
                if isinstance(value, list):
                    assert value[0] in graph
    assert "seed" not in DEFAULTS