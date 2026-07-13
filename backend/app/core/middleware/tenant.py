from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from app.core.exceptions import AppError


class TenantMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        header_tenant_id = request.headers.get("X-Tenant-ID")
        token_tenant_id = getattr(request.state, "tenant_id", None)

        if header_tenant_id and token_tenant_id and header_tenant_id != token_tenant_id:
            raise AppError(code="TENANT_FORBIDDEN", message="无权访问该租户数据", status_code=403)

        if header_tenant_id and not token_tenant_id:
            request.state.tenant_id = header_tenant_id

        return await call_next(request)

