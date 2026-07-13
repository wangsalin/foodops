from decimal import Decimal
from datetime import timedelta

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import current_tenant_id, scoped_store_condition, scoped_task_condition
from app.services.ai_runtime import sanitize_ai_output

router = APIRouter(prefix="/v1/dashboard", tags=["dashboard"])


def as_float(value) -> float:
    if value is None:
        return 0.0
    if isinstance(value, Decimal):
        return float(value)
    return float(value)


def as_int(value) -> int:
    return int(value or 0)


@router.get("/overview")
def dashboard_overview(request: Request, db: Session = Depends(get_db)) -> dict:
    tenant_id = current_tenant_id(request)
    store_scope_sql, store_scope_params = scoped_store_condition(request, "s")
    task_scope_sql, task_scope_params = scoped_task_condition(request, "t")
    latest_date = db.execute(
        text(
            f"""
            SELECT MAX(sd.biz_date)
            FROM sales_daily sd
            JOIN stores s ON s.id = sd.store_id
            WHERE sd.tenant_id = :tenant_id
              AND sd.biz_date <= CURRENT_DATE
              AND {store_scope_sql}
            """
        ),
        {"tenant_id": tenant_id, **store_scope_params},
    ).scalar()

    today_metrics = {"revenue": 0, "orders": 0, "avg_order": 0}
    previous_revenue = 0.0
    if latest_date:
        today_row = db.execute(
            text(
                f"""
                SELECT COALESCE(SUM(revenue), 0) AS revenue,
                       COALESCE(SUM(orders), 0) AS orders,
                       CASE WHEN COALESCE(SUM(orders), 0) > 0
                            THEN COALESCE(SUM(revenue), 0) / SUM(orders)
                            ELSE 0 END AS avg_order
                FROM sales_daily sd
                JOIN stores s ON s.id = sd.store_id
                WHERE sd.tenant_id = :tenant_id AND sd.biz_date = :biz_date
                  AND {store_scope_sql}
                """
            ),
            {"tenant_id": tenant_id, "biz_date": latest_date, **store_scope_params},
        ).mappings().one()
        today_metrics = {
            "revenue": as_float(today_row["revenue"]),
            "orders": as_int(today_row["orders"]),
            "avg_order": as_float(today_row["avg_order"]),
        }
        previous_revenue = as_float(
            db.execute(
                text(
                    f"""
                    SELECT COALESCE(SUM(revenue), 0)
                    FROM sales_daily sd
                    JOIN stores s ON s.id = sd.store_id
                    WHERE sd.tenant_id = :tenant_id
                      AND sd.biz_date = (
                        SELECT MAX(sd2.biz_date)
                        FROM sales_daily sd2
                        JOIN stores s ON s.id = sd2.store_id
                        WHERE sd2.tenant_id = :tenant_id
                          AND sd2.biz_date < :biz_date
                          AND {store_scope_sql}
                      )
                      AND {store_scope_sql}
                    """
                ),
                {"tenant_id": tenant_id, "biz_date": latest_date, **store_scope_params},
            ).scalar()
        )

    revenue_delta_pct = 0.0
    if previous_revenue > 0:
        revenue_delta_pct = round((today_metrics["revenue"] - previous_revenue) / previous_revenue * 100, 2)

    status_row = db.execute(
        text(
            f"""
            SELECT
              (SELECT COUNT(*)
               FROM alerts a
               JOIN stores s ON s.id = a.store_id
               WHERE a.tenant_id = :tenant_id AND a.status = 'open' AND {store_scope_sql}) AS open_alerts,
              (SELECT COUNT(*)
               FROM alerts a
               JOIN stores s ON s.id = a.store_id
               WHERE a.tenant_id = :tenant_id AND a.status = 'open' AND a.level IN ('critical', 'high') AND {store_scope_sql}) AS critical_alerts,
              (SELECT COUNT(*)
               FROM alerts a
               JOIN stores s ON s.id = a.store_id
               WHERE a.tenant_id = :tenant_id AND a.status = 'open' AND a.alert_type = 'inventory_risk' AND {store_scope_sql}) AS inventory_risk_alerts,
              (SELECT COUNT(*)
               FROM alerts a
               JOIN stores s ON s.id = a.store_id
               WHERE a.tenant_id = :tenant_id AND a.status = 'open' AND a.alert_type = 'bad_review' AND {store_scope_sql}) AS bad_review_alerts,
              (SELECT COUNT(*)
               FROM reviews r
               JOIN stores s ON s.id = r.store_id
               WHERE r.tenant_id = :tenant_id AND r.sentiment = 'negative' AND {store_scope_sql}) AS negative_reviews,
              (SELECT COUNT(*)
               FROM tasks t
               WHERE t.tenant_id = :tenant_id AND t.status NOT IN ('closed', 'archived') AND {task_scope_sql}) AS pending_tasks,
              (SELECT COUNT(*)
               FROM tasks t
               WHERE t.tenant_id = :tenant_id AND t.status IN ('closed', 'archived') AND {task_scope_sql}) AS closed_tasks,
              (SELECT COUNT(*) FROM import_jobs WHERE tenant_id = :tenant_id AND created_at::date = CURRENT_DATE) AS today_imports
            """
        ),
        {"tenant_id": tenant_id, **store_scope_params, **task_scope_params},
    ).mappings().one()

    ai_row = db.execute(
        text(
            """
            SELECT
              COALESCE(SUM(cost), 0) AS ai_cost,
              0 AS ai_reports,
              COUNT(*) FILTER (
                WHERE task_type = 'alert' AND status = 'success'
              ) AS ai_alerts
            FROM agent_runs
            WHERE tenant_id = :tenant_id
              AND created_at >= date_trunc('month', NOW())
            """
        ),
        {"tenant_id": tenant_id},
    ).mappings().one()
    ai_alerts = as_int(ai_row["ai_alerts"])
    ai_reports = as_int(ai_row["ai_reports"])
    saved_hours = round(((ai_alerts * 12) + (ai_reports * 15)) / 60, 1)

    return {
        "period": {"latest_sales_date": latest_date.isoformat() if latest_date else None},
        "metrics": {
            **today_metrics,
            "revenue_delta_pct": revenue_delta_pct,
            "open_alerts": as_int(status_row["open_alerts"]),
            "critical_alerts": as_int(status_row["critical_alerts"]),
            "inventory_risk_alerts": as_int(status_row["inventory_risk_alerts"]),
            "bad_review_alerts": as_int(status_row["bad_review_alerts"]),
            "negative_reviews": as_int(status_row["negative_reviews"]),
            "pending_tasks": as_int(status_row["pending_tasks"]),
            "closed_tasks": as_int(status_row["closed_tasks"]),
            "today_imports": as_int(status_row["today_imports"]),
            "ai_cost_month": as_float(ai_row["ai_cost"]),
            "ai_reports_month": ai_reports,
            "ai_alerts_month": ai_alerts,
            "saved_hours_month": saved_hours,
        },
        "summary": build_summary(today_metrics, as_int(status_row["open_alerts"]), as_int(status_row["pending_tasks"])),
    }


