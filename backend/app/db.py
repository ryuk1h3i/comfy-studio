from contextlib import contextmanager
from datetime import datetime, timezone
import uuid

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

from .config import DATABASE_URL


def now():
    return datetime.now(timezone.utc)


def identifier():
    return uuid.uuid4().hex


engine = create_engine(DATABASE_URL, pool_pre_ping=True,
                       connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {})
if DATABASE_URL.startswith("sqlite"):
    @event.listens_for(engine, "connect")
    def sqlite_config(connection, _):
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA busy_timeout=10000")
Session = sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class Settings(Base):
    __tablename__ = "settings"
    id: Mapped[int] = mapped_column(primary_key=True, default=1)
    value: Mapped[dict] = mapped_column(JSON, default=dict)


class Prompt(Base):
    __tablename__ = "prompts"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=identifier)
    title: Mapped[str] = mapped_column(String(160))
    text: Mapped[str] = mapped_column(Text)
    category: Mapped[str] = mapped_column(String(80), default="")
    tags: Mapped[list] = mapped_column(JSON, default=list)
    favorite: Mapped[bool] = mapped_column(Boolean, default=False)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class PromptVersion(Base):
    __tablename__ = "prompt_versions"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=identifier)
    prompt_id: Mapped[str] = mapped_column(ForeignKey("prompts.id"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(Text)
    title: Mapped[str] = mapped_column(String(160))
    created: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    __table_args__ = (Index("prompt_version_unique", "prompt_id", "version", unique=True),)


class Job(Base):
    __tablename__ = "jobs"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=identifier)
    token: Mapped[str] = mapped_column(String(100), unique=True)
    operation: Mapped[str] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(String(32), default="queued", index=True)
    priority: Mapped[int] = mapped_column(Integer, default=0)
    input_id: Mapped[str | None] = mapped_column(ForeignKey("assets.id", use_alter=True), nullable=True)
    root_id: Mapped[str | None] = mapped_column(ForeignKey("assets.id", use_alter=True), nullable=True)
    prompt_id: Mapped[str | None] = mapped_column(ForeignKey("prompts.id"), nullable=True, index=True)
    prompt_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    instruction: Mapped[str] = mapped_column(Text, default="")
    addition: Mapped[str] = mapped_column(Text, default="")
    settings: Mapped[dict] = mapped_column(JSON)
    workflow: Mapped[dict] = mapped_column(JSON)
    workflow_hash: Mapped[str] = mapped_column(String(64))
    comfy_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    progress: Mapped[str] = mapped_column(Text, default="In attesa")
    error: Mapped[str] = mapped_column(Text, default="")
    created: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)
    updated: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class JobTiming(Base):
    __tablename__ = "job_timings"
    job_id: Mapped[str] = mapped_column(ForeignKey("jobs.id"), primary_key=True)
    started: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    finished: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Asset(Base):
    __tablename__ = "assets"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=identifier)
    kind: Mapped[str] = mapped_column(String(16), index=True)
    name: Mapped[str] = mapped_column(String(200))
    checksum: Mapped[str] = mapped_column(String(64), index=True)
    width: Mapped[int] = mapped_column(Integer)
    height: Mapped[int] = mapped_column(Integer)
    mime: Mapped[str] = mapped_column(String(40))
    extension: Mapped[str] = mapped_column(String(8))
    job_id: Mapped[str | None] = mapped_column(ForeignKey("jobs.id", use_alter=True), nullable=True, index=True)
    output_key: Mapped[str | None] = mapped_column(String(128), nullable=True, unique=True)
    input_id: Mapped[str | None] = mapped_column(ForeignKey("assets.id"), nullable=True)
    root_id: Mapped[str | None] = mapped_column(ForeignKey("assets.id"), nullable=True, index=True)
    favorite: Mapped[bool] = mapped_column(Boolean, default=False)
    deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    analysis: Mapped[str] = mapped_column(String(24), default="pending", index=True)
    analysis_error: Mapped[str] = mapped_column(Text, default="")
    analysis_attempts: Mapped[int] = mapped_column(Integer, default=0)
    analysis_after: Mapped[float] = mapped_column(Float, default=0)
    embedding: Mapped[list | None] = mapped_column(JSON, nullable=True)
    model: Mapped[str] = mapped_column(String(200), default="")
    created: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)


class Person(Base):
    __tablename__ = "people"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=identifier)
    name: Mapped[str] = mapped_column(String(100), default="Persona senza nome")


class Face(Base):
    __tablename__ = "faces"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=identifier)
    asset_id: Mapped[str] = mapped_column(ForeignKey("assets.id"), index=True)
    person_id: Mapped[str | None] = mapped_column(ForeignKey("people.id"), nullable=True, index=True)
    box: Mapped[dict] = mapped_column(JSON)
    embedding: Mapped[list] = mapped_column(JSON)
    model: Mapped[str] = mapped_column(String(200))
    locked: Mapped[bool] = mapped_column(Boolean, default=False)


class Tag(Base):
    __tablename__ = "tags"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=identifier)
    name: Mapped[str] = mapped_column(String(80), unique=True)
    description: Mapped[str] = mapped_column(String(300))
    threshold: Mapped[float] = mapped_column(Float, default=0.25)
    automatic: Mapped[bool] = mapped_column(Boolean, default=False)
    embedding: Mapped[list | None] = mapped_column(JSON, nullable=True)
    model: Mapped[str] = mapped_column(String(200), default="")


class AssetTag(Base):
    __tablename__ = "asset_tags"
    asset_id: Mapped[str] = mapped_column(ForeignKey("assets.id"), primary_key=True)
    tag_id: Mapped[str] = mapped_column(ForeignKey("tags.id"), primary_key=True)
    state: Mapped[str] = mapped_column(String(16), default="suggested")
    score: Mapped[float] = mapped_column(Float, default=0)
    model: Mapped[str] = mapped_column(String(200), default="manual")


@contextmanager
def session():
    with Session.begin() as database:
        yield database


def initialize():
    Base.metadata.create_all(engine)
    if engine.dialect.name == "postgresql":
        from sqlalchemy import text
        with engine.begin() as connection:
            connection.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
            connection.execute(text("CREATE TABLE IF NOT EXISTS asset_vectors (asset_id varchar(32) PRIMARY KEY REFERENCES assets(id), model text NOT NULL, embedding vector NOT NULL)"))
            connection.execute(text("CREATE INDEX IF NOT EXISTS prompt_search_idx ON prompts USING gin(to_tsvector('simple', title || ' ' || text))"))