import copy
import hashlib
import json
import math
import secrets

from .config import WORKFLOWS

TEMPLATES = {
    "create": "flux2-klein-9b-q4-create-api.json",
    "edit": "flux2-klein-9b-q4-edit-api.json",
    "upscale": "seedvr2-upscale-api.json",
}


def validate_settings(value):
    result = copy.deepcopy(value)
    if not 0.1 <= float(result["edit_resolution"]) <= 4 or not 1 <= float(result["upscale_factor"]) <= 4:
        raise ValueError("Edit: 0.1-4 MP; upscale: 1-4x")
    dimensions = result["generation_resolution"]
    if len(dimensions) != 2 or any(type(side) is not int or not 256 <= side <= 2048 or side % 16 for side in dimensions):
        raise ValueError("Dimensioni: 256-2048, multipli di 16")
    if len(result["loras"]) > 10:
        raise ValueError("Massimo 10 LoRA")
    for item in result["loras"]:
        name, weight = item["name"], float(item["weight"])
        if not name.strip() or len(name) > 180 or any(ord(char) < 32 or char == "|" for char in name):
            raise ValueError("Nome LoRA non valido")
        if not math.isfinite(weight) or not -4 <= weight <= 4:
            raise ValueError("Peso LoRA: da -4 a 4")
        item["weight"] = weight
    if "seed" in result and (type(result["seed"]) is not int or not 0 <= result["seed"] < 2**63):
        raise ValueError("Seed non valido")
    if result.get("active_slot", "0") not in {str(number) for number in range(6)}:
        raise ValueError("Slot non valido")
    if any(key not in {str(number) for number in range(1, 6)} for key in result.get("quick_slots", {})):
        raise ValueError("Slot non valido")
    return result


def new_seed(previous):
    return (int(previous) + 1 + secrets.randbelow(2**32 - 1)) % 2**32


def build(operation, settings, instruction, template=None):
    key = operation
    prompt = copy.deepcopy(template) if template is not None else json.loads((WORKFLOWS / TEMPLATES[key]).read_text())
    seed_node, seed_key = ("66:54", "seed") if operation == "upscale" else ("13", "noise_seed")
    settings = copy.deepcopy(settings)
    settings.setdefault("seed", prompt[seed_node]["inputs"][seed_key])
    prompt[seed_node]["inputs"][seed_key] = settings["seed"]
    if operation == "upscale":
        prompt["1"]["inputs"]["image"] = "__STUDIO_INPUT__"
        prompt["66:57"]["inputs"]["resize_type.multiplier"] = settings["upscale_factor"]
    else:
        prompt["7"]["inputs"]["text"] = instruction
        if operation == "edit":
            prompt["4"]["inputs"]["image"] = "__STUDIO_INPUT__"
            prompt["5"]["inputs"]["megapixels"] = settings["edit_resolution"]
        else:
            for node_id in ("15", "16"):
                prompt[node_id]["inputs"].update(zip(("width", "height"), settings["generation_resolution"]))
        reference = prompt.pop("20")["inputs"]["model"]
        next_id = max(20, *(int(node_id) for node_id in prompt)) + 1
        for index, item in enumerate(settings["loras"]):
            node_id = "20" if index == 0 else str(next_id)
            next_id += int(index > 0)
            prompt[node_id] = {"class_type": "LoraLoaderModelOnly", "inputs": {
                "model": reference, "lora_name": item["name"], "strength_model": item["weight"]}}
            reference = [node_id, 0]
        prompt["12"]["inputs"]["model"] = reference
        prompt["19"]["inputs"]["filename_prefix"] = "Studio-Klein9B"
    return prompt, settings, hashlib.sha256(json.dumps(prompt, sort_keys=True).encode()).hexdigest()