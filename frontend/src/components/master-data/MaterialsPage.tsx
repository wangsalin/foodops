"use client";

import {
  AlertOutlined,
  DatabaseOutlined,
  EditOutlined,
  EyeOutlined,
  PlusOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
  TruckOutlined
} from "@ant-design/icons";
import { App, Button, Card, Checkbox, Drawer, Empty, Form, Input, InputNumber, Modal, Progress, Select, Space, Table, Tag, Typography } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";

import { api } from "@/lib/api";
import { hasPermission, readStoredPermissions } from "@/lib/permissions";

type MaterialInventorySnapshot = {
  store_id: string;
  store_name: string;
  biz_date?: string;
  inbound_qty?: string | number;
  usage_qty?: string | number;
  closing_stock?: string | number;
};

type MaterialRecord = {
  id: string;
  material_code: string;
  name: string;
  unit: string;
  safety_stock?: string | number;
  status: string;
  category?: string;
  spec?: string;
  purchase_spec?: string;
  is_key_material?: boolean;
  shelf_life_days?: string | number;
  storage_method?: string;
  supplier_id?: string;
  supplier_name?: string;
  supplier_contact?: string;
  supplier_phone?: string;
  min_order_qty?: string | number;
  lead_time_days?: string | number;
  supplier_note?: string;
  stock_alert_enabled?: boolean;
  remark?: string;
  monitored_store_count?: string | number;
  low_stock_store_count?: string | number;
  out_of_stock_store_count?: string | number;
  min_closing_stock?: string | number;
  latest_biz_date?: string;
  latest_inventory?: MaterialInventorySnapshot[];
};

type MaterialFormValues = {
  material_code: string;
  name: string;
  unit: string;
  safety_stock?: number;
  status: string;
  category?: string;
  spec?: string;
  purchase_spec?: string;
  is_key_material?: boolean;
  shelf_life_days?: number;
  storage_method?: string;
  supplier_id?: string;
  supplier_name?: string;
  supplier_contact?: string;
  supplier_phone?: string;
  min_order_qty?: number;
  lead_time_days?: number;
  supplier_note?: string;
  stock_alert_enabled?: boolean;
  remark?: string;
};

type SupplierRecord = {
  id: string;
  supplier_code: string;
  name: string;
  status: string;
  contact_name?: string;
  phone?: string;
  delivery_scope?: string;
  settlement_type?: string;
  lead_time_days?: string | number;
  min_order_amount?: string | number;
  address?: string;
  remark?: string;
  material_count?: string | number;
  materials?: SupplierMaterialRecord[];
};

type SupplierMaterialRecord = {
  id: string;
  material_code: string;
  name: string;
  unit: string;
  category?: string;
  purchase_spec?: string;
  status: string;
};

type SupplierFormValues = {
  supplier_code: string;
  name: string;
  status: string;
  contact_name?: string;
  phone?: string;
  delivery_scope?: string;
  settlement_type?: string;
  lead_time_days?: number;
  min_order_amount?: number;
  address?: string;
  remark?: string;
};

const statusOptions = [
  { value: "active", label: "启用" },
  { value: "disabled", label: "停用" }
];

const riskOptions = [
  { value: "critical", label: "断货风险" },
  { value: "warning", label: "低库存" },
  { value: "normal", label: "库存正常" },
  { value: "unconfigured", label: "未设安全线" },
  { value: "no_data", label: "暂无库存数据" },
  { value: "disabled", label: "已停用" }
];

const categoryOptions = [
  { value: "tea_base", label: "茶底类" },
  { value: "dairy", label: "乳制品类" },
  { value: "fruit", label: "水果类" },
  { value: "syrup", label: "糖浆/酱料" },
  { value: "topping", label: "小料类" },
  { value: "powder", label: "粉料类" },
  { value: "packaging", label: "包材类" },
  { value: "semi_finished", label: "半成品类" },
  { value: "seasonal", label: "季节限定" },
  { value: "other", label: "其他" }
];

const storageOptions = [
  { value: "normal", label: "常温" },
  { value: "cold", label: "冷藏" },
  { value: "frozen", label: "冷冻" }
];

const keyMaterialOptions = [
  { value: "true", label: "关键原料" },
  { value: "false", label: "普通原料" }
];

const settlementOptions = [
  { value: "monthly", label: "月结" },
  { value: "cash", label: "现结" },
  { value: "prepaid", label: "预付" },
  { value: "other", label: "其他" }
];

function asNumber(value?: string | number | null) {
  if (value === undefined || value === null || value === "") return 0;
  return Number(value);
}

function hasValue(value?: string | number | null) {
  return value !== undefined && value !== null && value !== "";
}

