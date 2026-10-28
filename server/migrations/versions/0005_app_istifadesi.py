"""app istifadəsi: son açılış, ana ekran, bildiriş icazəsi

Revision ID: 0005
Revises: 0004
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '0005'
down_revision: Union[str, None] = '0004'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('clients') as b:
        b.add_column(sa.Column('app_seen_at', sa.DateTime(timezone=True), nullable=True))
        b.add_column(sa.Column('app_standalone', sa.Boolean(), server_default=sa.false(), nullable=False))
        b.add_column(sa.Column('push_permission', sa.String(length=12), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('clients') as b:
        b.drop_column('push_permission')
        b.drop_column('app_standalone')
        b.drop_column('app_seen_at')
