from datetime import date, timedelta
from decimal import Decimal
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.services.notify_service import create_high_risk_notifications

SALES_DROP_WARNING_RATIO = Decimal("0.70")
SALES_DROP_CRITICAL_RATIO = Decimal("0.50")
FOOD_SAFETY_KEYWORDS = ("食安", "食品安全", "异物", "呕吐", "腹泻", "变质", "发酸", "不新鲜")


def scan_sales_drop_alerts(
    db: Session,
    tenant_id: str,
    *,
    user_id: str | None = None,
    biz_date: date | None = None,
) -> dict:
    target_date = biz_date or latest_sales_date(db, tenant_id)
    if target_date is None:
        return {"status": "completed", "biz_date": None, "generated": 0, "scanned": 0, "alerts": []}

    rows = db.execute(
        text(
            """
            SELECT store_id, biz_date, revenue
            FROM sales_daily
            WHERE tenant_id = :tenant_id
              AND biz_date = :biz_date
            ORDER BY store_id
            """
        ),
        {"tenant_id": tenant_id, "biz_date": target_date},
    ).mappings().all()
    generated_alerts: list[dict] = []
    for row in rows:
        alert = evaluate_sales_drop_row(db, tenant_id, dict(row), user_id)
        if alert:
            generated_alerts.append(alert)
    return {
        "status": "completed",
        "biz_date": target_date.isoformat(),
        "generated": len(generated_alerts),
        "scanned": len(rows),
        "alerts": generated_alerts,
    }


def scan_sales_drop_alerts_for_all_tenants(db: Session) -> dict:
    tenant_ids = db.execute(text("SELECT id FROM tenants ORDER BY created_at ASC")).scalars().all()
    results = []
    generated = 0
    for tenant_id in tenant_ids:
        result = scan_sales_drop_alerts(db, str(tenant_id))
        results.append({"tenant_id": str(tenant_id), **result})
        generated += int(result["generated"])
    return {"status": "completed", "generated": generated, "tenants": results}


def generate_sales_drop_alerts_for_rows(
    db: Session,
    tenant_id: str,
    user_id: str | None,
    sales_rows: list[dict],
) -> int:
    return len(generate_sales_drop_alert_details_for_rows(db, tenant_id, user_id, sales_rows))


def generate_sales_drop_alert_details_for_rows(
    db: Session,
    tenant_id: str,
    user_id: str | None,
    sales_rows: list[dict],
) -> list[dict]:
    generated: list[dict] = []
    for row in sales_rows:
        alert = evaluate_sales_drop_row(db, tenant_id, row, user_id)
        if alert:
            generated.append(alert)
    return generated


def generate_inventory_risk_alerts_for_rows(
    db: Session,
    tenant_id: str,
    user_id: str | None,
    inventory_rows: list[dict],
) -> int:
    return len(generate_inventory_risk_alert_details_for_rows(db, tenant_id, user_id, inventory_rows))


def generate_inventory_risk_alert_details_for_rows(
    db: Session,
    tenant_id: str,
    user_id: str | None,
    inventory_rows: list[dict],
) -> list[dict]:
    generated: list[dict] = []
    for row in inventory_rows:
        alert = evaluate_inventory_risk_row(db, tenant_id, row, user_id)
        if alert:
            generated.append(alert)
    return generated


def generate_bad_review_alerts_for_rows(
    db: Session,
    tenant_id: str,
    user_id: str | None,
    review_rows: list[dict],
) -> int:
    return len(generate_bad_review_alert_details_for_rows(db, tenant_id, user_id, review_rows))


def generate_bad_review_alert_details_for_rows(
    db: Session,
    tenant_id: str,
    user_id: str | None,
    review_rows: list[dict],
) -> list[dict]:
    generated: list[dict] = []
    touched_store_ids = {row["store_id"] for row in review_rows if row.get("store_id")}
    for store_id in touched_store_ids:
        alert = evaluate_bad_review_store(db, tenant_id, store_id, user_id)
        if alert:
            generated.append(alert)
    return generated


