"""pytest bunu hər test modulundan əvvəl yükləyir: test hansı ardıcıllıqla və ya tək işə salınsa da,
`settings` dev.db-yə yox, test.db-yə qoşulsun (əks halda `drop_all` lokal dev bazasını silir)."""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ["DATABASE_URL"] = "sqlite:///./test.db"
os.environ["SCHEDULER"] = "0"