function formatQty(value?: string | number | null, unit?: string) {
  if (!hasValue(value)) return "-";
  const suffix = unit ? ` ${unit}` : "";
  return `${asNumber(value).toFixed(2)}${suffix}`;
}

function formatAmount(value?: string | number | null) {
  if (!hasValue(value)) return "-";
  return `¥${asNumber(value).toFixed(2)}`;
}

function labelFromOptions(options: { value: string; label: string }[], value?: string) {
  return options.find((item) => item.value === value)?.label || "未维护";
}

function materialRisk(record: MaterialRecord) {
  if (record.status === "disabled") {
    return { key: "disabled", label: "已停用", color: "default", percent: 0 };
  }
  if (asNumber(record.out_of_stock_store_count) > 0) {
    return { key: "critical", label: "断货风险", color: "red", percent: 100 };
  }
  if (asNumber(record.low_stock_store_count) > 0) {
    return { key: "warning", label: "低库存", color: "orange", percent: 72 };
  }
  if (!hasValue(record.safety_stock)) {
    return { key: "unconfigured", label: "未设安全线", color: "gold", percent: 42 };
  }
  if (asNumber(record.monitored_store_count) === 0) {
    return { key: "no_data", label: "暂无库存数据", color: "blue", percent: 24 };
  }
  return { key: "normal", label: "库存正常", color: "green", percent: 8 };
}

function materialFormInitialValues(record: MaterialRecord | null): Partial<MaterialFormValues> {
  if (!record) {
    return { status: "active", stock_alert_enabled: true, is_key_material: false };
  }
  return {
    material_code: record.material_code,
    name: record.name,
    unit: record.unit,
    safety_stock: hasValue(record.safety_stock) ? asNumber(record.safety_stock) : undefined,
    status: record.status || "active",
    category: record.category,
    spec: record.spec,
    purchase_spec: record.purchase_spec,
    is_key_material: Boolean(record.is_key_material),
    shelf_life_days: hasValue(record.shelf_life_days) ? asNumber(record.shelf_life_days) : undefined,
    storage_method: record.storage_method,
    supplier_id: record.supplier_id,
    supplier_name: record.supplier_name,
    supplier_contact: record.supplier_contact,
    supplier_phone: record.supplier_phone,
    min_order_qty: hasValue(record.min_order_qty) ? asNumber(record.min_order_qty) : undefined,
    lead_time_days: hasValue(record.lead_time_days) ? asNumber(record.lead_time_days) : undefined,
    supplier_note: record.supplier_note,
    stock_alert_enabled: record.stock_alert_enabled !== false,
    remark: record.remark
  };
}

function supplierFormInitialValues(record: SupplierRecord | null): Partial<SupplierFormValues> {
  if (!record) {
    return { status: "active", settlement_type: "monthly" };
  }
  return {
    supplier_code: record.supplier_code,
    name: record.name,
    status: record.status || "active",
    contact_name: record.contact_name,
    phone: record.phone,
    delivery_scope: record.delivery_scope,
    settlement_type: record.settlement_type,
    lead_time_days: hasValue(record.lead_time_days) ? asNumber(record.lead_time_days) : undefined,
    min_order_amount: hasValue(record.min_order_amount) ? asNumber(record.min_order_amount) : undefined,
    address: record.address,
    remark: record.remark
  };
}

