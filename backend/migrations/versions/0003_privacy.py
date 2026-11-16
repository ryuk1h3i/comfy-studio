from alembic import op
from app.db import PrivacyDevice, PrivacyUnlock

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade():
    PrivacyDevice.__table__.create(op.get_bind(), checkfirst=True)
    PrivacyUnlock.__table__.create(op.get_bind(), checkfirst=True)


def downgrade():
    PrivacyUnlock.__table__.drop(op.get_bind())
    PrivacyDevice.__table__.drop(op.get_bind())