@router.get("/alerts")
def dashboard_alerts(request: Request, db: Session = Depends(get_db)) -> list[dict]:
    tenant_id = current_tenant_id(request)
    scope_sql, scope_params = scoped_store_condition(request, "s")
    rows = db.execute(
        text(
            f"""
            SELECT a.id, a.alert_type, a.level, a.title, a.summary, a.status, a.created_at,
                   s.name AS store_name,
                   u.name AS responsible_user_name
            FROM alerts a
            LEFT JOIN stores s ON s.id = a.store_id
            LEFT JOIN users u ON u.id = a.responsible_user_id
            WHERE a.tenant_id = :tenant_id
              AND {scope_sql}
            ORDER BY a.created_at DESC
            LIMIT 10
            """
        ),
        {"tenant_id": tenant_id, **scope_params},
    ).mappings().all()
    return [dict(row) for row in rows]


@router.get("/filters")
def dashboard_filters(request: Request, db: Session = Depends(get_db)) -> dict:
    tenant_id = current_tenant_id(request)
    scope_sql, scope_params = scoped_store_condition(request, "s")
    store_rows = db.execute(
        text(
            f"""
            SELECT s.id, s.code, s.name, s.region, s.status
            FROM stores s
            WHERE s.tenant_id = :tenant_id
              AND {scope_sql}
            ORDER BY s.status ASC, s.name ASC
            """
        ),
        {"tenant_id": tenant_id, **scope_params},
    ).mappings().all()
    channel_rows = db.execute(
        text(
            f"""
            SELECT ch.channel, COUNT(*) AS usage_count
            FROM sales_daily sd
            JOIN stores s ON s.id = sd.store_id
            CROSS JOIN LATERAL jsonb_object_keys(COALESCE(sd.channel_json, '{{}}'::jsonb)) AS ch(channel)
            WHERE sd.tenant_id = :tenant_id
              AND {scope_sql}
            GROUP BY ch.channel
            ORDER BY usage_count DESC, ch.channel ASC
            """
        ),
        {"tenant_id": tenant_id, **scope_params},
    ).mappings().all()
    return {
        "stores": [dict(row) for row in store_rows],
        "channels": [dict(row) for row in channel_rows],
        "day_options": [7, 14, 30, 60],
    }


@router.get("/trends")
def dashboard_trends(
    request: Request,
    db: Session = Depends(get_db),
    days: int = Query(default=14, ge=7, le=60),
    store_id: str | None = Query(default=None),
    channel: str | None = Query(default=None),
) -> dict:
    tenant_id = current_tenant_id(request)
    store_scope_sql, store_scope_params = scoped_store_condition(request, "s")
    task_scope_sql, task_scope_params = scoped_task_condition(request, "t")
    params = {
        "tenant_id": tenant_id,
        "store_id": store_id or "",
        "channel": channel or "",
        **store_scope_params,
        **task_scope_params,
    }
    store_filter_sql = "(:store_id = '' OR s.id::text = :store_id)"
    latest_date = db.execute(
        text(
            f"""
            SELECT MAX(sd.biz_date)
            FROM sales_daily sd
            JOIN stores s ON s.id = sd.store_id
            WHERE sd.tenant_id = :tenant_id
              AND sd.biz_date <= CURRENT_DATE
              AND {store_scope_sql}
              AND {store_filter_sql}
            """
        ),
        params,
    ).scalar()
    if not latest_date:
        return {
            "period": {"start_date": None, "end_date": None, "days": days},
            "filters": {"store_id": store_id, "channel": channel},
            "points": [],
            "totals": {"revenue": 0, "orders": 0, "alerts": 0, "tasks": 0},
        }

    start_date = latest_date - timedelta(days=days - 1)
    trend_params = {**params, "start_date": start_date, "end_date": latest_date}
    rows = db.execute(
        text(
            f"""
            WITH date_spine AS (
              SELECT generate_series(CAST(:start_date AS date), CAST(:end_date AS date), interval '1 day')::date AS biz_date
            ),
            sales AS (
              SELECT sd.biz_date,
                     COALESCE(
                       SUM(
                         CASE
                           WHEN :channel = '' THEN COALESCE(sd.revenue, 0)
                           ELSE COALESCE(NULLIF(sd.channel_json ->> :channel, '')::numeric, 0)
                         END
                       ),
                       0
                     ) AS revenue,
                     COALESCE(SUM(sd.orders), 0) AS orders
              FROM sales_daily sd
              JOIN stores s ON s.id = sd.store_id
              WHERE sd.tenant_id = :tenant_id
                AND sd.biz_date BETWEEN :start_date AND :end_date
                AND {store_scope_sql}
                AND {store_filter_sql}
              GROUP BY sd.biz_date
            ),
            alert_counts AS (
              SELECT a.created_at::date AS biz_date,
                     COUNT(*) AS alerts,
                     COUNT(*) FILTER (WHERE a.level IN ('critical', 'high')) AS critical_alerts
              FROM alerts a
              JOIN stores s ON s.id = a.store_id
              WHERE a.tenant_id = :tenant_id
                AND a.created_at::date BETWEEN :start_date AND :end_date
                AND {store_scope_sql}
                AND {store_filter_sql}
              GROUP BY a.created_at::date
            ),
            task_counts AS (
              SELECT t.created_at::date AS biz_date,
                     COUNT(*) AS tasks,
                     COUNT(*) FILTER (WHERE t.status IN ('closed', 'archived')) AS closed_tasks
              FROM tasks t
              LEFT JOIN alerts ta ON t.source_type = 'alert'
                                  AND t.source_id = ta.id
                                  AND t.tenant_id = ta.tenant_id
              WHERE t.tenant_id = :tenant_id
                AND t.created_at::date BETWEEN :start_date AND :end_date
                AND {task_scope_sql}
                AND (:store_id = '' OR ta.store_id::text = :store_id)
              GROUP BY t.created_at::date
            )
            SELECT ds.biz_date,
                   COALESCE(sales.revenue, 0) AS revenue,
                   COALESCE(sales.orders, 0) AS orders,
                   CASE WHEN COALESCE(sales.orders, 0) > 0
                        THEN COALESCE(sales.revenue, 0) / sales.orders
                        ELSE 0 END AS avg_order,
                   COALESCE(alert_counts.alerts, 0) AS alerts,
                   COALESCE(alert_counts.critical_alerts, 0) AS critical_alerts,
                   COALESCE(task_counts.tasks, 0) AS tasks,
                   COALESCE(task_counts.closed_tasks, 0) AS closed_tasks
            FROM date_spine ds
            LEFT JOIN sales ON sales.biz_date = ds.biz_date
            LEFT JOIN alert_counts ON alert_counts.biz_date = ds.biz_date
            LEFT JOIN task_counts ON task_counts.biz_date = ds.biz_date
            ORDER BY ds.biz_date ASC
            """
        ),
        trend_params,
    ).mappings().all()
    points = [
        {
            "biz_date": row["biz_date"].isoformat(),
            "revenue": as_float(row["revenue"]),
            "orders": as_int(row["orders"]),
            "avg_order": as_float(row["avg_order"]),
            "alerts": as_int(row["alerts"]),
            "critical_alerts": as_int(row["critical_alerts"]),
            "tasks": as_int(row["tasks"]),
            "closed_tasks": as_int(row["closed_tasks"]),
        }
        for row in rows
    ]
    return {
        "period": {"start_date": start_date.isoformat(), "end_date": latest_date.isoformat(), "days": days},
        "filters": {"store_id": store_id, "channel": channel},
        "points": points,
        "totals": {
            "revenue": round(sum(point["revenue"] for point in points), 2),
            "orders": sum(point["orders"] for point in points),
            "alerts": sum(point["alerts"] for point in points),
            "tasks": sum(point["tasks"] for point in points),
        },
    }


