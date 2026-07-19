from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import current_user_id
from app.core.exceptions import AppError
from app.core.security import blacklist_token, create_access_token, create_refresh_token, decode_refresh_token, verify_password
from app.services.audit_service import write_audit_log

router = APIRouter(prefix="/v1/auth", tags=["auth"])


class LoginRequest(BaseModel):
    username: str
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str
    access_token: str | None = None


class LogoutRequest(BaseModel):
    refresh_token: str | None = None


@router.post("/login")
def login(payload: LoginRequest, request: Request, db: Session = Depends(get_db)) -> dict:
    user = db.execute(
        text(
            """
            SELECT u.id, u.tenant_id, u.role_id, u.name, u.username, u.password_hash,
                   u.status, r.name AS role_name, r.permissions, r.data_scope
            FROM users u
            LEFT JOIN roles r ON r.id = u.role_id
            WHERE u.username = :username
            """
        ),
        {"username": payload.username},
    ).mappings().first()

    if not user or user["status"] != "active" or not verify_password(payload.password, user["password_hash"]):
        write_audit_log(
            db,
            tenant_id=user["tenant_id"] if user else None,
            user_id=user["id"] if user else None,
            action="LOGIN",
            module="auth",
            result="failure",
            ip=request.client.host if request.client else None,
        )
        raise AppError(code="AUTH_INVALID_CREDENTIALS", message="用户名或密码错误", status_code=401)

    token_claims = build_token_claims(dict(user))
    token = create_access_token(token_claims)
    refresh_token = create_refresh_token(token_claims)
    write_audit_log(
        db,
        tenant_id=user["tenant_id"],
        user_id=user["id"],
        action="LOGIN",
        module="auth",
        result="success",
        ip=request.client.host if request.client else None,
    )
    return {
        "access_token": token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "user": {
            "id": str(user["id"]),
            "tenant_id": str(user["tenant_id"]),
            "name": user["name"],
            "username": user["username"],
            "role": user["role_name"],
            "permissions": user["permissions"] or {},
        },
    }


@router.post("/refresh")
def refresh(payload: RefreshRequest, request: Request, db: Session = Depends(get_db)) -> dict:
    claims = decode_refresh_token(payload.refresh_token)
    user = get_active_user_for_token(db, claims.get("sub"))
    blacklist_token(payload.refresh_token, claims)
    if payload.access_token:
        try:
            blacklist_token(payload.access_token)
        except Exception:
            pass

    token_claims = build_token_claims(user)
    access_token = create_access_token(token_claims)
    refresh_token = create_refresh_token(token_claims)
    write_audit_log(
        db,
        tenant_id=user["tenant_id"],
        user_id=user["id"],
        action="TOKEN_REFRESH",
        module="auth",
        result="success",
        ip=request.client.host if request.client else None,
    )
    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "user": user_response(user),
    }


@router.post("/logout")
def logout(payload: LogoutRequest, request: Request, db: Session = Depends(get_db)) -> dict:
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        blacklist_token(auth_header.removeprefix("Bearer ").strip())
    if payload.refresh_token:
        try:
            blacklist_token(payload.refresh_token)
        except Exception:
            pass
    write_audit_log(
        db,
        tenant_id=getattr(request.state, "tenant_id", None),
        user_id=getattr(request.state, "user_id", None),
        action="LOGOUT",
        module="auth",
        result="success",
        ip=request.client.host if request.client else None,
    )
    return {"status": "ok"}


@router.get("/me")
def me(request: Request, db: Session = Depends(get_db)) -> dict:
    user_id = current_user_id(request)
    user = db.execute(
        text(
            """
            SELECT u.id, u.tenant_id, u.department_id, d.name AS department_name,
                   u.role_id, r.name AS role_name, r.permissions, r.data_scope,
                   u.name, u.phone, u.username, u.status, u.default_channel
            FROM users u
            LEFT JOIN departments d ON d.id = u.department_id
            LEFT JOIN roles r ON r.id = u.role_id
            WHERE u.id = :user_id
            """
        ),
        {"user_id": user_id},
    ).mappings().one()
    return dict(user)


def get_active_user_for_token(db: Session, user_id: str | None) -> dict:
    if not user_id:
        raise AppError(code="AUTH_TOKEN_INVALID", message="登录已失效,请重新登录", status_code=401)
    user = db.execute(
        text(
            """
            SELECT u.id, u.tenant_id, u.role_id, u.name, u.username, u.password_hash,
                   u.status, r.name AS role_name, r.permissions, r.data_scope
            FROM users u
            LEFT JOIN roles r ON r.id = u.role_id
            WHERE u.id = :user_id
            """
        ),
        {"user_id": user_id},
    ).mappings().first()
    if not user or user["status"] != "active":
        raise AppError(code="AUTH_USER_DISABLED", message="账号不可用,请联系管理员", status_code=401)
    return dict(user)


def build_token_claims(user: dict) -> dict:
    return {
        "sub": str(user["id"]),
        "tenant_id": str(user["tenant_id"]),
        "role_id": str(user["role_id"]) if user["role_id"] else None,
        "role_name": user["role_name"],
        "data_scope": user["data_scope"],
        "permissions": user["permissions"] or {},
    }


def user_response(user: dict) -> dict:
    return {
        "id": str(user["id"]),
        "tenant_id": str(user["tenant_id"]),
        "name": user["name"],
        "username": user["username"],
        "role": user["role_name"],
        "permissions": user["permissions"] or {},
    }
