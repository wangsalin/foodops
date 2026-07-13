import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings
from app.core.exceptions import AppError


def encrypt_secret(value: str) -> str:
    if not value:
        return ""
    return _fernet().encrypt(value.encode("utf-8")).decode("utf-8")


def decrypt_secret(value: str) -> str:
    if not value:
        return ""
    try:
        return _fernet().decrypt(value.encode("utf-8")).decode("utf-8")
    except InvalidToken as exc:
        raise AppError(code="SECRET_DECRYPT_FAILED", message="Secret cannot be decrypted", status_code=500) from exc


def _fernet() -> Fernet:
    digest = hashlib.sha256(settings.aes_encryption_key.encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(digest))
