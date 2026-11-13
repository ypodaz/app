"""subscriptions + subscription_payments: aylıq abunələr və sub-icarə (subscriptions.py)

Revision ID: 0021
Revises: 0020
Create Date: 2026-11-13 15:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0021'
down_revision: Union[str, None] = '0020'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('subscriptions',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('business_id', sa.String(length=16), server_default='ypod', nullable=False),
    sa.Column('client_id', sa.Integer(), nullable=False),
    sa.Column('title', sa.String(length=120), nullable=False),
    sa.Column('kind', sa.String(length=16), nullable=False),
    sa.Column('amount', sa.Integer(), nullable=False),
    sa.Column('pay_day', sa.Integer(), nullable=False),
    sa.Column('visits_per_month', sa.Integer(), nullable=True),
    sa.Column('starts_on', sa.Date(), nullable=False),
    sa.Column('active', sa.Boolean(), server_default=sa.true(), nullable=False),
    sa.Column('note', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['client_id'], ['clients.id'], ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('subscriptions', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_subscriptions_business_id'), ['business_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_subscriptions_client_id'), ['client_id'], unique=False)

    op.create_table('subscription_payments',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('subscription_id', sa.Integer(), nullable=False),
    sa.Column('period', sa.String(length=7), nullable=False),
    sa.Column('amount', sa.Integer(), nullable=False),
    sa.Column('status', sa.String(length=12), server_default='pending', nullable=False),
    sa.Column('due_on', sa.Date(), nullable=False),
    sa.Column('paid_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('asked_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['subscription_id'], ['subscriptions.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('subscription_id', 'period', name='uq_subscription_period')
    )
    with op.batch_alter_table('subscription_payments', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_subscription_payments_subscription_id'), ['subscription_id'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('subscription_payments', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_subscription_payments_subscription_id'))
    op.drop_table('subscription_payments')
    with op.batch_alter_table('subscriptions', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_subscriptions_client_id'))
        batch_op.drop_index(batch_op.f('ix_subscriptions_business_id'))
    op.drop_table('subscriptions')
