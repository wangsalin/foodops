import json
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import current_tenant_id, current_user_id
from app.core.exceptions import AppError
from app.core.security import hash_password
from app.services.audit_service import insert_audit_log

router = APIRouter(prefix="/v1/org", tags=["org"])

ROLE_DATA_SCOPES = {"all", "none", "single_store", "multi_store", "region", "own_stores", "channel", "dept"}


class DepartmentCreate(BaseModel):
    name: str = Field(min_length=1)
    parent_id: UUID | None = None
    type: str = "dept"
    sort: int = 0


class DepartmentUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1)
    parent_id: UUID | None = None
    type: str | None = None
    sort: int | None = None


class RoleCreate(BaseModel):
    name: str = Field(min_length=1)
    description: str | None = None
    data_scope: str = "all"
    permissions: dict = Field(default_factory=dict)


class RoleUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1)
    description: str | None = None
    data_scope: str | None = None
    permissions: dict | None = None


class DepartmentRoleUpdate(BaseModel):
    role_ids: list[UUID] = Field(default_factory=list)
    default_role_id: UUID | None = None


class UserCreate(BaseModel):
    name: str = Field(min_length=1)
    username: str = Field(min_length=1)
    password: str = Field(min_length=8)
    phone: str | None = None
    default_channel: str = "system"
    department_id: UUID | None = None
    role_id: UUID | None = None


class UserUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1)
    phone: str | None = None
    default_channel: str | None = None
    department_id: UUID | None = None
    role_id: UUID | None = None
    status: str | None = None


class PasswordReset(BaseModel):
    password: str = Field(min_length=8)


class UserStoreScopeUpdate(BaseModel):
    store_ids: list[UUID] = Field(default_factory=list)


def validate_role_data_scope(data_scope: str | None) -> None:
    if data_scope is None:
        return
    if data_scope not in ROLE_DATA_SCOPES:
        raise AppError(code="ROLE_DATA_SCOPE_INVALID", message="Unsupported role data scope", status_code=400)


@router.get("/departments")
def list_departments(request: Request, db: Session = Depends(get_db)) -> list[dict]:
    tenant_id = current_tenant_id(request)
    rows = db.execute(
        text(
            """
            SELECT id, tenant_id, name, parent_id, type, sort
            FROM departments
            WHERE tenant_id = :tenant_id
            ORDER BY sort ASC, name ASC
            """
        ),
        {"tenant_id": tenant_id},
    ).mappings().all()
    return [dict(row) for row in rows]


@router.post("/departments", status_code=201)
def create_department(payload: DepartmentCreate, request: Request, db: Session = Depends(get_db)) -> dict:
    tenant_id = current_tenant_id(request)
    user_id = current_user_id(request)
    row = db.execute(
        text(
            """
            INSERT INTO departments (tenant_id, name, parent_id, type, sort)
            VALUES (:tenant_id, :name, :parent_id, :type, :sort)
            RETURNING id, tenant_id, name, parent_id, type, sort
            """
        ),
        {"tenant_id": tenant_id, **payload.model_dump()},
    ).mappings().one()
    insert_audit_log(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        action="DEPARTMENT_CREATE",
        module="org",
        object_type="department",
        object_id=row["id"],
        result=f"name={row['name']}",
        ip=request.client.host if request.client else None,
    )
    db.commit()
    return dict(row)


@router.put("/departments/{department_id}")
def update_department(department_id: UUID, payload: DepartmentUpdate, request: Request, db: Session = Depends(get_db)) -> dict:
    tenant_id = current_tenant_id(request)
    user_id = current_user_id(request)
    row = db.execute(
        text(
            """
            UPDATE departments
            SET name = COALESCE(:name, name),
                parent_id = COALESCE(:parent_id, parent_id),
                type = COALESCE(:type, type),
                sort = COALESCE(:sort, sort)
            WHERE id = :department_id AND tenant_id = :tenant_id
            RETURNING id, tenant_id, name, parent_id, type, sort
            """
        ),
        {"tenant_id": tenant_id, "department_id": department_id, **payload.model_dump()},
    ).mappings().first()
    if not row:
        raise AppError(code="DEPARTMENT_NOT_FOUND", message="Department not found", status_code=404)
    insert_audit_log(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        action="DEPARTMENT_UPDATE",
        module="org",
        object_type="department",
        object_id=row["id"],
        result=f"name={row['name']}",
        ip=request.client.host if request.client else None,
    )
    db.commit()
    return dict(row)


