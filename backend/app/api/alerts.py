from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import current_tenant_id, current_user_id, scoped_store_condition, scoped_store_id_condition
from app.core.exceptions import AppError
from app.api.tasks import insert_task
from app.api.relay import fetch_task_for_relay, issue_relay_token
from app.services.audit_service import insert_audit_log
from app.services.ai_runtime import sanitize_ai_output
from app.services.notify_service import create_task_h5_notification, dispatch_notifications_by_ids

router = APIRouter(prefix="/v1/alerts", tags=["alerts"])

ALERT_STATUSES = {"open", "processing", "ignored", "closed"}


class AlertStatusUpdate(BaseModel):
    status: str


class AlertToTask(BaseModel):
    title: str | None = None
    department_id: UUID | None = None
    assignee_id: UUID | None = None
    priority: str | None = None
    due_at: datetime | None = None
    note: str | None = None


@router.get("")
def list_alerts(request: Request, db: Session = Depends(get_db)) -> list[dict]:
    tenant_id = current_tenant_id(request)
    scope_sql, scope_params = scoped_store_condition(request, "s")
    rows = db.execute(
        text(
            f"""
            SELECT a.id, a.tenant_id, a.store_id, s.name AS store_name,
                   a.alert_type, a.level, a.title, a.summary, a.status,
                   a.responsible_user_id, u.name AS responsible_user_name,
                   a.due_at, a.created_at
            FROM alerts a
            LEFT JOIN stores s ON s.id = a.store_id
            LEFT JOIN users u ON u.id = a.responsible_user_id
            WHERE a.tenant_id = :tenant_id
              AND {scope_sql}
            ORDER BY a.created_at DESC
            LIMIT 200
            """
        ),
        {"tenant_id": tenant_id, **scope_params},
    ).mappings().all()
    return [normalize_alert_row(row) for row in rows]


@router.get("/dispatch-options")
def alert_dispatch_options(request: Request, db: Session = Depends(get_db)) -> dict:
    tenant_id = current_tenant_id(request)
    users = db.execute(
        text(
            """
            SELECT u.id, u.name, u.username, u.phone,
                   d.name AS department_name,
                   r.name AS role_name
            FROM users u
            LEFT JOIN departments d ON d.id = u.department_id
            LEFT JOIN roles r ON r.id = u.role_id
            WHERE u.tenant_id = :tenant_id
              AND u.status = 'active'
            ORDER BY d.sort ASC NULLS LAST, u.name ASC
            """
        ),
        {"tenant_id": tenant_id},
    ).mappings().all()
    departments = db.execute(
        text(
            """
            SELECT id, name, type, sort
            FROM departments
            WHERE tenant_id = :tenant_id
            ORDER BY sort ASC, name ASC
            """
        ),
        {"tenant_id": tenant_id},
    ).mappings().all()
    return {"users": [dict(row) for row in users], "departments": [dict(row) for row in departments]}


@router.get("/{alert_id}")
def get_alert(alert_id: UUID, request: Request, db: Session = Depends(get_db)) -> dict:
    tenant_id = current_tenant_id(request)
    scope_sql, scope_params = scoped_store_condition(request, "s")
    row = db.execute(
        text(
            f"""
            SELECT a.id, a.tenant_id, a.store_id, s.name AS store_name,
                   a.alert_type, a.level, a.title, a.summary, a.status,
                   a.responsible_user_id, u.name AS responsible_user_name,
                   a.due_at, a.created_at
            FROM alerts a
            LEFT JOIN stores s ON s.id = a.store_id
            LEFT JOIN users u ON u.id = a.responsible_user_id
            WHERE a.id = :alert_id AND a.tenant_id = :tenant_id
              AND {scope_sql}
            """
        ),
        {"tenant_id": tenant_id, "alert_id": alert_id, **scope_params},
    ).mappings().first()
    if not row:
        raise AppError(code="ALERT_NOT_FOUND", message="Alert not found", status_code=404)
    alert = normalize_alert_row(row)
    alert["tasks"] = get_alert_tasks(db, tenant_id, alert_id)
    alert["notifications"] = get_alert_notifications(db, tenant_id, alert_id)
    alert["audit_logs"] = get_alert_audit_logs(db, tenant_id, alert_id)
    return alert


