"""known_contacts.full_name: kontaktun tam adı

Revision ID: 0020
Revises: 0019
Create Date: 2026-11-13 14:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0020'
down_revision: Union[str, None] = '0019'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('known_contacts', schema=None) as batch_op:
        batch_op.add_column(sa.Column('full_name', sa.String(length=120), server_default='', nullable=False))


def downgrade() -> None:
    with op.batch_alter_table('known_contacts', schema=None) as batch_op:
        batch_op.drop_column('full_name')
