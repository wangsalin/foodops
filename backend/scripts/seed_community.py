"""Seed a small FoodOps Community demo dataset.

Run from backend/ after alembic upgrade:
    python scripts/seed_community.py
"""

from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import text

from app.core.config import settings
from app.core.database import SessionLocal
from app.core.security import hash_password


def scalar(db, sql: str, params: dict | None = None):
    return db.execute(text(sql), params or {}).scalar()


def one(db, sql: str, params: dict | None = None):
    return db.execute(text(sql), params or {}).mappings().one()


def main() -> None:
    with SessionLocal() as db:
        tenant_id = scalar(db, "SELECT id FROM tenants WHERE name = :name LIMIT 1", {"name": "Demo Food Group"})
        if tenant_id is None:
            tenant_id = scalar(
                db,
                "INSERT INTO tenants (name, deployment_mode) VALUES (:name, 'community_local') RETURNING id",
                {"name": "Demo Food Group"},
            )

        admin_role = upsert_role(db, tenant_id, "Administrator", "all")
        ops_role = upsert_role(db, tenant_id, "Operations Manager", "all")
        store_role = upsert_role(db, tenant_id, "Store Manager", "single_store")

        hq_dept = upsert_department(db, tenant_id, "Headquarters", 10)
        store_dept = upsert_department(db, tenant_id, "Store Operations", 20)
        upsert_department_role(db, tenant_id, hq_dept, admin_role, True)
        upsert_department_role(db, tenant_id, hq_dept, ops_role, False)
        upsert_department_role(db, tenant_id, store_dept, store_role, True)

        admin_user = upsert_user(
            db,
            tenant_id,
            department_id=hq_dept,
            role_id=admin_role,
            username=settings.init_admin_username,
            password=settings.init_admin_password,
            name="Admin",
        )
        ops_user = upsert_user(
            db,
            tenant_id,
            department_id=hq_dept,
            role_id=ops_role,
            username="ops",
            password="ops123456",
            name="Ops Manager",
        )
        store_user = upsert_user(
            db,
            tenant_id,
            department_id=store_dept,
            role_id=store_role,
            username="store01",
            password="store123456",
            name="Store Manager 01",
        )

        store_a = upsert_store(db, tenant_id, "S001", "Central Station Store", ops_user, store_user, "North")
        store_b = upsert_store(db, tenant_id, "S002", "Riverside Store", ops_user, None, "South")
        upsert_store_scope(db, tenant_id, store_user, store_a)

        category = upsert_category(db, tenant_id, "Signature Drinks", 10)
        product_a = upsert_product(db, tenant_id, "P-001", "Classic Milk Tea", category, Decimal("18.00"), Decimal("6.50"))
        product_b = upsert_product(db, tenant_id, "P-002", "Lemon Tea", category, Decimal("16.00"), Decimal("5.20"))

        supplier = upsert_supplier(db, tenant_id)
        tea = upsert_material(db, tenant_id, supplier, "M-TEA", "Tea Base", "kg", Decimal("20.00"))
        milk = upsert_material(db, tenant_id, supplier, "M-MILK", "Milk", "L", Decimal("25.00"))

        today = date.today()
        for offset in range(7):
            biz_date = today - timedelta(days=offset)
            upsert_sales(db, tenant_id, store_a, biz_date, Decimal("6200") - offset * 120, 310 - offset * 4)
            upsert_sales(db, tenant_id, store_b, biz_date, Decimal("4800") - offset * 90, 240 - offset * 3)
            upsert_product_sales(db, tenant_id, store_a, product_a, biz_date, 120 - offset, Decimal("2160") - offset * 18)
            upsert_product_sales(db, tenant_id, store_b, product_b, biz_date, 86 - offset, Decimal("1376") - offset * 16)

        upsert_inventory(db, tenant_id, store_a, tea, today, Decimal("12.00"))
        upsert_inventory(db, tenant_id, store_a, milk, today, Decimal("18.00"))
        upsert_inventory(db, tenant_id, store_b, tea, today, Decimal("32.00"))
        upsert_inventory(db, tenant_id, store_b, milk, today, Decimal("42.00"))
        upsert_review(db, tenant_id, store_a, product_a)

        alert_id = upsert_alert(db, tenant_id, store_a, ops_user)
        task_id = upsert_task(db, tenant_id, alert_id, store_a, store_dept, store_user)
        upsert_notification(db, tenant_id, store_user, task_id)
        upsert_brand(db, tenant_id)

        db.commit()

    print("Community demo data seeded.")
    print(f"Login: {settings.init_admin_username} / {settings.init_admin_password}")
    print("Extra users: ops / ops123456, store01 / store123456")