def evaluate_sales_drop_row(db: Session, tenant_id: str, row: dict, user_id: str | None = None) -> dict | None:
    store = db.execute(
        text(
            """
            SELECT name, manager_user_id, status
            FROM stores
            WHERE id = :store_id AND tenant_id = :tenant_id
            """
        ),
        {"tenant_id": tenant_id, "store_id": row["store_id"]},
    ).mappings().first()
    if not store:
        return None

    revenue = as_decimal(row.get("revenue"))
    if revenue == 0 and str(store["status"] or "").lower() in {"closed", "renovating", "停业", "装修"}:
        return None

    ratio, baseline = same_week_revenue_ratio(db, tenant_id, row["store_id"], row["biz_date"], revenue)
    if ratio is None or baseline is None or ratio >= SALES_DROP_WARNING_RATIO:
        return None

    if sales_drop_alert_exists_recently(db, tenant_id, row["store_id"]):
        return None

    level = "critical" if ratio < SALES_DROP_CRITICAL_RATIO else "warning"
    if level == "warning" and previous_day_sales_drop(db, tenant_id, row["store_id"], row["biz_date"]):
        level = "critical"

    drop_pct = round((1 - float(ratio)) * 100, 1)
    title = f"{store['name']} 销售下滑 {drop_pct}%"
    summary = (
        f"{row['biz_date']} 营收 {revenue:.2f} 元，低于过去同星期均值 {baseline:.2f} 元，"
        "触发销售异常预警。"
    )
    alert = db.execute(
        text(
            """
            INSERT INTO alerts (
              tenant_id, store_id, alert_type, level, title, summary,
              status, responsible_user_id, due_at
            )
            VALUES (
              :tenant_id, :store_id, 'sales_drop', :level, :title, :summary,
              'open', :responsible_user_id, NOW() + INTERVAL '1 day'
            )
            RETURNING id, tenant_id, store_id, alert_type, level, title, summary,
                      status, responsible_user_id, due_at, created_at
            """
        ),
        {
            "tenant_id": tenant_id,
            "store_id": row["store_id"],
            "level": level,
            "title": title,
            "summary": summary,
            "responsible_user_id": store["manager_user_id"],
        },
    ).mappings().one()
    insert_alert_notification(db, alert)
    insert_alert_audit_log(db, alert)
    insert_local_alert_attribution_run(db, tenant_id, alert["id"], user_id, alert_type="sales_drop", title=title)
    serialized = serialize_alert(alert)
    serialized["store_name"] = store["name"]
    return serialized


def evaluate_inventory_risk_row(db: Session, tenant_id: str, row: dict, user_id: str | None = None) -> dict | None:
    store = db.execute(
        text(
            """
            SELECT name, manager_user_id
            FROM stores
            WHERE id = :store_id AND tenant_id = :tenant_id
            """
        ),
        {"tenant_id": tenant_id, "store_id": row["store_id"]},
    ).mappings().first()
    material = db.execute(
        text(
            """
            SELECT name, safety_stock
            FROM materials
            WHERE id = :material_id AND tenant_id = :tenant_id
            """
        ),
        {"tenant_id": tenant_id, "material_id": row["material_id"]},
    ).mappings().first()
    if not store or not material:
        return None

    closing_stock = as_decimal(row.get("closing_stock"))
    safety_stock = as_decimal(material["safety_stock"])
    if closing_stock > 0 and (material["safety_stock"] is None or closing_stock > safety_stock):
        return None
    if alert_exists_recently(db, tenant_id, row["store_id"], "inventory_risk"):
        return None

    level = "critical" if closing_stock == 0 else "warning"
    title = f"{store['name']} {material['name']} 库存风险"
    if closing_stock == 0:
        summary = f"{row['biz_date']} {material['name']} 期末库存为 0，可能影响正常出品，需立即处理。"
    else:
        summary = f"{row['biz_date']} {material['name']} 期末库存 {closing_stock:.2f}，低于或等于安全库存线 {safety_stock:.2f}。"
    alert = insert_alert(
        db,
        tenant_id=tenant_id,
        store_id=row["store_id"],
        alert_type="inventory_risk",
        level=level,
        title=title,
        summary=summary,
        responsible_user_id=store["manager_user_id"],
    )
    insert_alert_notification(db, alert)
    insert_alert_audit_log(db, alert)
    insert_local_alert_attribution_run(db, tenant_id, alert["id"], user_id, alert_type="inventory_risk", title=title)
    serialized = serialize_alert(alert)
    serialized["store_name"] = store["name"]
    return serialized


