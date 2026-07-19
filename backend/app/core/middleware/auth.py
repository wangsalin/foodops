from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
from starlette.requests import Request
from sqlalchemy import text

from app.core.database import SessionLocal
from app.core.exceptions import AppError
from app.core.permissions import enforce_request_permission
from app.core.security import decode_access_token


class AuthMiddleware(BaseHTTPMiddleware):
    public_prefixes = (
        "/docs",
        "/openapi.json",
        "/redoc",
        "/api/health",
        "/api/v1/auth/login",
        "/api/v1/auth/refresh",
        "/api/v1/brand-assets/public",
        "/api/v1/relay/tasks/",
        "/api/v1/uploads/images",
        "/uploads/",
    )

    async def dispatch(self, request: Request, call_next):
        if request.method == "OPTIONS" or request.url.path == "/" or request.url.path.startswith(self.public_prefixes):
            return await call_next(request)

        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return JSONResponse(status_code=401, content={"code": "AUTH_REQUIRED", "message": "请先登录", "detail": None})

        try:
            claims = decode_access_token(auth_header.removeprefix("Bearer ").strip())
            auth_context = load_current_auth_context(claims)
        except AppError as exc:
            return JSONResponse(status_code=exc.status_code, content={"code": exc.code, "message": exc.message, "detail": exc.detail})
        request.state.user_id = auth_context["user_id"]
        request.state.tenant_id = auth_context["tenant_id"]
        request.state.role_id = auth_context["role_id"]
        request.state.data_scope = auth_context["data_scope"]
        request.state.permissions = auth_context["permissions"]
        try:
            enforce_request_permission(request)
        except AppError as exc:
            return JSONResponse(status_code=exc.status_code, content={"code": exc.code, "message": exc.message, "detail": exc.detail})
        return await call_next(request)


def load_current_auth_context(claims: dict) -> dict:
    user_id = claims.get("sub")
    token_tenant_id = claims.get("tenant_id")
    if not user_id or not token_tenant_id:
        raise AppError(code="AUTH_TOKEN_INVALID", message="登录已失效,请重新登录", status_code=401)
    with SessionLocal() as db:
        user = db.execute(
            text(
                """
                SELECT u.id, u.tenant_id, u.role_id, u.status,
                       r.permissions, r.data_scope
                FROM users u
                LEFT JOIN roles r ON r.id = u.role_id AND r.tenant_id = u.tenant_id
                WHERE u.id = :user_id
                """
            ),
            {"user_id": user_id},
        ).mappings().first()
    if not user or user["status"] != "active" or str(user["tenant_id"]) != str(token_tenant_id):
        raise AppError(code="AUTH_USER_DISABLED", message="账号不可用,请联系管理员", status_code=401)
    permissions = user["permissions"] or {}
    return {
        "user_id": str(user["id"]),
        "tenant_id": str(user["tenant_id"]),
        "role_id": str(user["role_id"]) if user["role_id"] else None,
        "data_scope": user["data_scope"],
        "permissions": permissions,
    }