@router.get("/risk-stores")
def dashboard_risk_stores(request: Request, db: Session = Depends(get_db)) -> list[dict]:
    tenant_id = current_tenant_id(request)
    scope_sql, scope_params = scoped_store_condition(request, "s")
    rows = db.execute(
        text(
            f"""
            SELECT s.id, s.name AS store_name,
                   COUNT(a.id) AS alert_count,
                   MAX(a.level) AS max_level,
                   MAX(a.summary) AS latest_reason
            FROM alerts a
            JOIN stores s ON s.id = a.store_id
            WHERE a.tenant_id = :tenant_id AND a.status = 'open'
              AND {scope_sql}
            GROUP BY s.id, s.name
            ORDER BY COUNT(a.id) DESC, s.name ASC
            LIMIT 5
            """
        ),
        {"tenant_id": tenant_id, **scope_params},
    ).mappings().all()
    return [dict(row) for row in rows]


@router.get("/stores")
def dashboard_stores(request: Request, db: Session = Depends(get_db)) -> dict:
    tenant_id = current_tenant_id(request)
    scope_sql, scope_params = scoped_store_condition(request, "s")
    rows = db.execute(
        text(
            f"""
            WITH scoped_stores AS (
              SELECT s.id, s.code, s.name, s.store_type, s.region, s.status, s.opened_at
              FROM stores s
              WHERE s.tenant_id = :tenant_id
                AND {scope_sql}
            ),
            latest_sales AS (
              SELECT DISTINCT ON (sd.store_id)
                     sd.store_id, sd.biz_date, sd.revenue, sd.orders, sd.avg_order
              FROM sales_daily sd
              JOIN scoped_stores ss ON ss.id = sd.store_id
              WHERE sd.tenant_id = :tenant_id
                AND sd.biz_date <= CURRENT_DATE
              ORDER BY sd.store_id, sd.biz_date DESC
            ),
            previous_sales AS (
              SELECT DISTINCT ON (sd.store_id)
                     sd.store_id, sd.revenue
              FROM sales_daily sd
              JOIN latest_sales ls ON ls.store_id = sd.store_id
              WHERE sd.tenant_id = :tenant_id
                AND sd.biz_date < ls.biz_date
                AND sd.biz_date <= CURRENT_DATE
              ORDER BY sd.store_id, sd.biz_date DESC
            ),
            alert_counts AS (
              SELECT a.store_id,
                     COUNT(*) FILTER (WHERE a.status = 'open') AS open_alerts,
                     COUNT(*) FILTER (WHERE a.status = 'open' AND a.level IN ('critical', 'high')) AS critical_alerts,
                     COUNT(*) FILTER (WHERE a.status = 'open' AND a.alert_type = 'inventory_risk') AS inventory_risk_alerts,
                     COUNT(*) FILTER (WHERE a.status = 'open' AND a.alert_type = 'bad_review') AS bad_review_alerts
              FROM alerts a
              JOIN scoped_stores ss ON ss.id = a.store_id
              WHERE a.tenant_id = :tenant_id
              GROUP BY a.store_id
            ),
            task_counts AS (
              SELECT a.store_id,
                     COUNT(*) FILTER (WHERE t.status NOT IN ('closed', 'archived')) AS pending_tasks
              FROM tasks t
              JOIN alerts a ON t.source_type = 'alert'
                           AND t.source_id = a.id
                           AND t.tenant_id = a.tenant_id
              JOIN scoped_stores ss ON ss.id = a.store_id
              WHERE t.tenant_id = :tenant_id
              GROUP BY a.store_id
            ),
            review_counts AS (
              SELECT r.store_id,
                     COUNT(*) AS total_reviews,
                     COUNT(*) FILTER (WHERE r.sentiment = 'negative') AS negative_reviews,
                     COUNT(*) FILTER (WHERE r.category = 'food_safety') AS food_safety_reviews,
                     COALESCE(AVG(r.rating), 0) AS avg_rating
              FROM reviews r
              JOIN scoped_stores ss ON ss.id = r.store_id
              WHERE r.tenant_id = :tenant_id
              GROUP BY r.store_id
            ),
            latest_inventory AS (
              SELECT DISTINCT ON (inv.store_id, inv.material_id)
                     inv.store_id, inv.material_id, inv.closing_stock, m.safety_stock
              FROM inventory_snapshots inv
              JOIN materials m ON m.id = inv.material_id
              JOIN scoped_stores ss ON ss.id = inv.store_id
              WHERE inv.tenant_id = :tenant_id
                AND inv.biz_date <= CURRENT_DATE
              ORDER BY inv.store_id, inv.material_id, inv.biz_date DESC
            ),
            inventory_counts AS (
              SELECT li.store_id,
                     COUNT(*) FILTER (WHERE li.closing_stock = 0) AS inventory_critical_items,
                     COUNT(*) FILTER (
                       WHERE li.closing_stock > 0
                         AND li.safety_stock IS NOT NULL
                         AND li.closing_stock <= li.safety_stock
                     ) AS inventory_warning_items
              FROM latest_inventory li
              GROUP BY li.store_id
            )
            SELECT ss.id, ss.code, ss.name, ss.store_type, ss.region, ss.status, ss.opened_at,
                   ls.biz_date AS latest_sales_date,
                   COALESCE(ls.revenue, 0) AS latest_revenue,
                   COALESCE(ls.orders, 0) AS latest_orders,
                   COALESCE(ls.avg_order, 0) AS latest_avg_order,
                   COALESCE(ps.revenue, 0) AS previous_revenue,
                   COALESCE(ac.open_alerts, 0) AS open_alerts,
                   COALESCE(ac.critical_alerts, 0) AS critical_alerts,
                   COALESCE(ac.inventory_risk_alerts, 0) AS inventory_risk_alerts,
                   COALESCE(ac.bad_review_alerts, 0) AS bad_review_alerts,
                   COALESCE(tc.pending_tasks, 0) AS pending_tasks,
                   COALESCE(rc.total_reviews, 0) AS total_reviews,
                   COALESCE(rc.negative_reviews, 0) AS negative_reviews,
                   COALESCE(rc.food_safety_reviews, 0) AS food_safety_reviews,
                   COALESCE(rc.avg_rating, 0) AS avg_rating,
                   COALESCE(ic.inventory_critical_items, 0) AS inventory_critical_items,
                   COALESCE(ic.inventory_warning_items, 0) AS inventory_warning_items
            FROM scoped_stores ss
            LEFT JOIN latest_sales ls ON ls.store_id = ss.id
            LEFT JOIN previous_sales ps ON ps.store_id = ss.id
            LEFT JOIN alert_counts ac ON ac.store_id = ss.id
            LEFT JOIN task_counts tc ON tc.store_id = ss.id
            LEFT JOIN review_counts rc ON rc.store_id = ss.id
            LEFT JOIN inventory_counts ic ON ic.store_id = ss.id
            ORDER BY COALESCE(ac.open_alerts, 0) DESC,
                     COALESCE(ac.critical_alerts, 0) DESC,
                     COALESCE(ls.revenue, 0) DESC,
                     ss.name ASC
            """
        ),
        {"tenant_id": tenant_id, **scope_params},
    ).mappings().all()
    items = []
    for row in rows:
        latest_revenue = as_float(row["latest_revenue"])
        previous_revenue = as_float(row["previous_revenue"])
        revenue_delta_pct = 0.0
        if previous_revenue > 0:
            revenue_delta_pct = round((latest_revenue - previous_revenue) / previous_revenue * 100, 2)
        risk_score = min(
            100,
            as_int(row["critical_alerts"]) * 35
            + as_int(row["open_alerts"]) * 12
            + as_int(row["pending_tasks"]) * 8
            + as_int(row["inventory_critical_items"]) * 15
            + as_int(row["bad_review_alerts"]) * 15
            + as_int(row["negative_reviews"]) * 8,
        )
        if risk_score >= 60 or as_int(row["critical_alerts"]) > 0:
            risk_level = "critical"
        elif risk_score >= 25:
            risk_level = "warning"
        else:
            risk_level = "normal"
        items.append(
            {
                "id": row["id"],
                "code": row["code"],
                "name": row["name"],
                "store_type": row["store_type"],
                "region": row["region"],
                "status": row["status"],
                "opened_at": row["opened_at"],
                "latest_sales_date": row["latest_sales_date"],
                "latest_revenue": latest_revenue,
                "latest_orders": as_int(row["latest_orders"]),
                "latest_avg_order": as_float(row["latest_avg_order"]),
                "revenue_delta_pct": revenue_delta_pct,
                "open_alerts": as_int(row["open_alerts"]),
                "critical_alerts": as_int(row["critical_alerts"]),
                "inventory_risk_alerts": as_int(row["inventory_risk_alerts"]),
                "bad_review_alerts": as_int(row["bad_review_alerts"]),
                "pending_tasks": as_int(row["pending_tasks"]),
                "total_reviews": as_int(row["total_reviews"]),
                "negative_reviews": as_int(row["negative_reviews"]),
                "food_safety_reviews": as_int(row["food_safety_reviews"]),
                "avg_rating": round(as_float(row["avg_rating"]), 2),
                "inventory_critical_items": as_int(row["inventory_critical_items"]),
                "inventory_warning_items": as_int(row["inventory_warning_items"]),
                "risk_score": risk_score,
                "risk_level": risk_level,
            }
        )
    latest_revenue_total = round(sum(item["latest_revenue"] for item in items), 2)
    return {
        "summary": {
            "total_stores": len(items),
            "active_stores": sum(1 for item in items if item["status"] == "active"),
            "latest_revenue": latest_revenue_total,
            "open_alerts": sum(item["open_alerts"] for item in items),
            "critical_alerts": sum(item["critical_alerts"] for item in items),
            "pending_tasks": sum(item["pending_tasks"] for item in items),
            "inventory_risk_alerts": sum(item["inventory_risk_alerts"] for item in items),
            "bad_review_alerts": sum(item["bad_review_alerts"] for item in items),
            "negative_reviews": sum(item["negative_reviews"] for item in items),
            "risk_stores": sum(1 for item in items if item["risk_level"] != "normal"),
        },
        "items": items,
    }


