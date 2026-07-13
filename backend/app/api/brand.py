import json
from typing import Any

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import current_tenant_id, current_user_id
from app.services.audit_service import insert_audit_log

router = APIRouter(prefix="/v1/brand-assets", tags=["brand-assets"])


class BrandAssetUpsert(BaseModel):
    system_name: str | None = None
    brand_name: str | None = None
    brand_short_name: str | None = None
    logo_url: str | None = None
    favicon_url: str | None = None
    primary_color: str | None = None
    accent_color: str | None = None
    font_cn: str | None = None
    font_en: str | None = None
    slogan: str | None = None
    tone: str | None = None
    forbidden_rules: str | None = None
    culture: dict[str, Any] | None = None
    expression: dict[str, Any] | None = None
    ai_policy: dict[str, Any] | None = None
    brand_docs: dict[str, Any] | None = None


def _json_value(value: dict[str, Any] | None) -> str:
    return json.dumps(value or {}, ensure_ascii=False)


@router.get("/public")
def get_public_brand_assets(db: Session = Depends(get_db)) -> dict | None:
    row = db.execute(
        text(
            """
            SELECT
                   ba.id, ba.tenant_id, ba.system_name, ba.brand_name, ba.brand_short_name,
                   ba.logo_url, ba.favicon_url, ba.primary_color, ba.accent_color,
                   ba.font_cn, ba.font_en, ba.slogan, ba.tone, ba.forbidden_rules,
                   ba.culture, ba.expression, ba.ai_policy, ba.brand_docs, ba.updated_at
            FROM brand_assets ba
            JOIN tenants t ON t.id = ba.tenant_id
            ORDER BY ba.updated_at DESC, t.created_at DESC
            LIMIT 1
            """
        )
    ).mappings().first()
    return dict(row) if row else None


@router.get("")
def get_brand_assets(request: Request, db: Session = Depends(get_db)) -> dict | None:
    tenant_id = current_tenant_id(request)
    row = db.execute(
        text(
            """
            SELECT
                   id, tenant_id, system_name, brand_name, brand_short_name,
                   logo_url, favicon_url, primary_color, accent_color,
                   font_cn, font_en, slogan, tone, forbidden_rules,
                   culture, expression, ai_policy, brand_docs, updated_at
            FROM brand_assets
            WHERE tenant_id = :tenant_id
            ORDER BY updated_at DESC
            LIMIT 1
            """
        ),
        {"tenant_id": tenant_id},
    ).mappings().first()
    return dict(row) if row else None


@router.put("")
def upsert_brand_assets(payload: BrandAssetUpsert, request: Request, db: Session = Depends(get_db)) -> dict:
    tenant_id = current_tenant_id(request)
    user_id = current_user_id(request)
    existing = db.execute(
        text(
            """
            SELECT id
            FROM brand_assets
            WHERE tenant_id = :tenant_id
            ORDER BY updated_at DESC
            LIMIT 1
            """
        ),
        {"tenant_id": tenant_id},
    ).mappings().first()
    payload_data = payload.model_dump()
    params = {
        "tenant_id": tenant_id,
        **payload_data,
        "culture": _json_value(payload.culture),
        "expression": _json_value(payload.expression),
        "ai_policy": _json_value(payload.ai_policy),
        "brand_docs": _json_value(payload.brand_docs),
    }
    if existing:
        row = db.execute(
            text(
                """
                UPDATE brand_assets
                SET system_name = :system_name,
                    brand_name = :brand_name,
                    brand_short_name = :brand_short_name,
                    logo_url = :logo_url,
                    favicon_url = :favicon_url,
                    primary_color = :primary_color,
                    accent_color = :accent_color,
                    font_cn = :font_cn,
                    font_en = :font_en,
                    slogan = :slogan,
                    tone = :tone,
                    forbidden_rules = :forbidden_rules,
                    culture = CAST(:culture AS JSONB),
                    expression = CAST(:expression AS JSONB),
                    ai_policy = CAST(:ai_policy AS JSONB),
                    brand_docs = CAST(:brand_docs AS JSONB),
                    updated_at = NOW()
                WHERE id = :id AND tenant_id = :tenant_id
                RETURNING id, tenant_id, system_name, brand_name, brand_short_name,
                          logo_url, favicon_url, primary_color, accent_color,
                          font_cn, font_en, slogan, tone, forbidden_rules,
                          culture, expression, ai_policy, brand_docs, updated_at
                """
            ),
            {"id": existing["id"], **params},
        ).mappings().one()
    else:
        row = db.execute(
            text(
                """
                INSERT INTO brand_assets (
                  tenant_id, system_name, brand_name, brand_short_name,
                  logo_url, favicon_url, primary_color, accent_color,
                  font_cn, font_en, slogan, tone, forbidden_rules,
                  culture, expression, ai_policy, brand_docs
                )
                VALUES (
                  :tenant_id, :system_name, :brand_name, :brand_short_name,
                  :logo_url, :favicon_url, :primary_color, :accent_color,
                  :font_cn, :font_en, :slogan, :tone, :forbidden_rules,
                  CAST(:culture AS JSONB), CAST(:expression AS JSONB),
                  CAST(:ai_policy AS JSONB), CAST(:brand_docs AS JSONB)
                )
                RETURNING id, tenant_id, system_name, brand_name, brand_short_name,
                          logo_url, favicon_url, primary_color, accent_color,
                          font_cn, font_en, slogan, tone, forbidden_rules,
                          culture, expression, ai_policy, brand_docs, updated_at
                """
            ),
            params,
        ).mappings().one()
    insert_audit_log(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        action="BRAND_ASSET_UPSERT",
        module="system",
        object_type="brand_asset",
        object_id=row["id"],
        result=f"brand={row['brand_name'] or ''}; logo_url={row['logo_url'] or ''}; primary_color={row['primary_color'] or ''}; culture={bool(row['culture'])}",
        ip=request.client.host if request.client else None,
    )
    db.commit()
    return dict(row)