@router.put("/{alert_id}/status")
def update_alert_status(alert_id: UUID, payload: AlertStatusUpdate, request: Request, db: Session = Depends(get_db)) -> dict:
    tenant_id = current_tenant_id(request)
    user_id = current_user_id(request)
    ensure_alert_status(payload.status)
    scope_sql, scope_params = scoped_store_id_condition(request, "alerts.store_id")
    row = db.execute(
        text(
            f"""
            UPDATE alerts
            SET status = :status
            WHERE id = :alert_id AND tenant_id = :tenant_id
              AND {scope_sql}
            RETURNING id, tenant_id, store_id, alert_type, level, title, summary,
                      status, responsible_user_id, due_at, created_at
            """
        ),
        {"tenant_id": tenant_id, "alert_id": alert_id, "status": payload.status, **scope_params},
    ).mappings().first()
    if not row:
        raise AppError(code="ALERT_NOT_FOUND", message="Alert not found", status_code=404)
    insert_audit_log(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        action="ALERT_STATUS_UPDATE",
        module="alerts",
        object_type="alert",
        object_id=alert_id,
        result="success",
        ip=request.client.host if request.client else None,
    )
    db.commit()
    return normalize_alert_row(row)


@router.post("/{alert_id}/to-task", status_code=201)
def alert_to_task(alert_id: UUID, payload: AlertToTask, request: Request, db: Session = Depends(get_db)) -> dict:
    tenant_id = current_tenant_id(request)
    user_id = current_user_id(request)
    if payload.assignee_id:
        ensure_user_belongs_to_tenant(db, tenant_id, payload.assignee_id)
    if payload.department_id:
        ensure_department_belongs_to_tenant(db, tenant_id, payload.department_id)
    scope_sql, scope_params = scoped_store_id_condition(request, "a.store_id")
    existing = db.execute(
        text(
            f"""
            SELECT t.id, t.tenant_id, t.source_type, t.source_id, t.title, t.department_id,
                   t.assignee_id, t.status, t.priority, t.due_at, t.result, t.feedback_img_urls, t.created_at
            FROM tasks t
            JOIN alerts a ON a.id = t.source_id
                         AND t.source_type = 'alert'
                         AND a.tenant_id = t.tenant_id
            WHERE t.tenant_id = :tenant_id
              AND t.source_id = :alert_id
              AND t.status NOT IN ('closed', 'archived')
              AND {scope_sql}
            ORDER BY t.created_at DESC
            LIMIT 1
            """
        ),
        {"tenant_id": tenant_id, "alert_id": alert_id, **scope_params},
    ).mappings().first()
    if existing:
        if existing["status"] == "pending_review":
            return {
                **dict(existing),
                "h5_token": None,
                "h5_url": None,
                "notification_status": "skipped",
                "note": payload.note,
            }
        db.execute(
            text(
                """
                UPDATE tasks
                SET title = COALESCE(:title, title),
                    department_id = COALESCE(:department_id, department_id),
                    assignee_id = COALESCE(:assignee_id, assignee_id),
                    priority = COALESCE(:priority, priority),
                    due_at = COALESCE(:due_at, due_at)
                WHERE id = :task_id AND tenant_id = :tenant_id
                """
            ),
            {
                "tenant_id": tenant_id,
                "task_id": existing["id"],
                "title": payload.title,
                "department_id": payload.department_id,
                "assignee_id": payload.assignee_id,
                "priority": payload.priority,
                "due_at": payload.due_at,
            },
        )
        if payload.assignee_id:
            db.execute(
                text(
                    """
                    UPDATE alerts
                    SET status = 'processing',
                        responsible_user_id = :assignee_id
                    WHERE id = :alert_id AND tenant_id = :tenant_id
                    """
                ),
                {"tenant_id": tenant_id, "alert_id": alert_id, "assignee_id": payload.assignee_id},
            )
        relay_task = fetch_task_for_relay(db, tenant_id, existing["id"])
        relay = issue_relay_token(existing["id"], relay_task, db=db)
        notification = create_task_h5_notification(db, tenant_id, relay_task, relay["h5_url"], payload.note)
        apply_dispatch_result(notification, dispatch_notifications_by_ids(db, [notification["id"]]))
        insert_audit_log(
            db,
            tenant_id=tenant_id,
            user_id=user_id,
            action="ALERT_TO_TASK",
            module="alerts",
            object_type="task",
            object_id=existing["id"],
            result="success",
            ip=request.client.host if request.client else None,
        )
        db.commit()
        return {
            **relay_task,
            "h5_token": relay["token"],
            "h5_url": relay["h5_url"],
            "notification_status": notification["status"],
            "notification_channel": notification["channel"],
            "notification_id": notification["id"],
            "note": payload.note,
        }

    alert = db.execute(
        text(
            f"""
            SELECT a.id, a.store_id, a.title, a.summary, a.level, a.status, a.responsible_user_id, s.manager_user_id
            FROM alerts a
            LEFT JOIN stores s ON s.id = a.store_id
            WHERE a.id = :alert_id AND a.tenant_id = :tenant_id
              AND {scope_sql}
            """
        ),
        {"tenant_id": tenant_id, "alert_id": alert_id, **scope_params},
    ).mappings().first()
    if not alert:
        raise AppError(code="ALERT_NOT_FOUND", message="Alert not found", status_code=404)
    if alert["status"] in {"ignored", "closed"}:
        raise AppError(
            code="ALERT_NOT_DISPATCHABLE",
            message="Ignored or closed alerts cannot be dispatched",
            status_code=409,
            detail={"status": alert["status"]},
        )
    assignee_id = payload.assignee_id or alert["responsible_user_id"] or alert["manager_user_id"]
    task = insert_task(
        db,
        tenant_id,
        {
            "source_type": "alert",
            "source_id": alert_id,
            "store_id": alert["store_id"],
            "title": payload.title or alert["title"],
            "department_id": payload.department_id,
            "assignee_id": assignee_id,
            "status": "pending_confirm",
            "priority": payload.priority or ("high" if alert["level"] in ("critical", "high") else "normal"),
            "due_at": payload.due_at,
        },
    )
    db.execute(
        text(
            """
            UPDATE alerts
            SET status = 'processing',
                responsible_user_id = COALESCE(:assignee_id, responsible_user_id)
            WHERE id = :alert_id AND tenant_id = :tenant_id
            """
        ),
        {"tenant_id": tenant_id, "alert_id": alert_id, "assignee_id": assignee_id},
    )
    insert_audit_log(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        action="ALERT_TO_TASK",
        module="alerts",
        object_type="task",
        object_id=task["id"],
        result="success",
        ip=request.client.host if request.client else None,
    )
    db.commit()
    relay_task = fetch_task_for_relay(db, tenant_id, task["id"])
    relay = issue_relay_token(task["id"], relay_task, db=db)
    notification = create_task_h5_notification(db, tenant_id, relay_task, relay["h5_url"], payload.note)
    apply_dispatch_result(notification, dispatch_notifications_by_ids(db, [notification["id"]]))
    db.commit()
    return {
        **task,
        "h5_token": relay["token"],
        "h5_url": relay["h5_url"],
        "notification_status": notification["status"],
        "notification_channel": notification["channel"],
        "notification_id": notification["id"],
        "note": payload.note,
    }