def evaluate_bad_review_store(db: Session, tenant_id: str, store_id, user_id: str | None = None) -> dict | None:
    store = db.execute(
        text(
            """
            SELECT name, manager_user_id
            FROM stores
            WHERE id = :store_id AND tenant_id = :tenant_id
            """
        ),
        {"tenant_id": tenant_id, "store_id": store_id},
    ).mappings().first()
    if not store or alert_exists_recently(db, tenant_id, store_id, "bad_review"):
        return None

    review_stats = db.execute(
        text(
            """
            SELECT COUNT(*) AS bad_count,
                   COUNT(*) FILTER (
                     WHERE content ILIKE '%食安%'
                        OR content ILIKE '%食品安全%'
                        OR content ILIKE '%异物%'
                        OR content ILIKE '%呕吐%'
                        OR content ILIKE '%腹泻%'
                        OR content ILIKE '%变质%'
                        OR content ILIKE '%发酸%'
                        OR content ILIKE '%不新鲜%'
                   ) AS food_safety_count,
                   MAX(created_at) AS latest_review_at
            FROM reviews
            WHERE tenant_id = :tenant_id
              AND store_id = :store_id
              AND rating <= 2.0
              AND created_at >= NOW() - INTERVAL '24 hours'
            """
        ),
        {"tenant_id": tenant_id, "store_id": store_id},
    ).mappings().one()
    bad_count = int(review_stats["bad_count"] or 0)
    food_safety_count = int(review_stats["food_safety_count"] or 0)
    if bad_count < 6 and food_safety_count == 0:
        return None

    level = "critical" if food_safety_count else "warning"
    title = f"{store['name']} 差评风险"
    if food_safety_count:
        summary = f"近 24 小时出现 {food_safety_count} 条食安关键词差评，需当日处理并复核门店出品。"
    else:
        summary = f"近 24 小时累计 {bad_count} 条低评分差评，需排查服务、包装、出餐和口感问题。"
    alert = insert_alert(
        db,
        tenant_id=tenant_id,
        store_id=store_id,
        alert_type="bad_review",
        level=level,
        title=title,
        summary=summary,
        responsible_user_id=store["manager_user_id"],
    )
    insert_alert_notification(db, alert)
    insert_alert_audit_log(db, alert)
    insert_local_alert_attribution_run(db, tenant_id, alert["id"], user_id, alert_type="bad_review", title=title)
    serialized = serialize_alert(alert)
    serialized["store_name"] = store["name"]
    return serialized


def latest_sales_date(db: Session, tenant_id: str) -> date | None:
    return db.execute(
        text("SELECT MAX(biz_date) FROM sales_daily WHERE tenant_id = :tenant_id"),
        {"tenant_id": tenant_id},
    ).scalar()


def same_week_revenue_ratio(
    db: Session,
    tenant_id: str,
    store_id,
    biz_date: date,
    revenue: Decimal,
) -> tuple[Decimal | None, Decimal | None]:
    history = db.execute(
        text(
            """
            SELECT revenue
            FROM sales_daily
            WHERE tenant_id = :tenant_id
              AND store_id = :store_id
              AND biz_date IN (:d1, :d2, :d3, :d4)
              AND biz_date < :biz_date
            """
        ),
        {
            "tenant_id": tenant_id,
            "store_id": store_id,
            "biz_date": biz_date,
            "d1": biz_date - timedelta(days=7),
            "d2": biz_date - timedelta(days=14),
            "d3": biz_date - timedelta(days=21),
            "d4": biz_date - timedelta(days=28),
        },
    ).scalars().all()
    if len(history) < 2:
        return None, None
    baseline = sum(as_decimal(value) for value in history) / len(history)
    if baseline <= 0:
        return None, None
    return revenue / baseline, baseline


def previous_day_sales_drop(db: Session, tenant_id: str, store_id, biz_date: date) -> bool:
    previous = db.execute(
        text(
            """
            SELECT revenue
            FROM sales_daily
            WHERE tenant_id = :tenant_id
              AND store_id = :store_id
              AND biz_date = :previous_date
            """
        ),
        {"tenant_id": tenant_id, "store_id": store_id, "previous_date": biz_date - timedelta(days=1)},
    ).scalar()
    if previous is None:
        return False
    ratio, _ = same_week_revenue_ratio(db, tenant_id, store_id, biz_date - timedelta(days=1), as_decimal(previous))
    return bool(ratio is not None and ratio < SALES_DROP_WARNING_RATIO)


def sales_drop_alert_exists_recently(db: Session, tenant_id: str, store_id) -> bool:
    return alert_exists_recently(db, tenant_id, store_id, "sales_drop")


def alert_exists_recently(db: Session, tenant_id: str, store_id, alert_type: str) -> bool:
    existed = db.execute(
        text(
            """
            SELECT 1
            FROM alerts a
            WHERE a.tenant_id = :tenant_id
              AND a.store_id = :store_id
              AND a.alert_type = :alert_type
              AND a.created_at >= NOW() - INTERVAL '24 hours'
            UNION ALL
            SELECT 1
            FROM alerts a
            JOIN tasks t ON t.source_type = 'alert'
                        AND t.source_id = a.id
                        AND t.tenant_id = a.tenant_id
            WHERE a.tenant_id = :tenant_id
              AND a.store_id = :store_id
              AND a.alert_type = :alert_type
              AND t.status NOT IN ('closed', 'archived')
            LIMIT 1
            """
        ),
        {"tenant_id": tenant_id, "store_id": store_id, "alert_type": alert_type},
    ).scalar()
    return bool(existed)


