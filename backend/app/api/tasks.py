import json
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import current_data_scope, current_tenant_id, current_user_id, scoped_store_id_condition, scoped_task_condition
from app.core.exceptions import AppError
from app.services.audit_service import insert_audit_log
from app.services.notify_service import (
    create_task_feedback_review_notification,
    create_task_h5_notification,
    dispatch_notifications_by_ids,
)
from app.services.task_state import ensure_feedback_allowed, ensure_status_transition, ensure_valid_status

router = APIRouter(prefix="/v1/tasks", tags=["tasks"])


class TaskCreate(BaseModel):
    source_type: str | None = None
    source_id: UUID | None = None
    store_id: UUID | None = None
    title: str = Field(min_length=1)
    department_id: UUID | None = None
    assignee_id: UUID | None = None
    status: str = "pending_confirm"
    priority: str = "normal"
    due_at: datetime | None = None


class TaskStatusUpdate(BaseModel):
    status: str


class TaskFeedback(BaseModel):
    result: str = Field(min_length=1)
    feedback_img_urls: list[str] = Field(default_factory=list)


class TaskReview(BaseModel):
    approved: bool | None = True
    action: str | None = None
    note: str | None = None


@router.get("")
def list_tasks(request: Request, db: Session = Depends(get_db)) -> list[dict]:
    tenant_id = current_tenant_id(request)
    scope_sql, scope_params = scoped_task_condition(request, "t")
    rows = db.execute(
        text(
            f"""
            SELECT t.id, t.tenant_id, t.source_type, t.source_id, t.title,
                   t.department_id, d.name AS department_name,
                   t.assignee_id, u.name AS assignee_name,
                   t.status, t.priority, t.due_at, t.result,
                   t.feedback_img_urls, t.created_at,
                   a.alert_type, a.level AS alert_level,
                   COALESCE(ts.id, s.id) AS store_id,
                   COALESCE(ts.name, s.name) AS store_name
            FROM tasks t
            LEFT JOIN departments d ON d.id = t.department_id
            LEFT JOIN users u ON u.id = t.assignee_id
            LEFT JOIN stores ts ON ts.id = t.store_id AND ts.tenant_id = t.tenant_id
            LEFT JOIN alerts a ON t.source_type = 'alert' AND a.id = t.source_id
            LEFT JOIN stores s ON s.id = a.store_id
            WHERE t.tenant_id = :tenant_id
              AND {scope_sql}
            ORDER BY t.created_at DESC
            LIMIT 200
            """
        ),
        {"tenant_id": tenant_id, **scope_params},
    ).mappings().all()
    return [dict(row) for row in rows]


@router.post("", status_code=201)
def create_task(payload: TaskCreate, request: Request, db: Session = Depends(get_db)) -> dict:
    tenant_id = current_tenant_id(request)
    ensure_valid_status(payload.status)
    values = payload.model_dump()
    validate_task_store_scope(db, tenant_id, request, values)
    row = insert_task(db, tenant_id, values)
    db.commit()
    return row


@router.get("/{task_id}")
def get_task(task_id: UUID, request: Request, db: Session = Depends(get_db)) -> dict:
    tenant_id = current_tenant_id(request)
    scope_sql, scope_params = scoped_task_condition(request, "t")
    row = db.execute(
        text(
            f"""
            SELECT t.id, t.tenant_id, t.source_type, t.source_id, t.title,
                   t.department_id, d.name AS department_name,
                   t.assignee_id, u.name AS assignee_name,
                   t.status, t.priority, t.due_at, t.result,
                   t.feedback_img_urls, t.created_at,
                   a.alert_type, a.level AS alert_level,
                   COALESCE(ts.id, s.id) AS store_id,
                   COALESCE(ts.name, s.name) AS store_name
            FROM tasks t
            LEFT JOIN departments d ON d.id = t.department_id
            LEFT JOIN users u ON u.id = t.assignee_id
            LEFT JOIN stores ts ON ts.id = t.store_id AND ts.tenant_id = t.tenant_id
            LEFT JOIN alerts a ON t.source_type = 'alert' AND a.id = t.source_id
            LEFT JOIN stores s ON s.id = a.store_id
            WHERE t.id = :task_id AND t.tenant_id = :tenant_id
              AND {scope_sql}
            """
        ),
        {"tenant_id": tenant_id, "task_id": task_id, **scope_params},
    ).mappings().one()
    task = dict(row)
    task["related_alert"] = get_related_alert(db, tenant_id, task)
    task["notifications"] = get_task_notifications(db, tenant_id, task_id)
    task["audit_logs"] = get_task_audit_logs(db, tenant_id, task_id)
    return task


