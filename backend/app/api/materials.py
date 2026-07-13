from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import current_tenant_id, current_user_id
from app.core.exceptions import AppError
from app.services.audit_service import insert_audit_log

router = APIRouter(prefix="/v1/materials", tags=["materials"])


class MaterialCreate(BaseModel):
    material_code: str = Field(min_length=1)
    name: str = Field(min_length=1)
    unit: str = Field(min_length=1)
    safety_stock: Decimal | None = None
    category: str | None = None
    spec: str | None = None
    purchase_spec: str | None = None
    is_key_material: bool = False
    shelf_life_days: int | None = None
    storage_method: str | None = None
    supplier_id: UUID | None = None
    supplier_name: str | None = None
    supplier_contact: str | None = None
    supplier_phone: str | None = None
    min_order_qty: Decimal | None = None
    lead_time_days: int | None = None
    supplier_note: str | None = None
    stock_alert_enabled: bool = True
    remark: str | None = None


class MaterialUpdate(BaseModel):
    material_code: str | None = Field(default=None, min_length=1)
    name: str | None = Field(default=None, min_length=1)
    unit: str | None = Field(default=None, min_length=1)
    safety_stock: Decimal | None = None
    status: str | None = None
    category: str | None = None
    spec: str | None = None
    purchase_spec: str | None = None
    is_key_material: bool | None = None
    shelf_life_days: int | None = None
    storage_method: str | None = None
    supplier_id: UUID | None = None
    supplier_name: str | None = None
    supplier_contact: str | None = None
    supplier_phone: str | None = None
    min_order_qty: Decimal | None = None
    lead_time_days: int | None = None
    supplier_note: str | None = None
    stock_alert_enabled: bool | None = None
    remark: str | None = None


def normalize_keyword(value: str | None) -> str | None:
    value = (value or "").strip()
    return value or None


def validate_status(status: str | None) -> None:
    if status is not None and status not in {"active", "disabled"}:
        raise AppError(code="INVALID_MATERIAL_STATUS", message="Invalid material status", status_code=400)


def resolve_supplier_snapshot(db: Session, tenant_id: str, supplier_id: UUID | None) -> dict:
    if supplier_id is None:
        return {}
    supplier = db.execute(
        text(
            """
            SELECT id, name, contact_name, phone, lead_time_days, remark
            FROM material_suppliers
            WHERE id = :supplier_id AND tenant_id = :tenant_id AND status = 'active'
            """
        ),
        {"tenant_id": tenant_id, "supplier_id": supplier_id},
    ).mappings().first()
    if not supplier:
        raise AppError(code="SUPPLIER_NOT_FOUND", message="Supplier not found", status_code=404)
    return {
        "supplier_id": supplier["id"],
        "supplier_name": supplier["name"],
        "supplier_contact": supplier["contact_name"],
        "supplier_phone": supplier["phone"],
        "lead_time_days": supplier["lead_time_days"],
        "supplier_note": supplier["remark"],
    }


