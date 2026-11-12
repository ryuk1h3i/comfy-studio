from alembic import op
from app.db import Base

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    Base.metadata.create_all(op.get_bind())
    if op.get_bind().dialect.name == "postgresql":
        op.execute("CREATE EXTENSION IF NOT EXISTS vector")
        op.execute("CREATE TABLE IF NOT EXISTS asset_vectors (asset_id varchar(32) PRIMARY KEY REFERENCES assets(id), model text NOT NULL, embedding vector NOT NULL)")
        op.execute("CREATE INDEX IF NOT EXISTS prompt_search_idx ON prompts USING gin(to_tsvector('simple', title || ' ' || text))")


def downgrade():
    if op.get_bind().dialect.name == "postgresql":
        op.execute("DROP TABLE IF EXISTS asset_vectors")
    Base.metadata.drop_all(op.get_bind())