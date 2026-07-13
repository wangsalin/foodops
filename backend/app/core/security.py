import hashlib
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

import bcrypt
import jwt

from app.core.config import settings
from app.core.exceptions import AppError
from app.core.redis import get_redis


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))


def _signing_key() -> str:
    if settings.jwt_algorithm.upper().startswith("RS"):
        path = Path(settings.jwt_private_key_path)
        if path.exists():
            return path.read_text(encoding="utf-8")
    return settings.app_secret_key


def _verify_key() -> str:
    if settings.jwt_algorithm.upper().startswith("RS"):
        path = Path(settings.jwt_public_key_path)
        if path.exists():
            return path.read_text(encoding="utf-8")
    return settings.app_secret_key


def _algorithm() -> str:
    if settings.jwt_algorithm.upper().startswith("RS") and Path(settings.jwt_private_key_path).exists():
        return settings.jwt_algorithm
    return "HS256"


def create_access_token(claims: dict) -> str:
    return _create_token(claims, "access", timedelta(minutes=settings.jwt_access_token_expire_minutes))


def create_refresh_token(claims: dict) -> str:
    return _create_token(claims, "refresh", timedelta(days=settings.jwt_refresh_token_expire_days))


def _create_token(claims: dict, token_type: str, ttl: timedelta) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        **claims,
        "typ": token_type,
        "jti": str(uuid4()),
        "iat": now,
        "exp": now + ttl,
    }
    return jwt.encode(payload, _signing_key(), algorithm=_algorithm())


def decode_access_token(token: str) -> dict:
    return _decode_token(token, "access")


def decode_refresh_token(token: str) -> dict:
    return _decode_token(token, "refresh")


def _decode_token(token: str, expected_type: str) -> dict:
    try:
        claims = jwt.decode(token, _verify_key(), algorithms=[_algorithm()])
    except jwt.PyJWTError as exc:
        raise AppError(code="AUTH_TOKEN_INVALID", message="登录已失效，请重新登录", status_code=401) from exc
    token_type = claims.get("typ", "access")
    if token_type != expected_type:
        raise AppError(code="AUTH_TOKEN_INVALID", message="登录已失效，请重新登录", status_code=401)
    if is_token_blacklisted(token, claims):
        raise AppError(code="AUTH_TOKEN_REVOKED", message="登录已退出，请重新登录", status_code=401)
    return claims


def blacklist_token(token: str, claims: dict | None = None) -> None:
    if not token:
        return
    claims = claims or jwt.decode(token, _verify_key(), algorithms=[_algorithm()])
    ttl = _remaining_ttl_seconds(claims)
    if ttl <= 0:
        return
    redis = get_redis()
    if claims.get("jti"):
        redis.setex(_blacklist_jti_key(str(claims["jti"])), ttl, "1")
    redis.setex(_blacklist_hash_key(token), ttl, "1")


def is_token_blacklisted(token: str, claims: dict | None = None) -> bool:
    redis = get_redis()
    if claims and claims.get("jti") and redis.exists(_blacklist_jti_key(str(claims["jti"]))):
        return True
    return bool(redis.exists(_blacklist_hash_key(token)))


def _remaining_ttl_seconds(claims: dict) -> int:
    exp = claims.get("exp")
    if exp is None:
        return 0
    return max(int(exp - datetime.now(timezone.utc).timestamp()), 0)


def _blacklist_jti_key(jti: str) -> str:
    return f"foodops:jwt:blacklist:jti:{jti}"


def _blacklist_hash_key(token: str) -> str:
    digest = hashlib.sha256(token.encode("utf-8")).hexdigest()
    return f"foodops:jwt:blacklist:token:{digest}"
