import json
from datetime import datetime, timedelta, timezone
from uuid import UUID

import jwt
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.exceptions import AppError
from app.services.audit_service import insert_audit_log
from app.services.notify_service import create_task_feedback_review_notification
from app.services.task_state import ensure_dispatchable, ensure_feedback_allowed, ensure_status_transition

router = APIRouter(prefix="/v1/relay", tags=["relay"])

REPORT_SHARE_CODE_PREFIX = "report:"


class RelayFeedback(BaseModel):
    result: str = Field(min_length=1)
    feedback_img_urls: list[str] = Field(default_factory=list)


def issue_relay_token(task_id: UUID | str, task: dict, db: Session | None = None) -> dict:
    now = datetime.now(timezone.utc)
    payload = {
        "typ": "relay_task",
        "tenant_id": str(task["tenant_id"]),
        "task_id": str(task_id),
        "iat": now,
        "exp": now + timedelta(days=7),
    }
    token = jwt.encode(payload, settings.app_secret_key, algorithm="HS256")
    return {"token": token, "h5_url": f"{settings.h5_base_url.rstrip('/')}/h5/task/{token}"}


def decode_relay_token(token: str) -> dict:
    try:
        claims = jwt.decode(token, settings.app_secret_key, algorithms=["HS256"])
    except jwt.PyJWTError as exc:
        raise AppError(code="RELAY_TOKEN_INVALID", message="Task link is invalid or expired", status_code=401) from exc
    if claims.get("typ") != "relay_task" or not claims.get("tenant_id") or not claims.get("task_id"):
        raise AppError(code="RELAY_TOKEN_INVALID", message="Task link is invalid or expired", status_code=401)
    return claims


@router.get("/tasks/{token}")
def get_relay_task(token: str, db: Session = Depends(get_db)) -> dict:
    claims = decode_relay_token(token)
    task = fetch_task_for_relay(db, claims["tenant_id"], UUID(claims["task_id"]))
    return {"token_status": token_status(task), "task": task}


@router.post("/tasks/{token}/confirm")
def confirm_relay_task(token: str, db: Session = Depends(get_db)) -> dict:
    claims = decode_relay_token(token)
    task = fetch_task_for_relay(db, claims["tenant_id"], UUID(claims["task_id"]))
    ensure_dispatchable(task["status"])
    update_task_status(db, claims["tenant_id"], task["id"], "confirmed")
    insert_audit_log(
        db,
        tenant_id=claims["tenant_id"],
        user_id=task.get("assignee_id"),
        action="TASK_H5_CONFIRM",
        module="tasks",
        object_type="task",
        object_id=task["id"],
        result="success",
        ip=None,
    )
    db.commit()
    return get_relay_task(token, db)


@router.post("/tasks/{token}/start")
def start_relay_task(token: str, db: Session = Depends(get_db)) -> dict:
    claims = decode_relay_token(token)
    task = fetch_task_for_relay(db, claims["tenant_id"], UUID(claims["task_id"]))
    ensure_status_transition(task["status"], "processing")
    update_task_status(db, claims["tenant_id"], task["id"], "processing")
    insert_audit_log(
        db,
        tenant_id=claims["tenant_id"],
        user_id=task.get("assignee_id"),
        action="TASK_H5_START",
        module="tasks",
        object_type="task",
        object_id=task["id"],
        result="success",
        ip=None,
    )
    db.commit()
    return get_relay_task(token, db)


@router.post("/tasks/{token}/feedback")
def submit_relay_feedback(token: str, payload: RelayFeedback, db: Session = Depends(get_db)) -> dict:
    claims = decode_relay_token(token)
    task = fetch_task_for_relay(db, claims["tenant_id"], UUID(claims["task_id"]))
    ensure_feedback_allowed(task["status"])
    db.execute(
        text(
            """
            UPDATE tasks
            SET result = :result,
                feedback_img_urls = CAST(:feedback_img_urls AS jsonb),
                status = 'pending_review'
            WHERE id = :task_id AND tenant_id = :tenant_id
            """
        ),
        {
            "tenant_id": claims["tenant_id"],
            "task_id": task["id"],
            "result": payload.result,
            "feedback_img_urls": json.dumps(payload.feedback_img_urls),
        },
    )
    insert_audit_log(
        db,
        tenant_id=claims["tenant_id"],
        user_id=task.get("assignee_id"),
        action="TASK_H5_FEEDBACK",
        module="tasks",
        object_type="task",
        object_id=task["id"],
        result="success",
        ip=None,
    )
    create_task_feedback_review_notification(db, claims["tenant_id"], task)
    db.commit()
    return get_relay_task(token, db)


def fetch_task_for_relay(db: Session, tenant_id: str, task_id: UUID) -> dict:
    row = db.execute(
        text(
            """
            SELECT t.id, t.tenant_id, t.source_type, t.source_id, t.title,
                   t.department_id, d.name AS department_name,
                   t.assignee_id, u.name AS assignee_name,
                   t.status, t.priority, t.due_at, t.result,
                   t.feedback_img_urls, t.created_at,
                   a.alert_type, a.level AS alert_level, a.summary AS alert_summary,
                   COALESCE(t.store_id, a.store_id) AS store_id,
                   s.name AS store_name, s.region AS store_region
            FROM tasks t
            LEFT JOIN departments d ON d.id = t.department_id
            LEFT JOIN users u ON u.id = t.assignee_id
            LEFT JOIN alerts a ON t.source_type = 'alert' AND a.id = t.source_id AND a.tenant_id = t.tenant_id
            LEFT JOIN stores s ON s.id = COALESCE(t.store_id, a.store_id) AND s.tenant_id = t.tenant_id
            WHERE t.id = :task_id AND t.tenant_id = :tenant_id
            """
        ),
        {"tenant_id": tenant_id, "task_id": task_id},
    ).mappings().first()
    if not row:
        raise AppError(code="TASK_NOT_FOUND", message="Task not found", status_code=404)
    task = dict(row)
    task["id"] = str(task["id"])
    task["tenant_id"] = str(task["tenant_id"])
    task["source_id"] = str(task["source_id"]) if task.get("source_id") else None
    task["department_id"] = str(task["department_id"]) if task.get("department_id") else None
    task["assignee_id"] = str(task["assignee_id"]) if task.get("assignee_id") else None
    task["store_id"] = str(task["store_id"]) if task.get("store_id") else None
    task["due_at"] = task["due_at"].isoformat() if task.get("due_at") else None
    task["created_at"] = task["created_at"].isoformat() if task.get("created_at") else None
    task["feedback_img_urls"] = task.get("feedback_img_urls") or []
    return task


def update_task_status(db: Session, tenant_id: str, task_id: UUID | str, status: str) -> None:
    db.execute(
        text(
            """
            UPDATE tasks
            SET status = :status
            WHERE id = :task_id AND tenant_id = :tenant_id
            """
        ),
        {"tenant_id": tenant_id, "task_id": task_id, "status": status},
    )


def token_status(task: dict) -> str:
    if task["status"] in {"pending_review", "closed"}:
        return "feedback_submitted"
    return "active"


def issue_report_token(*args, **kwargs) -> dict:
    raise AppError(code="COMMUNITY_FEATURE_DISABLED", message="Report H5 is not included in Community v0.1", status_code=404)