export function MaterialsPage() {
  const [materials, setMaterials] = useState<MaterialRecord[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierRecord[]>([]);
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>();
  const [categoryFilter, setCategoryFilter] = useState<string>();
  const [riskFilter, setRiskFilter] = useState<string>();
  const [keyMaterialFilter, setKeyMaterialFilter] = useState<string>();
  const [open, setOpen] = useState(false);
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [editing, setEditing] = useState<MaterialRecord | null>(null);
  const [editingSupplier, setEditingSupplier] = useState<SupplierRecord | null>(null);
  const [materialFormKey, setMaterialFormKey] = useState(0);
  const [supplierFormKey, setSupplierFormKey] = useState(0);
  const [preview, setPreview] = useState<MaterialRecord | null>(null);
  const [supplierPreview, setSupplierPreview] = useState<SupplierRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [supplierSaving, setSupplierSaving] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [supplierDetailLoading, setSupplierDetailLoading] = useState(false);
  const [permissions, setPermissions] = useState(() => readStoredPermissions());
  const { message } = App.useApp();
  const canManageMaterials = hasPermission(permissions, "materials", "manage");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [materialRes, supplierRes] = await Promise.all([
        api.get("/api/v1/materials", {
          params: {
            keyword: keyword || undefined,
            status: statusFilter || undefined,
            category: categoryFilter || undefined,
            is_key_material: keyMaterialFilter || undefined
          }
        }),
        api.get("/api/v1/suppliers")
      ]);
      setMaterials(materialRes.data);
      setSuppliers(supplierRes.data);
    } catch {
      message.error("原料数据加载失败,请确认后端服务和登录状态");
    } finally {
      setLoading(false);
    }
  }, [categoryFilter, keyMaterialFilter, keyword, message, statusFilter]);

  useEffect(() => {
    setPermissions(readStoredPermissions());
    load();
  }, [load]);

  const filteredMaterials = useMemo(
    () => materials.filter((item) => !riskFilter || materialRisk(item).key === riskFilter),
    [materials, riskFilter]
  );

  const supplierOptions = useMemo(
    () =>
      suppliers
        .filter((supplier) => supplier.status === "active")
        .map((supplier) => ({
          value: supplier.id,
          label: `${supplier.name} · ${supplier.supplier_code}`
        })),
    [suppliers]
  );

  const metrics = useMemo(() => {
    const active = materials.filter((item) => item.status === "active").length;
    const configured = materials.filter((item) => hasValue(item.safety_stock)).length;
    const keyMaterials = materials.filter((item) => item.is_key_material).length;
    const supplierBindings = materials.filter((item) => item.supplier_id || item.supplier_name).length;
    const activeSuppliers = suppliers.filter((item) => item.status === "active").length;
    const critical = materials.filter((item) => materialRisk(item).key === "critical").length;
    const warning = materials.filter((item) => materialRisk(item).key === "warning").length;
    return { active, configured, keyMaterials, supplierBindings, activeSuppliers, critical, warning };
  }, [materials, suppliers]);

  function startCreate() {
    setEditing(null);
    setMaterialFormKey((value) => value + 1);
    setOpen(true);
  }

  function startEdit(record: MaterialRecord) {
    setEditing(record);
    setMaterialFormKey((value) => value + 1);
    setOpen(true);
  }

  async function openDetail(record: MaterialRecord) {
    setPreview(record);
    setDetailLoading(true);
    try {
      const res = await api.get(`/api/v1/materials/${record.id}`);
      setPreview({ ...record, ...res.data });
    } catch {
      message.error("原料详情加载失败,请稍后重试");
    } finally {
      setDetailLoading(false);
    }
  }

  async function openSupplierDetail(record: SupplierRecord) {
    setSupplierPreview(record);
    setSupplierDetailLoading(true);
    try {
      const res = await api.get(`/api/v1/suppliers/${record.id}`);
      setSupplierPreview({ ...record, ...res.data });
    } catch {
      message.error("供货商详情加载失败,请稍后重试");
    } finally {
      setSupplierDetailLoading(false);
    }
  }

  async function submit(values: MaterialFormValues) {
    setSaving(true);
    try {
      const payload = {
        ...values,
        safety_stock: values.safety_stock ?? null
      };
      if (editing) {
        await api.put(`/api/v1/materials/${editing.id}`, payload);
        message.success("原料已更新");
      } else {
        await api.post("/api/v1/materials", payload);
        message.success("原料已创建");
      }
      setOpen(false);
      await load();
    } catch {
      message.error("原料保存失败,请检查编码是否重复或字段是否完整");
    } finally {
      setSaving(false);
    }
  }

  function startSupplierCreate() {
    setEditingSupplier(null);
    setSupplierFormKey((value) => value + 1);
    setSupplierOpen(true);
  }

  function startSupplierEdit(record: SupplierRecord) {
    setEditingSupplier(record);
    setSupplierFormKey((value) => value + 1);
    setSupplierOpen(true);
  }

  async function submitSupplier(values: SupplierFormValues) {
    setSupplierSaving(true);
    try {
      if (editingSupplier) {
        await api.put(`/api/v1/suppliers/${editingSupplier.id}`, values);
        message.success("供货商已更新");
      } else {
        await api.post("/api/v1/suppliers", values);
        message.success("供货商已创建");
      }
      setSupplierOpen(false);
      await load();
    } catch {
      message.error("供货商保存失败,请检查编码是否重复或字段是否完整");
    } finally {
      setSupplierSaving(false);
    }
  }

  const columns = [
    {
      title: "原料",
      dataIndex: "name",
      render: (_: unknown, record: MaterialRecord) => (
        <div className="material-name-cell">
          <b>{record.name}</b>
          <span>{record.material_code}</span>
          <span>{labelFromOptions(categoryOptions, record.category)}</span>
        </div>
      )
    },
    {
      title: "规格",
      width: 150,
      render: (_: unknown, record: MaterialRecord) => (
        <div className="material-stock-cell">
          <b>{record.unit}</b>
          <span>{record.purchase_spec || record.spec || "未维护"}</span>
        </div>
      )
    },
    {
      title: "安全库存",
      dataIndex: "safety_stock",
      width: 140,
      render: (_: unknown, record: MaterialRecord) => formatQty(record.safety_stock, record.unit)
    },
    {
      title: "库存风险",
      width: 210,
      render: (_: unknown, record: MaterialRecord) => {
        const risk = materialRisk(record);
        return (
          <div className="material-risk-cell">
            <Tag color={risk.color}>{risk.label}</Tag>
            <Progress percent={risk.percent} showInfo={false} size="small" status={risk.key === "critical" ? "exception" : "normal"} />
          </div>
        );
      }
    },
    {
      title: "供货商",
      width: 170,
      render: (_: unknown, record: MaterialRecord) => (
        <div className="material-stock-cell">
          <b>{record.supplier_name || "未维护"}</b>
          <span>{hasValue(record.lead_time_days) ? `${record.lead_time_days} 天到货` : "未设到货周期"}</span>
        </div>
      )
    },
    {
      title: "关键",
      width: 90,
      render: (_: unknown, record: MaterialRecord) => (
        <Tag color={record.is_key_material ? "green" : "default"}>{record.is_key_material ? "关键" : "普通"}</Tag>
      )
    },
    {
      title: "最近库存",
      width: 160,
      render: (_: unknown, record: MaterialRecord) => (
        <div className="material-stock-cell">
          <b>{formatQty(record.min_closing_stock, record.unit)}</b>
          <span>{record.latest_biz_date || "暂无快照"}</span>
        </div>
      )
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 90,
      render: (value: string) => <Tag color={value === "active" ? "green" : "default"}>{value === "active" ? "启用" : "停用"}</Tag>
    },
    {
      title: "操作",
      width: 168,
      fixed: "right" as const,
      render: (_: unknown, record: MaterialRecord) => (
        <Space>
          <Button icon={<EyeOutlined />} onClick={() => openDetail(record)}>查看</Button>
          {canManageMaterials ? <Button type="primary" icon={<EditOutlined />} onClick={() => startEdit(record)}>编辑</Button> : null}
        </Space>
      )
    }
  ];

  return (
    <>
      <div className="analysis-metric-grid material-metric-grid">
        <Card className="metric-card panel-card" loading={loading}>
          <Typography.Text type="secondary">原料总数</Typography.Text>
          <div className="ai-big-number">{materials.length}</div>
          <div className="metric-foot">{metrics.active} 个启用中</div>
        </Card>
        <Card className="metric-card panel-card" loading={loading}>
          <Typography.Text type="secondary">库存风险</Typography.Text>
          <div className="ai-big-number">{metrics.critical + metrics.warning}</div>
          <div className="metric-foot">断货 {metrics.critical} · 低库存 {metrics.warning}</div>
        </Card>
        <Card className="metric-card panel-card" loading={loading}>
          <Typography.Text type="secondary">关键原料</Typography.Text>
          <div className="ai-big-number">{metrics.keyMaterials}</div>
          <div className="metric-foot">断货会影响出品</div>
        </Card>
        <Card className="metric-card panel-card" loading={loading}>
          <Typography.Text type="secondary">供货信息</Typography.Text>
          <div className="ai-big-number">{metrics.activeSuppliers}</div>
          <div className="metric-foot">{metrics.supplierBindings} 个原料已绑定</div>
        </Card>
      </div>

      <Card
        className="panel-card material-supplier-card"
        title="供货商档案"
        extra={canManageMaterials ? <Button icon={<PlusOutlined />} onClick={startSupplierCreate}>新增供货商</Button> : null}
      >
        {suppliers.length ? (
          <div className="supplier-card-grid">
            {suppliers.map((supplier) => (
              <div className="supplier-card-item" key={supplier.id}>
                <div className="supplier-card-head">
                  <div className="supplier-card-icon"><TruckOutlined /></div>
                  <div>
                    <b>{supplier.name}</b>
                    <span>{supplier.supplier_code}</span>
                  </div>
                  <Tag color={supplier.status === "active" ? "green" : "default"}>{supplier.status === "active" ? "启用" : "停用"}</Tag>
                </div>
                <div className="supplier-card-meta">
                  <div><span>配送范围</span><b>{supplier.delivery_scope || "未维护"}</b></div>
                  <div><span>结算方式</span><b>{labelFromOptions(settlementOptions, supplier.settlement_type)}</b></div>
                  <div><span>到货周期</span><b>{hasValue(supplier.lead_time_days) ? `${supplier.lead_time_days} 天` : "未维护"}</b></div>
                  <div><span>绑定原料</span><b>{asNumber(supplier.material_count)} 个</b></div>
                </div>
                <div className="supplier-card-foot">
                  <span>{supplier.contact_name || "未维护联系人"} · {supplier.phone || "未维护电话"}</span>
                  <Space size={6}>
                    <Button size="small" icon={<EyeOutlined />} onClick={() => openSupplierDetail(supplier)}>查看</Button>
                    {canManageMaterials ? <Button size="small" icon={<EditOutlined />} onClick={() => startSupplierEdit(supplier)}>编辑</Button> : null}
                  </Space>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Empty description="暂无供货商档案,请先新增供货商后再绑定原料" />
        )}
      </Card>

      <Card
        className="panel-card material-list-card"
        title="原料列表"
        extra={canManageMaterials ? <Button type="primary" icon={<PlusOutlined />} onClick={startCreate}>新增原料</Button> : null}
      >
        <div className="material-filter-row">
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="搜索原料编码 / 名称"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            onPressEnter={() => load()}
          />
          <Select
            allowClear
            showSearch
            placeholder="全部分类"
            value={categoryFilter}
            options={categoryOptions}
            onChange={setCategoryFilter}
          />
          <Select
            allowClear
            placeholder="全部状态"
            value={statusFilter}
            options={statusOptions}
            onChange={setStatusFilter}
          />
          <Select
            allowClear
            placeholder="全部风险"
            value={riskFilter}
            options={riskOptions}
            onChange={setRiskFilter}
          />
          <Select
            allowClear
            placeholder="全部关键性"
            value={keyMaterialFilter}
            options={keyMaterialOptions}
            onChange={setKeyMaterialFilter}
          />
        </div>

        <Table
          loading={loading}
          rowKey="id"
          dataSource={filteredMaterials}
          columns={columns}
          scroll={{ x: 1180 }}
          locale={{ emptyText: <Empty description="暂无原料档案,请先新增原料或导入库存数据" /> }}
        />
      </Card>

      <Drawer
        className="material-detail-drawer supplier-detail-drawer"
        title="供货商详情"
        open={Boolean(supplierPreview)}
        onClose={() => setSupplierPreview(null)}
        width={680}
        destroyOnHidden
      >
        {supplierPreview ? (
          <div className="material-detail-shell">
            <section className="material-detail-hero">
              <div className="material-detail-icon"><TruckOutlined /></div>
              <div>
                <span className="detail-kicker">{supplierPreview.supplier_code}</span>
                <h2>{supplierPreview.name}</h2>
                <p>
                  {supplierPreview.delivery_scope || "未维护配送范围"} ·
                  {labelFromOptions(settlementOptions, supplierPreview.settlement_type)} ·
                  {hasValue(supplierPreview.lead_time_days) ? `${supplierPreview.lead_time_days} 天到货` : "未维护到货周期"}。
                </p>
                <div className="product-detail-chip-row">
                  <Tag color={supplierPreview.status === "active" ? "green" : "default"}>{supplierPreview.status === "active" ? "启用" : "停用"}</Tag>
                  <Tag>{asNumber(supplierPreview.materials?.length ?? supplierPreview.material_count)} 个绑定原料</Tag>
                  <Tag>{supplierPreview.contact_name || "未维护联系人"}</Tag>
                </div>
              </div>
            </section>

            <div className="detail-metric-grid">
              <div><span>绑定原料</span><b>{asNumber(supplierPreview.materials?.length ?? supplierPreview.material_count)} 个</b></div>
              <div><span>到货周期</span><b>{hasValue(supplierPreview.lead_time_days) ? `${supplierPreview.lead_time_days} 天` : "-"}</b></div>
              <div><span>最小订购金额</span><b>{formatAmount(supplierPreview.min_order_amount)}</b></div>
              <div><span>结算方式</span><b>{labelFromOptions(settlementOptions, supplierPreview.settlement_type)}</b></div>
            </div>

            <section className="material-detail-section">
              <div className="detail-section-title">
                <span><TruckOutlined /> 基础信息</span>
              </div>
              <div className="material-info-grid">
                <div><span>供货商编码</span><b>{supplierPreview.supplier_code}</b></div>
                <div><span>供货商名称</span><b>{supplierPreview.name}</b></div>
                <div><span>联系人</span><b>{supplierPreview.contact_name || "未维护"}</b></div>
                <div><span>联系电话</span><b>{supplierPreview.phone || "未维护"}</b></div>
                <div><span>状态</span><b>{supplierPreview.status === "active" ? "启用" : "停用"}</b></div>
                <div><span>地址</span><b>{supplierPreview.address || "未维护"}</b></div>
              </div>
            </section>

            <section className="material-detail-section">
              <div className="detail-section-title">
                <span><SafetyCertificateOutlined /> 合作信息</span>
              </div>
              <div className="material-info-grid">
                <div><span>配送范围</span><b>{supplierPreview.delivery_scope || "未维护"}</b></div>
                <div><span>结算方式</span><b>{labelFromOptions(settlementOptions, supplierPreview.settlement_type)}</b></div>
                <div><span>到货周期</span><b>{hasValue(supplierPreview.lead_time_days) ? `${supplierPreview.lead_time_days} 天` : "未维护"}</b></div>
                <div><span>最小订购金额</span><b>{formatAmount(supplierPreview.min_order_amount)}</b></div>
                <div><span>备注</span><b>{supplierPreview.remark || "未维护"}</b></div>
              </div>
            </section>

            <section className="material-detail-section">
              <div className="detail-section-title">
                <span><DatabaseOutlined /> 绑定原料</span>
                <Tag>{supplierPreview.materials?.length || 0} 个</Tag>
              </div>
              <Table
                rowKey="id"
                size="small"
                loading={supplierDetailLoading}
                dataSource={supplierPreview.materials || []}
                pagination={false}
                locale={{ emptyText: <Empty description="暂无绑定原料" /> }}
                columns={[
                  {
                    title: "原料",
                    render: (_: unknown, row: SupplierMaterialRecord) => (
                      <div className="material-name-cell">
                        <b>{row.name}</b>
                        <span>{row.material_code}</span>
                      </div>
                    )
                  },
                  {
                    title: "分类",
                    width: 120,
                    render: (_: unknown, row: SupplierMaterialRecord) => labelFromOptions(categoryOptions, row.category)
                  },
                  {
                    title: "规格",
                    width: 120,
                    render: (_: unknown, row: SupplierMaterialRecord) => row.purchase_spec || row.unit || "-"
                  },
                  {
                    title: "状态",
                    width: 90,
                    render: (_: unknown, row: SupplierMaterialRecord) => (
                      <Tag color={row.status === "active" ? "green" : "default"}>{row.status === "active" ? "启用" : "停用"}</Tag>
                    )
                  }
                ]}
              />
            </section>

            {canManageMaterials ? (
              <div className="detail-action-row">
                <Button type="primary" icon={<EditOutlined />} onClick={() => startSupplierEdit(supplierPreview)}>编辑供货商档案</Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </Drawer>

      <Drawer
        className="material-detail-drawer"
        title="原料详情"
        open={Boolean(preview)}
        onClose={() => setPreview(null)}
        width={680}
        destroyOnHidden
      >
        {preview ? (
          <div className="material-detail-shell">
            <section className="material-detail-hero">
              <div className="material-detail-icon"><DatabaseOutlined /></div>
              <div>
                <span className="detail-kicker">{preview.material_code} · {preview.unit}</span>
                <h2>{preview.name}</h2>
                <p>
                  {labelFromOptions(categoryOptions, preview.category)} · {preview.purchase_spec || preview.spec || "未维护规格"} ·
                  安全库存线 {formatQty(preview.safety_stock, preview.unit)}。
                </p>
                <div className="product-detail-chip-row">
                  <Tag color={preview.status === "active" ? "green" : "default"}>{preview.status === "active" ? "启用" : "停用"}</Tag>
                  <Tag color={materialRisk(preview).color}>{materialRisk(preview).label}</Tag>
                  <Tag color={preview.is_key_material ? "green" : "default"}>{preview.is_key_material ? "关键原料" : "普通原料"}</Tag>
                  <Tag>{preview.latest_biz_date || "暂无库存快照"}</Tag>
                </div>
              </div>
            </section>

            <div className="detail-metric-grid">
              <div><span>安全库存</span><b>{formatQty(preview.safety_stock, preview.unit)}</b></div>
              <div><span>最近最低库存</span><b>{formatQty(preview.min_closing_stock, preview.unit)}</b></div>
              <div><span>到货周期</span><b>{hasValue(preview.lead_time_days) ? `${preview.lead_time_days} 天` : "-"}</b></div>
              <div><span>监控门店</span><b>{asNumber(preview.monitored_store_count)}</b></div>
            </div>

            <section className="material-detail-section">
              <div className="detail-section-title">
                <span><DatabaseOutlined /> 基础档案</span>
              </div>
              <div className="material-info-grid">
                <div><span>原料分类</span><b>{labelFromOptions(categoryOptions, preview.category)}</b></div>
                <div><span>库存单位</span><b>{preview.unit}</b></div>
                <div><span>规格说明</span><b>{preview.spec || "未维护"}</b></div>
                <div><span>采购规格</span><b>{preview.purchase_spec || "未维护"}</b></div>
                <div><span>储存方式</span><b>{labelFromOptions(storageOptions, preview.storage_method)}</b></div>
                <div><span>保质期</span><b>{hasValue(preview.shelf_life_days) ? `${preview.shelf_life_days} 天` : "未维护"}</b></div>
                <div><span>库存预警</span><b>{preview.stock_alert_enabled === false ? "不参与" : "参与"}</b></div>
                <div><span>备注</span><b>{preview.remark || "未维护"}</b></div>
              </div>
            </section>

            <section className="material-detail-section">
              <div className="detail-section-title">
                <span><SafetyCertificateOutlined /> 库存判断</span>
              </div>
              <p className="material-advice-text">
                {materialRisk(preview).key === "critical"
                  ? "已有门店最近库存为 0,应优先派发补货或核实库存盘点任务。"
                  : materialRisk(preview).key === "warning"
                    ? "部分门店低于安全库存线,建议结合未来两日销量检查备料。"
                    : materialRisk(preview).key === "unconfigured"
                      ? "当前原料未设置安全库存线,库存预警无法准确触发。"
                      : materialRisk(preview).key === "no_data"
                        ? "当前原料还没有库存快照,建议先通过数据导入补齐门店库存。"
                      : "当前原料没有明显库存风险,继续保持库存快照导入即可。"}
              </p>
            </section>

            <section className="material-detail-section">
              <div className="detail-section-title">
                <span><SafetyCertificateOutlined /> 供货信息</span>
                <Tag color={preview.supplier_name ? "green" : "default"}>{preview.supplier_name ? "已维护" : "待补充"}</Tag>
              </div>
              <div className="material-info-grid">
                <div><span>默认供货商</span><b>{preview.supplier_name || "未维护"}</b></div>
                <div><span>联系人</span><b>{preview.supplier_contact || "未维护"}</b></div>
                <div><span>联系电话</span><b>{preview.supplier_phone || "未维护"}</b></div>
                <div><span>最小订购量</span><b>{formatQty(preview.min_order_qty, preview.unit)}</b></div>
                <div><span>到货周期</span><b>{hasValue(preview.lead_time_days) ? `${preview.lead_time_days} 天` : "未维护"}</b></div>
                <div><span>供货备注</span><b>{preview.supplier_note || "未维护"}</b></div>
              </div>
            </section>

            <section className="material-detail-section">
              <div className="detail-section-title">
                <span><AlertOutlined /> 门店最近库存</span>
                <Tag>{preview.latest_inventory?.length || 0} 家门店</Tag>
              </div>
              <Table
                rowKey="store_id"
                size="small"
                loading={detailLoading}
                dataSource={preview.latest_inventory || []}
                pagination={false}
                locale={{ emptyText: <Empty description="暂无库存快照" /> }}
                columns={[
                  { title: "门店", dataIndex: "store_name" },
                  { title: "日期", dataIndex: "biz_date", width: 116 },
                  {
                    title: "期末库存",
                    width: 120,
                    render: (_: unknown, row: MaterialInventorySnapshot) => formatQty(row.closing_stock, preview.unit)
                  },
                  {
                    title: "状态",
                    width: 100,
                    render: (_: unknown, row: MaterialInventorySnapshot) => {
                      const stock = asNumber(row.closing_stock);
                      const safety = asNumber(preview.safety_stock);
                      const color = stock <= 0 ? "red" : hasValue(preview.safety_stock) && stock <= safety ? "orange" : "green";
                      const label = stock <= 0 ? "断货" : hasValue(preview.safety_stock) && stock <= safety ? "低库存" : "正常";
                      return <Tag color={color}>{label}</Tag>;
                    }
                  }
                ]}
              />
            </section>

            {canManageMaterials ? (
              <div className="detail-action-row">
                <Button type="primary" icon={<EditOutlined />} onClick={() => startEdit(preview)}>编辑原料档案</Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </Drawer>

      <Modal className="responsive-modal material-form-modal" title={editing ? "编辑原料" : "新增原料"} open={open} onCancel={() => setOpen(false)} footer={null} width={760} destroyOnHidden>
        <Form
          key={`material-${materialFormKey}`}
          preserve={false}
          layout="vertical"
          onFinish={submit}
          initialValues={materialFormInitialValues(editing)}
        >
          <div className="material-form-section-title">基础信息</div>
          <div className="material-form-grid">
            <Form.Item name="material_code" label="原料编码" rules={[{ required: true, message: "请输入原料编码" }]}>
              <Input placeholder="例如:MAT-TEA-001" />
            </Form.Item>
            <Form.Item name="name" label="原料名称" rules={[{ required: true, message: "请输入原料名称" }]}>
              <Input placeholder="例如:山茶茶底" />
            </Form.Item>
            <Form.Item name="category" label="原料分类" rules={[{ required: true, message: "请选择原料分类" }]}>
              <Select showSearch options={categoryOptions} placeholder="选择分类" />
            </Form.Item>
            <Form.Item name="status" label="状态">
              <Select options={statusOptions} />
            </Form.Item>
            <Form.Item name="unit" label="库存单位" rules={[{ required: true, message: "请输入单位" }]}>
              <Input placeholder="kg / L / 个 / 包 / 箱 / 瓶" />
            </Form.Item>
            <Form.Item name="spec" label="规格说明">
              <Input placeholder="例如:1L/瓶、1kg/份" />
            </Form.Item>
            <Form.Item name="purchase_spec" label="采购规格">
              <Input placeholder="例如:12瓶/箱、5kg/箱" />
            </Form.Item>
            <Form.Item name="safety_stock" label="安全库存线">
              <InputNumber min={0} precision={2} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="storage_method" label="储存方式">
              <Select allowClear options={storageOptions} placeholder="选择储存方式" />
            </Form.Item>
            <Form.Item name="shelf_life_days" label="保质期天数">
              <InputNumber min={0} precision={0} style={{ width: "100%" }} />
            </Form.Item>
          </div>
          <div className="material-form-checks">
            <Form.Item name="is_key_material" valuePropName="checked">
              <Checkbox>关键原料</Checkbox>
            </Form.Item>
            <Form.Item name="stock_alert_enabled" valuePropName="checked">
              <Checkbox>参与库存预警</Checkbox>
            </Form.Item>
          </div>

          <div className="material-form-section-title">供货信息</div>
          <div className="material-form-grid">
            <Form.Item name="supplier_id" label="默认供货商">
              <Select
                allowClear
                showSearch
                options={supplierOptions}
                optionFilterProp="label"
                placeholder="选择供货商档案"
              />
            </Form.Item>
            <Form.Item name="min_order_qty" label="最小订购量">
              <InputNumber min={0} precision={2} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="supplier_note" label="供货备注">
              <Input placeholder="配送区域、特殊要求等" />
            </Form.Item>
          </div>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={3} placeholder="盘点说明、替代规则、门店注意事项等" />
          </Form.Item>
          <Space className="modal-action-row">
            <Button type="primary" htmlType="submit" disabled={!canManageMaterials} loading={saving}>保存</Button>
            <Button onClick={() => setOpen(false)}>取消</Button>
          </Space>
        </Form>
      </Modal>

      <Modal
        className="responsive-modal material-form-modal"
        title={editingSupplier ? "编辑供货商" : "新增供货商"}
        open={supplierOpen}
        onCancel={() => setSupplierOpen(false)}
        footer={null}
        width={720}
        forceRender
        getContainer={false}
      >
        <Form
          key={`supplier-${supplierFormKey}`}
          preserve={false}
          layout="vertical"
          onFinish={submitSupplier}
          initialValues={supplierFormInitialValues(editingSupplier)}
        >
          <div className="material-form-grid">
            <Form.Item name="supplier_code" label="供货商编码" rules={[{ required: true, message: "请输入供货商编码" }]}>
              <Input placeholder="例如:SUP-FRUIT" />
            </Form.Item>
            <Form.Item name="name" label="供货商名称" rules={[{ required: true, message: "请输入供货商名称" }]}>
              <Input placeholder="例如:江浙鲜果供应" />
            </Form.Item>
            <Form.Item name="status" label="状态">
              <Select options={statusOptions} />
            </Form.Item>
            <Form.Item name="contact_name" label="联系人">
              <Input placeholder="联系人姓名" />
            </Form.Item>
            <Form.Item name="phone" label="联系电话">
              <Input placeholder="手机号或座机" />
            </Form.Item>
            <Form.Item name="delivery_scope" label="配送范围">
              <Input placeholder="例如:华东区域 / 全部门店" />
            </Form.Item>
            <Form.Item name="settlement_type" label="结算方式">
              <Select options={settlementOptions} />
            </Form.Item>
            <Form.Item name="lead_time_days" label="到货周期(天)">
              <InputNumber min={0} precision={0} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="min_order_amount" label="最小订购金额">
              <InputNumber min={0} precision={2} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="address" label="地址">
              <Input placeholder="仓库或联系人地址" />
            </Form.Item>
          </div>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={3} placeholder="供货要求、验收标准、配送说明等" />
          </Form.Item>
          <Space className="modal-action-row">
            <Button type="primary" htmlType="submit" disabled={!canManageMaterials} loading={supplierSaving}>保存</Button>
            <Button onClick={() => setSupplierOpen(false)}>取消</Button>
          </Space>
        </Form>
      </Modal>
    </>
  );
}