@router.delete("/departments/{department_id}", status_code=204)
def delete_department(department_id: UUID, request: Request, db: Session = Depends(get_db)) -> None:
    tenant_id = current_tenant_id(request)
    user_id = current_user_id(request)
    in_use = db.execute(
        text(
            """
            SELECT
              EXISTS(SELECT 1 FROM departments WHERE tenant_id = :tenant_id AND parent_id = :department_id) AS has_children,
              EXISTS(SELECT 1 FROM users WHERE tenant_id = :tenant_id AND department_id = :department_id) AS has_users
            """
        ),
        {"tenant_id": tenant_id, "department_id": department_id},
    ).mappings().one()
    if in_use["has_children"] or in_use["has_users"]:
        raise AppError(code="DEPARTMENT_IN_USE", message="Department is in use", status_code=400)
    row = db.execute(
        text(
            """
            DELETE FROM departments
            WHERE id = :department_id AND tenant_id = :tenant_id
            RETURNING id, name
            """
        ),
        {"tenant_id": tenant_id, "department_id": department_id},
    ).mappings().first()
    if not row:
        raise AppError(code="DEPARTMENT_NOT_FOUND", message="Department not found", status_code=404)
    insert_audit_log(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        action="DEPARTMENT_DELETE",
        module="org",
        object_type="department",
        object_id=row["id"],
        result=f"name={row['name']}",
        ip=request.client.host if request.client else None,
    )
    db.commit()
    return None


@router.get("/roles")
def list_roles(request: Request, department_id: UUID | None = None, db: Session = Depends(get_db)) -> list[dict]:
    tenant_id = current_tenant_id(request)
    if department_id:
        ensure_department_exists(db, tenant_id, department_id)
        rows = db.execute(
            text(
                """
                SELECT r.id, r.tenant_id, r.name, r.description, r.data_scope, r.permissions,
                       dr.is_default
                FROM department_roles dr
                JOIN roles r ON r.id = dr.role_id AND r.tenant_id = dr.tenant_id
                WHERE dr.tenant_id = :tenant_id
                  AND dr.department_id = :department_id
                ORDER BY dr.is_default DESC, r.name ASC
                """
            ),
            {"tenant_id": tenant_id, "department_id": department_id},
        ).mappings().all()
        return [dict(row) for row in rows]
    rows = db.execute(
        text(
            """
            SELECT id, tenant_id, name, description, data_scope, permissions, FALSE AS is_default
            FROM roles
            WHERE tenant_id = :tenant_id
            ORDER BY name ASC
            """
        ),
        {"tenant_id": tenant_id},
    ).mappings().all()
    return [dict(row) for row in rows]


@router.get("/departments/{department_id}/roles")
def list_department_roles(department_id: UUID, request: Request, db: Session = Depends(get_db)) -> list[dict]:
    tenant_id = current_tenant_id(request)
    ensure_department_exists(db, tenant_id, department_id)
    return list_roles(department_id=department_id, request=request, db=db)


