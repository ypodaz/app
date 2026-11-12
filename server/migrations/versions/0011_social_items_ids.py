"""social_items: ID sütunları 255 simvol (Instagram DM mid 164 simvoldur, 128-ə sığmırdı)

Revision ID: 0011
Revises: 0010
Create Date: 2026-11-12 13:30:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0011'
down_revision: Union[str, None] = '0010'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

COLS = (('external_id', False), ('thread_id', False), ('parent_id', True))


def upgrade() -> None:
    with op.batch_alter_table('social_items', schema=None) as batch_op:
        for name, nullable in COLS:
            batch_op.alter_column(name, existing_type=sa.String(length=128), type_=sa.String(length=255),
                                  existing_nullable=nullable)


def downgrade() -> None:
    with op.batch_alter_table('social_items', schema=None) as batch_op:
        for name, nullable in COLS:
            batch_op.alter_column(name, existing_type=sa.String(length=255), type_=sa.String(length=128),
                                  existing_nullable=nullable)
