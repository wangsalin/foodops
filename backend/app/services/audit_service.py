import json
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import Session


def _uuid_or_none(value):
    if not value:
        return None
    return value if isinstance(value, UUID) else UUID(str(value))


def write_audit_log(
    db: Session,
    *,
    tenant_id,
    user_id=None,
    action: str,
    module: str,
    result: str,
    ip: str | None = None,
    object_type: str | None = None,
    object_id=None,
    method: str | None = None,
    request_path: str | None = None,
    status_code: int | None = None,
    detail: dict | None = None,
) -> None:
    insert_audit_log(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        action=action,
        module=module,
        result=result,
        ip=ip,
        object_type=object_type,
        object_id=object_id,
        method=method,
        request_path=request_path,
        status_code=status_code,
        detail=detail,
    )
    db.commit()


def insert_audit_log(
    db: Session,
    *,
    tenant_id,
    user_id=None,
    action: str,
    module: str,
    result: str,
    ip: str | None = None,
    object_type: str | None = None,
    object_id=None,
    method: str | None = None,
    request_path: str | None = None,
    status_code: int | None = None,
    detail: dict | None = None,
) -> None:
    if tenant_id is None:
        return
    db.execute(
        text(
            """
            INSERT INTO audit_logs (
              tenant_id, user_id, action, module, object_type, object_id, result, ip,
              method, request_path, status_code, detail
            )
            VALUES (
              :tenant_id, :user_id, :action, :module, :object_type, :object_id, :result, :ip,
              :method, :request_path, :status_code, CAST(:detail AS jsonb)
            )
            """
        ),
        {
            "tenant_id": _uuid_or_none(tenant_id),
            "user_id": _uuid_or_none(user_id),
            "action": action,
            "module": module,
            "object_type": object_type,
            "object_id": _uuid_or_none(object_id),
            "result": result,
            "ip": ip,
            "method": method,
            "request_path": request_path,
            "status_code": status_code,
            "detail": json.dumps(detail or {}, ensure_ascii=False),
        },
    )
