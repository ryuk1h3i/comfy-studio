from typing import Literal
from pydantic import BaseModel, Field


class LoginInput(BaseModel):
    password: str = Field(max_length=1024)


class PrivacyInput(BaseModel):
    password: str = Field(min_length=1, max_length=1024)
    pin: str = Field(default="", pattern=r"^(?:[0-9]{6,12})?$")


class PinInput(BaseModel):
    pin: str = Field(pattern=r"^[0-9]{6,12}$")


class PromptInput(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    text: str = Field(min_length=1, max_length=12000)
    category: str = Field(default="", max_length=80)
    tags: list[str] = Field(default_factory=list, max_length=30)
    favorite: bool = False
    version: int | None = None


class PromptBulkInput(BaseModel):
    items: list[PromptInput] = Field(min_length=1, max_length=100)


class JobInput(BaseModel):
    token: str = Field(min_length=8, max_length=100)
    operation: Literal["create", "edit", "upscale"] = "create"
    input_id: str | None = None
    prompt_id: str | None = None
    instruction: str = Field(default="", max_length=16000)
    use_active: bool = False
    action: Literal["normal", "repeat", "vary"] = "normal"
    settings: dict = Field(default_factory=dict)