@router.get("/channels")
def dashboard_channels(request: Request, db: Session = Depends(get_db)) -> list[dict]:
    tenant_id = current_tenant_id(request)
    scope_sql, scope_params = scoped_store_condition(request, "s")
    latest_date = db.execute(
        text(
            f"""
            SELECT MAX(sd.biz_date)
            FROM sales_daily sd
            JOIN stores s ON s.id = sd.store_id
            WHERE sd.tenant_id = :tenant_id
              AND sd.biz_date <= CURRENT_DATE
              AND {scope_sql}
            """
        ),
        {"tenant_id": tenant_id, **scope_params},
    ).scalar()
    if not latest_date:
        return []
    rows = db.execute(
        text(
            f"""
            SELECT ch.key AS channel, COALESCE(SUM((ch.value)::numeric), 0) AS revenue
            FROM sales_daily sd
            JOIN stores s ON s.id = sd.store_id
            CROSS JOIN LATERAL jsonb_each_text(COALESCE(sd.channel_json, '{{}}'::jsonb)) AS ch(key, value)
            WHERE sd.tenant_id = :tenant_id AND sd.biz_date = :biz_date
              AND {scope_sql}
            GROUP BY ch.key
            ORDER BY revenue DESC
            """
        ),
        {"tenant_id": tenant_id, "biz_date": latest_date, **scope_params},
    ).mappings().all()
    total = sum(as_float(row["revenue"]) for row in rows)
    return [
        {
            "channel": row["channel"],
            "revenue": as_float(row["revenue"]),
            "percent": round(as_float(row["revenue"]) / total * 100, 1) if total else 0,
        }
        for row in rows
    ]