@router.put("/departments/{department_id}/roles")
def update_department_roles(department_id: UUID, payload: DepartmentRoleUpdate, request: Request, db: Session = Depends(get_db)) -> list[dict]:
    tenant_id = current_tenant_id(request)
    user_id = current_user_id(request)
    ensure_department_exists(db, tenant_id, department_id)
    role_ids = list(dict.fromkeys(payload.role_ids))
    if payload.default_role_id and payload.default_role_id not in role_ids:
        raise AppError(code="DEFAULT_ROLE_INVALID", message="Default role must be included in department roles", status_code=400)
    if role_ids:
        found_count = db.execute(
            text(
                """
                SELECT COUNT(*)
                FROM roles
                WHERE tenant_id = :tenant_id AND id = ANY(:role_ids)
                """
            ),
            {"tenant_id": tenant_id, "role_ids": role_ids},
        ).scalar_one()
        if int(found_count or 0) != len(role_ids):
            raise AppError(code="ROLE_NOT_FOUND", message="Role not found", status_code=404)
    if role_ids:
        in_use_count = db.execute(
            text(
                """
                SELECT COUNT(*)
                FROM users
                WHERE tenant_id = :tenant_id
                  AND department_id = :department_id
                  AND role_id IS NOT NULL
                  AND NOT (role_id = ANY(:role_ids))
                """
            ),
            {"tenant_id": tenant_id, "department_id": department_id, "role_ids": role_ids},
        ).scalar_one()
    else:
        in_use_count = db.execute(
            text(
                """
                SELECT COUNT(*)
                FROM users
                WHERE tenant_id = :tenant_id
                  AND department_id = :department_id
                  AND role_id IS NOT NULL
                """
            ),
            {"tenant_id": tenant_id, "department_id": department_id},
        ).scalar_one()
    if int(in_use_count or 0) > 0:
        raise AppError(code="DEPARTMENT_ROLE_IN_USE", message="Department has users assigned to roles that would be removed", status_code=400)
    db.execute(
        text("DELETE FROM department_roles WHERE tenant_id = :tenant_id AND department_id = :department_id"),
        {"tenant_id": tenant_id, "department_id": department_id},
    )
    for role_id in role_ids:
        db.execute(
            text(
                """
                INSERT INTO department_roles (tenant_id, department_id, role_id, is_default)
                VALUES (:tenant_id, :department_id, :role_id, :is_default)
                """
            ),
            {
                "tenant_id": tenant_id,
                "department_id": department_id,
                "role_id": role_id,
                "is_default": bool(payload.default_role_id and role_id == payload.default_role_id),
            },
        )
    insert_audit_log(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        action="DEPARTMENT_ROLES_UPDATE",
        module="org",
        object_type="department",
        object_id=department_id,
        result=f"role_count={len(role_ids)}",
        ip=request.client.host if request.client else None,
    )
    db.commit()
    return list_department_roles(department_id, request, db)


@router.post("/roles", status_code=201)
def create_role(payload: RoleCreate, request: Request, db: Session = Depends(get_db)) -> dict:
    tenant_id = current_tenant_id(request)
    user_id = current_user_id(request)
    validate_role_data_scope(payload.data_scope)
    row = db.execute(
        text(
            """
            INSERT INTO roles (tenant_id, name, description, data_scope, permissions)
            VALUES (:tenant_id, :name, :description, :data_scope, CAST(:permissions AS jsonb))
            RETURNING id, tenant_id, name, description, data_scope, permissions
            """
        ),
        {
            "tenant_id": tenant_id,
            "name": payload.name,
            "description": payload.description,
            "data_scope": payload.data_scope,
            "permissions": json.dumps(payload.permissions),
        },
    ).mappings().one()
    insert_audit_log(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        action="ROLE_CREATE",
        module="org",
        object_type="role",
        object_id=row["id"],
        result=f"name={row['name']}",
        ip=request.client.host if request.client else None,
    )
    db.commit()
    return dict(row)


@router.put("/roles/{role_id}")
def update_role(role_id: UUID, payload: RoleUpdate, request: Request, db: Session = Depends(get_db)) -> dict:
    tenant_id = current_tenant_id(request)
    user_id = current_user_id(request)
    validate_role_data_scope(payload.data_scope)
    current = db.execute(
        text(
            """
            SELECT id, name, description, data_scope, permissions
            FROM roles
            WHERE id = :role_id AND tenant_id = :tenant_id
            """
        ),
        {"tenant_id": tenant_id, "role_id": role_id},
    ).mappings().one()
    next_permissions = payload.permissions if payload.permissions is not None else current["permissions"]
    row = db.execute(
        text(
            """
            UPDATE roles
            SET name = COALESCE(:name, name),
                description = COALESCE(:description, description),
                data_scope = COALESCE(:data_scope, data_scope),
                permissions = CAST(:permissions AS jsonb)
            WHERE id = :role_id AND tenant_id = :tenant_id
            RETURNING id, tenant_id, name, description, data_scope, permissions
            """
        ),
        {
            "tenant_id": tenant_id,
            "role_id": role_id,
            "name": payload.name,
            "description": payload.description,
            "data_scope": payload.data_scope,
            "permissions": json.dumps(next_permissions or {}),
        },
    ).mappings().one()
    insert_audit_log(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        action="ROLE_UPDATE",
        module="org",
        object_type="role",
        object_id=row["id"],
        result=f"name={row['name']}",
        ip=request.client.host if request.client else None,
    )
    db.commit()
    return dict(row)


