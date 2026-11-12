"""shoots: delivered_at (montaj təhvil vaxtı) və feedback_asked_at (rəy sorğusu kartı göndərilib)

Revision ID: 0012
Revises: 0011
Create Date: 2026-11-12 15:30:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0012'
down_revision: Union[str, None] = '0011'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('shoots', schema=None) as batch_op:
        batch_op.add_column(sa.Column('delivered_at', sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column('feedback_asked_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('shoots', schema=None) as batch_op:
        batch_op.drop_column('feedback_asked_at')
        batch_op.drop_column('delivered_at')