@router.get("/channel-trends")
def dashboard_channel_trends(
    request: Request,
    days: int = Query(default=14, ge=7, le=60),
    db: Session = Depends(get_db),
) -> dict:
    tenant_id = current_tenant_id(request)
    scope_sql, scope_params = scoped_store_condition(request, "s")
    latest_date = db.execute(
        text(
            f"""
            SELECT MAX(sd.biz_date)
            FROM sales_daily sd
            JOIN stores s ON s.id = sd.store_id
            WHERE sd.tenant_id = :tenant_id
              AND sd.biz_date <= CURRENT_DATE
              AND {scope_sql}
            """
        ),
        {"tenant_id": tenant_id, **scope_params},
    ).scalar()
    if not latest_date:
        return {
            "period": {"start_date": None, "end_date": None, "days": days},
            "totals": {"revenue": 0, "orders": 0},
            "channels": [],
            "points": [],
            "order_method": "estimated_by_revenue_share",
        }

    start_date = latest_date - timedelta(days=days - 1)
    rows = db.execute(
        text(
            f"""
            WITH base AS (
              SELECT sd.biz_date,
                     COALESCE(sd.revenue, 0) AS revenue,
                     COALESCE(sd.orders, 0) AS orders,
                     COALESCE(sd.channel_json, '{{}}'::jsonb) AS channel_json
              FROM sales_daily sd
              JOIN stores s ON s.id = sd.store_id
              WHERE sd.tenant_id = :tenant_id
                AND sd.biz_date BETWEEN :start_date AND :latest_date
                AND {scope_sql}
            ),
            channel_rows AS (
              SELECT b.biz_date,
                     ch.key AS channel,
                     COALESCE(SUM((ch.value)::numeric), 0) AS revenue
              FROM base b
              CROSS JOIN LATERAL jsonb_each_text(b.channel_json) AS ch(key, value)
              GROUP BY b.biz_date, ch.key
            ),
            day_totals AS (
              SELECT biz_date,
                     COALESCE(SUM(revenue), 0) AS total_revenue,
                     COALESCE(SUM(orders), 0) AS total_orders
              FROM base
              GROUP BY biz_date
            )
            SELECT cr.biz_date,
                   cr.channel,
                   cr.revenue,
                   dt.total_revenue,
                   dt.total_orders,
                   CASE WHEN dt.total_revenue > 0
                        THEN dt.total_orders * cr.revenue / dt.total_revenue
                        ELSE 0 END AS estimated_orders
            FROM channel_rows cr
            JOIN day_totals dt ON dt.biz_date = cr.biz_date
            ORDER BY cr.biz_date ASC, cr.revenue DESC, cr.channel ASC
            """
        ),
        {"tenant_id": tenant_id, "start_date": start_date, "latest_date": latest_date, **scope_params},
    ).mappings().all()

    point_map: dict[str, dict] = {}
    channel_map: dict[str, dict] = {}
    total_revenue = 0.0
    total_orders = 0.0

    for row in rows:
        biz_date = row["biz_date"].isoformat()
        revenue = as_float(row["revenue"])
        estimated_orders = as_float(row["estimated_orders"])
        day_revenue = as_float(row["total_revenue"])
        day_orders = as_float(row["total_orders"])
        channel = row["channel"]

        if biz_date not in point_map:
            point_map[biz_date] = {
                "biz_date": biz_date,
                "total_revenue": day_revenue,
                "total_orders": round(day_orders),
                "channels": {},
            }
            total_revenue += day_revenue
            total_orders += day_orders

        point_map[biz_date]["channels"][channel] = {
            "revenue": revenue,
            "orders": round(estimated_orders),
        }

        if channel not in channel_map:
            channel_map[channel] = {
                "channel": channel,
                "revenue": 0.0,
                "orders": 0.0,
                "days_with_data": 0,
                "latest_revenue": 0.0,
                "previous_revenue": 0.0,
            }
        item = channel_map[channel]
        item["revenue"] += revenue
        item["orders"] += estimated_orders
        item["days_with_data"] += 1
        if row["biz_date"] == latest_date:
            item["latest_revenue"] = revenue
        if row["biz_date"] == latest_date - timedelta(days=1):
            item["previous_revenue"] = revenue

    channels = []
    for item in channel_map.values():
        revenue = as_float(item["revenue"])
        orders = as_float(item["orders"])
        previous = as_float(item["previous_revenue"])
        latest = as_float(item["latest_revenue"])
        trend_pct = round((latest - previous) / previous * 100, 1) if previous > 0 else None
        channels.append(
            {
                "channel": item["channel"],
                "revenue": round(revenue, 2),
                "percent": round(revenue / total_revenue * 100, 1) if total_revenue else 0,
                "orders": round(orders),
                "avg_order": round(revenue / orders, 2) if orders else 0,
                "days_with_data": item["days_with_data"],
                "latest_revenue": round(latest, 2),
                "previous_revenue": round(previous, 2),
                "trend_pct": trend_pct,
            }
        )

    channels.sort(key=lambda item: item["revenue"], reverse=True)
    return {
        "period": {
            "start_date": start_date.isoformat(),
            "end_date": latest_date.isoformat(),
            "days": days,
        },
        "totals": {"revenue": round(total_revenue, 2), "orders": round(total_orders)},
        "channels": channels,
        "points": list(point_map.values()),
        "order_method": "estimated_by_revenue_share",
    }


@router.get("/products")
def dashboard_products(
    request: Request,
    db: Session = Depends(get_db),
    store_id: str | None = Query(default=None),
) -> list[dict]:
    tenant_id = current_tenant_id(request)
    scope_sql, scope_params = scoped_store_condition(request, "s")
    filter_scope_sql, _ = scoped_store_condition(request, "sf")
    rows = db.execute(
        text(
            f"""
            SELECT p.id, p.sku, p.name, p.category, p.price, p.cost, p.margin_rate,
                   COALESCE(SUM(sp.qty), 0) AS qty,
                   COALESCE(SUM(sp.revenue), 0) AS revenue,
                   COALESCE(SUM(sp.margin), 0) AS margin
            FROM products p
            LEFT JOIN sales_product_daily sp ON sp.product_id = p.id
              AND sp.tenant_id = :tenant_id
              AND (:store_id = '' OR sp.store_id::text = :store_id)
            LEFT JOIN stores s ON s.id = sp.store_id
            WHERE p.tenant_id = :tenant_id
              AND (sp.id IS NULL OR {scope_sql})
              AND (
                :store_id = ''
                OR EXISTS (
                  SELECT 1
                  FROM stores sf
                  WHERE sf.id::text = :store_id
                    AND sf.tenant_id = :tenant_id
                    AND {filter_scope_sql}
                )
              )
            GROUP BY p.id, p.sku, p.name, p.category, p.price, p.cost, p.margin_rate
            ORDER BY revenue DESC, p.sku ASC
            LIMIT 20
            """
        ),
        {"tenant_id": tenant_id, "store_id": store_id or "", **scope_params},
    ).mappings().all()
    return [dict(row) for row in rows]


@router.get("/inventory-risks")
def dashboard_inventory_risks(
    request: Request,
    db: Session = Depends(get_db),
    store_id: str | None = Query(default=None),
) -> dict:
    tenant_id = current_tenant_id(request)
    scope_sql, scope_params = scoped_store_condition(request, "s")
    rows = db.execute(
        text(
            f"""
            SELECT inv.id, inv.biz_date, inv.inbound_qty, inv.usage_qty, inv.closing_stock,
                   s.name AS store_name,
                   m.material_code, m.name AS material_name, m.unit, m.safety_stock,
                   CASE
                     WHEN inv.closing_stock = 0 THEN 'critical'
                     WHEN m.safety_stock IS NOT NULL AND inv.closing_stock <= m.safety_stock THEN 'warning'
                     ELSE 'normal'
                   END AS risk_level
            FROM inventory_snapshots inv
            JOIN stores s ON s.id = inv.store_id
            JOIN materials m ON m.id = inv.material_id
            WHERE inv.tenant_id = :tenant_id
              AND {scope_sql}
              AND (:store_id = '' OR s.id::text = :store_id)
            ORDER BY
              CASE
                WHEN inv.closing_stock = 0 THEN 0
                WHEN m.safety_stock IS NOT NULL AND inv.closing_stock <= m.safety_stock THEN 1
                ELSE 2
              END,
              inv.biz_date DESC,
              s.name ASC,
              m.material_code ASC
            LIMIT 50
            """
        ),
        {"tenant_id": tenant_id, "store_id": store_id or "", **scope_params},
    ).mappings().all()
    serialized = [dict(row) for row in rows]
    return {
        "summary": {
            "total_material_snapshots": len(serialized),
            "critical": sum(1 for row in serialized if row["risk_level"] == "critical"),
            "warning": sum(1 for row in serialized if row["risk_level"] == "warning"),
        },
        "items": serialized,
    }


