import os
import subprocess
import sys
from pathlib import Path

from sqlalchemy import create_engine, inspect

SERVER = Path(__file__).resolve().parents[1]
CRM_TABLES = {"media_assets", "social_posts", "wa_contacts", "wa_conversations", "wa_messages", "bot_drafts", "leads",
              "lead_events", "faqs", "quick_replies", "unanswered_questions", "webhook_events"}


def alembic(url, *args):
    env = {**os.environ, "DATABASE_URL": url}
    subprocess.run([sys.executable, "-m", "alembic", *args], cwd=SERVER, env=env, check=True, capture_output=True)


def test_upgrade_and_downgrade(tmp_path):
    url = f"sqlite:///{tmp_path / 'm.db'}"
    alembic(url, "upgrade", "head")
    tables = set(inspect(create_engine(url)).get_table_names())
    assert CRM_TABLES <= tables
    alembic(url, "downgrade", "0007")
    tables = set(inspect(create_engine(url)).get_table_names())
    assert not CRM_TABLES & tables and "clients" in tables
    alembic(url, "upgrade", "head")  # təkrar yuxarı da işləyir


def test_people_table_migration(tmp_path):
    url = f"sqlite:///{tmp_path / 'p.db'}"
    alembic(url, "upgrade", "head")
    assert "people" in set(inspect(create_engine(url)).get_table_names())
    alembic(url, "downgrade", "0012")
    assert "people" not in set(inspect(create_engine(url)).get_table_names())
    alembic(url, "upgrade", "head")


def test_tasks_and_draft_chat_migration(tmp_path):
    url = f"sqlite:///{tmp_path / 't.db'}"
    alembic(url, "upgrade", "head")
    insp = inspect(create_engine(url))
    assert "tasks" in insp.get_table_names()
    assert "telegram_chat_id" in {c["name"] for c in insp.get_columns("bot_drafts")}
    alembic(url, "downgrade", "0013")
    insp = inspect(create_engine(url))
    assert "tasks" not in insp.get_table_names()
    assert "telegram_chat_id" not in {c["name"] for c in insp.get_columns("bot_drafts")}
    alembic(url, "upgrade", "head")
