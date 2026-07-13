from fastapi import APIRouter
from sqlalchemy import text

from app.core.database import engine
from app.core.redis import get_redis

router = APIRouter()


@router.get("/health")
def health() -> dict[str, str]:
    status = {"status": "ok", "database": "unknown", "redis": "unknown"}
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        status["database"] = "ok"
    except Exception:
        status["database"] = "error"

    try:
        get_redis().ping()
        status["redis"] = "ok"
    except Exception:
        status["redis"] = "error"

    return status