@router.get("/reviews")
def dashboard_reviews(
    request: Request,
    db: Session = Depends(get_db),
    store_id: str | None = Query(default=None),
) -> dict:
    tenant_id = current_tenant_id(request)
    scope_sql, scope_params = scoped_store_condition(request, "s")
    summary = db.execute(
        text(
            f"""
            SELECT COUNT(*) AS total_reviews,
                   COUNT(*) FILTER (WHERE r.sentiment = 'negative') AS negative_reviews,
                   COUNT(*) FILTER (WHERE r.category = 'food_safety') AS food_safety_reviews,
                   COALESCE(AVG(r.rating), 0) AS avg_rating
            FROM reviews r
            JOIN stores s ON s.id = r.store_id
            WHERE r.tenant_id = :tenant_id
              AND {scope_sql}
              AND (:store_id = '' OR s.id::text = :store_id)
            """
        ),
        {"tenant_id": tenant_id, "store_id": store_id or "", **scope_params},
    ).mappings().one()
    category_rows = db.execute(
        text(
            f"""
            SELECT COALESCE(r.category, 'unclassified') AS category,
                   COUNT(*) AS count
            FROM reviews r
            JOIN stores s ON s.id = r.store_id
            WHERE r.tenant_id = :tenant_id
              AND r.sentiment = 'negative'
              AND {scope_sql}
              AND (:store_id = '' OR s.id::text = :store_id)
            GROUP BY COALESCE(r.category, 'unclassified')
            ORDER BY count DESC, category ASC
            """
        ),
        {"tenant_id": tenant_id, "store_id": store_id or "", **scope_params},
    ).mappings().all()
    latest_rows = db.execute(
        text(
            f"""
            SELECT r.id, r.created_at, r.platform, r.rating, r.content,
                   r.replied, r.sentiment, r.category,
                   s.name AS store_name
            FROM reviews r
            JOIN stores s ON s.id = r.store_id
            WHERE r.tenant_id = :tenant_id
              AND {scope_sql}
              AND (:store_id = '' OR s.id::text = :store_id)
            ORDER BY r.created_at DESC
            LIMIT 50
            """
        ),
        {"tenant_id": tenant_id, "store_id": store_id or "", **scope_params},
    ).mappings().all()
    return {
        "summary": {
            "total_reviews": as_int(summary["total_reviews"]),
            "negative_reviews": as_int(summary["negative_reviews"]),
            "food_safety_reviews": as_int(summary["food_safety_reviews"]),
            "avg_rating": as_float(summary["avg_rating"]),
        },
        "categories": [dict(row) for row in category_rows],
        "items": [dict(row) for row in latest_rows],
    }


@router.get("/screen")
def dashboard_screen(request: Request, db: Session = Depends(get_db)) -> dict:
    tenant_id = current_tenant_id(request)
    store_scope_sql, store_scope_params = scoped_store_condition(request, "s")
    task_scope_sql, task_scope_params = scoped_task_condition(request, "t")
    latest_date = db.execute(
        text(
            f"""
            SELECT MAX(sd.biz_date)
            FROM sales_daily sd
            JOIN stores s ON s.id = sd.store_id
            WHERE sd.tenant_id = :tenant_id
              AND sd.biz_date <= CURRENT_DATE
              AND {store_scope_sql}
            """
        ),
        {"tenant_id": tenant_id, **store_scope_params},
    ).scalar()

    overview = build_screen_overview(db, tenant_id, latest_date, store_scope_sql, store_scope_params, task_scope_sql, task_scope_params)
    regions = build_screen_regions(db, tenant_id, latest_date, store_scope_sql, store_scope_params)
    trends = build_screen_trends(db, tenant_id, latest_date, store_scope_sql, store_scope_params)
    channels = build_screen_channels(db, tenant_id, latest_date, store_scope_sql, store_scope_params)
    risk_stores = build_screen_risk_stores(db, tenant_id, latest_date, store_scope_sql, store_scope_params)
    tasks = build_screen_tasks(db, tenant_id, task_scope_sql, task_scope_params)
    ai_summary = latest_screen_ai_summary(db, tenant_id) or build_screen_summary(overview, risk_stores, tasks)

    return {
        "period": {
            "latest_sales_date": latest_date.isoformat() if latest_date else None,
            "trend_days": 14,
        },
        "overview": overview,
        "regions": regions,
        "trends": trends,
        "channels": channels,
        "risk_stores": risk_stores,
        "tasks": tasks,
        "ai_summary": ai_summary,
        "refresh_interval_seconds": 60,
        "scope_note": "FoodOps V1 local data only",
    }


def build_screen_overview(
    db: Session,
    tenant_id: str,
    latest_date,
    store_scope_sql: str,
    store_scope_params: dict,
    task_scope_sql: str,
    task_scope_params: dict,
) -> dict:
    if latest_date:
        sales = db.execute(
            text(
                f"""
                SELECT COALESCE(SUM(sd.revenue), 0) AS revenue,
                       COALESCE(SUM(sd.orders), 0) AS orders,
                       CASE WHEN COALESCE(SUM(sd.orders), 0) > 0
                            THEN COALESCE(SUM(sd.revenue), 0) / SUM(sd.orders)
                            ELSE 0 END AS avg_order
                FROM sales_daily sd
                JOIN stores s ON s.id = sd.store_id
                WHERE sd.tenant_id = :tenant_id
                  AND sd.biz_date = :latest_date
                  AND {store_scope_sql}
                """
            ),
            {"tenant_id": tenant_id, "latest_date": latest_date, **store_scope_params},
        ).mappings().one()
        previous_revenue = db.execute(
            text(
                f"""
                SELECT COALESCE(SUM(sd.revenue), 0)
                FROM sales_daily sd
                JOIN stores s ON s.id = sd.store_id
                WHERE sd.tenant_id = :tenant_id
                  AND sd.biz_date = (
                    SELECT MAX(sd2.biz_date)
                    FROM sales_daily sd2
                    JOIN stores s ON s.id = sd2.store_id
                    WHERE sd2.tenant_id = :tenant_id
                      AND sd2.biz_date < :latest_date
                      AND {store_scope_sql}
                  )
                  AND {store_scope_sql}
                """
            ),
            {"tenant_id": tenant_id, "latest_date": latest_date, **store_scope_params},
        ).scalar()
    else:
        sales = {"revenue": 0, "orders": 0, "avg_order": 0}
        previous_revenue = 0

    status = db.execute(
        text(
            f"""
            SELECT
              (SELECT COUNT(*)
               FROM stores s
               WHERE s.tenant_id = :tenant_id AND s.status = 'active' AND {store_scope_sql}) AS active_stores,
              (SELECT COUNT(*)
               FROM stores s
               WHERE s.tenant_id = :tenant_id AND {store_scope_sql}) AS total_stores,
              (SELECT COUNT(*)
               FROM alerts a
               JOIN stores s ON s.id = a.store_id
               WHERE a.tenant_id = :tenant_id AND a.status = 'open' AND {store_scope_sql}) AS open_alerts,
              (SELECT COUNT(*)
               FROM alerts a
               JOIN stores s ON s.id = a.store_id
               WHERE a.tenant_id = :tenant_id AND a.status = 'open' AND a.level IN ('critical', 'high') AND {store_scope_sql}) AS critical_alerts,
              (SELECT COUNT(*)
               FROM reviews r
               JOIN stores s ON s.id = r.store_id
               WHERE r.tenant_id = :tenant_id AND r.sentiment = 'negative' AND {store_scope_sql}) AS negative_reviews,
              (SELECT COUNT(*)
               FROM tasks t
               WHERE t.tenant_id = :tenant_id AND t.status NOT IN ('closed', 'archived') AND {task_scope_sql}) AS pending_tasks,
              (SELECT COUNT(*)
               FROM tasks t
               WHERE t.tenant_id = :tenant_id AND t.status IN ('closed', 'archived') AND {task_scope_sql}) AS closed_tasks
            """
        ),
        {"tenant_id": tenant_id, **store_scope_params, **task_scope_params},
    ).mappings().one()
    revenue = as_float(sales["revenue"])
    previous = as_float(previous_revenue)
    return {
        "revenue": round(revenue, 2),
        "orders": as_int(sales["orders"]),
        "avg_order": round(as_float(sales["avg_order"]), 2),
        "revenue_delta_pct": round((revenue - previous) / previous * 100, 1) if previous > 0 else 0,
        "active_stores": as_int(status["active_stores"]),
        "total_stores": as_int(status["total_stores"]),
        "open_alerts": as_int(status["open_alerts"]),
        "critical_alerts": as_int(status["critical_alerts"]),
        "negative_reviews": as_int(status["negative_reviews"]),
        "pending_tasks": as_int(status["pending_tasks"]),
        "closed_tasks": as_int(status["closed_tasks"]),
    }


