from dataclasses import dataclass

from starlette.requests import Request

from app.core.exceptions import AppError


READ_ACTIONS = {"GET", "HEAD", "OPTIONS"}


@dataclass(frozen=True)
class PermissionRule:
    prefix: str
    module: str | None
    action: str | None = None


PERMISSION_RULES = (
    PermissionRule("/api/v1/tasks", "tasks", "task_route"),
    PermissionRule("/api/v1/dashboard", "dashboard"),
    PermissionRule("/api/v1/stores", "stores"),
    PermissionRule("/api/v1/products", "products"),
    PermissionRule("/api/v1/materials", "materials"),
    PermissionRule("/api/v1/suppliers", "materials"),
    PermissionRule("/api/v1/imports", "imports"),
    PermissionRule("/api/v1/alerts", "alerts"),
    PermissionRule("/api/v1/relay/generate-token", "tasks"),
    PermissionRule("/api/v1/notifications", "notifications"),
    PermissionRule("/api/v1/org", "users"),
    PermissionRule("/api/v1/audit-logs", "audit"),
    PermissionRule("/api/v1/system", "system"),
    PermissionRule("/api/v1/brand-assets", "system"),
    PermissionRule("/api/v1/uploads/brand-assets", "system"),
    PermissionRule("/api/v1/uploads/store-task-feedback", "tasks"),
    PermissionRule("/api/v1/auth/me", None),
)


def enforce_request_permission(request: Request) -> None:
    module, route_action = permission_for_path(request.url.path)
    if module is None:
        return

    permissions = getattr(request.state, "permissions", None) or {}
    if has_permission(permissions, "system", "manage"):
        return

    required = required_action(request, route_action)
    if has_permission(permissions, module, required):
        return

    raise AppError(
        code="PERMISSION_DENIED",
        message="No permission for this operation",
        status_code=403,
        detail={"module": module, "required": required},
    )


def module_for_path(path: str) -> str | None:
    module, _ = permission_for_path(path)
    return module


def permission_for_path(path: str) -> tuple[str | None, str | None]:
    for rule in PERMISSION_RULES:
        if path.startswith(rule.prefix):
            return rule.module, rule.action
    return None, None


def required_action(request: Request, route_action: str | None) -> str:
    if request.method in READ_ACTIONS:
        return "read"
    path = request.url.path
    if route_action == "task_route" and path.endswith("/review"):
        return "approve"
    if route_action == "task_route" and path.endswith("/feedback"):
        return "feedback"
    return "manage"


def has_permission(permissions: dict, module: str, required: str) -> bool:
    value = permissions.get(module)
    if isinstance(value, dict):
        if value.get(required) is True or value.get("*") is True or value.get("manage") is True:
            return True
        if required == "read" and any(value.get(action) is True for action in ("read", "approve", "feedback")):
            return True
        return False
    if value in {"manage", "all", "*"}:
        return True
    if required == "read" and value in {"read", "approve", "feedback"}:
        return True
    return value == required
