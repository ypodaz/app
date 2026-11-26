"""people_profile: tam yazışmadan çıxarılmış satış profili (JSON) və fərdi mesaj qaralaması

Revision ID: 0027
Revises: 0026
Create Date: 2026-11-26 17:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0027'
down_revision: Union[str, None] = '0026'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('people', schema=None) as batch_op:
        batch_op.add_column(sa.Column('profile', sa.Text(), server_default='', nullable=False))
        batch_op.add_column(sa.Column('profile_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('people', schema=None) as batch_op:
        batch_op.drop_column('profile_at')
        batch_op.drop_column('profile')