def build_screen_regions(db: Session, tenant_id: str, latest_date, scope_sql: str, scope_params: dict) -> list[dict]:
    latest_filter = "AND sd.biz_date = :latest_date" if latest_date else ""
    rows = db.execute(
        text(
            f"""
            WITH scoped_stores AS (
              SELECT s.id, COALESCE(NULLIF(s.region, ''), '未分区') AS region, s.status
              FROM stores s
              WHERE s.tenant_id = :tenant_id AND {scope_sql}
            ),
            latest_sales AS (
              SELECT sd.store_id, COALESCE(SUM(sd.revenue), 0) AS revenue, COALESCE(SUM(sd.orders), 0) AS orders
              FROM sales_daily sd
              JOIN scoped_stores ss ON ss.id = sd.store_id
              WHERE sd.tenant_id = :tenant_id {latest_filter}
              GROUP BY sd.store_id
            ),
            alert_counts AS (
              SELECT a.store_id,
                     COUNT(*) FILTER (WHERE a.status = 'open') AS open_alerts,
                     COUNT(*) FILTER (WHERE a.status = 'open' AND a.level IN ('critical', 'high')) AS critical_alerts
              FROM alerts a
              JOIN scoped_stores ss ON ss.id = a.store_id
              WHERE a.tenant_id = :tenant_id
              GROUP BY a.store_id
            )
            SELECT ss.region,
                   COUNT(*) AS store_count,
                   COUNT(*) FILTER (WHERE ss.status = 'active') AS active_stores,
                   COALESCE(SUM(ls.revenue), 0) AS revenue,
                   COALESCE(SUM(ls.orders), 0) AS orders,
                   COALESCE(SUM(ac.open_alerts), 0) AS open_alerts,
                   COALESCE(SUM(ac.critical_alerts), 0) AS critical_alerts
            FROM scoped_stores ss
            LEFT JOIN latest_sales ls ON ls.store_id = ss.id
            LEFT JOIN alert_counts ac ON ac.store_id = ss.id
            GROUP BY ss.region
            ORDER BY revenue DESC, store_count DESC, ss.region ASC
            """
        ),
        {"tenant_id": tenant_id, "latest_date": latest_date, **scope_params},
    ).mappings().all()
    return [
        {
            "region": row["region"],
            "store_count": as_int(row["store_count"]),
            "active_stores": as_int(row["active_stores"]),
            "revenue": round(as_float(row["revenue"]), 2),
            "orders": as_int(row["orders"]),
            "open_alerts": as_int(row["open_alerts"]),
            "critical_alerts": as_int(row["critical_alerts"]),
        }
        for row in rows
    ]


def build_screen_trends(db: Session, tenant_id: str, latest_date, scope_sql: str, scope_params: dict) -> list[dict]:
    if not latest_date:
        return []
    start_date = latest_date - timedelta(days=13)
    rows = db.execute(
        text(
            f"""
            WITH date_spine AS (
              SELECT generate_series(CAST(:start_date AS date), CAST(:latest_date AS date), interval '1 day')::date AS biz_date
            ),
            sales AS (
              SELECT sd.biz_date,
                     COALESCE(SUM(sd.revenue), 0) AS revenue,
                     COALESCE(SUM(sd.orders), 0) AS orders
              FROM sales_daily sd
              JOIN stores s ON s.id = sd.store_id
              WHERE sd.tenant_id = :tenant_id
                AND sd.biz_date BETWEEN :start_date AND :latest_date
                AND {scope_sql}
              GROUP BY sd.biz_date
            ),
            alerts AS (
              SELECT a.created_at::date AS biz_date, COUNT(*) AS alerts
              FROM alerts a
              JOIN stores s ON s.id = a.store_id
              WHERE a.tenant_id = :tenant_id
                AND a.created_at::date BETWEEN :start_date AND :latest_date
                AND {scope_sql}
              GROUP BY a.created_at::date
            )
            SELECT ds.biz_date,
                   COALESCE(sales.revenue, 0) AS revenue,
                   COALESCE(sales.orders, 0) AS orders,
                   COALESCE(alerts.alerts, 0) AS alerts
            FROM date_spine ds
            LEFT JOIN sales ON sales.biz_date = ds.biz_date
            LEFT JOIN alerts ON alerts.biz_date = ds.biz_date
            ORDER BY ds.biz_date ASC
            """
        ),
        {"tenant_id": tenant_id, "start_date": start_date, "latest_date": latest_date, **scope_params},
    ).mappings().all()
    return [
        {
            "biz_date": row["biz_date"].isoformat(),
            "revenue": round(as_float(row["revenue"]), 2),
            "orders": as_int(row["orders"]),
            "alerts": as_int(row["alerts"]),
        }
        for row in rows
    ]


def build_screen_channels(db: Session, tenant_id: str, latest_date, scope_sql: str, scope_params: dict) -> list[dict]:
    if not latest_date:
        return []
    rows = db.execute(
        text(
            f"""
            SELECT ch.key AS channel, COALESCE(SUM((ch.value)::numeric), 0) AS revenue
            FROM sales_daily sd
            JOIN stores s ON s.id = sd.store_id
            CROSS JOIN LATERAL jsonb_each_text(COALESCE(sd.channel_json, '{{}}'::jsonb)) AS ch(key, value)
            WHERE sd.tenant_id = :tenant_id
              AND sd.biz_date = :latest_date
              AND {scope_sql}
            GROUP BY ch.key
            ORDER BY revenue DESC
            LIMIT 8
            """
        ),
        {"tenant_id": tenant_id, "latest_date": latest_date, **scope_params},
    ).mappings().all()
    total = sum(as_float(row["revenue"]) for row in rows)
    return [
        {
            "channel": row["channel"],
            "revenue": round(as_float(row["revenue"]), 2),
            "percent": round(as_float(row["revenue"]) / total * 100, 1) if total else 0,
        }
        for row in rows
    ]


