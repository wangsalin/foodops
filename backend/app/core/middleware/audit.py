from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from app.core.database import SessionLocal
from app.services.audit_service import write_audit_log


class AuditLogMiddleware(BaseHTTPMiddleware):
    write_methods = {"POST": "CREATE", "PUT": "UPDATE", "PATCH": "UPDATE", "DELETE": "DELETE"}

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        if request.method in self.write_methods and not request.url.path.endswith("/auth/login"):
            tenant_id = getattr(request.state, "tenant_id", None)
            if tenant_id:
                with SessionLocal() as db:
                    write_audit_log(
                        db,
                        tenant_id=tenant_id,
                        user_id=getattr(request.state, "user_id", None),
                        action=self.write_methods[request.method],
                        module=request.url.path.split("/")[3] if len(request.url.path.split("/")) > 3 else "system",
                        result="success" if response.status_code < 400 else "failure",
                        ip=request.client.host if request.client else None,
                        method=request.method,
                        request_path=request.url.path,
                        status_code=response.status_code,
                        detail={
                            "query": str(request.url.query or ""),
                            "audit_source": "http_middleware",
                        },
                    )
        return response
