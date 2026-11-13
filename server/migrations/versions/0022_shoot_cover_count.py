"""shoots.cover_count: Cover (hər video 10 AZN) sayı; kind=single_reel (Tək Reels) üçün sütun lazım deyil

Revision ID: 0022
Revises: 0021
Create Date: 2026-11-14 10:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0022'
down_revision: Union[str, None] = '0021'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('shoots', sa.Column('cover_count', sa.Integer(), server_default='0', nullable=False))


def downgrade() -> None:
    op.drop_column('shoots', 'cover_count')