def build_screen_risk_stores(db: Session, tenant_id: str, latest_date, scope_sql: str, scope_params: dict) -> list[dict]:
    rows = db.execute(
        text(
            f"""
            WITH latest_sales AS (
              SELECT sd.store_id, COALESCE(SUM(sd.revenue), 0) AS revenue, COALESCE(SUM(sd.orders), 0) AS orders
              FROM sales_daily sd
              JOIN stores s ON s.id = sd.store_id
              WHERE sd.tenant_id = :tenant_id
                AND (CAST(:latest_date AS date) IS NULL OR sd.biz_date = :latest_date)
                AND {scope_sql}
              GROUP BY sd.store_id
            ),
            alert_counts AS (
              SELECT a.store_id,
                     COUNT(*) FILTER (WHERE a.status = 'open') AS open_alerts,
                     COUNT(*) FILTER (WHERE a.status = 'open' AND a.level IN ('critical', 'high')) AS critical_alerts,
                     MAX(a.summary) AS latest_reason
              FROM alerts a
              JOIN stores s ON s.id = a.store_id
              WHERE a.tenant_id = :tenant_id AND {scope_sql}
              GROUP BY a.store_id
            ),
            task_counts AS (
              SELECT a.store_id,
                     COUNT(*) FILTER (WHERE t.status NOT IN ('closed', 'archived')) AS pending_tasks
              FROM tasks t
              JOIN alerts a ON t.source_type = 'alert' AND t.source_id = a.id AND t.tenant_id = a.tenant_id
              JOIN stores s ON s.id = a.store_id
              WHERE t.tenant_id = :tenant_id AND {scope_sql}
              GROUP BY a.store_id
            ),
            review_counts AS (
              SELECT r.store_id, COUNT(*) FILTER (WHERE r.sentiment = 'negative') AS negative_reviews
              FROM reviews r
              JOIN stores s ON s.id = r.store_id
              WHERE r.tenant_id = :tenant_id AND {scope_sql}
              GROUP BY r.store_id
            )
            SELECT s.id, s.name, COALESCE(NULLIF(s.region, ''), '未分区') AS region,
                   COALESCE(ls.revenue, 0) AS revenue,
                   COALESCE(ls.orders, 0) AS orders,
                   COALESCE(ac.open_alerts, 0) AS open_alerts,
                   COALESCE(ac.critical_alerts, 0) AS critical_alerts,
                   COALESCE(tc.pending_tasks, 0) AS pending_tasks,
                   COALESCE(rc.negative_reviews, 0) AS negative_reviews,
                   ac.latest_reason
            FROM stores s
            LEFT JOIN latest_sales ls ON ls.store_id = s.id
            LEFT JOIN alert_counts ac ON ac.store_id = s.id
            LEFT JOIN task_counts tc ON tc.store_id = s.id
            LEFT JOIN review_counts rc ON rc.store_id = s.id
            WHERE s.tenant_id = :tenant_id AND {scope_sql}
            ORDER BY
              COALESCE(ac.critical_alerts, 0) DESC,
              COALESCE(ac.open_alerts, 0) DESC,
              COALESCE(tc.pending_tasks, 0) DESC,
              COALESCE(rc.negative_reviews, 0) DESC,
              COALESCE(ls.revenue, 0) ASC
            LIMIT 8
            """
        ),
        {"tenant_id": tenant_id, "latest_date": latest_date, **scope_params},
    ).mappings().all()
    items = []
    for row in rows:
        risk_score = min(
            100,
            as_int(row["critical_alerts"]) * 35
            + as_int(row["open_alerts"]) * 12
            + as_int(row["pending_tasks"]) * 8
            + as_int(row["negative_reviews"]) * 6,
        )
        items.append(
            {
                "id": row["id"],
                "name": row["name"],
                "region": row["region"],
                "revenue": round(as_float(row["revenue"]), 2),
                "orders": as_int(row["orders"]),
                "open_alerts": as_int(row["open_alerts"]),
                "critical_alerts": as_int(row["critical_alerts"]),
                "pending_tasks": as_int(row["pending_tasks"]),
                "negative_reviews": as_int(row["negative_reviews"]),
                "risk_score": risk_score,
                "risk_level": "critical" if risk_score >= 60 else "warning" if risk_score >= 25 else "normal",
                "latest_reason": row["latest_reason"],
            }
        )
    return items


def build_screen_tasks(db: Session, tenant_id: str, task_scope_sql: str, task_scope_params: dict) -> dict:
    summary_rows = db.execute(
        text(
            f"""
            SELECT t.status, COUNT(*) AS count
            FROM tasks t
            WHERE t.tenant_id = :tenant_id AND {task_scope_sql}
            GROUP BY t.status
            """
        ),
        {"tenant_id": tenant_id, **task_scope_params},
    ).mappings().all()
    latest_rows = db.execute(
        text(
            f"""
            SELECT t.id, t.title, t.status, t.priority, t.due_at,
                   u.name AS assignee_name,
                   s.name AS store_name
            FROM tasks t
            LEFT JOIN users u ON u.id = t.assignee_id
            LEFT JOIN alerts a ON t.source_type = 'alert' AND t.source_id = a.id AND t.tenant_id = a.tenant_id
            LEFT JOIN stores s ON s.id = a.store_id
            WHERE t.tenant_id = :tenant_id
              AND t.status NOT IN ('closed', 'archived')
              AND {task_scope_sql}
            ORDER BY CASE WHEN t.priority = 'high' THEN 0 ELSE 1 END,
                     t.due_at ASC NULLS LAST,
                     t.created_at DESC
            LIMIT 8
            """
        ),
        {"tenant_id": tenant_id, **task_scope_params},
    ).mappings().all()
    by_status = {row["status"]: as_int(row["count"]) for row in summary_rows}
    return {
        "by_status": by_status,
        "open_total": sum(count for status, count in by_status.items() if status not in {"closed", "archived"}),
        "closed_total": sum(count for status, count in by_status.items() if status in {"closed", "archived"}),
        "latest": [
            {
                "id": row["id"],
                "title": row["title"],
                "status": row["status"],
                "priority": row["priority"],
                "due_at": row["due_at"].isoformat() if row["due_at"] else None,
                "assignee_name": row["assignee_name"],
                "store_name": row["store_name"],
            }
            for row in latest_rows
        ],
    }


def latest_screen_ai_summary(db: Session, tenant_id: str) -> str | None:
    row = db.execute(
        text(
            """
            SELECT output_summary
            FROM agent_runs
            WHERE tenant_id = :tenant_id
              AND agent_name = 'daily_report'
              AND status = 'success'
            ORDER BY created_at DESC
            LIMIT 1
            """
        ),
        {"tenant_id": tenant_id},
    ).mappings().first()
    return sanitize_ai_output(row["output_summary"]) if row and row["output_summary"] else None


def build_screen_summary(overview: dict, risk_stores: list[dict], tasks: dict) -> str:
    if overview["revenue"] <= 0 and overview["orders"] <= 0:
        return "暂无可展示的交易数据，请先完成门店日销售、产品销售、库存或评价数据导入。"
    focus_store = risk_stores[0]["name"] if risk_stores else "暂无高风险门店"
    return (
        f"最新营业日营收 {overview['revenue']:.2f} 元，订单 {overview['orders']} 笔，"
        f"较上一营业日变化 {overview['revenue_delta_pct']:.1f}%。"
        f"开放预警 {overview['open_alerts']} 条，待处理任务 {tasks['open_total']} 个；"
        f"当前优先关注：{focus_store}。"
    )


def build_summary(metrics: dict, open_alerts: int, pending_tasks: int) -> str:
    if metrics["revenue"] <= 0 and metrics["orders"] <= 0:
        return "暂无销售数据。请先在数据导入页上传销售、库存或评价数据，系统将基于导入结果生成经营摘要。"
    return (
        f"最新营业日营收 {metrics['revenue']:.2f} 元，订单 {metrics['orders']} 笔，"
        f"客单价 {metrics['avg_order']:.2f} 元；当前开放预警 {open_alerts} 条，"
        f"待处理任务 {pending_tasks} 个。"
    )
