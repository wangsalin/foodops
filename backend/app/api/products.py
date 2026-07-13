import json
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import current_tenant_id, current_user_id
from app.core.exceptions import AppError
from app.services.audit_service import insert_audit_log

router = APIRouter(prefix="/v1/products", tags=["products"])


class ProductCreate(BaseModel):
    sku: str = Field(min_length=1)
    name: str = Field(min_length=1)
    category: str | None = None
    status: str | None = None
    price: Decimal | None = None
    cost: Decimal | None = None
    description: str | None = None
    image_urls: list[str] | None = None
    ai_tags: list[str] | None = None
    social_rules: str | None = None


class ProductUpdate(BaseModel):
    sku: str | None = Field(default=None, min_length=1)
    name: str | None = Field(default=None, min_length=1)
    category: str | None = None
    status: str | None = None
    price: Decimal | None = None
    cost: Decimal | None = None
    description: str | None = None
    image_urls: list[str] | None = None
    ai_tags: list[str] | None = None
    social_rules: str | None = None


class ProductCategoryCreate(BaseModel):
    name: str = Field(min_length=1)
    status: str | None = "active"
    sort: int | None = 0


class ProductCategoryUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1)
    status: str | None = None
    sort: int | None = None


def normalize_category_name(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    return normalized or None


def ensure_category_available(db: Session, tenant_id: str, category: str | None) -> None:
    if category is None:
        return
    exists = db.execute(
        text(
            """
            SELECT 1
            FROM product_categories
            WHERE tenant_id = :tenant_id AND name = :name AND status = 'active'
            """
        ),
        {"tenant_id": tenant_id, "name": category},
    ).scalar()
    if not exists:
        raise AppError(
            code="PRODUCT_CATEGORY_NOT_FOUND",
            message="请先维护产品分类",
            status_code=400,
            detail={"category": category},
        )


@router.get("")
def list_products(request: Request, db: Session = Depends(get_db)) -> list[dict]:
    tenant_id = current_tenant_id(request)
    rows = db.execute(
        text(
            """
            SELECT id, tenant_id, sku, name, category, status, price, cost,
                   margin_rate, description, image_urls, ai_tags, social_rules
            FROM products
            WHERE tenant_id = :tenant_id
            ORDER BY sku ASC
            """
        ),
        {"tenant_id": tenant_id},
    ).mappings().all()
    return [dict(row) for row in rows]


@router.get("/categories")
def list_product_categories(request: Request, db: Session = Depends(get_db)) -> list[dict]:
    tenant_id = current_tenant_id(request)
    rows = db.execute(
        text(
            """
            SELECT pc.id, pc.tenant_id, pc.name, pc.status, pc.sort, pc.created_at,
                   COUNT(p.id) AS product_count
            FROM product_categories pc
            LEFT JOIN products p
              ON p.tenant_id = pc.tenant_id AND p.category = pc.name
            WHERE pc.tenant_id = :tenant_id
            GROUP BY pc.id, pc.tenant_id, pc.name, pc.status, pc.sort, pc.created_at
            ORDER BY CASE WHEN pc.status = 'active' THEN 0 ELSE 1 END, pc.sort ASC, pc.name ASC
            """
        ),
        {"tenant_id": tenant_id},
    ).mappings().all()
    return [dict(row) for row in rows]


@router.post("/categories", status_code=201)
def create_product_category(payload: ProductCategoryCreate, request: Request, db: Session = Depends(get_db)) -> dict:
    tenant_id = current_tenant_id(request)
    user_id = current_user_id(request)
    name = normalize_category_name(payload.name)
    if not name:
        raise AppError(code="PRODUCT_CATEGORY_NAME_REQUIRED", message="请输入分类名称", status_code=400)
    row = db.execute(
        text(
            """
            INSERT INTO product_categories (tenant_id, name, status, sort)
            VALUES (:tenant_id, :name, COALESCE(:status, 'active'), COALESCE(:sort, 0))
            ON CONFLICT (tenant_id, name) DO NOTHING
            RETURNING id, tenant_id, name, status, sort, created_at
            """
        ),
        {"tenant_id": tenant_id, "name": name, "status": payload.status, "sort": payload.sort},
    ).mappings().first()
    if not row:
        raise AppError(
            code="PRODUCT_CATEGORY_EXISTS",
            message="分类已存在",
            status_code=409,
            detail={"name": name},
        )
    insert_audit_log(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        action="PRODUCT_CATEGORY_CREATE",
        module="products",
        object_type="product_category",
        object_id=row["id"],
        result=f"name={row['name']}",
        ip=request.client.host if request.client else None,
    )
    db.commit()
    return dict(row)


@router.patch("/categories/{category_id}")
def update_product_category(category_id: UUID, payload: ProductCategoryUpdate, request: Request, db: Session = Depends(get_db)) -> dict:
    tenant_id = current_tenant_id(request)
    user_id = current_user_id(request)
    fields = payload.model_dump(exclude_unset=True)
    if "name" in fields:
        fields["name"] = normalize_category_name(fields["name"])
        if not fields["name"]:
            raise AppError(code="PRODUCT_CATEGORY_NAME_REQUIRED", message="请输入分类名称", status_code=400)
    if not fields:
        row = db.execute(
            text(
                """
                SELECT id, tenant_id, name, status, sort, created_at
                FROM product_categories
                WHERE id = :category_id AND tenant_id = :tenant_id
                """
            ),
            {"tenant_id": tenant_id, "category_id": category_id},
        ).mappings().first()
        if not row:
            raise AppError(code="PRODUCT_CATEGORY_NOT_FOUND", message="分类不存在", status_code=404)
        return dict(row)

    allowed_fields = {"name": "name", "status": "status", "sort": "sort"}
    set_clauses: list[str] = []
    params = {"tenant_id": tenant_id, "category_id": category_id}
    for field, column in allowed_fields.items():
        if field in fields:
            params[field] = fields[field]
            set_clauses.append(f"{column} = :{field}")
    row = db.execute(
        text(
            f"""
            UPDATE product_categories
            SET {", ".join(set_clauses)}
            WHERE id = :category_id AND tenant_id = :tenant_id
            RETURNING id, tenant_id, name, status, sort, created_at
            """
        ),
        params,
    ).mappings().first()
    if not row:
        raise AppError(code="PRODUCT_CATEGORY_NOT_FOUND", message="分类不存在", status_code=404)
    insert_audit_log(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        action="PRODUCT_CATEGORY_UPDATE",
        module="products",
        object_type="product_category",
        object_id=row["id"],
        result=f"name={row['name']}",
        ip=request.client.host if request.client else None,
    )
    db.commit()
    return dict(row)


@router.put("/categories/{category_id}")
def put_update_product_category(category_id: UUID, payload: ProductCategoryUpdate, request: Request, db: Session = Depends(get_db)) -> dict:
    return update_product_category(category_id, payload, request, db)


@router.post("", status_code=201)
def create_product(payload: ProductCreate, request: Request, db: Session = Depends(get_db)) -> dict:
    tenant_id = current_tenant_id(request)
    user_id = current_user_id(request)
    category = normalize_category_name(payload.category)
    ensure_category_available(db, tenant_id, category)
    margin_rate = None
    if payload.price and payload.cost and payload.price > 0:
        margin_rate = (payload.price - payload.cost) / payload.price
    row = db.execute(
        text(
            """
            INSERT INTO products (
              tenant_id, sku, name, category, status, price, cost, margin_rate,
              description, image_urls, ai_tags, social_rules
            )
            VALUES (
              :tenant_id, :sku, :name, :category, COALESCE(:status, 'active'), :price, :cost, :margin_rate,
              :description, CAST(:image_urls AS jsonb), CAST(:ai_tags AS jsonb), :social_rules
            )
            RETURNING id, tenant_id, sku, name, category, status, price, cost,
                      margin_rate, description, image_urls, ai_tags, social_rules
            """
        ),
        {
            "tenant_id": tenant_id,
            "sku": payload.sku,
            "name": payload.name,
            "category": category,
            "status": payload.status,
            "price": payload.price,
            "cost": payload.cost,
            "margin_rate": margin_rate,
            "description": payload.description,
            "image_urls": json.dumps(payload.image_urls or []),
            "ai_tags": json.dumps(payload.ai_tags or []),
            "social_rules": payload.social_rules,
        },
    ).mappings().one()
    insert_audit_log(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        action="PRODUCT_CREATE",
        module="products",
        object_type="product",
        object_id=row["id"],
        result=f"sku={row['sku']}",
        ip=request.client.host if request.client else None,
    )
    db.commit()
    return dict(row)


@router.patch("/{product_id}")
def update_product(product_id: UUID, payload: ProductUpdate, request: Request, db: Session = Depends(get_db)) -> dict:
    tenant_id = current_tenant_id(request)
    user_id = current_user_id(request)
    fields = payload.model_dump(exclude_unset=True)
    current = db.execute(
        text(
            """
            SELECT id, tenant_id, sku, name, category, status, price, cost,
                   margin_rate, description, image_urls, ai_tags, social_rules
            FROM products
            WHERE id = :product_id AND tenant_id = :tenant_id
            """
        ),
        {"tenant_id": tenant_id, "product_id": product_id},
    ).mappings().first()
    if not current:
        raise AppError(code="PRODUCT_NOT_FOUND", message="Product not found", status_code=404)

    if not fields:
        return dict(current)
    if "category" in fields:
        fields["category"] = normalize_category_name(fields["category"])
        ensure_category_available(db, tenant_id, fields["category"])

    price = fields["price"] if "price" in fields else current["price"]
    cost = fields["cost"] if "cost" in fields else current["cost"]
    margin_rate = None
    if price and cost and price > 0:
        margin_rate = (price - cost) / price

    allowed_fields = {
        "sku": "sku",
        "name": "name",
        "category": "category",
        "status": "status",
        "price": "price",
        "cost": "cost",
        "description": "description",
        "image_urls": "image_urls",
        "ai_tags": "ai_tags",
        "social_rules": "social_rules",
    }
    set_clauses: list[str] = []
    params = {"tenant_id": tenant_id, "product_id": product_id, "margin_rate": margin_rate}
    for field, column in allowed_fields.items():
        if field not in fields:
            continue
        if field in {"image_urls", "ai_tags"}:
            params[field] = json.dumps(fields[field]) if fields[field] is not None else None
            set_clauses.append(f"{column} = CAST(:{field} AS jsonb)")
        else:
            params[field] = fields[field]
            set_clauses.append(f"{column} = :{field}")
    set_clauses.append("margin_rate = :margin_rate")

    row = db.execute(
        text(
            f"""
            UPDATE products
            SET {", ".join(set_clauses)}
            WHERE id = :product_id AND tenant_id = :tenant_id
            RETURNING id, tenant_id, sku, name, category, status, price, cost,
                      margin_rate, description, image_urls, ai_tags, social_rules
            """
        ),
        params,
    ).mappings().first()
    if not row:
        raise AppError(code="PRODUCT_NOT_FOUND", message="Product not found", status_code=404)
    insert_audit_log(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        action="PRODUCT_UPDATE",
        module="products",
        object_type="product",
        object_id=row["id"],
        result=f"sku={row['sku']}",
        ip=request.client.host if request.client else None,
    )
    db.commit()
    return dict(row)


@router.put("/{product_id}")
def put_update_product(product_id: UUID, payload: ProductUpdate, request: Request, db: Session = Depends(get_db)) -> dict:
    return update_product(product_id, payload, request, db)
