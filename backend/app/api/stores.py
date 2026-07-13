import json
from datetime import date
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import current_tenant_id, current_user_id, scoped_store_condition
from app.core.exceptions import AppError
from app.services.audit_service import insert_audit_log

router = APIRouter(prefix="/v1/stores", tags=["stores"])


class StoreCreate(BaseModel):
    code: str = Field(min_length=1)
    name: str = Field(min_length=1)
    store_type: str = "direct"
    region: str | None = None
    address: str | None = None
    manager_user_id: UUID | None = None
    franchisee_user_id: UUID | None = None
    opened_at: date | None = None
    cover_image_url: str | None = None
    image_urls: list[str] = Field(default_factory=list)
    store_format: str | None = None
    store_level: str | None = None
    business_district_type: str | None = None
    area_sqm: Decimal | None = None
    seat_count: int | None = None
    contact_phone: str | None = None
    operating_hours: str | None = None
    channel_tags: list[str] = Field(default_factory=list)
    property_tags: list[str] = Field(default_factory=list)
    latitude: Decimal | None = None
    longitude: Decimal | None = None


class StoreUpdate(BaseModel):
    code: str | None = Field(default=None, min_length=1)
    name: str | None = Field(default=None, min_length=1)
    store_type: str | None = None
    region: str | None = None
    address: str | None = None
    manager_user_id: UUID | None = None
    franchisee_user_id: UUID | None = None
    status: str | None = None
    opened_at: date | None = None
    cover_image_url: str | None = None
    image_urls: list[str] | None = None
    store_format: str | None = None
    store_level: str | None = None
    business_district_type: str | None = None
    area_sqm: Decimal | None = None
    seat_count: int | None = None
    contact_phone: str | None = None
    operating_hours: str | None = None
    channel_tags: list[str] | None = None
    property_tags: list[str] | None = None
    latitude: Decimal | None = None
    longitude: Decimal | None = None


@router.get("")
def list_stores(request: Request, db: Session = Depends(get_db)) -> list[dict]:
    tenant_id = current_tenant_id(request)
    scope_sql, scope_params = scoped_store_condition(request, "s")
    rows = db.execute(
        text(
            f"""
            SELECT s.id, s.tenant_id, s.code, s.name, s.store_type, s.region, s.address,
                   s.manager_user_id, manager.name AS manager_name,
                   s.franchisee_user_id, franchisee.name AS franchisee_name,
                   s.status, s.opened_at, s.cover_image_url, s.image_urls,
                   s.store_format, s.store_level, s.business_district_type,
                   s.area_sqm, s.seat_count, s.contact_phone, s.operating_hours,
                   s.channel_tags, s.property_tags, s.latitude, s.longitude
            FROM stores s
            LEFT JOIN users manager ON manager.id = s.manager_user_id
            LEFT JOIN users franchisee ON franchisee.id = s.franchisee_user_id
            WHERE s.tenant_id = :tenant_id
              AND {scope_sql}
            ORDER BY s.code ASC
            """
        ),
        {"tenant_id": tenant_id, **scope_params},
    ).mappings().all()
    return [serialize_store(row) for row in rows]


@router.post("", status_code=201)
def create_store(payload: StoreCreate, request: Request, db: Session = Depends(get_db)) -> dict:
    tenant_id = current_tenant_id(request)
    user_id = current_user_id(request)
    row = db.execute(
        text(
            """
            INSERT INTO stores (
              tenant_id, code, name, store_type, region, address,
              manager_user_id, franchisee_user_id, opened_at,
              cover_image_url, image_urls, store_format, store_level,
              business_district_type, area_sqm, seat_count, contact_phone,
              operating_hours, channel_tags, property_tags, latitude, longitude
            )
            VALUES (
              :tenant_id, :code, :name, :store_type, :region, :address,
              :manager_user_id, :franchisee_user_id, :opened_at,
              :cover_image_url, CAST(:image_urls AS jsonb), :store_format, :store_level,
              :business_district_type, :area_sqm, :seat_count, :contact_phone,
              :operating_hours, CAST(:channel_tags AS jsonb), CAST(:property_tags AS jsonb),
              :latitude, :longitude
            )
            RETURNING id, tenant_id, code, name, store_type, region, address,
                      manager_user_id, franchisee_user_id, status, opened_at,
                      cover_image_url, image_urls, store_format, store_level,
                      business_district_type, area_sqm, seat_count, contact_phone,
                      operating_hours, channel_tags, property_tags, latitude, longitude
            """
        ),
        {"tenant_id": tenant_id, **store_payload_params(payload.model_dump())},
    ).mappings().one()
    insert_audit_log(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        action="STORE_CREATE",
        module="stores",
        object_type="store",
        object_id=row["id"],
        result=f"code={row['code']}",
        ip=request.client.host if request.client else None,
    )
    db.commit()
    return serialize_store(row)


