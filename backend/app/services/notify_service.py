from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import Session

NOTIFICATION_MANAGE_VALUES = {"manage", "approve", "all", "*"}


def resolve_high_risk_notification_recipients(
    db: Session,
    tenant_id: str,
    store_id: UUID | str | None,
    *,
    include_store_manager: bool = True,
    include_supervisors: bool = True,
    include_operations: bool = True,
) -> list[dict]:
    store_users = fetch_store_notification_users(db, tenant_id, store_id) if include_store_manager and store_id else []
    operations_users = fetch_operations_notification_users(db, tenant_id) if include_operations else []
    return collect_high_risk_notification_recipients(store_users, [], operations_users)


def collect_high_risk_notification_recipients(
    store_users: list[dict],
    supervisor_users: list[dict],
    operations_users: list[dict],
) -> list[dict]:
    recipients: dict[str, dict] = {}
    for reason, users in (
        ("store_manager", store_users),
        ("supervisor", supervisor_users),
        ("operations", operations_users),
    ):
        for user in users:
            add_notification_recipient(recipients, user, reason)
    return list(recipients.values())


def add_notification_recipient(recipients: dict[str, dict], user: dict, reason: str) -> None:
    user_id = user.get("id") or user.get("user_id")
    if not user_id:
        return
    key = str(user_id)
    if key in recipients:
        reasons = recipients[key].setdefault("recipient_reasons", [recipients[key].get("recipient_reason")])
        if reason not in reasons:
            reasons.append(reason)
        return
    recipient = dict(user)
    recipient["id"] = user_id
    recipient["recipient_reason"] = reason
    recipient["recipient_reasons"] = [reason]
    recipients[key] = recipient


def fetch_store_notification_users(db: Session, tenant_id: str, store_id: UUID | str | None) -> list[dict]:
    rows = db.execute(
        text(
            """
            SELECT u.id, u.name, u.username, u.phone, u.default_channel,
                   r.name AS role_name, r.permissions, r.data_scope, d.name AS department_name
            FROM stores s
            JOIN users u ON u.tenant_id = s.tenant_id
                        AND u.id IN (s.manager_user_id, s.franchisee_user_id)
            LEFT JOIN roles r ON r.id = u.role_id AND r.tenant_id = u.tenant_id
            LEFT JOIN departments d ON d.id = u.department_id AND d.tenant_id = u.tenant_id
            WHERE s.tenant_id = :tenant_id
              AND s.id = :store_id
              AND u.status = 'active'
            ORDER BY u.created_at ASC
            """
        ),
        {"tenant_id": tenant_id, "store_id": store_id},
    ).mappings().all()
    return [dict(row) for row in rows]


def fetch_operations_notification_users(db: Session, tenant_id: str) -> list[dict]:
    rows = db.execute(
        text(
            """
            SELECT u.id, u.name, u.username, u.phone, u.default_channel,
                   r.name AS role_name, r.permissions, r.data_scope, d.name AS department_name
            FROM users u
            LEFT JOIN roles r ON r.id = u.role_id AND r.tenant_id = u.tenant_id
            LEFT JOIN departments d ON d.id = u.department_id AND d.tenant_id = u.tenant_id
            WHERE u.tenant_id = :tenant_id
              AND u.status = 'active'
            ORDER BY u.created_at ASC
            """
        ),
        {"tenant_id": tenant_id},
    ).mappings().all()
    return [dict(row) for row in rows if is_operations_notification_user(dict(row))]


def is_operations_notification_user(user: dict) -> bool:
    role_name = str(user.get("role_name") or "")
    department_name = str(user.get("department_name") or "")
    permissions = user.get("permissions") or {}
    if permission_allows(permissions, "system", {"manage", "all", "*"}):
        return True
    has_ops_identity = any(token in role_name for token in ("运营", "系统管理员", "管理员")) or any(
        token in department_name for token in ("总部", "运营")
    )
    if not has_ops_identity:
        return False
    return any(permission_allows(permissions, module, NOTIFICATION_MANAGE_VALUES) for module in ("alerts", "tasks"))


def permission_allows(permissions: object, module: str, allowed_values: set[str]) -> bool:
    if not isinstance(permissions, dict):
        return False
    value = permissions.get(module)
    if isinstance(value, str):
        return value in allowed_values
    if isinstance(value, dict):
        return any(bool(value.get(key)) for key in allowed_values)
    return False


def create_high_risk_notifications(
    db: Session,
    tenant_id: str,
    *,
    target_type: str,
    target_id: UUID | str,
    title: str,
    content: str,
    store_id: UUID | str | None = None,
    dispatch_now: bool = False,
    include_store_manager: bool = True,
    include_supervisors: bool = True,
    include_operations: bool = True,
) -> list[dict]:
    recipients = resolve_high_risk_notification_recipients(
        db,
        tenant_id,
        store_id,
        include_store_manager=include_store_manager,
        include_supervisors=include_supervisors,
        include_operations=include_operations,
    )
    notifications = [
        notification
        for notification in (
            insert_targeted_notification(db, tenant_id, target_type, target_id, title, content, recipient)
            for recipient in recipients
        )
        if notification
    ]
    if dispatch_now and notifications:
        dispatch_notifications_by_ids(db, [notification["id"] for notification in notifications])
    return notifications


