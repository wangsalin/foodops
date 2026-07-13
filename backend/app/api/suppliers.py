from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import current_tenant_id, current_user_id
from app.core.exceptions import AppError
from app.services.audit_service import insert_audit_log

router = APIRouter(prefix="/v1/suppliers", tags=["suppliers"])


class SupplierCreate(BaseModel):
    supplier_code: str = Field(min_length=1)
    name: str = Field(min_length=1)
    status: str | None = "active"
    contact_name: str | None = None
    phone: str | None = None
    delivery_scope: str | None = None
    settlement_type: str | None = None
    lead_time_days: int | None = None
    min_order_amount: Decimal | None = None
    address: str | None = None
    remark: str | None = None


class SupplierUpdate(BaseModel):
    supplier_code: str | None = Field(default=None, min_length=1)
    name: str | None = Field(default=None, min_length=1)
    status: str | None = None
    contact_name: str | None = None
    phone: str | None = None
    delivery_scope: str | None = None
    settlement_type: str | None = None
    lead_time_days: int | None = None
    min_order_amount: Decimal | None = None
    address: str | None = None
    remark: str | None = None


def normalize_keyword(value: str | None) -> str | None:
    value = (value or "").strip()
    return value or None


def validate_status(status: str | None) -> None:
    if status is not None and status not in {"active", "disabled"}:
        raise AppError(code="INVALID_SUPPLIER_STATUS", message="Invalid supplier status", status_code=400)


