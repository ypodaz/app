"""Sosial cavablar: Instagram DM/komment və YouTube kommentləri (social_items)

Revision ID: 0010
Revises: 0009
Create Date: 2026-11-12 10:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0010'
down_revision: Union[str, None] = '0009'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('social_items',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('channel', sa.String(length=12), nullable=False),
    sa.Column('kind', sa.String(length=10), nullable=False),
    sa.Column('external_id', sa.String(length=128), nullable=False),
    sa.Column('thread_id', sa.String(length=128), nullable=False),
    sa.Column('parent_id', sa.String(length=128), nullable=True),
    sa.Column('author', sa.String(length=120), nullable=False),
    sa.Column('text', sa.Text(), nullable=False),
    sa.Column('draft_text', sa.Text(), nullable=True),
    sa.Column('status', sa.String(length=10), nullable=False),
    sa.Column('tg_message_id', sa.String(length=32), nullable=True),
    sa.Column('model_output', sa.JSON(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('decided_at', sa.DateTime(timezone=True), nullable=True),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('external_id')
    )
    with op.batch_alter_table('social_items', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_social_items_thread_id'), ['thread_id'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('social_items', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_social_items_thread_id'))

    op.drop_table('social_items')
