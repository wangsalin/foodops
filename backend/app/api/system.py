from fastapi import APIRouter, Depends, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.deps import current_tenant_id
from app.core.redis import get_redis

router = APIRouter(prefix="/v1/system", tags=["system"])


@router.get("/environment")
def environment_status(request: Request, db: Session = Depends(get_db)) -> dict:
    tenant_id = current_tenant_id(request)
    postgres_ok = bool(db.execute(text("SELECT 1")).scalar())
    redis_ok = redis_ping()
    warnings = []
    if not settings.app_secret_key or settings.app_secret_key.startswith("replace-with"):
        warnings.append("APP_SECRET_KEY is using the development placeholder.")

    return {
        "backend": {
            "app_env": settings.app_env,
            "debug": settings.debug,
            "api_title": "FoodOps Community API",
            "database_url": settings.database_url,
            "redis_url": settings.redis_url,
            "h5_base_url": settings.h5_base_url,
            "request_host": request.headers.get("host", ""),
        },
        "services": [
            {"key": "backend", "name": "Backend API", "status": "ok", "detail": "FastAPI is running"},
            {"key": "postgres", "name": "PostgreSQL", "status": "ok" if postgres_ok else "error", "detail": "Business data store"},
            {"key": "redis", "name": "Redis", "status": "ok" if redis_ok else "missing", "detail": "Token blacklist and transient state"},
            {"key": "rules", "name": "Local Rules", "status": "ok", "detail": "Deterministic alerts and attribution"},
            {"key": "notifications", "name": "System Notifications", "status": "ok", "detail": "Local in-app notifications"},
        ],
        "integrations": [
            {"key": "enterprise_connectors", "name": "Enterprise Connectors", "status": "disabled", "detail": "WeCom, Feishu, external agents and platform collectors are plugin-only."},
            {"key": "external_ai", "name": "External AI Providers", "status": "disabled", "detail": "Community v0.1 uses local rules and audit logs only."},
        ],
        "ai": {"providers": 0, "routes": 0, "active_rule_templates": 0, "mode": "local_rules"},
        "security": {
            "app_secret_configured": bool(settings.app_secret_key and not settings.app_secret_key.startswith("replace-with")),
            "jwt_algorithm": settings.jwt_algorithm,
        },
        "community": {
            "mode": "community",
            "version": "0.1.0",
            "scope": [
                "master_data",
                "manual_import",
                "dashboard",
                "alerts",
                "tasks",
                "h5_feedback",
                "audit_logs",
            ],
        },
        "counts": read_basic_counts(db, tenant_id),
        "warnings": warnings,
    }


def redis_ping() -> bool:
    try:
        return bool(get_redis().ping())
    except Exception:
        return False


def read_basic_counts(db: Session, tenant_id: str) -> dict:
    tables = ("stores", "products", "alerts", "tasks", "notifications")
    return {
        table: int(db.execute(text(f"SELECT COUNT(*) FROM {table} WHERE tenant_id = :tenant_id"), {"tenant_id": tenant_id}).scalar() or 0)
        for table in tables
    }
