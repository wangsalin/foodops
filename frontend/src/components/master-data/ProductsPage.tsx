"use client";

import { BarChartOutlined, CloseOutlined, DeleteOutlined, EditOutlined, EyeOutlined, FileTextOutlined, PictureOutlined, PlusOutlined, SearchOutlined, TagsOutlined, UploadOutlined } from "@ant-design/icons";
import { App, Button, Card, Drawer, Empty, Form, Image, Input, InputNumber, Modal, Select, Space, Table, Tag, Typography, Upload } from "antd";
import type { UploadRequestOption } from "rc-upload/lib/interface";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { api } from "@/lib/api";
import { hasPermission, readStoredPermissions } from "@/lib/permissions";

type ProductRecord = {
  id: string;
  sku: string;
  name: string;
  category?: string;
  status: string;
  price?: string | number;
  cost?: string | number;
  margin_rate?: string | number;
  description?: string;
  image_urls?: string[];
  ai_tags?: string[];
  social_rules?: string;
};

type ProductCategory = {
  id: string;
  name: string;
  status: string;
  sort?: number;
  product_count?: number | string;
};

type MaterialOption = {
  id: string;
  material_code: string;
  name: string;
  unit: string;
};

type ProductRecipeRecord = {
  id: string;
  product_id: string;
  material_id: string;
  material_code?: string;
  material_name?: string;
  quantity?: string | number;
  unit: string;
  loss_rate?: string | number;
  version: string;
  status: string;
};

type ProductAssetRecord = {
  id: string;
  product_id?: string;
  asset_type: string;
  name: string;
  file_url: string;
  thumbnail_url?: string;
  usage_scope?: string;
  status: string;
};

type ProductFormValues = {
  sku: string;
  name: string;
  category?: string;
  status: string;
  price?: number;
  cost?: number;
  description?: string;
  ai_tags?: string[];
  image_urls_text?: string;
  social_rules?: string;
};

type ProductCategoryFormValues = {
  name: string;
  status: string;
  sort?: number;
};

type RecipeFormValues = {
  recipes: Array<{
    material_id?: string;
    quantity?: number;
    unit?: string;
    loss_rate?: number;
    version?: string;
  }>;
};

type AssetFormValues = {
  asset_type: string;
  name: string;
  file_url: string;
  thumbnail_url?: string;
  usage_scope?: string;
};
const categoryStatusOptions = [
  { value: "active", label: "启用" },
  { value: "disabled", label: "停用" }
];
const statusOptions = [
  { value: "active", label: "上架" },
  { value: "disabled", label: "停用" }
];

const assetTypeOptions = [
  { value: "product_photo", label: "产品图" },
  { value: "marketing_image", label: "营销图" },
  { value: "package_reference", label: "包装参考" },
  { value: "design_material", label: "设计素材" },
  { value: "poster", label: "海报/物料" },
  { value: "other", label: "其他" }
];

function asNumber(value?: string | number) {
  if (value === undefined || value === null || value === "") return 0;
  return Number(value);
}

function formatMoney(value?: string | number) {
  return `¥${asNumber(value).toFixed(2)}`;
}

function formatMargin(value?: string | number) {
  const numberValue = asNumber(value);
  if (!numberValue) return "-";
  return `${(numberValue * 100).toFixed(1)}%`;
}

function normalizeText(value?: string | null) {
  return (value || "").trim().toLowerCase();
}

