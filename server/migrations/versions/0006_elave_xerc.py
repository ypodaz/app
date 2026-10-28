"""çəkilişdə sərbəst əlavə xərclər

Revision ID: 0006
Revises: 0005
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '0006'
down_revision: Union[str, None] = '0005'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('shoots') as b:
        b.add_column(sa.Column('extras', sa.JSON(), server_default=sa.text("'[]'"), nullable=False))


def downgrade() -> None:
    with op.batch_alter_table('shoots') as b:
        b.drop_column('extras')
