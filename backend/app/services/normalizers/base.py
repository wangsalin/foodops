from collections import Counter
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session


@dataclass(slots=True)
class NormalizePreviewResult:
    sync_job_id: str
    sync_type: str
    total_records: int = 0
    ready_rows: int = 0
    unmatched_store_rows: int = 0
    unmatched_product_rows: int = 0
    unmatched_material_rows: int = 0
    invalid_rows: int = 0
    status_counts: dict[str, int] = field(default_factory=dict)
    preview_rows: list[dict[str, Any]] = field(default_factory=list)


def normalize_job_preview(db: Session, tenant_id: str, job: dict, preview_limit: int | None = 20) -> NormalizePreviewResult:
    rows = db.execute(
        text(
            """
            SELECT id, data_source_id, record_type, external_id, external_store_id,
                   external_product_id, external_material_id, biz_date, payload
            FROM external_raw_records
            WHERE tenant_id = :tenant_id AND sync_job_id = :sync_job_id
            ORDER BY created_at ASC
            """
        ),
        {"tenant_id": tenant_id, "sync_job_id": job["id"]},
    ).mappings().all()
    counts: Counter[str] = Counter()
    preview_rows: list[dict[str, Any]] = []
    for row in rows:
        raw = dict(row)
        normalized = normalize_record(db, tenant_id, job, raw)
        status = normalized.pop("normalized_status")
        counts[status] += 1
        db.execute(
            text(
                """
                UPDATE external_raw_records
                SET normalized_status = :status,
                    error_message = :error_message
                WHERE id = :raw_record_id AND tenant_id = :tenant_id
                """
            ),
            {
                "tenant_id": tenant_id,
                "raw_record_id": raw["id"],
                "status": status,
                "error_message": normalized.get("error_message"),
            },
        )
        if preview_limit is None or len(preview_rows) < preview_limit:
            preview_rows.append({"raw_record_id": raw["id"], "status": status, **normalized})

    return NormalizePreviewResult(
        sync_job_id=str(job["id"]),
        sync_type=job["sync_type"],
        total_records=len(rows),
        ready_rows=counts["ready"],
        unmatched_store_rows=counts["unmatched_store"],
        unmatched_product_rows=counts["unmatched_product"],
        unmatched_material_rows=counts["unmatched_material"],
        invalid_rows=counts["invalid"],
        status_counts=dict(counts),
        preview_rows=preview_rows,
    )


def normalize_record(db: Session, tenant_id: str, job: dict, raw: dict) -> dict[str, Any]:
    sync_type = job["sync_type"]
    if sync_type == "stores":
        return {"normalized_status": "ready", "record_type": "store_mapping", "external_id": raw.get("external_id")}
    if sync_type == "products":
        return {"normalized_status": "ready", "record_type": "product_mapping", "external_id": raw.get("external_id")}
    if sync_type in {"sales_daily", "sales_product", "inventory", "reviews"}:
        return normalize_business_record(db, tenant_id, job, raw)
    return {"normalized_status": "invalid", "error_message": "Unsupported sync type", "record_type": sync_type}


def normalize_business_record(db: Session, tenant_id: str, job: dict, raw: dict) -> dict[str, Any]:
    payload = raw.get("payload") or {}
    store_mapping = find_store_mapping(db, tenant_id, raw["data_source_id"], raw.get("external_store_id") or payload.get("external_store_id"))
    if not store_mapping:
        return {
            "normalized_status": "unmatched_store",
            "error_message": "External store is not mapped",
            "external_store_id": raw.get("external_store_id") or payload.get("external_store_id"),
        }

    if job["sync_type"] == "sales_product":
        product_mapping = find_product_mapping(
            db,
            tenant_id,
            raw["data_source_id"],
            raw.get("external_product_id") or payload.get("external_product_id"),
        )
        if not product_mapping:
            return {
                "normalized_status": "unmatched_product",
                "error_message": "External product is not mapped",
                "external_product_id": raw.get("external_product_id") or payload.get("external_product_id"),
                "store_id": store_mapping["store_id"],
            }
        return sales_product_preview(raw, payload, store_mapping, product_mapping)

    if job["sync_type"] == "sales_daily":
        return sales_daily_preview(raw, payload, store_mapping, job["provider"])
    if job["sync_type"] == "inventory":
        material_mapping = find_material_mapping(
            db,
            tenant_id,
            raw["data_source_id"],
            raw.get("external_material_id") or payload.get("external_material_id"),
        )
        if not material_mapping:
            return {
                "normalized_status": "unmatched_material",
                "error_message": "External material is not mapped",
                "external_material_id": raw.get("external_material_id") or payload.get("external_material_id"),
                "store_id": store_mapping["store_id"],
            }
        return inventory_preview(raw, payload, store_mapping, material_mapping)
    if job["sync_type"] == "reviews":
        return review_preview(raw, payload, store_mapping, job["provider"])
    return {"normalized_status": "invalid", "error_message": "Unsupported business sync type"}


