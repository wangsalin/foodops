from fastapi import Request

from app.core.exceptions import AppError


def current_tenant_id(request: Request) -> str:
    tenant_id = getattr(request.state, "tenant_id", None)
    if not tenant_id:
        raise AppError(code="TENANT_REQUIRED", message="Missing tenant context", status_code=401)
    return str(tenant_id)


def current_user_id(request: Request) -> str:
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise AppError(code="AUTH_REQUIRED", message="Please sign in first", status_code=401)
    return str(user_id)


def current_data_scope(request: Request) -> str:
    return str(getattr(request.state, "data_scope", None) or "none")


def scoped_store_condition(request: Request, store_alias: str = "s") -> tuple[str, dict]:
    data_scope = current_data_scope(request)
    if data_scope == "all":
        return "1=1", {}
    user_id = current_user_id(request)
    return (
        f"""(
            {store_alias}.manager_user_id = :scope_user_id
            OR {store_alias}.franchisee_user_id = :scope_user_id
            OR EXISTS (
              SELECT 1
              FROM user_store_scopes uss
              WHERE uss.tenant_id = :tenant_id
                AND uss.user_id = :scope_user_id
                AND uss.store_id = {store_alias}.id
            )
        )""",
        {"scope_user_id": user_id},
    )


def scoped_store_id_condition(request: Request, store_id_expr: str) -> tuple[str, dict]:
    data_scope = current_data_scope(request)
    if data_scope == "all":
        return "1=1", {}
    user_id = current_user_id(request)
    return (
        f"""EXISTS (
            SELECT 1
            FROM stores scope_store
            WHERE scope_store.id = {store_id_expr}
              AND scope_store.tenant_id = :tenant_id
              AND (
                scope_store.manager_user_id = :scope_user_id
                OR scope_store.franchisee_user_id = :scope_user_id
                OR EXISTS (
                  SELECT 1
                  FROM user_store_scopes uss
                  WHERE uss.tenant_id = :tenant_id
                    AND uss.user_id = :scope_user_id
                    AND uss.store_id = scope_store.id
                )
              )
        )""",
        {"scope_user_id": user_id},
    )


def scoped_task_condition(request: Request, task_alias: str = "t") -> tuple[str, dict]:
    data_scope = current_data_scope(request)
    if data_scope == "all":
        return "1=1", {}
    user_id = current_user_id(request)
    return (
        f"""(
            {task_alias}.assignee_id = :scope_user_id
            OR EXISTS (
              SELECT 1
              FROM stores scope_store
              WHERE {task_alias}.store_id IS NOT NULL
                AND scope_store.id = {task_alias}.store_id
                AND scope_store.tenant_id = :tenant_id
                AND (
                  scope_store.manager_user_id = :scope_user_id
                  OR scope_store.franchisee_user_id = :scope_user_id
                  OR EXISTS (
                    SELECT 1
                    FROM user_store_scopes uss
                    WHERE uss.tenant_id = :tenant_id
                      AND uss.user_id = :scope_user_id
                      AND uss.store_id = scope_store.id
                  )
                )
            )
            OR EXISTS (
              SELECT 1
              FROM alerts scope_alert
              JOIN stores scope_store ON scope_store.id = scope_alert.store_id
              WHERE {task_alias}.source_type = 'alert'
                AND {task_alias}.source_id = scope_alert.id
                AND scope_alert.tenant_id = {task_alias}.tenant_id
                AND scope_store.tenant_id = :tenant_id
                AND (
                  scope_store.manager_user_id = :scope_user_id
                  OR scope_store.franchisee_user_id = :scope_user_id
                  OR EXISTS (
                    SELECT 1
                    FROM user_store_scopes uss
                    WHERE uss.tenant_id = :tenant_id
                      AND uss.user_id = :scope_user_id
                      AND uss.store_id = scope_store.id
                  )
                )
            )
        )""",
        {"scope_user_id": user_id},
    )