@router.put("/{task_id}/status")
def update_task_status(task_id: UUID, payload: TaskStatusUpdate, request: Request, db: Session = Depends(get_db)) -> dict:
    tenant_id = current_tenant_id(request)
    scope_sql, scope_params = scoped_task_condition(request, "tasks")
    current_status = get_task_status(db, tenant_id, task_id, scope_sql, scope_params)
    ensure_status_transition(current_status, payload.status)
    row = db.execute(
        text(
            f"""
            UPDATE tasks
            SET status = :status
            WHERE id = :task_id AND tenant_id = :tenant_id
              AND {scope_sql}
            RETURNING id, tenant_id, source_type, source_id, title, department_id,
                      store_id, assignee_id, status, priority, due_at, result, feedback_img_urls, created_at
            """
        ),
        {"tenant_id": tenant_id, "task_id": task_id, "status": payload.status, **scope_params},
    ).mappings().one()
    db.commit()
    return dict(row)


@router.post("/{task_id}/feedback")
def submit_task_feedback(task_id: UUID, payload: TaskFeedback, request: Request, db: Session = Depends(get_db)) -> dict:
    tenant_id = current_tenant_id(request)
    user_id = current_user_id(request)
    scope_sql, scope_params = scoped_task_condition(request, "tasks")
    current_status = get_task_status(db, tenant_id, task_id, scope_sql, scope_params)
    ensure_feedback_allowed(current_status)
    row = db.execute(
        text(
            f"""
            UPDATE tasks
            SET result = :result,
                feedback_img_urls = CAST(:feedback_img_urls AS jsonb),
                status = 'pending_review'
            WHERE id = :task_id AND tenant_id = :tenant_id
              AND {scope_sql}
            RETURNING id, tenant_id, source_type, source_id, title, department_id,
                      store_id, assignee_id, status, priority, due_at, result, feedback_img_urls, created_at
            """
        ),
        {
            "tenant_id": tenant_id,
            "task_id": task_id,
            "result": payload.result,
            "feedback_img_urls": json.dumps(payload.feedback_img_urls),
            **scope_params,
        },
    ).mappings().one()
    insert_audit_log(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        action="TASK_FEEDBACK_SUBMIT",
        module="tasks",
        object_type="task",
        object_id=task_id,
        result="success",
        ip=request.client.host if request.client else None,
    )
    create_task_feedback_review_notification(db, tenant_id, dict(row))
    db.commit()
    return dict(row)


@router.post("/{task_id}/review")
def review_task(task_id: UUID, payload: TaskReview, request: Request, db: Session = Depends(get_db)) -> dict:
    tenant_id = current_tenant_id(request)
    user_id = current_user_id(request)
    action, note = normalize_task_review_action(payload.action, payload.approved, payload.note)
    scope_sql, scope_params = scoped_task_condition(request, "tasks")
    response = apply_task_review(
        db=db,
        tenant_id=tenant_id,
        user_id=user_id,
        task_id=task_id,
        action=action,
        note=note,
        request=request,
        scope_sql=scope_sql,
        scope_params=scope_params,
        audit_module="tasks",
    )
    db.commit()
    return response


def normalize_task_review_action(action: str | None, approved: bool | None = True, note: str | None = None) -> tuple[str, str | None]:
    normalized_note = note.strip() if note else None
    normalized_action = action.strip().lower() if action else ("reject" if approved is False else "approve")
    if normalized_action not in {"approve", "reject", "escalate"}:
        raise AppError(
            code="TASK_REVIEW_ACTION_INVALID",
            message="Task review action is invalid",
            status_code=400,
            detail={"action": normalized_action},
        )
    if normalized_action in {"reject", "escalate"} and not normalized_note:
        raise AppError(
            code="TASK_REVIEW_NOTE_REQUIRED",
            message="Review note is required for rejecting or escalating a task",
            status_code=400,
            detail={"action": normalized_action},
        )
    return normalized_action, normalized_note


def task_review_next_status(action: str) -> str:
    if action == "approve":
        return "closed"
    if action == "reject":
        return "pending_confirm"
    if action == "escalate":
        return "processing"
    raise AppError(code="TASK_REVIEW_ACTION_INVALID", message="Task review action is invalid", status_code=400, detail={"action": action})


def build_task_review_result_note(action: str, note: str | None) -> str | None:
    if not note:
        return None
    label = {"approve": "审核意见", "reject": "驳回原因", "escalate": "升级说明"}[action]
    return f"{label}：{note}"