@router.get("")
def list_materials(
    request: Request,
    keyword: str | None = Query(default=None),
    status: str | None = Query(default=None),
    category: str | None = Query(default=None),
    supplier_id: UUID | None = Query(default=None),
    is_key_material: bool | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[dict]:
    tenant_id = current_tenant_id(request)
    keyword = normalize_keyword(keyword)
    validate_status(status)
    where_clauses = ["m.tenant_id = :tenant_id"]
    params = {"tenant_id": tenant_id}
    if status:
        where_clauses.append("m.status = :status")
        params["status"] = status
    if category:
        where_clauses.append("m.category = :category")
        params["category"] = category
    if supplier_id:
        where_clauses.append("m.supplier_id = :supplier_id")
        params["supplier_id"] = supplier_id
    if is_key_material is not None:
        where_clauses.append("m.is_key_material = :is_key_material")
        params["is_key_material"] = is_key_material
    if keyword:
        where_clauses.append(
            """(
              m.material_code ILIKE :keyword_like
              OR m.name ILIKE :keyword_like
              OR m.supplier_name ILIKE :keyword_like
              OR sup.name ILIKE :keyword_like
              OR sup.contact_name ILIKE :keyword_like
            )"""
        )
        params["keyword_like"] = f"%{keyword}%"

    rows = db.execute(
        text(
            f"""
            WITH latest_inventory AS (
              SELECT DISTINCT ON (inv.store_id, inv.material_id)
                     inv.store_id,
                     inv.material_id,
                     inv.biz_date,
                     inv.closing_stock
              FROM inventory_snapshots inv
              WHERE inv.tenant_id = :tenant_id
              ORDER BY inv.store_id, inv.material_id, inv.biz_date DESC
            ),
            inventory_summary AS (
              SELECT
                li.material_id,
                COUNT(*) AS monitored_store_count,
                SUM(CASE WHEN li.closing_stock <= 0 THEN 1 ELSE 0 END) AS out_of_stock_store_count,
                SUM(
                  CASE
                    WHEN m.safety_stock IS NOT NULL
                     AND li.closing_stock > 0
                     AND li.closing_stock <= m.safety_stock THEN 1
                    ELSE 0
                  END
                ) AS low_stock_store_count,
                MIN(li.closing_stock) AS min_closing_stock,
                MAX(li.biz_date) AS latest_biz_date
              FROM latest_inventory li
              JOIN materials m ON m.id = li.material_id AND m.tenant_id = :tenant_id
              GROUP BY li.material_id
            )
            SELECT
              m.id,
              m.tenant_id,
              m.material_code,
              m.name,
              m.unit,
              m.safety_stock,
              m.status,
              m.category,
              m.spec,
              m.purchase_spec,
              m.is_key_material,
              m.shelf_life_days,
              m.storage_method,
              m.supplier_id,
              COALESCE(sup.name, m.supplier_name) AS supplier_name,
              COALESCE(sup.contact_name, m.supplier_contact) AS supplier_contact,
              COALESCE(sup.phone, m.supplier_phone) AS supplier_phone,
              m.min_order_qty,
              COALESCE(sup.lead_time_days, m.lead_time_days) AS lead_time_days,
              COALESCE(sup.remark, m.supplier_note) AS supplier_note,
              m.stock_alert_enabled,
              m.remark,
              COALESCE(s.monitored_store_count, 0) AS monitored_store_count,
              COALESCE(s.low_stock_store_count, 0) AS low_stock_store_count,
              COALESCE(s.out_of_stock_store_count, 0) AS out_of_stock_store_count,
              s.min_closing_stock,
              s.latest_biz_date
            FROM materials m
            LEFT JOIN inventory_summary s ON s.material_id = m.id
            LEFT JOIN material_suppliers sup ON sup.id = m.supplier_id AND sup.tenant_id = m.tenant_id
            WHERE {" AND ".join(where_clauses)}
            ORDER BY m.material_code ASC
            """
        ),
        params,
    ).mappings().all()
    return [dict(row) for row in rows]


@router.post("", status_code=201)
def create_material(payload: MaterialCreate, request: Request, db: Session = Depends(get_db)) -> dict:
    tenant_id = current_tenant_id(request)
    user_id = current_user_id(request)
    supplier_snapshot = resolve_supplier_snapshot(db, tenant_id, payload.supplier_id)
    material_data = payload.model_dump()
    material_data.update(supplier_snapshot)
    try:
        row = db.execute(
            text(
                """
                INSERT INTO materials (
                  tenant_id, material_code, name, unit, safety_stock, category, spec,
                  purchase_spec, is_key_material, shelf_life_days, storage_method,
                  supplier_id, supplier_name, supplier_contact, supplier_phone, min_order_qty,
                  lead_time_days, supplier_note, stock_alert_enabled, remark
                )
                VALUES (
                  :tenant_id, :material_code, :name, :unit, :safety_stock, :category, :spec,
                  :purchase_spec, :is_key_material, :shelf_life_days, :storage_method,
                  :supplier_id, :supplier_name, :supplier_contact, :supplier_phone, :min_order_qty,
                  :lead_time_days, :supplier_note, :stock_alert_enabled, :remark
                )
                RETURNING id, tenant_id, material_code, name, unit, safety_stock, status,
                          category, spec, purchase_spec, is_key_material, shelf_life_days,
                          storage_method, supplier_id, supplier_name, supplier_contact, supplier_phone,
                          min_order_qty, lead_time_days, supplier_note, stock_alert_enabled, remark
                """
            ),
            {"tenant_id": tenant_id, **material_data},
        ).mappings().one()
    except IntegrityError as exc:
        db.rollback()
        raise AppError(code="MATERIAL_CODE_EXISTS", message="Material code already exists", status_code=409) from exc
    insert_audit_log(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        action="MATERIAL_CREATE",
        module="materials",
        object_type="material",
        object_id=row["id"],
        result=f"material_code={row['material_code']}",
        ip=request.client.host if request.client else None,
    )
    db.commit()
    return dict(row)


@router.get("/{material_id}")
def get_material(material_id: UUID, request: Request, db: Session = Depends(get_db)) -> dict:
    tenant_id = current_tenant_id(request)
    material = db.execute(
        text(
            """
            SELECT m.id, m.tenant_id, m.material_code, m.name, m.unit, m.safety_stock, m.status,
                   m.category, m.spec, m.purchase_spec, m.is_key_material, m.shelf_life_days,
                   m.storage_method, m.supplier_id,
                   COALESCE(sup.name, m.supplier_name) AS supplier_name,
                   COALESCE(sup.contact_name, m.supplier_contact) AS supplier_contact,
                   COALESCE(sup.phone, m.supplier_phone) AS supplier_phone,
                   m.min_order_qty,
                   COALESCE(sup.lead_time_days, m.lead_time_days) AS lead_time_days,
                   COALESCE(sup.remark, m.supplier_note) AS supplier_note,
                   m.stock_alert_enabled, m.remark
            FROM materials m
            LEFT JOIN material_suppliers sup ON sup.id = m.supplier_id AND sup.tenant_id = m.tenant_id
            WHERE m.id = :material_id AND m.tenant_id = :tenant_id
            """
        ),
        {"tenant_id": tenant_id, "material_id": material_id},
    ).mappings().first()
    if not material:
        raise AppError(code="MATERIAL_NOT_FOUND", message="Material not found", status_code=404)

    latest_inventory = db.execute(
        text(
            """
            SELECT DISTINCT ON (inv.store_id)
                   inv.store_id,
                   s.name AS store_name,
                   inv.biz_date,
                   inv.inbound_qty,
                   inv.usage_qty,
                   inv.closing_stock
            FROM inventory_snapshots inv
            JOIN stores s ON s.id = inv.store_id
            WHERE inv.tenant_id = :tenant_id
              AND inv.material_id = :material_id
            ORDER BY inv.store_id, inv.biz_date DESC
            """
        ),
        {"tenant_id": tenant_id, "material_id": material_id},
    ).mappings().all()

    return {
        **dict(material),
        "latest_inventory": [dict(row) for row in latest_inventory],
    }


@router.patch("/{material_id}")
def update_material(material_id: UUID, payload: MaterialUpdate, request: Request, db: Session = Depends(get_db)) -> dict:
    tenant_id = current_tenant_id(request)
    user_id = current_user_id(request)
    validate_status(payload.status)
    supplier_snapshot = resolve_supplier_snapshot(db, tenant_id, payload.supplier_id)
    material_data = payload.model_dump()
    material_data.update(supplier_snapshot)
    try:
        row = db.execute(
            text(
                """
                UPDATE materials
                SET material_code = COALESCE(:material_code, material_code),
                    name = COALESCE(:name, name),
                    unit = COALESCE(:unit, unit),
                    safety_stock = COALESCE(:safety_stock, safety_stock),
                    status = COALESCE(:status, status),
                    category = COALESCE(:category, category),
                    spec = COALESCE(:spec, spec),
                    purchase_spec = COALESCE(:purchase_spec, purchase_spec),
                    is_key_material = COALESCE(:is_key_material, is_key_material),
                    shelf_life_days = COALESCE(:shelf_life_days, shelf_life_days),
                    storage_method = COALESCE(:storage_method, storage_method),
                    supplier_id = COALESCE(:supplier_id, supplier_id),
                    supplier_name = COALESCE(:supplier_name, supplier_name),
                    supplier_contact = COALESCE(:supplier_contact, supplier_contact),
                    supplier_phone = COALESCE(:supplier_phone, supplier_phone),
                    min_order_qty = COALESCE(:min_order_qty, min_order_qty),
                    lead_time_days = COALESCE(:lead_time_days, lead_time_days),
                    supplier_note = COALESCE(:supplier_note, supplier_note),
                    stock_alert_enabled = COALESCE(:stock_alert_enabled, stock_alert_enabled),
                    remark = COALESCE(:remark, remark)
                WHERE id = :material_id AND tenant_id = :tenant_id
                RETURNING id, tenant_id, material_code, name, unit, safety_stock, status,
                          category, spec, purchase_spec, is_key_material, shelf_life_days,
                          storage_method, supplier_id, supplier_name, supplier_contact, supplier_phone,
                          min_order_qty, lead_time_days, supplier_note, stock_alert_enabled, remark
                """
            ),
            {"tenant_id": tenant_id, "material_id": material_id, **material_data},
        ).mappings().first()
    except IntegrityError as exc:
        db.rollback()
        raise AppError(code="MATERIAL_CODE_EXISTS", message="Material code already exists", status_code=409) from exc
    if not row:
        raise AppError(code="MATERIAL_NOT_FOUND", message="Material not found", status_code=404)
    insert_audit_log(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        action="MATERIAL_UPDATE",
        module="materials",
        object_type="material",
        object_id=row["id"],
        result=f"material_code={row['material_code']}",
        ip=request.client.host if request.client else None,
    )
    db.commit()
    return dict(row)


@router.put("/{material_id}")
def put_update_material(material_id: UUID, payload: MaterialUpdate, request: Request, db: Session = Depends(get_db)) -> dict:
    return update_material(material_id, payload, request, db)