@router.patch("/{store_id}")
def update_store(store_id: UUID, payload: StoreUpdate, request: Request, db: Session = Depends(get_db)) -> dict:
    tenant_id = current_tenant_id(request)
    user_id = current_user_id(request)
    scope_sql, scope_params = scoped_store_condition(request, "stores")
    values = payload.model_dump(exclude_unset=True)
    allowed_fields = {
        "code",
        "name",
        "store_type",
        "region",
        "address",
        "manager_user_id",
        "franchisee_user_id",
        "status",
        "opened_at",
        "cover_image_url",
        "image_urls",
        "store_format",
        "store_level",
        "business_district_type",
        "area_sqm",
        "seat_count",
        "contact_phone",
        "operating_hours",
        "channel_tags",
        "property_tags",
        "latitude",
        "longitude",
    }
    json_fields = {"image_urls", "channel_tags", "property_tags"}
    set_clauses = [
        f"{field} = CAST(:{field} AS jsonb)" if field in json_fields else f"{field} = :{field}"
        for field in values
        if field in allowed_fields
    ]
    if not set_clauses:
        row = db.execute(
            text(
                f"""
                SELECT id, tenant_id, code, name, store_type, region, address,
                       manager_user_id, franchisee_user_id, status, opened_at,
                       cover_image_url, image_urls, store_format, store_level,
                       business_district_type, area_sqm, seat_count, contact_phone,
                       operating_hours, channel_tags, property_tags, latitude, longitude
                FROM stores
                WHERE id = :store_id AND tenant_id = :tenant_id
                  AND {scope_sql}
                """
            ),
            {"tenant_id": tenant_id, "store_id": store_id, **scope_params},
        ).mappings().first()
        if not row:
            raise AppError(code="STORE_NOT_FOUND", message="Store not found", status_code=404)
        return serialize_store(row)
    row = db.execute(
        text(
            f"""
            UPDATE stores
            SET {", ".join(set_clauses)}
            WHERE id = :store_id AND tenant_id = :tenant_id
              AND {scope_sql}
            RETURNING id, tenant_id, code, name, store_type, region, address,
                      manager_user_id, franchisee_user_id, status, opened_at,
                      cover_image_url, image_urls, store_format, store_level,
                      business_district_type, area_sqm, seat_count, contact_phone,
                      operating_hours, channel_tags, property_tags, latitude, longitude
            """
        ),
        {"tenant_id": tenant_id, "store_id": store_id, **store_payload_params(values), **scope_params},
    ).mappings().first()
    if not row:
        raise AppError(code="STORE_NOT_FOUND", message="Store not found", status_code=404)
    insert_audit_log(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        action="STORE_UPDATE",
        module="stores",
        object_type="store",
        object_id=row["id"],
        result=f"code={row['code']}",
        ip=request.client.host if request.client else None,
    )
    db.commit()
    return serialize_store(row)


@router.put("/{store_id}")
def put_update_store(store_id: UUID, payload: StoreUpdate, request: Request, db: Session = Depends(get_db)) -> dict:
    return update_store(store_id, payload, request, db)


def store_payload_params(values: dict) -> dict:
    params = dict(values)
    for field in ("image_urls", "channel_tags", "property_tags"):
        if field in params:
            params[field] = json.dumps(params.get(field) or [], ensure_ascii=False)
    return params


def serialize_store(row) -> dict:
    item = dict(row)
    for field in ("image_urls", "channel_tags", "property_tags"):
        value = item.get(field)
        if value is None:
            item[field] = []
        elif isinstance(value, str):
            item[field] = json.loads(value)
    return item