def upsert_role(db, tenant_id, name: str, data_scope: str):
    permissions = {
        "dashboard": "read",
        "imports": "manage",
        "alerts": "manage",
        "tasks": "manage",
        "notifications": "read",
        "stores": "manage",
        "products": "manage",
        "materials": "manage",
        "users": "manage",
        "audit": "read",
        "system": "read",
    }
    return scalar(
        db,
        """
        INSERT INTO roles (tenant_id, name, description, data_scope, permissions)
        VALUES (:tenant_id, :name, :description, :data_scope, CAST(:permissions AS jsonb))
        ON CONFLICT (tenant_id, name)
        DO UPDATE SET data_scope = EXCLUDED.data_scope, permissions = EXCLUDED.permissions
        RETURNING id
        """,
        {
            "tenant_id": tenant_id,
            "name": name,
            "description": "Community demo role",
            "data_scope": data_scope,
            "permissions": json.dumps(permissions),
        },
    )


def upsert_department(db, tenant_id, name: str, sort: int):
    existing = scalar(db, "SELECT id FROM departments WHERE tenant_id = :tenant_id AND name = :name", {"tenant_id": tenant_id, "name": name})
    if existing:
        return existing
    return scalar(
        db,
        "INSERT INTO departments (tenant_id, name, type, sort) VALUES (:tenant_id, :name, 'dept', :sort) RETURNING id",
        {"tenant_id": tenant_id, "name": name, "sort": sort},
    )


def upsert_department_role(db, tenant_id, department_id, role_id, is_default: bool):
    db.execute(
        text(
            """
            INSERT INTO department_roles (tenant_id, department_id, role_id, is_default)
            VALUES (:tenant_id, :department_id, :role_id, :is_default)
            ON CONFLICT (tenant_id, department_id, role_id)
            DO UPDATE SET is_default = EXCLUDED.is_default
            """
        ),
        {"tenant_id": tenant_id, "department_id": department_id, "role_id": role_id, "is_default": is_default},
    )


def upsert_user(db, tenant_id, *, department_id, role_id, username: str, password: str, name: str):
    existing = scalar(db, "SELECT id FROM users WHERE username = :username", {"username": username})
    if existing:
        return existing
    return scalar(
        db,
        """
        INSERT INTO users (tenant_id, department_id, role_id, name, username, password_hash, status, default_channel)
        VALUES (:tenant_id, :department_id, :role_id, :name, :username, :password_hash, 'active', 'system')
        RETURNING id
        """,
        {
            "tenant_id": tenant_id,
            "department_id": department_id,
            "role_id": role_id,
            "name": name,
            "username": username,
            "password_hash": hash_password(password),
        },
    )


def upsert_store(db, tenant_id, code: str, name: str, manager_user_id, franchisee_user_id, region: str):
    return scalar(
        db,
        """
        INSERT INTO stores (tenant_id, code, name, store_type, region, manager_user_id, franchisee_user_id, store_format, store_level)
        VALUES (:tenant_id, :code, :name, 'direct', :region, :manager_user_id, :franchisee_user_id, 'standard', 'A')
        ON CONFLICT (tenant_id, code)
        DO UPDATE SET name = EXCLUDED.name, manager_user_id = EXCLUDED.manager_user_id, franchisee_user_id = EXCLUDED.franchisee_user_id
        RETURNING id
        """,
        {
            "tenant_id": tenant_id,
            "code": code,
            "name": name,
            "region": region,
            "manager_user_id": manager_user_id,
            "franchisee_user_id": franchisee_user_id,
        },
    )


def upsert_store_scope(db, tenant_id, user_id, store_id):
    db.execute(
        text(
            """
            INSERT INTO user_store_scopes (tenant_id, user_id, store_id)
            VALUES (:tenant_id, :user_id, :store_id)
            ON CONFLICT (tenant_id, user_id, store_id) DO NOTHING
            """
        ),
        {"tenant_id": tenant_id, "user_id": user_id, "store_id": store_id},
    )