@router.get("")
def list_suppliers(
    request: Request,
    keyword: str | None = Query(default=None),
    status: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[dict]:
    tenant_id = current_tenant_id(request)
    keyword = normalize_keyword(keyword)
    validate_status(status)
    where_clauses = ["s.tenant_id = :tenant_id"]
    params = {"tenant_id": tenant_id}
    if status:
        where_clauses.append("s.status = :status")
        params["status"] = status
    if keyword:
        where_clauses.append(
            "(s.supplier_code ILIKE :keyword_like OR s.name ILIKE :keyword_like OR s.contact_name ILIKE :keyword_like OR s.phone ILIKE :keyword_like)"
        )
        params["keyword_like"] = f"%{keyword}%"

    rows = db.execute(
        text(
            f"""
            SELECT
              s.id,
              s.tenant_id,
              s.supplier_code,
              s.name,
              s.status,
              s.contact_name,
              s.phone,
              s.delivery_scope,
              s.settlement_type,
              s.lead_time_days,
              s.min_order_amount,
              s.address,
              s.remark,
              s.created_at,
              s.updated_at,
              COUNT(m.id) AS material_count
            FROM material_suppliers s
            LEFT JOIN materials m
              ON m.tenant_id = s.tenant_id AND m.supplier_id = s.id
            WHERE {" AND ".join(where_clauses)}
            GROUP BY s.id
            ORDER BY CASE WHEN s.status = 'active' THEN 0 ELSE 1 END, s.supplier_code ASC
            """
        ),
        params,
    ).mappings().all()
    return [dict(row) for row in rows]


@router.post("", status_code=201)
def create_supplier(payload: SupplierCreate, request: Request, db: Session = Depends(get_db)) -> dict:
    tenant_id = current_tenant_id(request)
    user_id = current_user_id(request)
    validate_status(payload.status)
    try:
        row = db.execute(
            text(
                """
                INSERT INTO material_suppliers (
                  tenant_id, supplier_code, name, status, contact_name, phone,
                  delivery_scope, settlement_type, lead_time_days, min_order_amount,
                  address, remark
                )
                VALUES (
                  :tenant_id, :supplier_code, :name, COALESCE(:status, 'active'), :contact_name, :phone,
                  :delivery_scope, :settlement_type, :lead_time_days, :min_order_amount,
                  :address, :remark
                )
                RETURNING id, tenant_id, supplier_code, name, status, contact_name, phone,
                          delivery_scope, settlement_type, lead_time_days, min_order_amount,
                          address, remark, created_at, updated_at
                """
            ),
            {"tenant_id": tenant_id, **payload.model_dump()},
        ).mappings().one()
    except IntegrityError as exc:
        db.rollback()
        raise AppError(code="SUPPLIER_CODE_EXISTS", message="Supplier code already exists", status_code=409) from exc

    insert_audit_log(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        action="SUPPLIER_CREATE",
        module="materials",
        object_type="supplier",
        object_id=row["id"],
        result=f"supplier_code={row['supplier_code']}",
        ip=request.client.host if request.client else None,
    )
    db.commit()
    return dict(row)


@router.get("/{supplier_id}")
def get_supplier(supplier_id: UUID, request: Request, db: Session = Depends(get_db)) -> dict:
    tenant_id = current_tenant_id(request)
    supplier = db.execute(
        text(
            """
            SELECT id, tenant_id, supplier_code, name, status, contact_name, phone,
                   delivery_scope, settlement_type, lead_time_days, min_order_amount,
                   address, remark, created_at, updated_at
            FROM material_suppliers
            WHERE id = :supplier_id AND tenant_id = :tenant_id
            """
        ),
        {"tenant_id": tenant_id, "supplier_id": supplier_id},
    ).mappings().first()
    if not supplier:
        raise AppError(code="SUPPLIER_NOT_FOUND", message="Supplier not found", status_code=404)

    materials = db.execute(
        text(
            """
            SELECT id, material_code, name, unit, category, purchase_spec, status
            FROM materials
            WHERE tenant_id = :tenant_id AND supplier_id = :supplier_id
            ORDER BY material_code ASC
            """
        ),
        {"tenant_id": tenant_id, "supplier_id": supplier_id},
    ).mappings().all()
    return {**dict(supplier), "materials": [dict(row) for row in materials]}


@router.patch("/{supplier_id}")
def update_supplier(supplier_id: UUID, payload: SupplierUpdate, request: Request, db: Session = Depends(get_db)) -> dict:
    tenant_id = current_tenant_id(request)
    user_id = current_user_id(request)
    validate_status(payload.status)
    try:
        row = db.execute(
            text(
                """
                UPDATE material_suppliers
                SET supplier_code = COALESCE(:supplier_code, supplier_code),
                    name = COALESCE(:name, name),
                    status = COALESCE(:status, status),
                    contact_name = COALESCE(:contact_name, contact_name),
                    phone = COALESCE(:phone, phone),
                    delivery_scope = COALESCE(:delivery_scope, delivery_scope),
                    settlement_type = COALESCE(:settlement_type, settlement_type),
                    lead_time_days = COALESCE(:lead_time_days, lead_time_days),
                    min_order_amount = COALESCE(:min_order_amount, min_order_amount),
                    address = COALESCE(:address, address),
                    remark = COALESCE(:remark, remark),
                    updated_at = NOW()
                WHERE id = :supplier_id AND tenant_id = :tenant_id
                RETURNING id, tenant_id, supplier_code, name, status, contact_name, phone,
                          delivery_scope, settlement_type, lead_time_days, min_order_amount,
                          address, remark, created_at, updated_at
                """
            ),
            {"tenant_id": tenant_id, "supplier_id": supplier_id, **payload.model_dump()},
        ).mappings().first()
    except IntegrityError as exc:
        db.rollback()
        raise AppError(code="SUPPLIER_CODE_EXISTS", message="Supplier code already exists", status_code=409) from exc

    if not row:
        raise AppError(code="SUPPLIER_NOT_FOUND", message="Supplier not found", status_code=404)

    db.execute(
        text(
            """
            UPDATE materials
            SET supplier_name = COALESCE(:name, supplier_name),
                supplier_contact = COALESCE(:contact_name, supplier_contact),
                supplier_phone = COALESCE(:phone, supplier_phone),
                lead_time_days = COALESCE(:lead_time_days, lead_time_days)
            WHERE tenant_id = :tenant_id AND supplier_id = :supplier_id
            """
        ),
        {"tenant_id": tenant_id, "supplier_id": supplier_id, **payload.model_dump()},
    )
    insert_audit_log(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        action="SUPPLIER_UPDATE",
        module="materials",
        object_type="supplier",
        object_id=row["id"],
        result=f"supplier_code={row['supplier_code']}",
        ip=request.client.host if request.client else None,
    )
    db.commit()
    return dict(row)


@router.put("/{supplier_id}")
def put_update_supplier(supplier_id: UUID, payload: SupplierUpdate, request: Request, db: Session = Depends(get_db)) -> dict:
    return update_supplier(supplier_id, payload, request, db)