def insert_alert(
    db: Session,
    *,
    tenant_id: str,
    store_id,
    alert_type: str,
    level: str,
    title: str,
    summary: str,
    responsible_user_id,
) -> dict:
    return db.execute(
        text(
            """
            INSERT INTO alerts (
              tenant_id, store_id, alert_type, level, title, summary,
              status, responsible_user_id, due_at
            )
            VALUES (
              :tenant_id, :store_id, :alert_type, :level, :title, :summary,
              'open', :responsible_user_id, NOW() + INTERVAL '1 day'
            )
            RETURNING id, tenant_id, store_id, alert_type, level, title, summary,
                      status, responsible_user_id, due_at, created_at
            """
        ),
        {
            "tenant_id": tenant_id,
            "store_id": store_id,
            "alert_type": alert_type,
            "level": level,
            "title": title,
            "summary": summary,
            "responsible_user_id": responsible_user_id,
        },
    ).mappings().one()


def insert_alert_notification(db: Session, alert: dict) -> None:
    create_high_risk_notifications(
        db,
        str(alert["tenant_id"]),
        target_type="alert",
        target_id=alert["id"],
        store_id=alert.get("store_id"),
        title=build_alert_notification_title(alert),
        content=build_alert_notification_content(alert),
    )


def build_alert_notification_title(alert: dict) -> str:
    level_label = {"critical": "严重", "high": "高风险", "warning": "预警"}.get(str(alert.get("level") or ""), "预警")
    return f"{level_label}经营预警：{alert.get('title') or alert.get('alert_type') or alert.get('id')}"


def build_alert_notification_content(alert: dict) -> str:
    lines = [
        f"预警类型：{alert.get('alert_type') or 'unknown'}",
        f"风险等级：{alert.get('level') or 'warning'}",
        f"预警内容：{alert.get('summary') or ''}",
        "请门店负责人先核实现场情况；督导和总部运营需跟进处理进展，必要时转为任务闭环。",
    ]
    if alert.get("due_at"):
        lines.append(f"处理截止：{alert['due_at']}")
    return "\n".join(lines)


def insert_alert_audit_log(db: Session, alert: dict) -> None:
    db.execute(
        text(
            """
            INSERT INTO audit_logs (
              tenant_id, user_id, action, module, object_type, object_id, result, ip
            )
            VALUES (
              :tenant_id, NULL, 'ALERT_SALES_DROP_GENERATED', 'alerts', 'alert', :alert_id, 'success', NULL
            )
            """
        ),
        {"tenant_id": alert["tenant_id"], "alert_id": alert["id"]},
    )


def insert_local_alert_attribution_run(
    db: Session,
    tenant_id: str,
    alert_id,
    user_id: str | None,
    *,
    alert_type: str,
    title: str,
) -> None:
    db.execute(
        text(
            """
            INSERT INTO agent_runs (
              tenant_id, user_id, agent_name, task_type, model_used,
              input_tokens, output_tokens, cost, input_summary, output_summary, status
            )
            VALUES (
              :tenant_id, :user_id, 'community-alert-rules', 'alert_attribution',
              'foodops-local-rules-v1', 0, 0, 0,
              :input_summary, :output_summary, 'success'
            )
            """
        ),
        {
            "tenant_id": tenant_id,
            "user_id": user_id,
            "input_summary": f"alert_id={alert_id}; type={alert_type}",
            "output_summary": f"{title} 已由 Community 本地规则生成初步归因记录。",
        },
    )


def serialize_alert(alert: dict) -> dict:
    return {
        "id": str(alert["id"]),
        "tenant_id": str(alert["tenant_id"]),
        "store_id": str(alert["store_id"]) if alert["store_id"] else None,
        "alert_type": alert["alert_type"],
        "level": alert["level"],
        "title": alert["title"],
        "summary": alert["summary"],
        "status": alert["status"],
        "responsible_user_id": str(alert["responsible_user_id"]) if alert["responsible_user_id"] else None,
        "due_at": alert["due_at"].isoformat() if alert["due_at"] else None,
        "created_at": alert["created_at"].isoformat() if alert["created_at"] else None,
    }


def as_decimal(value) -> Decimal:
    if value is None:
        return Decimal("0")
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))
