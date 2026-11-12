"""bot_drafts.auto_at: sahibkar 1 saat toxunmasa bot qaralamanı özü göndərir (crm/turns.py)

Revision ID: 0016
Revises: 0015
Create Date: 2026-11-13 03:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0016'
down_revision: Union[str, None] = '0015'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('bot_drafts', schema=None) as batch_op:
        batch_op.add_column(sa.Column('auto_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('bot_drafts', schema=None) as batch_op:
        batch_op.drop_column('auto_at')