@router.delete("/roles/{role_id}", status_code=204)
def delete_role(role_id: UUID, request: Request, db: Session = Depends(get_db)) -> None:
    tenant_id = current_tenant_id(request)
    user_id = current_user_id(request)
    user_count = db.execute(
        text(
            """
            SELECT COUNT(*)
            FROM users
            WHERE tenant_id = :tenant_id AND role_id = :role_id
            """
        ),
        {"tenant_id": tenant_id, "role_id": role_id},
    ).scalar_one()
    if int(user_count or 0) > 0:
        raise AppError(code="ROLE_IN_USE", message="Role is in use", status_code=400)
    row = db.execute(
        text(
            """
            DELETE FROM roles
            WHERE id = :role_id AND tenant_id = :tenant_id
            RETURNING id, name
            """
        ),
        {"tenant_id": tenant_id, "role_id": role_id},
    ).mappings().first()
    if not row:
        raise AppError(code="ROLE_NOT_FOUND", message="Role not found", status_code=404)
    insert_audit_log(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        action="ROLE_DELETE",
        module="org",
        object_type="role",
        object_id=row["id"],
        result=f"name={row['name']}",
        ip=request.client.host if request.client else None,
    )
    db.commit()
    return None


@router.get("/users")
def list_users(request: Request, db: Session = Depends(get_db)) -> list[dict]:
    tenant_id = current_tenant_id(request)
    rows = db.execute(
        text(
            """
            SELECT u.id, u.tenant_id, u.department_id, d.name AS department_name,
                   u.role_id, r.name AS role_name, r.data_scope AS role_data_scope,
                   r.permissions AS role_permissions, u.name, u.phone, u.username,
                   u.status, u.default_channel,
                   u.created_at,
                   COALESCE(
                     ARRAY_AGG(uss.store_id) FILTER (WHERE uss.store_id IS NOT NULL),
                     ARRAY[]::uuid[]
                   ) AS store_scope_ids,
                   COALESCE(
                     ARRAY_AGG(s.name ORDER BY s.code) FILTER (WHERE s.id IS NOT NULL),
                     ARRAY[]::text[]
                   ) AS store_scope_names
            FROM users u
            LEFT JOIN departments d ON d.id = u.department_id
            LEFT JOIN roles r ON r.id = u.role_id
            LEFT JOIN user_store_scopes uss ON uss.user_id = u.id AND uss.tenant_id = u.tenant_id
            LEFT JOIN stores s ON s.id = uss.store_id AND s.tenant_id = u.tenant_id
            WHERE u.tenant_id = :tenant_id
            GROUP BY u.id, d.name, r.name, r.data_scope, r.permissions
            ORDER BY u.created_at DESC
            """
        ),
        {"tenant_id": tenant_id},
    ).mappings().all()
    return [dict(row) for row in rows]


@router.post("/users", status_code=201)
def create_user(payload: UserCreate, request: Request, db: Session = Depends(get_db)) -> dict:
    tenant_id = current_tenant_id(request)
    user_id = current_user_id(request)
    validate_user_department_and_role(db, tenant_id, payload.department_id, payload.role_id)
    row = db.execute(
        text(
            """
            INSERT INTO users (
              tenant_id, department_id, role_id, name, phone, username,
              password_hash, status, default_channel
            )
            VALUES (
              :tenant_id, :department_id, :role_id, :name, :phone, :username,
              :password_hash, 'active', :default_channel
            )
            RETURNING id, tenant_id, department_id, role_id, name, phone, username,
                      status, default_channel, created_at
            """
        ),
        {
            "tenant_id": tenant_id,
            "department_id": payload.department_id,
            "role_id": payload.role_id,
            "name": payload.name,
            "phone": payload.phone,
            "username": payload.username,
            "password_hash": hash_password(payload.password),
            "default_channel": payload.default_channel,
        },
    ).mappings().one()
    insert_audit_log(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        action="USER_CREATE",
        module="users",
        object_type="user",
        object_id=row["id"],
        result=f"username={row['username']}",
        ip=request.client.host if request.client else None,
    )
    db.commit()
    return dict(row)