def apply_dispatch_result(notification: dict, dispatch_results: dict[str, dict]) -> None:
    result = dispatch_results.get(str(notification["id"]))
    if result:
        notification["status"] = result["status"]
        notification["dispatch_reason"] = result["reason"]


def ensure_alert_status(status: str) -> None:
    if status not in ALERT_STATUSES:
        raise AppError(
            code="ALERT_STATUS_INVALID",
            message="Invalid alert status",
            status_code=400,
            detail={"status": status},
        )


def normalize_alert_row(row: dict) -> dict:
    alert = dict(row)
    alert["summary"] = sanitize_ai_output(alert.get("summary"))
    return alert


def get_alert_tasks(db: Session, tenant_id: str, alert_id: UUID) -> list[dict]:
    rows = db.execute(
        text(
            """
            SELECT t.id, t.source_type, t.source_id, t.title, t.department_id,
                   d.name AS department_name,
                   t.assignee_id, u.name AS assignee_name,
                   t.status, t.priority, t.due_at, t.result,
                   t.feedback_img_urls, t.created_at
            FROM tasks t
            LEFT JOIN departments d ON d.id = t.department_id
            LEFT JOIN users u ON u.id = t.assignee_id
            WHERE t.tenant_id = :tenant_id
              AND t.source_type = 'alert'
              AND t.source_id = :alert_id
            ORDER BY t.created_at DESC, t.id DESC
            LIMIT 20
            """
        ),
        {"tenant_id": tenant_id, "alert_id": alert_id},
    ).mappings().all()
    return [dict(row) for row in rows]


