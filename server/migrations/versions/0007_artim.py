"""müştəri artımı: profil sahələri, teqlər, dəvət, kampaniyalar

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-28 20:24:25.448818

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0007'
down_revision: Union[str, None] = '0006'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('tags',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(length=40), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('name')
    )
    op.create_table('campaigns',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('kind', sa.String(length=16), nullable=False),
    sa.Column('title', sa.String(length=80), nullable=False),
    sa.Column('body', sa.String(length=400), nullable=False),
    sa.Column('url', sa.String(length=500), nullable=True),
    sa.Column('filters', sa.JSON(), nullable=False),
    sa.Column('recipients', sa.Integer(), nullable=False),
    sa.Column('push_on', sa.Integer(), nullable=False),
    sa.Column('created_by', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['created_by'], ['admins.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('client_tags',
    sa.Column('client_id', sa.Integer(), nullable=False),
    sa.Column('tag_id', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['client_id'], ['clients.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['tag_id'], ['tags.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('client_id', 'tag_id')
    )
    with op.batch_alter_table('client_tags', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_client_tags_tag_id'), ['tag_id'], unique=False)

    op.create_table('campaign_recipients',
    sa.Column('campaign_id', sa.Integer(), nullable=False),
    sa.Column('client_id', sa.Integer(), nullable=False),
    sa.Column('opened_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['campaign_id'], ['campaigns.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['client_id'], ['clients.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('campaign_id', 'client_id')
    )
    with op.batch_alter_table('campaign_recipients', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_campaign_recipients_client_id'), ['client_id'], unique=False)

    with op.batch_alter_table('clients', schema=None) as batch_op:
        batch_op.add_column(sa.Column('profession', sa.String(length=80), nullable=True))
        batch_op.add_column(sa.Column('workplace', sa.String(length=120), nullable=True))
        batch_op.add_column(sa.Column('instagram', sa.String(length=80), nullable=True))
        batch_op.add_column(sa.Column('niche', sa.String(length=120), nullable=True))
        batch_op.add_column(sa.Column('birthday', sa.Date(), nullable=True))
        batch_op.add_column(sa.Column('source', sa.String(length=16), nullable=True))
        batch_op.add_column(sa.Column('marketing_opt_in', sa.Boolean(), server_default=sa.true(), nullable=False))
        batch_op.add_column(sa.Column('profile_bonus_at', sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column('referral_code', sa.String(length=8), nullable=True))
        batch_op.add_column(sa.Column('referred_by_id', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('referral_rewarded_at', sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column('winback_at', sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column('cashback_nudge_at', sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column('birthday_year', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('review_asked_at', sa.DateTime(timezone=True), nullable=True))
        batch_op.create_index(batch_op.f('ix_clients_referred_by_id'), ['referred_by_id'], unique=False)
        batch_op.create_unique_constraint('uq_clients_referral_code', ['referral_code'])
        batch_op.create_foreign_key('fk_clients_referred_by_id', 'clients', ['referred_by_id'], ['id'], ondelete='SET NULL')



def downgrade() -> None:
    with op.batch_alter_table('clients', schema=None) as batch_op:
        batch_op.drop_constraint('fk_clients_referred_by_id', type_='foreignkey')
        batch_op.drop_constraint('uq_clients_referral_code', type_='unique')
        batch_op.drop_index(batch_op.f('ix_clients_referred_by_id'))
        batch_op.drop_column('review_asked_at')
        batch_op.drop_column('birthday_year')
        batch_op.drop_column('cashback_nudge_at')
        batch_op.drop_column('winback_at')
        batch_op.drop_column('referral_rewarded_at')
        batch_op.drop_column('referred_by_id')
        batch_op.drop_column('referral_code')
        batch_op.drop_column('profile_bonus_at')
        batch_op.drop_column('marketing_opt_in')
        batch_op.drop_column('source')
        batch_op.drop_column('birthday')
        batch_op.drop_column('niche')
        batch_op.drop_column('instagram')
        batch_op.drop_column('workplace')
        batch_op.drop_column('profession')

    with op.batch_alter_table('campaign_recipients', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_campaign_recipients_client_id'))

    op.drop_table('campaign_recipients')
    with op.batch_alter_table('client_tags', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_client_tags_tag_id'))

    op.drop_table('client_tags')
    op.drop_table('campaigns')
    op.drop_table('tags')
