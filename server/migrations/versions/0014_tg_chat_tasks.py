"""bot_drafts.telegram_chat_id + tasks cədvəli (Telegram to-do)

Revision ID: 0014
Revises: 0013
Create Date: 2026-11-12 19:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0014'
down_revision: Union[str, None] = '0013'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('bot_drafts', schema=None) as batch_op:
        batch_op.add_column(sa.Column('telegram_chat_id', sa.String(length=32), nullable=True))

    op.create_table('tasks',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('business_id', sa.String(length=16), server_default='ypod', nullable=False),
    sa.Column('text', sa.Text(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('done_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('tg_message_id', sa.String(length=32), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('tasks', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_tasks_business_id'), ['business_id'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('tasks', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_tasks_business_id'))

    op.drop_table('tasks')
    with op.batch_alter_table('bot_drafts', schema=None) as batch_op:
        batch_op.drop_column('telegram_chat_id')
