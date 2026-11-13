"""shoots.calendar_uid + calendar_links cədvəli (Apple təqvimindən çəkilişlərin avtomatik yaranması, crm/calendar_sync.py)

Revision ID: 0018
Revises: 0017
Create Date: 2026-11-13 12:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0018'
down_revision: Union[str, None] = '0017'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('shoots', schema=None) as batch_op:
        batch_op.add_column(sa.Column('calendar_uid', sa.String(length=255), nullable=True))
        batch_op.create_unique_constraint('uq_shoots_calendar_uid', ['calendar_uid'])

    op.create_table('calendar_links',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('uid', sa.String(length=255), nullable=False),
    sa.Column('state', sa.String(length=8), nullable=False),
    sa.Column('title', sa.String(length=200), server_default='', nullable=False),
    sa.Column('starts_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('duration_min', sa.Integer(), server_default='60', nullable=False),
    sa.Column('missing', sa.Integer(), server_default='0', nullable=False),
    sa.Column('asked_deleted', sa.Boolean(), server_default=sa.false(), nullable=False),
    sa.Column('ask_message_id', sa.String(length=32), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('uid')
    )


def downgrade() -> None:
    op.drop_table('calendar_links')
    with op.batch_alter_table('shoots', schema=None) as batch_op:
        batch_op.drop_constraint('uq_shoots_calendar_uid', type_='unique')
        batch_op.drop_column('calendar_uid')