def find_store_mapping(db: Session, tenant_id: str, data_source_id: str, external_store_id: str | None):
    if not external_store_id:
        return None
    return db.execute(
        text(
            """
            SELECT id, store_id
            FROM external_store_mappings
            WHERE tenant_id = :tenant_id
              AND data_source_id = :data_source_id
              AND external_store_id = :external_store_id
              AND match_status = 'matched'
              AND store_id IS NOT NULL
            """
        ),
        {"tenant_id": tenant_id, "data_source_id": data_source_id, "external_store_id": external_store_id},
    ).mappings().first()


def find_product_mapping(db: Session, tenant_id: str, data_source_id: str, external_product_id: str | None):
    if not external_product_id:
        return None
    return db.execute(
        text(
            """
            SELECT id, product_id
            FROM external_product_mappings
            WHERE tenant_id = :tenant_id
              AND data_source_id = :data_source_id
              AND external_product_id = :external_product_id
              AND match_status = 'matched'
              AND product_id IS NOT NULL
            """
        ),
        {"tenant_id": tenant_id, "data_source_id": data_source_id, "external_product_id": external_product_id},
    ).mappings().first()


def find_material_mapping(db: Session, tenant_id: str, data_source_id: str, external_material_id: str | None):
    if not external_material_id:
        return None
    return db.execute(
        text(
            """
            SELECT id, material_id
            FROM external_material_mappings
            WHERE tenant_id = :tenant_id
              AND data_source_id = :data_source_id
              AND external_material_id = :external_material_id
              AND match_status = 'matched'
              AND material_id IS NOT NULL
            """
        ),
        {"tenant_id": tenant_id, "data_source_id": data_source_id, "external_material_id": external_material_id},
    ).mappings().first()


def sales_daily_preview(raw: dict, payload: dict, store_mapping: dict, provider: str) -> dict[str, Any]:
    orders = int(payload.get("orders") or 0)
    revenue = float(payload.get("revenue") or 0)
    return {
        "normalized_status": "ready",
        "record_type": "sales_daily",
        "store_id": store_mapping["store_id"],
        "biz_date": raw.get("biz_date") or payload.get("biz_date"),
        "channel": provider,
        "revenue": revenue,
        "orders": orders,
        "avg_order": revenue / orders if orders else 0,
        "discount_amt": float(payload.get("discount_amt") or 0),
        "refund_amt": float(payload.get("refund_amt") or 0),
    }


def sales_product_preview(raw: dict, payload: dict, store_mapping: dict, product_mapping: dict) -> dict[str, Any]:
    return {
        "normalized_status": "ready",
        "record_type": "sales_product",
        "store_id": store_mapping["store_id"],
        "product_id": product_mapping["product_id"],
        "biz_date": raw.get("biz_date") or payload.get("biz_date"),
        "qty": int(payload.get("qty") or 0),
        "revenue": float(payload.get("revenue") or 0),
    }


def inventory_preview(raw: dict, payload: dict, store_mapping: dict, material_mapping: dict) -> dict[str, Any]:
    return {
        "normalized_status": "ready",
        "record_type": "inventory",
        "store_id": store_mapping["store_id"],
        "material_id": material_mapping["material_id"],
        "biz_date": raw.get("biz_date") or payload.get("biz_date"),
        "external_id": raw.get("external_id"),
        "inbound_qty": float(payload.get("inbound_qty") or 0),
        "usage_qty": float(payload.get("usage_qty") or 0),
        "closing_stock": float(payload.get("closing_stock") or 0),
    }


def review_preview(raw: dict, payload: dict, store_mapping: dict, provider: str) -> dict[str, Any]:
    return {
        "normalized_status": "ready",
        "record_type": "reviews",
        "store_id": store_mapping["store_id"],
        "platform": provider,
        "rating": float(payload.get("rating") or 0),
        "content": payload.get("content") or "",
    }
