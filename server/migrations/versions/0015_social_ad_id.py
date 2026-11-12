"""social_items.ad_id: reklamdan (click-to-DM) gələn Instagram yazışması

Revision ID: 0015
Revises: 0014
Create Date: 2026-11-12 20:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0015'
down_revision: Union[str, None] = '0014'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('social_items', schema=None) as batch_op:
        batch_op.add_column(sa.Column('ad_id', sa.String(length=32), nullable=True))
        batch_op.create_index(batch_op.f('ix_social_items_ad_id'), ['ad_id'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('social_items', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_social_items_ad_id'))
        batch_op.drop_column('ad_id')