function parseImageUrls(value?: string) {
  return (value || "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function imageSrc(url?: string) {
  if (!url) return "";
  if (/^(https?:|data:|blob:)/.test(url)) return url;
  const base = api.defaults.baseURL || "";
  return `${base}${url}`;
}

function primaryImage(record: ProductRecord) {
  return record.image_urls?.find(Boolean);
}

export function ProductsPage() {
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [open, setOpen] = useState(false);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<ProductCategory | null>(null);
  const [editing, setEditing] = useState<ProductRecord | null>(null);
  const [preview, setPreview] = useState<ProductRecord | null>(null);
  const [keyword, setKeyword] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>();
  const [statusFilter, setStatusFilter] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [categorySaving, setCategorySaving] = useState(false);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [recipes, setRecipes] = useState<ProductRecipeRecord[]>([]);
  const [assets, setAssets] = useState<ProductAssetRecord[]>([]);
  const [materials, setMaterials] = useState<MaterialOption[]>([]);
  const [recipeOpen, setRecipeOpen] = useState(false);
  const [assetOpen, setAssetOpen] = useState(false);
  const [librarySaving, setLibrarySaving] = useState(false);
  const [permissions, setPermissions] = useState(() => readStoredPermissions());
  const [form] = Form.useForm<ProductFormValues>();
  const [recipeForm] = Form.useForm<RecipeFormValues>();
  const [assetForm] = Form.useForm<AssetFormValues>();
  const { message } = App.useApp();
  const router = useRouter();
  const canManageProducts = hasPermission(permissions, "products", "manage");
  const canReadRecipes = hasPermission(permissions, "recipes", "read");
  const canManageRecipes = hasPermission(permissions, "recipes", "manage");
  const canReadAssets = hasPermission(permissions, "assets", "read");
  const canManageAssets = hasPermission(permissions, "assets", "manage");
  const imageUrlsText = Form.useWatch("image_urls_text", form);
  const editingImageUrls = useMemo(() => parseImageUrls(imageUrlsText), [imageUrlsText]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [productRes, categoryRes] = await Promise.all([
        api.get("/api/v1/products"),
        api.get("/api/v1/products/categories")
      ]);
      setProducts(productRes.data);
      setCategories(categoryRes.data);
    } catch {
      message.error("产品数据加载失败，请确认后端服务和登录状态");
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    setPermissions(readStoredPermissions());
    load();
  }, [load]);

  const categoryStats = useMemo(
    () =>
      categories
        .filter((category) => category.status === "active")
        .map((category) => [category.name, Number(category.product_count || 0)] as [string, number]),
    [categories]
  );
  const categoryOptions = useMemo(
    () =>
      categories
        .filter((category) => category.status === "active")
        .map((category) => ({ value: category.name, label: category.name })),
    [categories]
  );

  const filteredProducts = useMemo(() => {
    const query = normalizeText(keyword);
    return products.filter((item) => {
      const matchesKeyword =
        !query ||
        normalizeText(item.name).includes(query) ||
        normalizeText(item.sku).includes(query) ||
        normalizeText(item.category).includes(query) ||
        normalizeText(item.description).includes(query) ||
        (item.ai_tags || []).some((tag) => normalizeText(tag).includes(query));
      const matchesCategory = !categoryFilter || (item.category || "未分类") === categoryFilter;
      const matchesStatus = !statusFilter || item.status === statusFilter;
      return matchesKeyword && matchesCategory && matchesStatus;
    });
  }, [categoryFilter, keyword, products, statusFilter]);

  const loadProductLibrary = useCallback(async (productId: string) => {
    setLibraryLoading(true);
    try {
      const requests: Promise<unknown>[] = [];
      if (canReadRecipes) requests.push(api.get("/api/v1/product-recipes", { params: { product_id: productId } }));
      if (canReadAssets) requests.push(api.get("/api/v1/product-assets", { params: { product_id: productId } }));
      const results = await Promise.all(requests);
      let index = 0;
      setRecipes(canReadRecipes ? (results[index++] as { data: ProductRecipeRecord[] }).data : []);
      setAssets(canReadAssets ? (results[index++] as { data: ProductAssetRecord[] }).data : []);
    } catch {
      message.error("V2 配方/素材加载失败");
    } finally {
      setLibraryLoading(false);
    }
  }, [canReadAssets, canReadRecipes, message]);

  useEffect(() => {
    if (preview?.id) {
      loadProductLibrary(preview.id);
    } else {
      setRecipes([]);
      setAssets([]);
    }
  }, [loadProductLibrary, preview?.id]);

  const activeCount = products.filter((item) => item.status === "active").length;
  const avgMargin = useMemo(() => {
    const margins = products.map((item) => asNumber(item.margin_rate)).filter(Boolean);
    if (!margins.length) return 0;
    return margins.reduce((sum, item) => sum + item, 0) / margins.length;
  }, [products]);

  function startCreate() {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ status: "active", category: categoryOptions[0]?.value });
    setOpen(true);
  }

  function startEdit(record: ProductRecord) {
    setPreview(null);
    setEditing(record);
    form.setFieldsValue({
      ...record,
      price: record.price ? Number(record.price) : undefined,
      cost: record.cost ? Number(record.cost) : undefined,
      image_urls_text: (record.image_urls || []).join("\n")
    });
    setOpen(true);
  }

  async function startEditRecipes() {
    if (!preview) return;
    try {
      const materialRes = await api.get("/api/v1/materials", { params: { status: "active" } });
      setMaterials(materialRes.data);
      recipeForm.setFieldsValue({
        recipes: recipes.map((item) => ({
          material_id: item.material_id,
          quantity: Number(item.quantity || 0),
          unit: item.unit,
          loss_rate: Number(item.loss_rate || 0),
          version: item.version || "v1"
        }))
      });
      setRecipeOpen(true);
    } catch {
      message.error("原料档案加载失败，无法维护配方");
    }
  }

  async function submitRecipes(values: RecipeFormValues) {
    if (!preview) return;
    setLibrarySaving(true);
    try {
      await api.put("/api/v1/product-recipes", {
        product_id: preview.id,
        recipes: (values.recipes || []).map((item) => ({
          material_id: item.material_id,
          quantity: item.quantity,
          unit: item.unit,
          loss_rate: item.loss_rate || 0,
          version: item.version || "v1",
          status: "active"
        }))
      });
      message.success("产品配方已更新");
      setRecipeOpen(false);
      await loadProductLibrary(preview.id);
    } catch {
      message.error("配方保存失败，请检查原料、用量和单位");
    } finally {
      setLibrarySaving(false);
    }
  }

  function startCreateAsset() {
    if (!preview) return;
    assetForm.resetFields();
    assetForm.setFieldsValue({ asset_type: "product_photo" });
    setAssetOpen(true);
  }

  async function uploadProductAsset(options: UploadRequestOption) {
    const file = options.file as File;
    if (file.size > 20 * 1024 * 1024) {
      message.error("素材不能超过 20MB");
      options.onError?.(new Error("asset too large"));
      return;
    }
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await api.post("/api/v1/uploads/product-assets", formData, {
        headers: { "Content-Type": "multipart/form-data" }
      });
      assetForm.setFieldsValue({
        file_url: res.data.url,
        name: assetForm.getFieldValue("name") || file.name
      });
      message.success("素材已上传");
      options.onSuccess?.(res.data);
    } catch {
      message.error("素材上传失败");
      options.onError?.(new Error("upload failed"));
    }
  }

  async function submitAsset(values: AssetFormValues) {
    if (!preview) return;
    setLibrarySaving(true);
    try {
      await api.post("/api/v1/product-assets", {
        product_id: preview.id,
        asset_type: values.asset_type,
        name: values.name,
        file_url: values.file_url,
        thumbnail_url: values.thumbnail_url || null,
        usage_scope: values.usage_scope || null
      });
      message.success("产品素材已登记");
      setAssetOpen(false);
      await loadProductLibrary(preview.id);
    } catch {
      message.error("素材登记失败，请检查类型和文件地址");
    } finally {
      setLibrarySaving(false);
    }
  }

  async function archiveAsset(assetId: string) {
    if (!preview) return;
    setLibrarySaving(true);
    try {
      await api.post(`/api/v1/product-assets/${assetId}/archive`);
      message.success("素材已归档");
      await loadProductLibrary(preview.id);
    } catch {
      message.error("素材归档失败");
    } finally {
      setLibrarySaving(false);
    }
  }

  async function submit(values: ProductFormValues) {
    const payload = {
      sku: values.sku,
      name: values.name,
      category: values.category || null,
      status: values.status,
      price: values.price,
      cost: values.cost,
      description: values.description || null,
      ai_tags: values.ai_tags || [],
      image_urls: parseImageUrls(values.image_urls_text),
      social_rules: values.social_rules || null
    };
    setSaving(true);
    try {
      if (editing) {
        await api.put(`/api/v1/products/${editing.id}`, payload);
        message.success("产品已更新");
      } else {
        await api.post("/api/v1/products", payload);
        message.success("产品已创建");
      }
      setOpen(false);
      form.resetFields();
      await load();
    } catch {
      message.error("产品保存失败，请检查 SKU 是否重复或字段是否完整");
    } finally {
      setSaving(false);
    }
  }

  async function uploadProductImage(options: UploadRequestOption) {
    const file = options.file as File;
    if (!file.type || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      message.error("仅支持 JPG、PNG、WebP 图片");
      options.onError?.(new Error("unsupported image type"));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      message.error("图片不能超过 5MB");
      options.onError?.(new Error("image too large"));
      return;
    }

    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await api.post("/api/v1/uploads/product-images", formData, {
        headers: { "Content-Type": "multipart/form-data" }
      });
      const nextUrls = [...editingImageUrls, res.data.url];
      form.setFieldValue("image_urls_text", nextUrls.join("\n"));
      message.success("产品图已上传");
      options.onSuccess?.(res.data);
    } catch {
      message.error("产品图上传失败，请稍后重试");
      options.onError?.(new Error("upload failed"));
    }
  }

  function removeEditingImage(url: string) {
    form.setFieldValue("image_urls_text", editingImageUrls.filter((item) => item !== url).join("\n"));
  }

  function startCreateCategory() {
    setEditingCategory(null);
    setCategoryOpen(true);
  }

  function startEditCategory(category: ProductCategory) {
    setEditingCategory(category);
    setCategoryOpen(true);
  }

  async function submitCategory(values: ProductCategoryFormValues) {
    setCategorySaving(true);
    try {
      const payload = {
        name: values.name,
        sort: values.sort || 0,
        status: values.status || "active"
      };
      if (editingCategory) {
        await api.put(`/api/v1/products/categories/${editingCategory.id}`, payload);
        message.success("产品分类已更新");
      } else {
        await api.post("/api/v1/products/categories", payload);
        message.success("产品分类已新增");
      }
      setCategoryOpen(false);
      setEditingCategory(null);
      await load();
    } catch {
      message.error("分类保存失败，请检查是否已存在同名分类");
    } finally {
      setCategorySaving(false);
    }
  }

  return (
    <>
      <div className="analysis-metric-grid product-metric-grid">
        <Card className="metric-card panel-card" loading={loading}>
          <Typography.Text type="secondary">SKU 总数</Typography.Text>
          <div className="ai-big-number">{products.length}</div>
          <div className="metric-foot">{activeCount} 个上架中</div>
        </Card>
        <Card className="metric-card panel-card" loading={loading}>
          <Typography.Text type="secondary">分类数</Typography.Text>
          <div className="ai-big-number">{categoryStats.length}</div>
          <div className="metric-foot">按产品档案分类统计</div>
        </Card>
        <Card className="metric-card panel-card" loading={loading}>
          <Typography.Text type="secondary">平均毛利率</Typography.Text>
          <div className="ai-big-number">{avgMargin ? `${(avgMargin * 100).toFixed(1)}%` : "-"}</div>
          <div className="metric-foot">基于维护的售价和成本</div>
        </Card>
        <Card className="metric-card panel-card" loading={loading}>
          <Typography.Text type="secondary">操作手册</Typography.Text>
          <div className="ai-big-number">{products.filter((item) => item.social_rules).length}</div>
          <div className="metric-foot">已维护制作/运营说明</div>
        </Card>
      </div>

      <Card className="panel-card" title="产品分类">
        <div className="product-filter-row">
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="搜索 SKU / 产品 / 分类 / 标签"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            onPressEnter={(event) => setKeyword(event.currentTarget.value)}
          />
          <Select
            allowClear
            placeholder="全部状态"
            value={statusFilter}
            options={statusOptions}
            onChange={setStatusFilter}
          />
          {canManageProducts ? (
            <Space className="product-filter-actions">
              <Button icon={<PlusOutlined />} onClick={startCreateCategory}>新增分类</Button>
              <Button type="primary" onClick={startCreate} disabled={!categoryOptions.length}>新增产品</Button>
            </Space>
          ) : null}
        </div>
        <div className="product-category-strip">
          <div className={!categoryFilter ? "product-category product-category-all active" : "product-category product-category-all"}>
            <button type="button" onClick={() => setCategoryFilter(undefined)}>
              <span>全部</span><b>{products.length}</b>
            </button>
          </div>
          {categoryStats.map(([category, count]) => (
            <div className={categoryFilter === category ? "product-category active" : "product-category"} key={category}>
              <button type="button" onClick={() => setCategoryFilter(category)}>
                <span>{category}</span><b>{count}</b>
              </button>
              {canManageProducts ? (
                <button
                  className="product-category-edit"
                  type="button"
                  aria-label={`编辑分类 ${category}`}
                  onClick={() => {
                    const target = categories.find((item) => item.name === category);
                    if (target) startEditCategory(target);
                  }}
                >
                  <EditOutlined />
                </button>
              ) : null}
            </div>
          ))}
        </div>
      </Card>

      <Card className="panel-card product-list-panel" title={`产品列表 · ${filteredProducts.length}/${products.length}`} style={{ marginTop: 16 }} loading={loading}>
        {filteredProducts.length ? (
          <div className="product-card-grid">
            {filteredProducts.map((record) => {
              const cover = primaryImage(record);
              return (
                <article className="product-profile-card" key={record.id}>
                  <button className="product-cover" type="button" onClick={() => setPreview(record)}>
                    {cover ? (
                      <Image src={imageSrc(cover)} alt={record.name} preview={false} />
                    ) : (
                      <span className="product-cover-placeholder">
                        <PictureOutlined />
                        <b>{record.name.slice(0, 1)}</b>
                      </span>
                    )}
                    <Tag color={record.status === "active" ? "green" : "default"} className="product-cover-status">
                      {record.status === "active" ? "上架" : "停用"}
                    </Tag>
                  </button>
                  <div className="product-card-body">
                    <div className="product-card-head">
                      <div>
                        <span className="product-card-sku">{record.sku} · {record.category || "未分类"}</span>
                        <h3>{record.name}</h3>
                      </div>
                      <b>{formatMoney(record.price)}</b>
                    </div>
                    <p>{record.description || "暂未维护产品说明，可补充口味、卖点和门店出品要点。"}</p>
                    <div className="product-card-metrics">
                      <span>成本 <b>{formatMoney(record.cost)}</b></span>
                      <span>毛利率 <b>{formatMargin(record.margin_rate)}</b></span>
                      <span>图片 <b>{record.image_urls?.length || 0}</b></span>
                    </div>
                    <div className="product-card-tags">
                      {(record.ai_tags || []).slice(0, 3).map((tag) => <Tag key={tag}>{tag}</Tag>)}
                      <Tag color={record.social_rules ? "green" : "default"}>{record.social_rules ? "已维护手册" : "未维护手册"}</Tag>
                    </div>
                    <div className="product-card-actions">
                      <Button icon={<EyeOutlined />} onClick={() => setPreview(record)}>查看</Button>
                      <Button icon={<BarChartOutlined />} onClick={() => router.push(`/analysis/products?product_id=${record.id}`)}>分析</Button>
                      {canManageProducts ? <Button type="primary" icon={<EditOutlined />} onClick={() => startEdit(record)}>编辑</Button> : null}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <Empty description="暂无产品档案，请先新增 SKU" />
        )}
      </Card>

      <Drawer
        className="product-detail-drawer"
        title="产品详情"
        open={Boolean(preview)}
        onClose={() => setPreview(null)}
        width={720}
        destroyOnHidden
      >
        {preview ? (
          <div className="product-detail-shell">
            <section className="product-detail-hero">
              <div className="product-detail-cover">
                {primaryImage(preview) ? (
                  <Image src={imageSrc(primaryImage(preview))} alt={preview.name} fallback="/logo.svg" preview={false} />
                ) : (
                  <span className="product-detail-cover-empty">
                    <PictureOutlined />
                    <b>{preview.name.slice(0, 1)}</b>
                  </span>
                )}
              </div>
              <div className="product-detail-main">
                <div className="product-detail-kicker">
                  <span>{preview.sku}</span>
                  <span>{preview.category || "未分类"}</span>
                </div>
                <h2>{preview.name}</h2>
                <p>{preview.description || "暂未维护产品说明。建议补充口味卖点、适用场景、出品要点和门店推荐话术。"}</p>
                <div className="product-detail-chip-row">
                  <Tag color={preview.status === "active" ? "green" : "default"}>{preview.status === "active" ? "上架" : "停用"}</Tag>
                  <Tag color={preview.social_rules ? "green" : "default"}>{preview.social_rules ? "已维护操作手册" : "未维护操作手册"}</Tag>
                  <Tag color={preview.image_urls?.length ? "green" : "default"}>{preview.image_urls?.length || 0} 张产品图</Tag>
                </div>
              </div>
            </section>

            <div className="detail-metric-grid">
              <div><span>售价</span><b>{formatMoney(preview.price)}</b></div>
              <div><span>成本</span><b>{formatMoney(preview.cost)}</b></div>
              <div><span>毛利率</span><b>{formatMargin(preview.margin_rate)}</b></div>
              <div><span>图片</span><b>{preview.image_urls?.length || 0}</b></div>
            </div>

            <section className="product-detail-section">
              <div className="detail-section-title">
                <span><TagsOutlined /> 运营标签</span>
                <Tag color={preview.ai_tags?.length ? "green" : "default"}>{preview.ai_tags?.length || 0} 个</Tag>
              </div>
              {preview.ai_tags?.length ? (
                <div className="product-detail-tags">
                  {preview.ai_tags.map((tag) => <Tag key={tag}>{tag}</Tag>)}
                </div>
              ) : (
                <div className="product-detail-empty">暂未维护运营标签，可用于看板筛选、AI 摘要和产品分析归因。</div>
              )}
            </section>

            <section className="product-detail-section">
              <div className="detail-section-title">
                <span><PictureOutlined /> 产品图片</span>
                <Tag>{preview.image_urls?.length || 0} 张</Tag>
              </div>
              {preview.image_urls?.length ? (
                <div className="product-image-preview">
                  {preview.image_urls.slice(0, 6).map((url) => (
                    <Image key={url} src={imageSrc(url)} alt={preview.name} fallback="/logo.svg" />
                  ))}
                </div>
              ) : (
                <div className="product-detail-empty">暂无产品图。建议上传清晰封面图，便于门店识别和产品分析展示。</div>
              )}
            </section>

            <section className="product-detail-section">
              <div className="detail-section-title">
                <span><FileTextOutlined /> V2 产品配方</span>
                <Space>
                  <Tag color={recipes.length ? "green" : "default"}>{recipes.length} 条</Tag>
                  {canManageRecipes ? <Button size="small" icon={<EditOutlined />} onClick={startEditRecipes}>维护配方</Button> : null}
                </Space>
              </div>
              {canReadRecipes ? (
                <Table
                  size="small"
                  loading={libraryLoading}
                  pagination={false}
                  rowKey="id"
                  dataSource={recipes}
                  columns={[
                    { title: "原料", dataIndex: "material_name", render: (value, row) => value || row.material_code || "-" },
                    { title: "用量", dataIndex: "quantity", width: 90, render: (value) => asNumber(value).toFixed(3) },
                    { title: "单位", dataIndex: "unit", width: 72 },
                    { title: "损耗", dataIndex: "loss_rate", width: 84, render: (value) => `${(asNumber(value) * 100).toFixed(1)}%` }
                  ]}
                />
              ) : (
                <div className="product-detail-empty">当前角色无产品配方权限。</div>
              )}
            </section>

            <section className="product-detail-section">
              <div className="detail-section-title">
                <span><PictureOutlined /> V2 产品素材</span>
                <Space>
                  <Tag color={assets.length ? "green" : "default"}>{assets.length} 个</Tag>
                  {canManageAssets ? <Button size="small" icon={<PlusOutlined />} onClick={startCreateAsset}>登记素材</Button> : null}
                </Space>
              </div>
              {canReadAssets ? (
                <Table
                  size="small"
                  loading={libraryLoading}
                  pagination={false}
                  rowKey="id"
                  dataSource={assets}
                  columns={[
                    { title: "名称", dataIndex: "name" },
                    { title: "类型", dataIndex: "asset_type", width: 120, render: (value) => assetTypeOptions.find((item) => item.value === value)?.label || value },
                    { title: "用途", dataIndex: "usage_scope", width: 120, render: (value) => value || "-" },
                    {
                      title: "操作",
                      width: 120,
                      render: (_, row) => (
                        <Space>
                          <Button size="small" href={imageSrc(row.file_url)} target="_blank">打开</Button>
                          {canManageAssets ? <Button size="small" danger icon={<DeleteOutlined />} loading={librarySaving} onClick={() => archiveAsset(row.id)} /> : null}
                        </Space>
                      )
                    }
                  ]}
                />
              ) : (
                <div className="product-detail-empty">当前角色无产品素材权限。</div>
              )}
            </section>

            <section className="product-detail-section product-manual-card">
              <div className="detail-section-title">
                <span><FileTextOutlined /> 操作手册</span>
                <Tag color={preview.social_rules ? "green" : "default"}>{preview.social_rules ? "已维护" : "待补充"}</Tag>
              </div>
              <Typography.Paragraph className="product-manual-text">
                {preview.social_rules || "暂未维护。建议补充制作要点、出品标准、门店注意事项和不可使用场景。"}
              </Typography.Paragraph>
              {!preview.social_rules ? (
                <ul className="product-manual-suggestion">
                  <li>制作参数：茶汤、糖度、冰量、出杯步骤。</li>
                  <li>出品标准：杯型、装饰、封口和交付检查。</li>
                  <li>跟进重点：缺料替代、客诉高发点、禁用场景。</li>
                </ul>
              ) : null}
            </section>

            {canManageProducts ? (
              <div className="detail-action-row">
                <Button icon={<BarChartOutlined />} onClick={() => router.push(`/analysis/products?product_id=${preview.id}`)}>查看经营分析</Button>
                <Button type="primary" icon={<EditOutlined />} onClick={() => startEdit(preview)}>编辑产品档案</Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </Drawer>

      <Modal title={editing ? "编辑产品" : "新增产品"} open={open} onCancel={() => setOpen(false)} footer={null} width={720} forceRender destroyOnHidden>
        <Form form={form} preserve={false} layout="vertical" onFinish={submit} initialValues={{ status: "active", category: "招牌茶" }}>
          <div className="product-form-grid">
            <Form.Item name="sku" label="SKU" rules={[{ required: true, message: "请输入 SKU" }]}><Input /></Form.Item>
            <Form.Item name="name" label="产品名称" rules={[{ required: true, message: "请输入产品名称" }]}><Input /></Form.Item>
            <Form.Item
              name="category"
              label="分类"
              rules={[{ required: true, message: "请先选择产品分类" }]}
              extra="分类需先在产品分类中单独新增。"
            >
              <Select
                showSearch
                options={categoryOptions}
                placeholder="选择产品分类"
                notFoundContent="请先新增产品分类"
                filterOption={(inputValue, option) =>
                  String(option?.label || "").toLowerCase().includes(inputValue.toLowerCase())
                }
              />
            </Form.Item>
            <Form.Item name="status" label="状态"><Select options={statusOptions} /></Form.Item>
            <Form.Item name="price" label="售价"><InputNumber min={0} precision={2} style={{ width: "100%" }} /></Form.Item>
            <Form.Item name="cost" label="成本"><InputNumber min={0} precision={2} style={{ width: "100%" }} /></Form.Item>
          </div>
          <Form.Item name="ai_tags" label="运营标签"><Select mode="tags" tokenSeparators={[",", "，"]} placeholder="例如：招牌、低糖、热销" /></Form.Item>
          <Form.Item name="description" label="产品说明"><Input.TextArea rows={3} /></Form.Item>
          <Form.Item name="image_urls_text" hidden><Input.TextArea /></Form.Item>
          <Form.Item label="产品图">
            <Upload.Dragger
              accept="image/jpeg,image/png,image/webp"
              customRequest={uploadProductImage}
              disabled={!canManageProducts}
              multiple
              showUploadList={false}
            >
              <p className="product-upload-icon"><UploadOutlined /></p>
              <p className="product-upload-title">上传产品图</p>
              <p className="product-upload-hint">支持 JPG、PNG、WebP，单张不超过 5MB。建议上传正方形或 4:3 产品图。</p>
            </Upload.Dragger>
            {editingImageUrls.length ? (
              <div className="product-edit-image-grid">
                {editingImageUrls.map((url) => (
                  <div className="product-edit-image" key={url}>
                    <Image src={imageSrc(url)} alt="产品图" preview={false} />
                    <button type="button" aria-label="移除产品图" onClick={() => removeEditingImage(url)}>
                      <CloseOutlined />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="product-upload-empty">还没有产品图，上传后会显示在产品列表和详情页。</div>
            )}
          </Form.Item>
          <Form.Item name="social_rules" label="操作手册">
            <Input.TextArea rows={6} placeholder="填写制作要点、出品标准、门店注意事项、禁用规则等。" />
          </Form.Item>
          <Space><Button type="primary" htmlType="submit" disabled={!canManageProducts} loading={saving}>保存</Button><Button onClick={() => setOpen(false)}>取消</Button></Space>
        </Form>
      </Modal>

      <Modal
        title="V2 产品配方"
        open={recipeOpen}
        onCancel={() => setRecipeOpen(false)}
        footer={null}
        width={760}
        destroyOnHidden
      >
        <Form form={recipeForm} layout="vertical" preserve={false} onFinish={submitRecipes} initialValues={{ recipes: [] }}>
          <Form.List name="recipes">
            {(fields, { add, remove }) => (
              <Space direction="vertical" style={{ width: "100%" }}>
                {fields.map(({ key, name, ...restField }) => (
                  <div className="product-form-grid" key={key}>
                    <Form.Item {...restField} name={[name, "material_id"]} label="原料" rules={[{ required: true, message: "请选择原料" }]}>
                      <Select
                        showSearch
                        options={materials.map((item) => ({ value: item.id, label: `${item.material_code} · ${item.name}` }))}
                        onChange={(value) => {
                          const material = materials.find((item) => item.id === value);
                          if (material) recipeForm.setFieldValue(["recipes", name, "unit"], material.unit);
                        }}
                        filterOption={(inputValue, option) => String(option?.label || "").toLowerCase().includes(inputValue.toLowerCase())}
                      />
                    </Form.Item>
                    <Form.Item {...restField} name={[name, "quantity"]} label="用量" rules={[{ required: true, message: "请填写用量" }]}>
                      <InputNumber min={0.001} precision={3} style={{ width: "100%" }} />
                    </Form.Item>
                    <Form.Item {...restField} name={[name, "unit"]} label="单位" rules={[{ required: true, message: "请填写单位" }]}>
                      <Input />
                    </Form.Item>
                    <Form.Item {...restField} name={[name, "loss_rate"]} label="损耗率">
                      <InputNumber min={0} max={1} precision={4} style={{ width: "100%" }} />
                    </Form.Item>
                    <Form.Item {...restField} name={[name, "version"]} label="版本">
                      <Input placeholder="v1" />
                    </Form.Item>
                    <Button danger icon={<DeleteOutlined />} onClick={() => remove(name)} />
                  </div>
                ))}
                <Button icon={<PlusOutlined />} onClick={() => add({ version: "v1", loss_rate: 0 })}>新增配方行</Button>
              </Space>
            )}
          </Form.List>
          <Space style={{ marginTop: 16 }}>
            <Button type="primary" htmlType="submit" disabled={!canManageRecipes} loading={librarySaving}>保存配方</Button>
            <Button onClick={() => setRecipeOpen(false)}>取消</Button>
          </Space>
        </Form>
      </Modal>

      <Modal
        title="V2 产品素材"
        open={assetOpen}
        onCancel={() => setAssetOpen(false)}
        footer={null}
        width={620}
        destroyOnHidden
      >
        <Form form={assetForm} layout="vertical" preserve={false} onFinish={submitAsset} initialValues={{ asset_type: "product_photo" }}>
          <Form.Item label="上传素材">
            <Upload.Dragger customRequest={uploadProductAsset} multiple={false} showUploadList={false} disabled={!canManageAssets}>
              <p className="product-upload-icon"><UploadOutlined /></p>
              <p className="product-upload-title">上传产品素材</p>
              <p className="product-upload-hint">支持图片、PDF、Word、Excel，单个文件不超过 20MB。</p>
            </Upload.Dragger>
          </Form.Item>
          <Form.Item name="asset_type" label="素材类型" rules={[{ required: true, message: "请选择素材类型" }]}>
            <Select options={assetTypeOptions} />
          </Form.Item>
          <Form.Item name="name" label="素材名称" rules={[{ required: true, message: "请输入素材名称" }]}>
            <Input />
          </Form.Item>
          <Form.Item name="file_url" label="文件地址" rules={[{ required: true, message: "请上传或填写文件地址" }]}>
            <Input />
          </Form.Item>
          <Form.Item name="thumbnail_url" label="缩略图地址">
            <Input />
          </Form.Item>
          <Form.Item name="usage_scope" label="使用范围">
            <Input placeholder="例如：外卖平台、小红书、门店海报" />
          </Form.Item>
          <Space>
            <Button type="primary" htmlType="submit" disabled={!canManageAssets} loading={librarySaving}>登记素材</Button>
            <Button onClick={() => setAssetOpen(false)}>取消</Button>
          </Space>
        </Form>
      </Modal>

      <Modal
        title={editingCategory ? "编辑产品分类" : "新增产品分类"}
        open={categoryOpen}
        onCancel={() => {
          setCategoryOpen(false);
          setEditingCategory(null);
        }}
        footer={null}
        width={460}
        destroyOnHidden
      >
        <Form
          key={editingCategory?.id || "new-product-category"}
          preserve={false}
          layout="vertical"
          onFinish={submitCategory}
          initialValues={
            editingCategory
              ? {
                  name: editingCategory.name,
                  status: editingCategory.status || "active",
                  sort: Number(editingCategory.sort || 0)
                }
              : { status: "active", sort: (categories.length + 1) * 10 }
          }
        >
          <Form.Item
            name="name"
            label="分类名称"
            rules={[{ required: true, message: "请输入分类名称" }]}
            extra="分类会进入产品表单下拉和产品分类筛选，不再在产品表单里临时输入。"
          >
            <Input placeholder="例如：轻乳茶、热饮、周边" />
          </Form.Item>
          <Form.Item name="status" label="状态">
            <Select options={categoryStatusOptions} />
          </Form.Item>
          <Form.Item name="sort" label="排序">
            <InputNumber min={0} precision={0} style={{ width: "100%" }} />
          </Form.Item>
          <Space>
            <Button type="primary" htmlType="submit" disabled={!canManageProducts} loading={categorySaving}>{editingCategory ? "保存修改" : "保存分类"}</Button>
            <Button onClick={() => {
              setCategoryOpen(false);
              setEditingCategory(null);
            }}>取消</Button>
          </Space>
        </Form>
      </Modal>
    </>
  );
}
