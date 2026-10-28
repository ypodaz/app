"""Web Push üçün VAPID açarları yaradır. Bir dəfə işlət, iki sətri Railway → app → Variables-a əlavə et.

    .venv/bin/python gen_vapid.py
"""
import base64

from cryptography.hazmat.primitives import serialization
from py_vapid import Vapid01


def b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


v = Vapid01()
v.generate_keys()
priv = v.private_key.private_numbers().private_value.to_bytes(32, "big")
pub = v.public_key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
print(f"VAPID_PUBLIC_KEY={b64(pub)}")
print(f"VAPID_PRIVATE_KEY={b64(priv)}")
