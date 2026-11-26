"""shoot_campaign: çəkiliş kampaniya qiyməti ilədir (keşbek yazılmır)

Revision ID: 0028
Revises: 0027
Create Date: 2026-11-27 12:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0028'
down_revision: Union[str, None] = '0027'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('shoots', schema=None) as batch_op:
        batch_op.add_column(sa.Column('campaign', sa.Boolean(), server_default=sa.false(), nullable=False))


def downgrade() -> None:
    with op.batch_alter_table('shoots', schema=None) as batch_op:
        batch_op.drop_column('campaign')
