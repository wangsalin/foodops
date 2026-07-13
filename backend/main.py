from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.alerts import router as alerts_router
from app.api.audit import router as audit_router
from app.api.auth import router as auth_router
from app.api.brand import router as brand_router
from app.api.dashboard import router as dashboard_router
from app.api.health import router as health_router
from app.api.imports import router as imports_router
from app.api.materials import router as materials_router
from app.api.notifications import router as notifications_router
from app.api.org import router as org_router
from app.api.products import router as products_router
from app.api.relay import router as relay_router
from app.api.stores import router as stores_router
from app.api.suppliers import router as suppliers_router
from app.api.system import router as system_router
from app.api.tasks import router as tasks_router
from app.api.uploads import router as uploads_router
from app.core.config import settings
from app.core.exceptions import register_exception_handlers
from app.core.middleware.audit import AuditLogMiddleware
from app.core.middleware.auth import AuthMiddleware
from app.core.middleware.tenant import TenantMiddleware

Path(settings.upload_dir).mkdir(parents=True, exist_ok=True)

app = FastAPI(title="FoodOps Community API", version="0.1.0", debug=settings.debug)
cors_allow_origins = [origin.strip() for origin in settings.cors_allow_origins.split(",") if origin.strip()]

app.add_middleware(AuditLogMiddleware)
app.add_middleware(TenantMiddleware)
app.add_middleware(AuthMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

register_exception_handlers(app)

app.include_router(health_router, prefix="/api", tags=["health"])
app.include_router(alerts_router, prefix="/api")
app.include_router(audit_router, prefix="/api")
app.include_router(auth_router, prefix="/api")
app.include_router(brand_router, prefix="/api")
app.include_router(dashboard_router, prefix="/api")
app.include_router(imports_router, prefix="/api")
app.include_router(org_router, prefix="/api")
app.include_router(stores_router, prefix="/api")
app.include_router(tasks_router, prefix="/api")
app.include_router(products_router, prefix="/api")
app.include_router(materials_router, prefix="/api")
app.include_router(suppliers_router, prefix="/api")
app.include_router(system_router, prefix="/api")
app.include_router(notifications_router, prefix="/api")
app.include_router(relay_router, prefix="/api")
app.include_router(uploads_router, prefix="/api")
app.mount("/uploads", StaticFiles(directory=settings.upload_dir), name="uploads")


@app.get("/")
def root() -> dict[str, str]:
    return {"name": "FoodOps Community API", "docs": "/docs"}
