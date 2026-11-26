"""people_last_visit: müştəri bazası kartında son gəliş və son söhbət mövzusu

Revision ID: 0026
Revises: 0025
Create Date: 2026-11-26 12:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0026'
down_revision: Union[str, None] = '0025'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('people', schema=None) as batch_op:
        batch_op.add_column(sa.Column('last_visit_at', sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column('last_topic', sa.Text(), server_default='', nullable=False))


def downgrade() -> None:
    with op.batch_alter_table('people', schema=None) as batch_op:
        batch_op.drop_column('last_topic')
        batch_op.drop_column('last_visit_at')