def upsert_category(db, tenant_id, name: str, sort: int):
    return scalar(
        db,
        """
        INSERT INTO product_categories (tenant_id, name, sort)
        VALUES (:tenant_id, :name, :sort)
        ON CONFLICT (tenant_id, name) DO UPDATE SET sort = EXCLUDED.sort
        RETURNING name
        """,
        {"tenant_id": tenant_id, "name": name, "sort": sort},
    )


def upsert_product(db, tenant_id, sku: str, name: str, category: str, price: Decimal, cost: Decimal):
    return scalar(
        db,
        """
        INSERT INTO products (tenant_id, sku, name, category, price, cost, margin_rate, image_urls, ai_tags)
        VALUES (:tenant_id, :sku, :name, :category, :price, :cost, :margin_rate, '[]'::jsonb, '[]'::jsonb)
        ON CONFLICT (tenant_id, sku)
        DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, price = EXCLUDED.price, cost = EXCLUDED.cost
        RETURNING id
        """,
        {
            "tenant_id": tenant_id,
            "sku": sku,
            "name": name,
            "category": category,
            "price": price,
            "cost": cost,
            "margin_rate": (price - cost) / price,
        },
    )


def upsert_supplier(db, tenant_id):
    return scalar(
        db,
        """
        INSERT INTO material_suppliers (tenant_id, supplier_code, name, contact_name, phone, lead_time_days)
        VALUES (:tenant_id, 'SUP-001', 'Demo Supplier', 'Contact', '10000000000', 2)
        ON CONFLICT (tenant_id, supplier_code) DO UPDATE SET name = EXCLUDED.name
        RETURNING id
        """,
        {"tenant_id": tenant_id},
    )


def upsert_material(db, tenant_id, supplier_id, code: str, name: str, unit: str, safety_stock: Decimal):
    return scalar(
        db,
        """
        INSERT INTO materials (
          tenant_id, material_code, name, unit, safety_stock, category, supplier_id, supplier_name, stock_alert_enabled
        )
        VALUES (:tenant_id, :code, :name, :unit, :safety_stock, 'core', :supplier_id, 'Demo Supplier', TRUE)
        ON CONFLICT (tenant_id, material_code)
        DO UPDATE SET name = EXCLUDED.name, safety_stock = EXCLUDED.safety_stock, supplier_id = EXCLUDED.supplier_id
        RETURNING id
        """,
        {"tenant_id": tenant_id, "code": code, "name": name, "unit": unit, "safety_stock": safety_stock, "supplier_id": supplier_id},
    )


def upsert_sales(db, tenant_id, store_id, biz_date: date, revenue: Decimal, orders: int):
    db.execute(
        text(
            """
            INSERT INTO sales_daily (tenant_id, store_id, biz_date, revenue, orders, avg_order, channel_json)
            VALUES (:tenant_id, :store_id, :biz_date, :revenue, :orders, :avg_order, '{"offline": 0.68, "online": 0.32}'::jsonb)
            ON CONFLICT (tenant_id, store_id, biz_date)
            DO UPDATE SET revenue = EXCLUDED.revenue, orders = EXCLUDED.orders, avg_order = EXCLUDED.avg_order
            """
        ),
        {"tenant_id": tenant_id, "store_id": store_id, "biz_date": biz_date, "revenue": revenue, "orders": orders, "avg_order": revenue / orders},
    )


def upsert_product_sales(db, tenant_id, store_id, product_id, biz_date: date, qty: int, revenue: Decimal):
    db.execute(
        text(
            """
            INSERT INTO sales_product_daily (tenant_id, store_id, product_id, biz_date, qty, revenue, margin)
            VALUES (:tenant_id, :store_id, :product_id, :biz_date, :qty, :revenue, :margin)
            ON CONFLICT (tenant_id, store_id, product_id, biz_date)
            DO UPDATE SET qty = EXCLUDED.qty, revenue = EXCLUDED.revenue, margin = EXCLUDED.margin
            """
        ),
        {"tenant_id": tenant_id, "store_id": store_id, "product_id": product_id, "biz_date": biz_date, "qty": qty, "revenue": revenue, "margin": revenue * Decimal("0.52")},
    )


