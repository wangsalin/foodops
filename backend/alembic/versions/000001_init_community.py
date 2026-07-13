"""init community schema

Revision ID: 000001_init_community
Revises:
Create Date: 2026-07-13
"""

from alembic import op

revision = "000001_init_community"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")
    op.execute(
        """
CREATE TABLE tenants (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  deployment_mode  TEXT DEFAULT 'community_local',
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE departments (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  parent_id UUID REFERENCES departments(id) ON DELETE SET NULL,
  type      TEXT,
  sort      INT DEFAULT 0
);

CREATE TABLE roles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  data_scope  TEXT DEFAULT 'all',
  permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (tenant_id, name)
);

CREATE TABLE department_roles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  role_id       UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  is_default    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, department_id, role_id)
);

CREATE TABLE users (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  department_id    UUID REFERENCES departments(id) ON DELETE SET NULL,
  role_id          UUID REFERENCES roles(id) ON DELETE SET NULL,
  name             TEXT NOT NULL,
  phone            TEXT,
  username         TEXT UNIQUE NOT NULL,
  password_hash    TEXT NOT NULL,
  status           TEXT DEFAULT 'active',
  default_channel  TEXT DEFAULT 'system',
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE stores (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code                   TEXT NOT NULL,
  name                   TEXT NOT NULL,
  store_type             TEXT NOT NULL DEFAULT 'direct',
  region                 TEXT,
  address                TEXT,
  manager_user_id        UUID REFERENCES users(id) ON DELETE SET NULL,
  franchisee_user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  status                 TEXT DEFAULT 'active',
  opened_at              DATE,
  cover_image_url        TEXT,
  image_urls             JSONB NOT NULL DEFAULT '[]'::jsonb,
  store_format           TEXT,
  store_level            TEXT,
  business_district_type TEXT,
  area_sqm               NUMERIC(10,2),
  seat_count             INT,
  contact_phone          TEXT,
  operating_hours        TEXT,
  channel_tags           JSONB NOT NULL DEFAULT '[]'::jsonb,
  property_tags          JSONB NOT NULL DEFAULT '[]'::jsonb,
  latitude               NUMERIC(10,6),
  longitude              NUMERIC(10,6),
  UNIQUE (tenant_id, code)
);

CREATE TABLE user_store_scopes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  store_id   UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  scope_type TEXT DEFAULT 'visible',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, user_id, store_id)
);

CREATE TABLE product_categories (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  status     TEXT DEFAULT 'active',
  sort       INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, name)
);

CREATE TABLE products (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sku          TEXT NOT NULL,
  name         TEXT NOT NULL,
  category     TEXT,
  status       TEXT DEFAULT 'active',
  price        NUMERIC(10,2),
  cost         NUMERIC(10,2),
  margin_rate  NUMERIC(5,4),
  description  TEXT,
  image_urls   JSONB NOT NULL DEFAULT '[]'::jsonb,
  ai_tags      JSONB NOT NULL DEFAULT '[]'::jsonb,
  social_rules TEXT,
  UNIQUE (tenant_id, sku)
);

CREATE TABLE brand_assets (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  logo_url         TEXT,
  primary_color    TEXT,
  accent_color     TEXT,
  font_cn          TEXT,
  font_en          TEXT,
  tone             TEXT,
  forbidden_rules  TEXT,
  system_name      TEXT,
  brand_name       TEXT,
  brand_short_name TEXT,
  slogan           TEXT,
  favicon_url      TEXT,
  culture          JSONB DEFAULT '{}'::jsonb,
  expression       JSONB DEFAULT '{}'::jsonb,
  ai_policy        JSONB DEFAULT '{}'::jsonb,
  brand_docs       JSONB DEFAULT '{}'::jsonb,
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE material_suppliers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  supplier_code    TEXT NOT NULL,
  name             TEXT NOT NULL,
  status           TEXT DEFAULT 'active',
  contact_name     TEXT,
  phone            TEXT,
  delivery_scope   TEXT,
  settlement_type  TEXT,
  lead_time_days   INT,
  min_order_amount NUMERIC(10,2),
  address          TEXT,
  remark           TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, supplier_code)
);

CREATE TABLE materials (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  material_code       TEXT NOT NULL,
  name                TEXT NOT NULL,
  unit                TEXT NOT NULL,
  safety_stock        NUMERIC(10,2),
  status              TEXT DEFAULT 'active',
  category            TEXT,
  spec                TEXT,
  purchase_spec       TEXT,
  is_key_material     BOOLEAN DEFAULT FALSE,
  shelf_life_days     INT,
  storage_method      TEXT,
  supplier_id         UUID REFERENCES material_suppliers(id) ON DELETE SET NULL,
  supplier_name       TEXT,
  supplier_contact    TEXT,
  supplier_phone      TEXT,
  min_order_qty       NUMERIC(10,2),
  lead_time_days      INT,
  supplier_note       TEXT,
  stock_alert_enabled BOOLEAN DEFAULT TRUE,
  remark              TEXT,
  UNIQUE (tenant_id, material_code)
);

CREATE TABLE inventory_snapshots (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id      UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  material_id   UUID NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  biz_date      DATE NOT NULL,
  inbound_qty   NUMERIC(10,2) DEFAULT 0,
  usage_qty     NUMERIC(10,2),
  closing_stock NUMERIC(10,2) NOT NULL,
  UNIQUE (tenant_id, store_id, material_id, biz_date)
);

CREATE TABLE import_jobs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id        UUID REFERENCES users(id) ON DELETE SET NULL,
  import_type    TEXT NOT NULL,
  file_url       TEXT NOT NULL,
  status         TEXT DEFAULT 'processing',
  total_rows     INT DEFAULT 0,
  success_rows   INT DEFAULT 0,
  overwrite_rows INT DEFAULT 0,
  error_details  JSONB,
  metadata       JSONB,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE sales_daily (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id     UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  biz_date     DATE NOT NULL,
  revenue      NUMERIC(12,2),
  orders       INT,
  avg_order    NUMERIC(10,2),
  discount_amt NUMERIC(10,2),
  refund_amt   NUMERIC(10,2),
  channel_json JSONB,
  UNIQUE (tenant_id, store_id, biz_date)
);

CREATE TABLE sales_product_daily (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id   UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  biz_date   DATE NOT NULL,
  qty        INT,
  revenue    NUMERIC(10,2),
  margin     NUMERIC(10,2),
  UNIQUE (tenant_id, store_id, product_id, biz_date)
);

CREATE TABLE reviews (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id   UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  platform   TEXT NOT NULL,
  rating     NUMERIC(2,1),
  content    TEXT,
  replied    BOOLEAN DEFAULT FALSE,
  sentiment  TEXT,
  category   TEXT,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE alerts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id            UUID REFERENCES stores(id) ON DELETE SET NULL,
  alert_type          TEXT NOT NULL,
  level               TEXT NOT NULL,
  title               TEXT NOT NULL,
  summary             TEXT,
  status              TEXT DEFAULT 'open',
  responsible_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  due_at              TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE tasks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source_type       TEXT,
  source_id         UUID,
  title             TEXT NOT NULL,
  department_id     UUID REFERENCES departments(id) ON DELETE SET NULL,
  store_id          UUID REFERENCES stores(id) ON DELETE SET NULL,
  assignee_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  status            TEXT DEFAULT 'pending_confirm',
  priority          TEXT DEFAULT 'normal',
  due_at            TIMESTAMPTZ,
  result            TEXT,
  feedback_img_urls JSONB,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE notifications (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  recipient_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  channel           TEXT NOT NULL DEFAULT 'system',
  target_type       TEXT,
  target_id         TEXT,
  title             TEXT,
  content           TEXT,
  status            TEXT DEFAULT 'pending',
  retry_count       INT DEFAULT 0,
  sent_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE relay_devices (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  device_name       TEXT,
  device_key        TEXT UNIQUE NOT NULL,
  status            TEXT DEFAULT 'active',
  last_heartbeat_at TIMESTAMPTZ
);

CREATE TABLE agent_runs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id        UUID REFERENCES users(id) ON DELETE SET NULL,
  agent_name     TEXT,
  task_type      TEXT,
  model_used     TEXT,
  input_tokens   INT,
  output_tokens  INT,
  cost           NUMERIC(10,6),
  input_summary  TEXT,
  output_summary TEXT,
  status         TEXT,
  error_msg      TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE audit_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  action       TEXT,
  module       TEXT,
  object_type  TEXT,
  object_id    UUID,
  result       TEXT,
  ip           TEXT,
  method       TEXT,
  request_path TEXT,
  status_code  INT,
  detail       JSONB DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_department_roles_department ON department_roles (tenant_id, department_id);
CREATE INDEX idx_department_roles_role ON department_roles (tenant_id, role_id);
CREATE INDEX idx_stores_profile_filters ON stores (tenant_id, store_format, store_level, business_district_type);
CREATE INDEX idx_tasks_store_scope ON tasks (tenant_id, store_id, status, due_at);
CREATE INDEX idx_notifications_tenant_status_created ON notifications (tenant_id, status, created_at DESC);
CREATE INDEX idx_notifications_tenant_created ON notifications (tenant_id, created_at DESC);
CREATE INDEX idx_notifications_recipient_user ON notifications (tenant_id, recipient_user_id);
CREATE INDEX idx_audit_logs_tenant_created ON audit_logs (tenant_id, created_at DESC);
"""
    )


def downgrade() -> None:
    for table in (
        "audit_logs",
        "agent_runs",
        "relay_devices",
        "notifications",
        "tasks",
        "alerts",
        "reviews",
        "sales_product_daily",
        "sales_daily",
        "import_jobs",
        "inventory_snapshots",
        "materials",
        "material_suppliers",
        "brand_assets",
        "products",
        "product_categories",
        "user_store_scopes",
        "stores",
        "users",
        "department_roles",
        "roles",
        "departments",
        "tenants",
    ):
        op.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
