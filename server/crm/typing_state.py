"""«Bot yazır…» göstəricisi: bot cavab yaradanda söhbət vaxt damğası ilə işarələnir, bitəndə silinir.
Yalnız bu prosesin yaddaşındadır (miqrasiya yoxdur); müddəti bitən işarə özü sönür. Heç vaxt xəta atmır.
Açar: `wa:<söhbət id>` və ya `ig:<igsid>`.
"""
import time
from contextlib import contextmanager

TTL = 90  # saniyə: bot çökərsə də göstərici ilişib qalmasın
_since: dict[str, float] = {}


def mark(key: str) -> None:
    try:
        _since[key] = time.monotonic()
    except Exception:
        pass


def clear(key: str) -> None:
    _since.pop(key, None)


def is_typing(key: str) -> bool:
    try:
        t = _since.get(key)
        if t is None:
            return False
        if time.monotonic() - t > TTL:
            _since.pop(key, None)
            return False
        return True
    except Exception:
        return False


@contextmanager
def generating(key: str):
    mark(key)
    try:
        yield
    finally:
        clear(key)