def build_task_review_contract(task: dict, action: str | None = None) -> dict:
    status = task.get("status")
    return {
        "review_status": status,
        "allowed_actions": ["approve", "reject", "escalate"] if status == "pending_review" else [],
        "action": action,
        "requires_note": {"approve": False, "reject": True, "escalate": True},
        "status_mapping": {
            "approve": "closed",
            "reject": "pending_confirm",
            "escalate": "processing",
        },
    }


def apply_task_review(
    db: Session,
    tenant_id: str,
    user_id: str,
    task_id: UUID,
    action: str,
    note: str | None,
    request: Request,
    scope_sql: str = "1=1",
    scope_params: dict | None = None,
    audit_module: str = "tasks",
) -> dict:
    next_status = task_review_next_status(action)
    scope_params = scope_params or {}
    current_status = get_task_status(db, tenant_id, task_id, scope_sql, scope_params)
    ensure_status_transition(current_status, next_status)
    review_note = build_task_review_result_note(action, note)
    row = db.execute(
        text(
            f"""
            UPDATE tasks
                  SET status = :status,
                      priority = CASE WHEN :action = 'escalate' THEN 'critical' ELSE priority END,
                      due_at = CASE
                        WHEN :action = 'escalate' AND (due_at IS NULL OR due_at > NOW() + INTERVAL '1 day')
                        THEN NOW() + INTERVAL '1 day'
                        ELSE due_at
                      END,
                      result = CASE
                        WHEN NULLIF(CAST(:review_note AS text), '') IS NOT NULL
                        THEN CONCAT(COALESCE(result, ''), E'\n\n', CAST(:review_note AS text))
                        ELSE result
                      END
            WHERE id = :task_id AND tenant_id = :tenant_id
              AND {scope_sql}
            RETURNING id, tenant_id, source_type, source_id, title, department_id,
                      store_id, assignee_id, status, priority, due_at, result, feedback_img_urls, created_at
            """
        ),
        {
            "tenant_id": tenant_id,
            "task_id": task_id,
            "status": next_status,
            "action": action,
            "review_note": review_note,
            **scope_params,
        },
    ).mappings().one()
    insert_audit_log(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        action=task_review_audit_action(action),
        module=audit_module,
        object_type="task",
        object_id=task_id,
        result="success",
        detail={"review_action": action, "from": current_status, "to": next_status, "note": note},
        ip=request.client.host if request.client else None,
    )
    response = dict(row)
    response["review_contract"] = build_task_review_contract(response, action)
    if action == "approve":
        insert_review_notification(db, tenant_id, response, action, note)
    elif action == "reject":
        relay = create_return_repush_notification(db, tenant_id, task_id, note)
        response.update(relay)
    else:
        insert_review_notification(db, tenant_id, response, action, note)
    return response


def task_review_audit_action(action: str) -> str:
    return {
        "approve": "TASK_REVIEW_APPROVE",
        "reject": "TASK_REVIEW_RETURN",
        "escalate": "TASK_REVIEW_ESCALATE",
    }[action]


def create_return_repush_notification(db: Session, tenant_id: str, task_id: UUID, note: str | None) -> dict:
    from app.api.relay import fetch_task_for_relay, issue_relay_token

    task = fetch_task_for_relay(db, tenant_id, task_id)
    relay = issue_relay_token(task_id, task, db=db)
    notification = create_task_h5_notification(db, tenant_id, task, relay["h5_url"], note=f"复核驳回：{note}" if note else None)
    apply_notification_dispatch_result(notification, dispatch_notifications_by_ids(db, [notification["id"]]))
    return {
        "h5_url": relay["h5_url"],
        "notification_id": notification["id"],
        "notification_channel": notification["channel"],
        "notification_status": notification["status"],
    }


def apply_notification_dispatch_result(notification: dict, dispatch_results: dict[str, dict]) -> None:
    result = dispatch_results.get(str(notification["id"]))
    if result:
        notification["status"] = result["status"]
        notification["dispatch_reason"] = result["reason"]


def insert_task(db: Session, tenant_id: str, values: dict) -> dict:
    ensure_valid_status(values["status"])
    row = db.execute(
        text(
            """
            INSERT INTO tasks (
              tenant_id, source_type, source_id, store_id, title, department_id,
              assignee_id, status, priority, due_at
            )
            VALUES (
              :tenant_id, :source_type, :source_id, :store_id, :title, :department_id,
              :assignee_id, :status, :priority, :due_at
            )
            RETURNING id, tenant_id, source_type, source_id, title, department_id,
                      store_id, assignee_id, status, priority, due_at, result, feedback_img_urls, created_at
            """
        ),
        {"tenant_id": tenant_id, **values},
    ).mappings().one()
    return dict(row)


