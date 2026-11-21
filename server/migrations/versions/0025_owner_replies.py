"""owner_replies: Telegram «Cavabımı yaz» (crm/owner_reply.py)

Revision ID: 0025
Revises: 0024
Create Date: 2026-11-21 14:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0025'
down_revision: Union[str, None] = '0024'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('owner_replies',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('channel', sa.String(length=4), nullable=False),
    sa.Column('ref', sa.String(length=255), nullable=False),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.Column('raw', sa.Text(), nullable=False),
    sa.Column('text', sa.Text(), nullable=False),
    sa.Column('status', sa.String(length=10), nullable=False),
    sa.Column('regen_count', sa.Integer(), nullable=False),
    sa.Column('prompt_message_id', sa.String(length=32), nullable=True),
    sa.Column('tg_chat_id', sa.String(length=32), nullable=True),
    sa.Column('tg_message_id', sa.String(length=32), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('owner_replies', schema=None) as batch_op:
        batch_op.create_index('ix_owner_replies_chan_ref', ['channel', 'ref'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('owner_replies', schema=None) as batch_op:
        batch_op.drop_index('ix_owner_replies_chan_ref')
    op.drop_table('owner_replies')
