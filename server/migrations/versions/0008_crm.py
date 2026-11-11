"""CRM: paylaşım, WhatsApp inbox, leadlər, FAQ, webhook təkrarları

Revision ID: 0008
Revises: 0007
Create Date: 2026-11-11 10:04:52.181598

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0008'
down_revision: Union[str, None] = '0007'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('faqs',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('business_id', sa.String(length=16), server_default='ypod', nullable=False),
    sa.Column('question', sa.Text(), nullable=False),
    sa.Column('answer', sa.Text(), nullable=False),
    sa.Column('active', sa.Boolean(), server_default=sa.true(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('faqs', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_faqs_business_id'), ['business_id'], unique=False)

    op.create_table('media_assets',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('business_id', sa.String(length=16), server_default='ypod', nullable=False),
    sa.Column('number', sa.Integer(), nullable=False),
    sa.Column('day', sa.Integer(), nullable=False),
    sa.Column('slot', sa.String(length=8), nullable=False),
    sa.Column('title', sa.String(length=200), nullable=False),
    sa.Column('file_name', sa.String(length=200), nullable=False),
    sa.Column('public_url', sa.String(length=500), nullable=True),
    sa.Column('cover_offset_ms', sa.Integer(), server_default='1000', nullable=False),
    sa.Column('duration_s', sa.Float(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('media_assets', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_media_assets_business_id'), ['business_id'], unique=False)

    op.create_table('quick_replies',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('business_id', sa.String(length=16), server_default='ypod', nullable=False),
    sa.Column('title', sa.String(length=80), nullable=False),
    sa.Column('text', sa.Text(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('quick_replies', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_quick_replies_business_id'), ['business_id'], unique=False)

    op.create_table('wa_contacts',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('business_id', sa.String(length=16), server_default='ypod', nullable=False),
    sa.Column('phone', sa.String(length=32), nullable=True),
    sa.Column('bsuid', sa.String(length=64), nullable=True),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.Column('language', sa.String(length=8), nullable=True),
    sa.Column('excluded', sa.Boolean(), server_default=sa.false(), nullable=False),
    sa.Column('bot_muted_until', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('bsuid'),
    sa.UniqueConstraint('phone')
    )
    with op.batch_alter_table('wa_contacts', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_wa_contacts_business_id'), ['business_id'], unique=False)

    op.create_table('webhook_events',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('business_id', sa.String(length=16), server_default='ypod', nullable=False),
    sa.Column('provider', sa.String(length=16), nullable=False),
    sa.Column('idempotency_key', sa.String(length=128), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('idempotency_key')
    )
    with op.batch_alter_table('webhook_events', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_webhook_events_business_id'), ['business_id'], unique=False)

    op.create_table('social_posts',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('business_id', sa.String(length=16), server_default='ypod', nullable=False),
    sa.Column('media_asset_id', sa.Integer(), nullable=False),
    sa.Column('platform', sa.String(length=12), nullable=False),
    sa.Column('scheduled_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('text', sa.Text(), nullable=False),
    sa.Column('title', sa.String(length=200), nullable=True),
    sa.Column('status', sa.String(length=12), nullable=False),
    sa.Column('external_id', sa.String(length=100), nullable=True),
    sa.Column('error', sa.Text(), nullable=True),
    sa.Column('attempts', sa.Integer(), server_default='0', nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['media_asset_id'], ['media_assets.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('media_asset_id', 'platform', name='uq_social_posts_media_platform')
    )
    with op.batch_alter_table('social_posts', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_social_posts_business_id'), ['business_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_social_posts_media_asset_id'), ['media_asset_id'], unique=False)

    op.create_table('wa_conversations',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('business_id', sa.String(length=16), server_default='ypod', nullable=False),
    sa.Column('contact_id', sa.Integer(), nullable=False),
    sa.Column('kapso_conversation_id', sa.String(length=64), nullable=True),
    sa.Column('mode', sa.String(length=8), server_default='bot', nullable=False),
    sa.Column('last_message_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('last_inbound_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('window_expires_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('unread', sa.Integer(), server_default='0', nullable=False),
    sa.Column('lead_id', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['contact_id'], ['wa_contacts.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('kapso_conversation_id')
    )
    with op.batch_alter_table('wa_conversations', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_wa_conversations_business_id'), ['business_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_wa_conversations_contact_id'), ['contact_id'], unique=False)

    op.create_table('bot_drafts',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('business_id', sa.String(length=16), server_default='ypod', nullable=False),
    sa.Column('conversation_id', sa.Integer(), nullable=False),
    sa.Column('text', sa.Text(), nullable=False),
    sa.Column('status', sa.String(length=10), nullable=False),
    sa.Column('reason', sa.String(length=200), nullable=True),
    sa.Column('model_output', sa.JSON(), nullable=True),
    sa.Column('telegram_message_id', sa.String(length=32), nullable=True),
    sa.Column('decided_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['conversation_id'], ['wa_conversations.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('bot_drafts', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_bot_drafts_business_id'), ['business_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_bot_drafts_conversation_id'), ['conversation_id'], unique=False)

    op.create_table('unanswered_questions',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('business_id', sa.String(length=16), server_default='ypod', nullable=False),
    sa.Column('conversation_id', sa.Integer(), nullable=True),
    sa.Column('question', sa.Text(), nullable=False),
    sa.Column('resolved', sa.Boolean(), server_default=sa.false(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['conversation_id'], ['wa_conversations.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('unanswered_questions', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_unanswered_questions_business_id'), ['business_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_unanswered_questions_conversation_id'), ['conversation_id'], unique=False)

    op.create_table('wa_messages',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('business_id', sa.String(length=16), server_default='ypod', nullable=False),
    sa.Column('conversation_id', sa.Integer(), nullable=False),
    sa.Column('wamid', sa.String(length=128), nullable=True),
    sa.Column('direction', sa.String(length=3), nullable=False),
    sa.Column('source', sa.String(length=8), nullable=False),
    sa.Column('type', sa.String(length=16), nullable=False),
    sa.Column('text', sa.Text(), nullable=False),
    sa.Column('media_url', sa.String(length=500), nullable=True),
    sa.Column('transcript', sa.Text(), nullable=True),
    sa.Column('status', sa.String(length=16), nullable=True),
    sa.Column('raw', sa.JSON(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['conversation_id'], ['wa_conversations.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('wamid')
    )
    with op.batch_alter_table('wa_messages', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_wa_messages_business_id'), ['business_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_wa_messages_conversation_id'), ['conversation_id'], unique=False)

    op.create_table('leads',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('business_id', sa.String(length=16), server_default='ypod', nullable=False),
    sa.Column('contact_id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.Column('phone', sa.String(length=32), nullable=False),
    sa.Column('service', sa.String(length=12), nullable=True),
    sa.Column('preferred_date', sa.String(length=64), nullable=True),
    sa.Column('people', sa.Integer(), nullable=True),
    sa.Column('cameras', sa.Integer(), nullable=True),
    sa.Column('editing', sa.Boolean(), nullable=True),
    sa.Column('source', sa.String(length=12), nullable=False),
    sa.Column('stage', sa.String(length=12), nullable=False),
    sa.Column('notes', sa.Text(), nullable=False),
    sa.Column('shoot_id', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['contact_id'], ['wa_contacts.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['shoot_id'], ['shoots.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('leads', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_leads_business_id'), ['business_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_leads_contact_id'), ['contact_id'], unique=False)

    op.create_table('lead_events',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('business_id', sa.String(length=16), server_default='ypod', nullable=False),
    sa.Column('lead_id', sa.Integer(), nullable=False),
    sa.Column('kind', sa.String(length=24), nullable=False),
    sa.Column('data', sa.JSON(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['lead_id'], ['leads.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('lead_events', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_lead_events_business_id'), ['business_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_lead_events_lead_id'), ['lead_id'], unique=False)



def downgrade() -> None:
    with op.batch_alter_table('lead_events', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_lead_events_lead_id'))
        batch_op.drop_index(batch_op.f('ix_lead_events_business_id'))

    op.drop_table('lead_events')
    with op.batch_alter_table('leads', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_leads_contact_id'))
        batch_op.drop_index(batch_op.f('ix_leads_business_id'))

    op.drop_table('leads')
    with op.batch_alter_table('wa_messages', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_wa_messages_conversation_id'))
        batch_op.drop_index(batch_op.f('ix_wa_messages_business_id'))

    op.drop_table('wa_messages')
    with op.batch_alter_table('unanswered_questions', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_unanswered_questions_conversation_id'))
        batch_op.drop_index(batch_op.f('ix_unanswered_questions_business_id'))

    op.drop_table('unanswered_questions')
    with op.batch_alter_table('bot_drafts', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_bot_drafts_conversation_id'))
        batch_op.drop_index(batch_op.f('ix_bot_drafts_business_id'))

    op.drop_table('bot_drafts')
    with op.batch_alter_table('wa_conversations', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_wa_conversations_contact_id'))
        batch_op.drop_index(batch_op.f('ix_wa_conversations_business_id'))

    op.drop_table('wa_conversations')
    with op.batch_alter_table('social_posts', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_social_posts_media_asset_id'))
        batch_op.drop_index(batch_op.f('ix_social_posts_business_id'))

    op.drop_table('social_posts')
    with op.batch_alter_table('webhook_events', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_webhook_events_business_id'))

    op.drop_table('webhook_events')
    with op.batch_alter_table('wa_contacts', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_wa_contacts_business_id'))

    op.drop_table('wa_contacts')
    with op.batch_alter_table('quick_replies', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_quick_replies_business_id'))

    op.drop_table('quick_replies')
    with op.batch_alter_table('media_assets', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_media_assets_business_id'))

    op.drop_table('media_assets')
    with op.batch_alter_table('faqs', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_faqs_business_id'))

    op.drop_table('faqs')