def validate_task_store_scope(db: Session, tenant_id: str, request: Request, values: dict) -> None:
    store_id = values.get("store_id")
    source_type = values.get("source_type")
    if not store_id:
        if current_data_scope(request) != "all" and source_type != "alert":
            raise AppError(
                code="TASK_STORE_REQUIRED",
                message="Store is required for scoped manual tasks",
                status_code=400,
            )
        return
    exists = db.execute(
        text("SELECT 1 FROM stores WHERE tenant_id = :tenant_id AND id = :store_id"),
        {"tenant_id": tenant_id, "store_id": store_id},
    ).scalar()
    if not exists:
        raise AppError(code="TASK_STORE_NOT_FOUND", message="Task store not found", status_code=404)
    if current_data_scope(request) == "all":
        return
    scope_sql, scope_params = scoped_store_id_condition(request, ":store_id")
    in_scope = db.execute(
        text(f"SELECT 1 WHERE {scope_sql}"),
        {"tenant_id": tenant_id, "store_id": store_id, **scope_params},
    ).scalar()
    if not in_scope:
        raise AppError(code="TASK_STORE_NOT_IN_SCOPE", message="Task store is not in current user scope", status_code=404)


def insert_review_notification(db: Session, tenant_id: str, task: dict, action: str, note: str | None) -> None:
    title = {
        "approve": "任务审核通过",
        "reject": "任务被退回处理",
        "escalate": "任务升级处理",
    }[action]
    content_parts = [
        f"任务：{task.get('title') or task.get('id')}",
        {
            "approve": "复核已通过，任务已关闭。",
            "reject": "复核已驳回，门店需继续处理后重新提交反馈。",
            "escalate": "复核已升级，任务优先级已提升，需要运营或督导继续跟进。",
        }[action],
    ]
    if note:
        content_parts.append(f"复核说明：{note}")
    db.execute(
        text(
            """
            INSERT INTO notifications (tenant_id, channel, target_type, target_id, title, content, status)
            VALUES (:tenant_id, 'system', 'task', :task_id, :title, :content, 'pending')
            """
        ),
        {
            "tenant_id": tenant_id,
            "task_id": str(task["id"]),
            "title": title,
            "content": "\n".join(content_parts),
        },
    )


def get_related_alert(db: Session, tenant_id: str, task: dict) -> dict | None:
    if task.get("source_type") != "alert" or not task.get("source_id"):
        return None
    row = db.execute(
        text(
            """
            SELECT a.id, a.alert_type, a.level, a.title, a.summary, a.status,
                   a.created_at, s.name AS store_name
            FROM alerts a
            LEFT JOIN stores s ON s.id = a.store_id
            WHERE a.tenant_id = :tenant_id AND a.id = :alert_id
            """
        ),
        {"tenant_id": tenant_id, "alert_id": task["source_id"]},
    ).mappings().first()
    return dict(row) if row else None


def get_task_notifications(db: Session, tenant_id: str, task_id: UUID) -> list[dict]:
    rows = db.execute(
        text(
            """
            SELECT id, channel, title, content, status, retry_count, sent_at
            FROM notifications
            WHERE tenant_id = :tenant_id
              AND target_type = 'task'
              AND target_id = :task_id
            ORDER BY sent_at DESC NULLS LAST, id DESC
            LIMIT 8
            """
        ),
        {"tenant_id": tenant_id, "task_id": str(task_id)},
    ).mappings().all()
    return [dict(row) for row in rows]


def get_task_audit_logs(db: Session, tenant_id: str, task_id: UUID) -> list[dict]:
    rows = db.execute(
        text(
            """
            SELECT id, user_id, action, module, object_type, object_id, result, created_at
            FROM audit_logs
            WHERE tenant_id = :tenant_id
              AND object_id = :task_id
            ORDER BY created_at DESC, id DESC
            LIMIT 10
            """
        ),
        {"tenant_id": tenant_id, "task_id": task_id},
    ).mappings().all()
    return [dict(row) for row in rows]


def get_task_status(db: Session, tenant_id: str, task_id: UUID, scope_sql: str = "1=1", scope_params: dict | None = None) -> str:
    row = db.execute(
        text(
            f"""
            SELECT status
            FROM tasks
            WHERE id = :task_id AND tenant_id = :tenant_id
              AND {scope_sql}
            """
        ),
        {"tenant_id": tenant_id, "task_id": task_id, **(scope_params or {})},
    ).mappings().one()
    return str(row["status"])