@router.patch("/users/{user_id}")
def update_user(user_id: UUID, payload: UserUpdate, request: Request, db: Session = Depends(get_db)) -> dict:
    tenant_id = current_tenant_id(request)
    operator_id = current_user_id(request)
    current = db.execute(
        text(
            """
            SELECT department_id, role_id
            FROM users
            WHERE id = :user_id AND tenant_id = :tenant_id
            """
        ),
        {"tenant_id": tenant_id, "user_id": user_id},
    ).mappings().first()
    if not current:
        raise AppError(code="USER_NOT_FOUND", message="User not found", status_code=404)
    validate_user_department_and_role(
        db,
        tenant_id,
        payload.department_id if payload.department_id is not None else current["department_id"],
        payload.role_id if payload.role_id is not None else current["role_id"],
    )
    row = db.execute(
        text(
            """
            UPDATE users
            SET name = COALESCE(:name, name),
                phone = COALESCE(:phone, phone),
                default_channel = COALESCE(:default_channel, default_channel),
                department_id = COALESCE(:department_id, department_id),
                role_id = COALESCE(:role_id, role_id),
                status = COALESCE(:status, status)
            WHERE id = :user_id AND tenant_id = :tenant_id
            RETURNING id, tenant_id, department_id, role_id, name, phone, username,
                      status, default_channel, created_at
            """
        ),
        {"tenant_id": tenant_id, "user_id": user_id, **payload.model_dump()},
    ).mappings().first()
    if not row:
        raise AppError(code="USER_NOT_FOUND", message="User not found", status_code=404)
    insert_audit_log(
        db,
        tenant_id=tenant_id,
        user_id=operator_id,
        action="USER_UPDATE",
        module="users",
        object_type="user",
        object_id=row["id"],
        result=f"username={row['username']}",
        ip=request.client.host if request.client else None,
    )
    db.commit()
    return dict(row)


@router.put("/users/{user_id}")
def put_update_user(user_id: UUID, payload: UserUpdate, request: Request, db: Session = Depends(get_db)) -> dict:
    return update_user(user_id, payload, request, db)


@router.get("/users/{user_id}/store-scopes")
def get_user_store_scopes(user_id: UUID, request: Request, db: Session = Depends(get_db)) -> dict:
    tenant_id = current_tenant_id(request)
    ensure_user_exists(db, tenant_id, user_id)
    rows = db.execute(
        text(
            """
            SELECT s.id, s.code, s.name, s.region, s.status
            FROM user_store_scopes uss
            JOIN stores s ON s.id = uss.store_id AND s.tenant_id = uss.tenant_id
            WHERE uss.tenant_id = :tenant_id AND uss.user_id = :user_id
            ORDER BY s.code ASC
            """
        ),
        {"tenant_id": tenant_id, "user_id": user_id},
    ).mappings().all()
    return {"user_id": str(user_id), "stores": [dict(row) for row in rows]}


@router.put("/users/{user_id}/store-scopes")
def update_user_store_scopes(user_id: UUID, payload: UserStoreScopeUpdate, request: Request, db: Session = Depends(get_db)) -> dict:
    tenant_id = current_tenant_id(request)
    operator_id = current_user_id(request)
    role_scope = db.execute(
        text(
            """
            SELECT r.data_scope
            FROM users u
            LEFT JOIN roles r ON r.id = u.role_id AND r.tenant_id = u.tenant_id
            WHERE u.tenant_id = :tenant_id AND u.id = :user_id
            """
        ),
        {"tenant_id": tenant_id, "user_id": user_id},
    ).mappings().first()
    if not role_scope:
        raise AppError(code="USER_NOT_FOUND", message="User not found", status_code=404)
    store_ids = list(dict.fromkeys(payload.store_ids))
    data_scope = role_scope["data_scope"] or "none"
    if data_scope == "all" and store_ids:
        raise AppError(code="STORE_SCOPE_NOT_REQUIRED", message="Store scope is not required for all-data role", status_code=400)
    if data_scope == "single_store" and len(store_ids) != 1:
        raise AppError(code="STORE_SCOPE_REQUIRED", message="Single-store role requires exactly one store", status_code=400)
    if data_scope not in {"all", "none", "single_store"} and not store_ids:
        raise AppError(code="STORE_SCOPE_REQUIRED", message="Store scope is required for this role", status_code=400)
    if data_scope == "none" and store_ids:
        raise AppError(code="ROLE_REQUIRED", message="Please assign a role before setting store scope", status_code=400)
    if store_ids:
        found_count = db.execute(
            text(
                """
                SELECT COUNT(*)
                FROM stores
                WHERE tenant_id = :tenant_id AND id = ANY(:store_ids)
                """
            ),
            {"tenant_id": tenant_id, "store_ids": store_ids},
        ).scalar_one()
        if int(found_count or 0) != len(store_ids):
            raise AppError(code="STORE_SCOPE_INVALID", message="Store scope contains invalid stores", status_code=400)
    db.execute(
        text("DELETE FROM user_store_scopes WHERE tenant_id = :tenant_id AND user_id = :user_id"),
        {"tenant_id": tenant_id, "user_id": user_id},
    )
    for store_id in store_ids:
        db.execute(
            text(
                """
                INSERT INTO user_store_scopes (tenant_id, user_id, store_id)
                VALUES (:tenant_id, :user_id, :store_id)
                """
            ),
            {"tenant_id": tenant_id, "user_id": user_id, "store_id": store_id},
        )
    insert_audit_log(
        db,
        tenant_id=tenant_id,
        user_id=operator_id,
        action="USER_STORE_SCOPE_UPDATE",
        module="users",
        object_type="user",
        object_id=user_id,
        result=f"store_scope_count={len(store_ids)}",
        ip=request.client.host if request.client else None,
    )
    db.commit()
    return get_user_store_scopes(user_id, request, db)


