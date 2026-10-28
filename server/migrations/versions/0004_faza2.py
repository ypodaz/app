"""faza2: AI, push, xatırlatmalar

Revision ID: 0004
Revises: 0003
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '0004'
down_revision: Union[str, None] = '0003'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('ai_usage',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('subject', sa.String(length=24), nullable=False),
    sa.Column('day', sa.Date(), nullable=False),
    sa.Column('messages', sa.Integer(), nullable=False),
    sa.Column('tokens_in', sa.Integer(), nullable=False),
    sa.Column('tokens_out', sa.Integer(), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ux_ai_usage_subject_day', 'ai_usage', ['subject', 'day'], unique=True)
    op.create_table('ai_messages',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('client_id', sa.Integer(), nullable=False),
    sa.Column('role', sa.String(length=8), nullable=False),
    sa.Column('text', sa.Text(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['client_id'], ['clients.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_ai_messages_client_id'), 'ai_messages', ['client_id'], unique=False)
    op.create_table('push_subscriptions',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('client_id', sa.Integer(), nullable=False),
    sa.Column('endpoint', sa.String(length=1000), nullable=False),
    sa.Column('p256dh', sa.String(length=255), nullable=False),
    sa.Column('auth', sa.String(length=255), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['client_id'], ['clients.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('endpoint')
    )
    op.create_index(op.f('ix_push_subscriptions_client_id'), 'push_subscriptions', ['client_id'], unique=False)
    with op.batch_alter_table('shoots') as b:
        b.add_column(sa.Column('reminded_at', sa.DateTime(timezone=True), nullable=True))
    with op.batch_alter_table('packages') as b:
        b.add_column(sa.Column('ending_notified_at', sa.DateTime(timezone=True), nullable=True))
    with op.batch_alter_table('notifications') as b:
        b.add_column(sa.Column('pushed_at', sa.DateTime(timezone=True), nullable=True))
    # köhnə bildirişlər push-a getməsin
    op.execute("UPDATE notifications SET pushed_at = created_at")


def downgrade() -> None:
    with op.batch_alter_table('notifications') as b:
        b.drop_column('pushed_at')
    with op.batch_alter_table('packages') as b:
        b.drop_column('ending_notified_at')
    with op.batch_alter_table('shoots') as b:
        b.drop_column('reminded_at')
    op.drop_table('push_subscriptions')
    op.drop_table('ai_messages')
    op.drop_table('ai_usage')