def upsert_inventory(db, tenant_id, store_id, material_id, biz_date: date, closing_stock: Decimal):
    db.execute(
        text(
            """
            INSERT INTO inventory_snapshots (tenant_id, store_id, material_id, biz_date, inbound_qty, usage_qty, closing_stock)
            VALUES (:tenant_id, :store_id, :material_id, :biz_date, 0, 0, :closing_stock)
            ON CONFLICT (tenant_id, store_id, material_id, biz_date)
            DO UPDATE SET closing_stock = EXCLUDED.closing_stock
            """
        ),
        {"tenant_id": tenant_id, "store_id": store_id, "material_id": material_id, "biz_date": biz_date, "closing_stock": closing_stock},
    )


def upsert_review(db, tenant_id, store_id, product_id):
    exists = scalar(
        db,
        "SELECT id FROM reviews WHERE tenant_id = :tenant_id AND store_id = :store_id AND content = :content LIMIT 1",
        {"tenant_id": tenant_id, "store_id": store_id, "content": "Wait time was too long at noon."},
    )
    if exists:
        return
    db.execute(
        text(
            """
            INSERT INTO reviews (tenant_id, store_id, product_id, platform, rating, content, replied, sentiment, category, created_at)
            VALUES (:tenant_id, :store_id, :product_id, 'manual', 3.0, :content, FALSE, 'negative', 'service', :created_at)
            """
        ),
        {
            "tenant_id": tenant_id,
            "store_id": store_id,
            "product_id": product_id,
            "content": "Wait time was too long at noon.",
            "created_at": datetime.now(timezone.utc) - timedelta(hours=2),
        },
    )


def upsert_alert(db, tenant_id, store_id, responsible_user_id):
    return scalar(
        db,
        """
        INSERT INTO alerts (tenant_id, store_id, alert_type, level, title, summary, status, responsible_user_id, due_at)
        VALUES (:tenant_id, :store_id, 'inventory_low', 'high', 'Tea Base stock below safety line',
                'Central Station Store has low Tea Base stock and needs replenishment review.', 'open', :responsible_user_id, NOW() + INTERVAL '1 day')
        RETURNING id
        """,
        {"tenant_id": tenant_id, "store_id": store_id, "responsible_user_id": responsible_user_id},
    )


def upsert_task(db, tenant_id, alert_id, store_id, department_id, assignee_id):
    return scalar(
        db,
        """
        INSERT INTO tasks (tenant_id, source_type, source_id, title, department_id, store_id, assignee_id, status, priority, due_at)
        VALUES (:tenant_id, 'alert', :alert_id, 'Confirm replenishment plan for Tea Base', :department_id, :store_id, :assignee_id,
                'pending_confirm', 'high', NOW() + INTERVAL '1 day')
        RETURNING id
        """,
        {"tenant_id": tenant_id, "alert_id": alert_id, "department_id": department_id, "store_id": store_id, "assignee_id": assignee_id},
    )


def upsert_notification(db, tenant_id, recipient_user_id, task_id):
    db.execute(
        text(
            """
            INSERT INTO notifications (tenant_id, recipient_user_id, channel, target_type, target_id, title, content, status, sent_at)
            VALUES (:tenant_id, :recipient_user_id, 'system', 'task', :task_id, 'New task assigned',
                    'Please confirm the replenishment task in the H5 task view.', 'sent', NOW())
            """
        ),
        {"tenant_id": tenant_id, "recipient_user_id": recipient_user_id, "task_id": str(task_id)},
    )


def upsert_brand(db, tenant_id):
    db.execute(
        text(
            """
            INSERT INTO brand_assets (
              tenant_id, logo_url, primary_color, accent_color, system_name, brand_name, brand_short_name, slogan, culture, expression, ai_policy, brand_docs
            )
            VALUES (
              :tenant_id, '/logo.svg', '#569435', '#d8a24a', 'FoodOps Community', 'FoodOps Community', 'FoodOps',
              'Local operations loop for chain food teams', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb
            )
            """
        ),
        {"tenant_id": tenant_id},
    )


if __name__ == "__main__":
    main()