@router.post("/users/{user_id}/reset-password")
def reset_user_password(user_id: UUID, payload: PasswordReset, request: Request, db: Session = Depends(get_db)) -> dict:
    tenant_id = current_tenant_id(request)
    operator_id = current_user_id(request)
    result = db.execute(
        text(
            """
            UPDATE users
            SET password_hash = :password_hash
            WHERE id = :user_id AND tenant_id = :tenant_id
            """
        ),
        {"tenant_id": tenant_id, "user_id": user_id, "password_hash": hash_password(payload.password)},
    )
    if result.rowcount == 0:
        raise AppError(code="USER_NOT_FOUND", message="User not found", status_code=404)
    insert_audit_log(
        db,
        tenant_id=tenant_id,
        user_id=operator_id,
        action="USER_PASSWORD_RESET",
        module="users",
        object_type="user",
        object_id=user_id,
        result="password_reset",
        ip=request.client.host if request.client else None,
    )
    db.commit()
    return {"id": str(user_id), "status": "password_reset"}


@router.post("/users/{user_id}/reset-pwd")
def reset_user_pwd(user_id: UUID, payload: PasswordReset, request: Request, db: Session = Depends(get_db)) -> dict:
    return reset_user_password(user_id, payload, request, db)


def ensure_user_exists(db: Session, tenant_id: str, user_id: UUID) -> None:
    exists = db.execute(
        text("SELECT 1 FROM users WHERE tenant_id = :tenant_id AND id = :user_id"),
        {"tenant_id": tenant_id, "user_id": user_id},
    ).scalar()
    if not exists:
        raise AppError(code="USER_NOT_FOUND", message="User not found", status_code=404)


def ensure_department_exists(db: Session, tenant_id: str, department_id: UUID) -> None:
    exists = db.execute(
        text("SELECT 1 FROM departments WHERE tenant_id = :tenant_id AND id = :department_id"),
        {"tenant_id": tenant_id, "department_id": department_id},
    ).scalar()
    if not exists:
        raise AppError(code="DEPARTMENT_NOT_FOUND", message="Department not found", status_code=404)


def validate_user_department_and_role(db: Session, tenant_id: str, department_id: UUID | None, role_id: UUID | None) -> None:
    if not department_id:
        raise AppError(code="DEPARTMENT_REQUIRED", message="Please select a department before assigning a role", status_code=400)
    if not role_id:
        raise AppError(code="ROLE_REQUIRED", message="Please select a role", status_code=400)
    department_exists = db.execute(
        text("SELECT 1 FROM departments WHERE tenant_id = :tenant_id AND id = :department_id"),
        {"tenant_id": tenant_id, "department_id": department_id},
    ).scalar()
    if not department_exists:
        raise AppError(code="DEPARTMENT_NOT_FOUND", message="Department not found", status_code=404)
    role_exists = db.execute(
        text("SELECT 1 FROM roles WHERE tenant_id = :tenant_id AND id = :role_id"),
        {"tenant_id": tenant_id, "role_id": role_id},
    ).scalar()
    if not role_exists:
        raise AppError(code="ROLE_NOT_FOUND", message="Role not found", status_code=404)
    role_allowed = db.execute(
        text(
            """
            SELECT 1
            FROM department_roles
            WHERE tenant_id = :tenant_id
              AND department_id = :department_id
              AND role_id = :role_id
            """
        ),
        {"tenant_id": tenant_id, "department_id": department_id, "role_id": role_id},
    ).scalar()
    if not role_allowed:
        raise AppError(
            code="ROLE_NOT_ALLOWED_FOR_DEPARTMENT",
            message="This role is not configured for the selected department",
            status_code=400,
        )