def get_alert_notifications(db: Session, tenant_id: str, alert_id: UUID) -> list[dict]:
    rows = db.execute(
        text(
            """
            SELECT n.id, n.channel, n.target_type, n.target_id, n.title,
                   n.content, n.status, n.retry_count, n.sent_at,
                   u.name AS recipient_user_name
            FROM notifications n
            LEFT JOIN users u ON u.id = n.recipient_user_id
            WHERE n.tenant_id = :tenant_id
              AND (
                (n.target_type = 'alert' AND n.target_id = :alert_id_text)
                OR (
                  n.target_type = 'task'
                  AND n.target_id IN (
                    SELECT t.id::text
                    FROM tasks t
                    WHERE t.tenant_id = :tenant_id
                      AND t.source_type = 'alert'
                      AND t.source_id = :alert_id
                  )
                )
              )
            ORDER BY n.sent_at DESC NULLS LAST, n.id DESC
            LIMIT 20
            """
        ),
        {"tenant_id": tenant_id, "alert_id": alert_id, "alert_id_text": str(alert_id)},
    ).mappings().all()
    return [dict(row) for row in rows]


def get_alert_audit_logs(db: Session, tenant_id: str, alert_id: UUID) -> list[dict]:
    rows = db.execute(
        text(
            """
            SELECT l.id, l.user_id, u.name AS user_name, l.action, l.module,
                   l.object_type, l.object_id, l.result, l.created_at
            FROM audit_logs l
            LEFT JOIN users u ON u.id = l.user_id
            WHERE l.tenant_id = :tenant_id
              AND (
                l.object_id = :alert_id
                OR l.object_id IN (
                  SELECT t.id
                  FROM tasks t
                  WHERE t.tenant_id = :tenant_id
                    AND t.source_type = 'alert'
                    AND t.source_id = :alert_id
                )
              )
            ORDER BY l.created_at DESC, l.id DESC
            LIMIT 20
            """
        ),
        {"tenant_id": tenant_id, "alert_id": alert_id},
    ).mappings().all()
    return [dict(row) for row in rows]


def ensure_user_belongs_to_tenant(db: Session, tenant_id: str, user_id: UUID) -> None:
    exists = db.execute(
        text(
            """
            SELECT 1
            FROM users
            WHERE tenant_id = :tenant_id
              AND id = :user_id
              AND status = 'active'
            """
        ),
        {"tenant_id": tenant_id, "user_id": user_id},
    ).scalar()
    if not exists:
        raise AppError(code="ASSIGNEE_NOT_FOUND", message="Assignee not found", status_code=404)


def ensure_department_belongs_to_tenant(db: Session, tenant_id: str, department_id: UUID) -> None:
    exists = db.execute(
        text(
            """
            SELECT 1
            FROM departments
            WHERE tenant_id = :tenant_id
              AND id = :department_id
            """
        ),
        {"tenant_id": tenant_id, "department_id": department_id},
    ).scalar()
    if not exists:
        raise AppError(code="DEPARTMENT_NOT_FOUND", message="Department not found", status_code=404)
