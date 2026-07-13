from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import current_tenant_id, current_user_id
from app.core.exceptions import AppError
from app.services.notify_service import dispatch_notifications_by_ids

router = APIRouter(prefix="/v1/notifications", tags=["notifications"])


class NotificationStatusUpdate(BaseModel):
    status: str


@router.get("")
def list_notifications(request: Request, db: Session = Depends(get_db)) -> list[dict]:
    tenant_id = current_tenant_id(request)
    rows = db.execute(
        text(
            """
            SELECT n.id, n.tenant_id, n.recipient_user_id, u.name AS recipient_user_name,
                   n.channel, n.target_type, n.target_id, n.title, n.content,
                   n.status, n.retry_count, n.sent_at, n.created_at, n.updated_at
            FROM notifications n
            LEFT JOIN users u ON u.id = n.recipient_user_id AND u.tenant_id = n.tenant_id
            WHERE n.tenant_id = :tenant_id
            ORDER BY n.created_at DESC, n.id DESC
            LIMIT 200
            """
        ),
        {"tenant_id": tenant_id},
    ).mappings().all()
    return [serialize_notification(row) for row in rows]


@router.get("/summary")
def notification_summary(request: Request, db: Session = Depends(get_db)) -> dict:
    tenant_id = current_tenant_id(request)
    rows = db.execute(
        text(
            """
            SELECT status, channel, COUNT(*) AS count
            FROM notifications
            WHERE tenant_id = :tenant_id
            GROUP BY status, channel
            """
        ),
        {"tenant_id": tenant_id},
    ).mappings().all()
    by_status: dict[str, int] = {}
    by_channel: dict[str, dict[str, int]] = {}
    for row in rows:
        status = str(row["status"])
        channel = str(row["channel"])
        count = int(row["count"] or 0)
        by_status[status] = by_status.get(status, 0) + count
        by_channel.setdefault(channel, {})[status] = count
    return {
        "pending": by_status.get("pending", 0),
        "sent": by_status.get("sent", 0),
        "failed": by_status.get("failed", 0),
        "by_status": by_status,
        "by_channel": by_channel,
        "mode": "system",
    }


@router.get("/{notification_id}")
def get_notification(notification_id: UUID, request: Request, db: Session = Depends(get_db)) -> dict:
    tenant_id = current_tenant_id(request)
    row = fetch_notification(db, tenant_id, notification_id)
    return serialize_notification(row)


@router.put("/{notification_id}/status")
def update_notification_status(
    notification_id: UUID,
    payload: NotificationStatusUpdate,
    request: Request,
    db: Session = Depends(get_db),
) -> dict:
    tenant_id = current_tenant_id(request)
    current_user_id(request)
    if payload.status not in {"pending", "sent", "failed", "read", "archived"}:
        raise AppError(code="NOTIFICATION_STATUS_INVALID", message="Invalid notification status", status_code=400)
    row = db.execute(
        text(
            """
            UPDATE notifications
            SET status = :status,
                updated_at = NOW()
            WHERE tenant_id = :tenant_id AND id = :notification_id
            RETURNING id, tenant_id, recipient_user_id, channel, target_type, target_id,
                      title, content, status, retry_count, sent_at, created_at, updated_at
            """
        ),
        {"tenant_id": tenant_id, "notification_id": notification_id, "status": payload.status},
    ).mappings().first()
    if not row:
        raise AppError(code="NOTIFICATION_NOT_FOUND", message="Notification not found", status_code=404)
    db.commit()
    return serialize_notification(row)


@router.post("/{notification_id}/retry")
def retry_notification(notification_id: UUID, request: Request, db: Session = Depends(get_db)) -> dict:
    tenant_id = current_tenant_id(request)
    fetch_notification(db, tenant_id, notification_id)
    dispatch_notifications_by_ids(db, [notification_id])
    db.commit()
    return serialize_notification(fetch_notification(db, tenant_id, notification_id))


def fetch_notification(db: Session, tenant_id: str, notification_id: UUID) -> dict:
    row = db.execute(
        text(
            """
            SELECT n.id, n.tenant_id, n.recipient_user_id, u.name AS recipient_user_name,
                   n.channel, n.target_type, n.target_id, n.title, n.content,
                   n.status, n.retry_count, n.sent_at, n.created_at, n.updated_at
            FROM notifications n
            LEFT JOIN users u ON u.id = n.recipient_user_id AND u.tenant_id = n.tenant_id
            WHERE n.tenant_id = :tenant_id AND n.id = :notification_id
            """
        ),
        {"tenant_id": tenant_id, "notification_id": notification_id},
    ).mappings().first()
    if not row:
        raise AppError(code="NOTIFICATION_NOT_FOUND", message="Notification not found", status_code=404)
    return dict(row)


def serialize_notification(row: dict) -> dict:
    data = dict(row)
    for key in ("id", "tenant_id", "recipient_user_id"):
        if data.get(key) is not None:
            data[key] = str(data[key])
    for key in ("sent_at", "created_at", "updated_at"):
        if isinstance(data.get(key), datetime):
            data[key] = data[key].isoformat()
    data.setdefault("delivery_config_status", "community_local")
    data.setdefault("recipient_binding_status", "system")
    data.setdefault("report_share_code", None)
    data.setdefault("report_link_status", None)
    data.setdefault("report_open_count", 0)
    return data
