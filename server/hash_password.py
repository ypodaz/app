"""Admin parolunun hash-ini çıxarır: python hash_password.py → nəticəni Railway-də ADMIN_PASSWORD_HASH-a yaz."""
from getpass import getpass

from argon2 import PasswordHasher

pw = getpass("Yeni admin parolu: ")
if len(pw) < 10:
    raise SystemExit("Parol ən azı 10 simvol olmalıdır.")
if pw != getpass("Təkrar: "):
    raise SystemExit("Parollar eyni deyil.")
print(PasswordHasher().hash(pw))