def insert_targeted_notification(
    db: Session,
    tenant_id: str,
    target_type: str,
    target_id: UUID | str,
    title: str,
    content: str,
    recipient: dict,
) -> dict | None:
    recipient_user_id = recipient.get("id")
    if not recipient_user_id:
        return None
    row = db.execute(
        text(
            """
            INSERT INTO notifications (
              tenant_id, recipient_user_id, channel, target_type, target_id, title, content, status
            )
            SELECT :tenant_id, :recipient_user_id, 'system', :target_type, :target_id, :title, :content, 'pending'
            WHERE NOT EXISTS (
              SELECT 1
              FROM notifications
              WHERE tenant_id = :tenant_id
                AND target_type = :target_type
                AND target_id = :target_id
                AND recipient_user_id = :recipient_user_id
            )
            RETURNING id, tenant_id, recipient_user_id, channel, target_type, target_id, title,
                      content, status, retry_count, sent_at
            """
        ),
        {
            "tenant_id": tenant_id,
            "recipient_user_id": recipient_user_id,
            "target_type": target_type,
            "target_id": str(target_id),
            "title": title,
            "content": content,
        },
    ).mappings().first()
    return dict(row) if row else None


def create_task_h5_notification(
    db: Session,
    tenant_id: str,
    task: dict,
    h5_url: str,
    note: str | None = None,
) -> dict:
    title = f"Store task pending: {task.get('title') or task.get('id')}"
    content_parts = [
        f"Task: {task.get('title') or task.get('id')}",
        f"Store: {task.get('store_name') or 'Unassigned'}",
        f"Link: {h5_url}",
    ]
    if note:
        content_parts.append(f"Note: {note}")
    row = db.execute(
        text(
            """
            INSERT INTO notifications (
              tenant_id, recipient_user_id, channel, target_type, target_id, title, content, status
            )
            VALUES (
              :tenant_id, :recipient_user_id, 'system', 'task', :task_id, :title, :content, 'pending'
            )
            RETURNING id, tenant_id, recipient_user_id, channel, target_type, target_id, title,
                      content, status, retry_count, sent_at
            """
        ),
        {
            "tenant_id": tenant_id,
            "recipient_user_id": task.get("assignee_id"),
            "task_id": str(task["id"]),
            "title": title,
            "content": "\n".join(content_parts),
        },
    ).mappings().one()
    return dict(row)


def create_task_feedback_review_notification(db: Session, tenant_id: str, task: dict) -> dict:
    row = db.execute(
        text(
            """
            INSERT INTO notifications (
              tenant_id, channel, target_type, target_id, title, content, status
            )
            VALUES (
              :tenant_id, 'system', 'task', :task_id, :title, :content, 'pending'
            )
            RETURNING id, tenant_id, recipient_user_id, channel, target_type, target_id, title,
                      content, status, retry_count, sent_at
            """
        ),
        {
            "tenant_id": tenant_id,
            "task_id": str(task["id"]),
            "title": f"Task feedback ready for review: {task.get('title') or task.get('id')}",
            "content": "The store submitted feedback. Review it in the task center.",
        },
    ).mappings().one()
    return dict(row)


def dispatch_pending_notifications(db: Session, limit: int = 50) -> dict:
    rows = db.execute(
        text(
            """
            SELECT id
            FROM notifications
            WHERE status = 'pending'
            ORDER BY id ASC
            LIMIT :limit
            """
        ),
        {"limit": limit},
    ).mappings().all()
    ids = [row["id"] for row in rows]
    dispatch_notifications_by_ids(db, ids)
    return {"processed": len(ids), "sent": len(ids), "failed": 0, "skipped": 0}


def dispatch_notifications_by_ids(db: Session, notification_ids: list[UUID | str]) -> dict[str, dict]:
    cleaned = [str(notification_id) for notification_id in notification_ids if notification_id]
    if not cleaned:
        return {}
    db.execute(
        text(
            """
            UPDATE notifications
            SET status = 'sent',
                sent_at = COALESCE(sent_at, NOW())
            WHERE id = ANY(CAST(:notification_ids AS uuid[]))
              AND status IN ('pending', 'failed')
            """
        ),
        {"notification_ids": cleaned},
    )
    return {notification_id: {"status": "sent", "reason": "community local notification"} for notification_id in cleaned}


def choose_channel(user: dict | None, requested_channel: str | None = None) -> str:
    return "system"
