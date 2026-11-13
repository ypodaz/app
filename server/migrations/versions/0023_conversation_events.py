"""conversation_events: söhbət tarixçəsində daxili qeyd və sistem sətirləri (crm/events.py)

Revision ID: 0023
Revises: 0022
Create Date: 2026-11-14 10:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0023'
down_revision: Union[str, None] = '0022'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('conversation_events',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('business_id', sa.String(length=16), server_default='ypod', nullable=False),
    sa.Column('channel', sa.String(length=8), nullable=False),
    sa.Column('ref', sa.String(length=64), nullable=False),
    sa.Column('kind', sa.String(length=8), nullable=False),
    sa.Column('text', sa.Text(), nullable=False),
    sa.Column('meta', sa.JSON(), nullable=True),
    sa.Column('client_id', sa.Integer(), nullable=True),
    sa.Column('lead_id', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('conversation_events', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_conversation_events_business_id'), ['business_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_conversation_events_client_id'), ['client_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_conversation_events_lead_id'), ['lead_id'], unique=False)
        batch_op.create_index('ix_conversation_events_chan_ref', ['channel', 'ref'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('conversation_events', schema=None) as batch_op:
        batch_op.drop_index('ix_conversation_events_chan_ref')
        batch_op.drop_index(batch_op.f('ix_conversation_events_lead_id'))
        batch_op.drop_index(batch_op.f('ix_conversation_events_client_id'))
        batch_op.drop_index(batch_op.f('ix_conversation_events_business_id'))
    op.drop_table('conversation_events')
