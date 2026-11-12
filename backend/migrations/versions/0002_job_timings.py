from alembic import op
from app.db import JobTiming

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade():
    JobTiming.__table__.create(op.get_bind(), checkfirst=True)


def downgrade():
    JobTiming.__table__.drop(op.get_bind(), checkfirst=True)