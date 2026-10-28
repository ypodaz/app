"""studiya icarəsi, endirim, hazırlıq/yığışdırma vaxtı

Revision ID: 0003
Revises: 0002
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '0003'
down_revision: Union[str, None] = '0002'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('shoots') as b:
        b.add_column(sa.Column('prep_min', sa.Integer(), server_default='15', nullable=False))
        b.add_column(sa.Column('wrap_min', sa.Integer(), server_default='0', nullable=False))
        b.add_column(sa.Column('discount', sa.Integer(), server_default='0', nullable=False))
        b.add_column(sa.Column('discount_note', sa.String(length=255), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('shoots') as b:
        b.drop_column('discount_note')
        b.drop_column('discount')
        b.drop_column('wrap_min')
        b.drop_column('prep_min')
