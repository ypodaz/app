"""leads: itirildi səbəbi (lost_reason, lost_text) və «sonra yazacaq» xatırlatması (remind_at, remind_note)

Revision ID: 0017
Revises: 0016
Create Date: 2026-11-13 12:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0017'
down_revision: Union[str, None] = '0016'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('leads', schema=None) as batch_op:
        batch_op.add_column(sa.Column('lost_reason', sa.String(length=12), nullable=True))
        batch_op.add_column(sa.Column('lost_text', sa.String(length=200), nullable=True))
        batch_op.add_column(sa.Column('remind_at', sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column('remind_note', sa.String(length=200), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('leads', schema=None) as batch_op:
        batch_op.drop_column('remind_note')
        batch_op.drop_column('remind_at')
        batch_op.drop_column('lost_text')
        batch_op.drop_column('lost_reason')
