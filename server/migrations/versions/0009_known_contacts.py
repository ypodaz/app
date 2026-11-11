"""Telefon kontaktları (köhnə müştəri / şəxsi) və söhbətin ötürülmə səbəbi

Revision ID: 0009
Revises: 0008
Create Date: 2026-11-12 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0009'
down_revision: Union[str, None] = '0008'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('known_contacts',
    sa.Column('phone', sa.String(length=32), nullable=False),
    sa.Column('kind', sa.String(length=16), nullable=False),
    sa.Column('first_name', sa.String(length=60), server_default='', nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('phone')
    )
    with op.batch_alter_table('wa_conversations', schema=None) as batch_op:
        batch_op.add_column(sa.Column('route', sa.String(length=16), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('wa_conversations', schema=None) as batch_op:
        batch_op.drop_column('route')

    op.drop_table('known_contacts')
