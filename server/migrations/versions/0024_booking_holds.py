"""booking_holds: botun tutduğu saatlar (crm/autobook.py)

Revision ID: 0024
Revises: 0023
Create Date: 2026-11-21 10:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0024'
down_revision: Union[str, None] = '0023'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('booking_holds',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('channel', sa.String(length=4), nullable=False),
    sa.Column('ref', sa.String(length=64), nullable=False),
    sa.Column('lead_id', sa.Integer(), nullable=True),
    sa.Column('block_id', sa.Integer(), nullable=True),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.Column('phone', sa.String(length=32), nullable=True),
    sa.Column('starts_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('duration_min', sa.Integer(), nullable=False),
    sa.Column('kind', sa.String(length=16), nullable=False),
    sa.Column('tag', sa.String(length=16), nullable=False),
    sa.Column('cameras', sa.Integer(), nullable=False),
    sa.Column('editing', sa.Boolean(), nullable=False),
    sa.Column('reels_count', sa.Integer(), nullable=False),
    sa.Column('total', sa.Integer(), nullable=False),
    sa.Column('deposit', sa.Integer(), nullable=False),
    sa.Column('status', sa.String(length=12), nullable=False),
    sa.Column('hold_until', sa.DateTime(timezone=True), nullable=False),
    sa.Column('shoot_id', sa.Integer(), nullable=True),
    sa.Column('tg_chat_id', sa.String(length=32), nullable=True),
    sa.Column('tg_message_id', sa.String(length=32), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['block_id'], ['blocks.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['lead_id'], ['leads.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('booking_holds', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_booking_holds_lead_id'), ['lead_id'], unique=False)
        batch_op.create_index('ix_booking_holds_chan_ref', ['channel', 'ref'], unique=False)
        batch_op.create_index('ix_booking_holds_status', ['status'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('booking_holds', schema=None) as batch_op:
        batch_op.drop_index('ix_booking_holds_status')
        batch_op.drop_index('ix_booking_holds_chan_ref')
        batch_op.drop_index(batch_op.f('ix_booking_holds_lead_id'))
    op.drop_table('booking_holds')
