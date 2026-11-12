"""Müştəri bazası: people cədvəli (IG, WhatsApp, app və kontaktlardan birləşdirilmiş şəxslər + AI kartı)

Revision ID: 0013
Revises: 0012
Create Date: 2026-11-12 17:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0013'
down_revision: Union[str, None] = '0012'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('people',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('business_id', sa.String(length=16), server_default='ypod', nullable=False),
    sa.Column('display_name', sa.String(length=120), server_default='', nullable=False),
    sa.Column('phone', sa.String(length=32), nullable=True),
    sa.Column('ig_username', sa.String(length=80), nullable=True),
    sa.Column('igsid', sa.String(length=64), nullable=True),
    sa.Column('client_id', sa.Integer(), nullable=True),
    sa.Column('profession', sa.String(length=120), server_default='', nullable=False),
    sa.Column('workplace', sa.String(length=160), server_default='', nullable=False),
    sa.Column('reason', sa.Text(), server_default='', nullable=False),
    sa.Column('service', sa.String(length=120), server_default='', nullable=False),
    sa.Column('need', sa.Text(), server_default='', nullable=False),
    sa.Column('phones_found', sa.Text(), server_default='', nullable=False),
    sa.Column('summary', sa.Text(), server_default='', nullable=False),
    sa.Column('outcome', sa.String(length=8), server_default='unknown', nullable=False),
    sa.Column('sources', sa.String(length=40), server_default='', nullable=False),
    sa.Column('msg_count', sa.Integer(), server_default='0', nullable=False),
    sa.Column('first_contact_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('last_contact_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('card_model', sa.String(length=60), nullable=True),
    sa.Column('card_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['client_id'], ['clients.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('people', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_people_business_id'), ['business_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_people_client_id'), ['client_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_people_igsid'), ['igsid'], unique=False)
        batch_op.create_index(batch_op.f('ix_people_ig_username'), ['ig_username'], unique=False)
        batch_op.create_index(batch_op.f('ix_people_phone'), ['phone'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('people', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_people_phone'))
        batch_op.drop_index(batch_op.f('ix_people_ig_username'))
        batch_op.drop_index(batch_op.f('ix_people_igsid'))
        batch_op.drop_index(batch_op.f('ix_people_client_id'))
        batch_op.drop_index(batch_op.f('ix_people_business_id'))

    op.drop_table('people')
