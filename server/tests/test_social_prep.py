import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import social_prep  # noqa: E402


def test_list_sources_ascii_names(tmp_path):
    (tmp_path / "02 - Gün 1 Axşam - Leyla və Nərmin.mp4").write_bytes(b"")
    (tmp_path / "01 - Gün 1 Səhər - Sabah çəkilişin var.mp4").write_bytes(b"")
    (tmp_path / "Qulaq yoxlaması.md").write_text("x")
    items = social_prep.list_sources(tmp_path)
    assert [(i["number"], i["day"], i["slot"], i["file_name"]) for i in items] == [
        (1, 1, "seher", "01-gun-1-seher.mp4"), (2, 1, "axsam", "02-gun-1-axsam.mp4")]
    assert items[0]["title"] == "Sabah çəkilişin var"
