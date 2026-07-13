from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import current_tenant_id
from app.core.exceptions import AppError

router = APIRouter(prefix="/v1/audit-logs", tags=["audit-logs"])


@router.get("")
def list_audit_logs(
    request: Request,
    action: str | None = Query(default=None),
    module: str | None = Query(default=None),
    result: str | None = Query(default=None),
    user_id: UUID | None = Query(default=None),
    keyword: str | None = Query(default=None),
    object_id: str | None = Query(default=None),
    object_query: str | None = Query(default=None, alias="object"),
    object_type: str | None = Query(default=None),
    date_from: datetime | None = Query(default=None),
    date_to: datetime | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
) -> dict:
    tenant_id = current_tenant_id(request)
    filters = ["audit_logs.tenant_id = :tenant_id"]
    params: dict = {
        "tenant_id": tenant_id,
        "limit": page_size,
        "offset": (page - 1) * page_size,
    }
    if action:
        filters.append("audit_logs.action = :action")
        params["action"] = action
    if module:
        filters.append("audit_logs.module = :module")
        params["module"] = module
    if result:
        filters.append("audit_logs.result = :result")
        params["result"] = result
    if user_id:
        filters.append("audit_logs.user_id = :user_id")
        params["user_id"] = user_id
    if object_type:
        filters.append("audit_logs.object_type = :object_type")
        params["object_type"] = object_type
    target_object = object_id or object_query
    if target_object:
        filters.append("audit_logs.object_id::text ILIKE :object_id")
        params["object_id"] = f"%{target_object.strip()}%"
    if keyword:
        filters.append(
            """
            (
              audit_logs.action ILIKE :keyword
              OR audit_logs.module ILIKE :keyword
              OR COALESCE(audit_logs.result, '') ILIKE :keyword
              OR COALESCE(audit_logs.object_type, '') ILIKE :keyword
              OR COALESCE(audit_logs.object_id::text, '') ILIKE :keyword
              OR COALESCE(audit_logs.user_id::text, '') ILIKE :keyword
              OR COALESCE(audit_logs.request_path, '') ILIKE :keyword
              OR EXISTS (
                SELECT 1 FROM users u
                WHERE u.id = audit_logs.user_id
                  AND u.tenant_id = audit_logs.tenant_id
                  AND (u.name ILIKE :keyword OR u.username ILIKE :keyword)
              )
            )
            """
        )
        params["keyword"] = f"%{keyword.strip()}%"
    if date_from:
        filters.append("audit_logs.created_at >= :date_from")
        params["date_from"] = date_from
    if date_to:
        filters.append("audit_logs.created_at <= :date_to")
        params["date_to"] = date_to

    where_sql = " AND ".join(filters)
    rows = db.execute(
        text(
            f"""
            SELECT audit_logs.id, audit_logs.tenant_id, audit_logs.user_id,
                   u.name AS user_name, u.username AS username,
                   audit_logs.action, audit_logs.module, audit_logs.object_type, audit_logs.object_id,
                   audit_logs.result, audit_logs.ip, audit_logs.method, audit_logs.request_path,
                   audit_logs.status_code, audit_logs.detail, audit_logs.created_at
            FROM audit_logs
            LEFT JOIN users u ON u.id = audit_logs.user_id AND u.tenant_id = audit_logs.tenant_id
            WHERE {where_sql}
            ORDER BY audit_logs.created_at DESC, audit_logs.id DESC
            LIMIT :limit OFFSET :offset
            """
        ),
        params,
    ).mappings().all()
    total = db.execute(
        text(f"SELECT COUNT(*) FROM audit_logs WHERE {where_sql}"),
        params,
    ).scalar_one()
    summary = db.execute(
        text(
            """
            SELECT
              COUNT(*) AS total,
              COUNT(*) FILTER (WHERE result = 'success') AS success,
              COUNT(*) FILTER (WHERE COALESCE(result, 'failure') <> 'success') AS failure,
              COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') AS last_24h
            FROM audit_logs
            WHERE tenant_id = :tenant_id
            """
        ),
        {"tenant_id": tenant_id},
    ).mappings().one()
    action_rows = db.execute(
        text(
            """
            SELECT action, COUNT(*) AS count
            FROM audit_logs
            WHERE tenant_id = :tenant_id
            GROUP BY action
            ORDER BY count DESC, action ASC
            LIMIT 12
            """
        ),
        {"tenant_id": tenant_id},
    ).mappings().all()
    return {
        "items": [dict(row) for row in rows],
        "total": int(total or 0),
        "page": page,
        "page_size": page_size,
        "summary": {
            "total": int(summary["total"] or 0),
            "success": int(summary["success"] or 0),
            "failure": int(summary["failure"] or 0),
            "last_24h": int(summary["last_24h"] or 0),
            "top_actions": [dict(row) for row in action_rows],
        },
    }


@router.get("/{audit_log_id}")
def get_audit_log_detail(audit_log_id: UUID, request: Request, db: Session = Depends(get_db)) -> dict:
    tenant_id = current_tenant_id(request)
    row = db.execute(
        text(
            """
            SELECT al.id, al.tenant_id, al.user_id, u.name AS user_name, u.username AS username,
                   al.action, al.module, al.object_type, al.object_id,
                   al.result, al.ip, al.method, al.request_path, al.status_code,
                   al.detail, al.created_at
            FROM audit_logs al
            LEFT JOIN users u ON u.id = al.user_id AND u.tenant_id = al.tenant_id
            WHERE al.id = :audit_log_id AND al.tenant_id = :tenant_id
            """
        ),
        {"tenant_id": tenant_id, "audit_log_id": audit_log_id},
    ).mappings().first()
    if not row:
        raise AppError(code="AUDIT_LOG_NOT_FOUND", message="Audit log not found", status_code=404)

    task = None
    if row["object_type"] == "task" and row["object_id"]:
        task_row = db.execute(
            text(
                """
                SELECT t.id, t.title, t.status, t.priority, t.due_at, t.result,
                       t.source_type, t.source_id, s.name AS store_name
                FROM tasks t
                LEFT JOIN alerts a ON t.source_type = 'alert' AND a.id = t.source_id
                LEFT JOIN stores s ON s.id = a.store_id
                WHERE t.id = :task_id AND t.tenant_id = :tenant_id
                """
            ),
            {"tenant_id": tenant_id, "task_id": row["object_id"]},
        ).mappings().first()
        task = dict(task_row) if task_row else None

    notifications = []
    if row["object_id"]:
        notification_rows = db.execute(
            text(
                """
                SELECT id, channel, target_type, target_id, title, content, status, sent_at
                FROM notifications
                WHERE tenant_id = :tenant_id
                  AND target_id = :target_id
                ORDER BY id DESC
                LIMIT 10
                """
            ),
            {"tenant_id": tenant_id, "target_id": str(row["object_id"])},
        ).mappings().all()
        notifications = [dict(item) for item in notification_rows]

    return {
        "audit": dict(row),
        "task": task,
        "notifications": notifications,
    }
