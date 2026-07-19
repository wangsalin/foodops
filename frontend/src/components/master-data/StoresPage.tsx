"use client";

import { PictureOutlined, ReloadOutlined, UploadOutlined } from "@ant-design/icons";
import { App, Button, Card, DatePicker, Descriptions, Drawer, Empty, Form, Image, Input, InputNumber, Modal, Select, Space, Table, Tag, Typography, Upload } from "antd";
import dayjs from "dayjs";
import type { UploadRequestOption } from "rc-upload/lib/interface";
import { useCallback, useEffect, useMemo, useState } from "react";

import { api } from "@/lib/api";
import { hasPermission, readStoredPermissions } from "@/lib/permissions";

type StoreRecord = {
  id: string;
  code: string;
  name: string;
  store_type: string;
  region?: string;
  address?: string;
  manager_user_id?: string;
  manager_name?: string;
  franchisee_user_id?: string;
  franchisee_name?: string;
  status: string;
  opened_at?: string;
  cover_image_url?: string;
  image_urls?: string[];
  store_format?: string;
  store_level?: string;
  business_district_type?: string;
  area_sqm?: string | number;
  seat_count?: number;
  contact_phone?: string;
  operating_hours?: string;
  channel_tags?: string[];
  property_tags?: string[];
  latitude?: string | number;
  longitude?: string | number;
};

type StoreFormValues = Omit<StoreRecord, "id" | "manager_name" | "franchisee_name" | "opened_at" | "image_urls"> & {
  opened_at?: dayjs.Dayjs | null;
  image_urls_text?: string;
};

type UserRecord = {
  id: string;
  name: string;
  username?: string;
  department_name?: string;
  role_name?: string;
};

const storeFormatOptions = [
  { value: "standard", label: "标准店" },
  { value: "flagship", label: "旗舰店" },
  { value: "stall", label: "档口店" },
  { value: "mall", label: "商场店" },
  { value: "street", label: "街边店" },
  { value: "takeaway", label: "外卖店" }
];

const districtOptions = [
  { value: "community", label: "社区" },
  { value: "office", label: "写字楼" },
  { value: "school", label: "学校" },
  { value: "mall", label: "商场" },
  { value: "scenic", label: "景区" },
  { value: "transport", label: "交通枢纽" }
];

const channelOptions = ["堂食", "外卖", "自提", "团购", "私域"];
const propertyOptions = ["明档", "后厨", "冷藏", "打包区", "高峰店", "新店", "重点店"];

function optionLabel(options: { value: string; label: string }[], value?: string) {
  return options.find((item) => item.value === value)?.label || value || "-";
}

function formatRegionName(value?: string | null) {
  if (!value) return "未分区";
  if (/^scope[-_]/i.test(value)) return "未分组区域";
  return value;
}

function formatStoreName(value?: string | null) {
  if (!value) return "未命名门店";
  if (/^Scope Store/i.test(value)) return "测试门店";
  return value;
}

function formatStoreCode(value?: string | null) {
  if (!value) return "-";
  if (/^TMP-SUP-A-/i.test(value)) return "验收督导门店A";
  if (/^TMP-SUP-B-/i.test(value)) return "验收督导门店B";
  if (/^TMP-SUP-C-/i.test(value)) return "验收督导门店C";
  return value;
}

function formatAddress(value?: string | null) {
  if (!value) return "-";
  if (/^Scope Store/i.test(value)) return "测试地址";
  return value;
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

function primaryStoreImage(record: StoreRecord) {
  return record.cover_image_url || record.image_urls?.find(Boolean);
}

export function StoresPage() {
  const [stores, setStores] = useState<StoreRecord[]>([]);
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<StoreRecord | null>(null);
  const [preview, setPreview] = useState<StoreRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>();
  const [statusFilter, setStatusFilter] = useState<string>();
  const [permissions, setPermissions] = useState(() => readStoredPermissions());
  const [form] = Form.useForm<StoreFormValues>();
  const { message } = App.useApp();
  const canManageStores = hasPermission(permissions, "stores", "manage");
  const imageUrlsText = Form.useWatch("image_urls_text", form);
  const editingImageUrls = useMemo(() => parseImageUrls(imageUrlsText), [imageUrlsText]);

  const summary = useMemo(() => {
    return stores.reduce(
      (acc, store) => {
        acc.total += 1;
        if (store.status === "active") acc.active += 1;
        if (store.store_type === "direct") acc.direct += 1;
        if (store.store_type === "franchise") acc.franchise += 1;
        if (!store.manager_user_id) acc.unbound += 1;
        if (!primaryStoreImage(store)) acc.missingImages += 1;
        return acc;
      },
      { total: 0, active: 0, direct: 0, franchise: 0, unbound: 0, missingImages: 0 }
    );
  }, [stores]);

  const filteredStores = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    return stores.filter((store) => {
      if (typeFilter && store.store_type !== typeFilter) return false;
      if (statusFilter && store.status !== statusFilter) return false;
      if (!normalizedKeyword) return true;
      return [
        store.code,
        store.name,
        store.region,
        store.address,
        store.manager_name,
        store.franchisee_name,
        store.store_format,
        store.business_district_type,
        ...(store.channel_tags || []),
        ...(store.property_tags || [])
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedKeyword));
    });
  }, [keyword, statusFilter, stores, typeFilter]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [storeRes, userRes] = await Promise.all([
        api.get("/api/v1/stores"),
        api.get("/api/v1/org/users").catch(() => ({ data: [] }))
      ]);
      setStores(storeRes.data);
      setUsers(userRes.data);
    } catch {
      message.error("门店数据加载失败,请确认后端服务和登录状态");
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    setPermissions(readStoredPermissions());
    load();
  }, [load]);

  function userOptions() {
    return users.map((user) => ({
      value: user.id,
      label: `${user.name}${user.department_name ? ` · ${user.department_name}` : ""}${user.role_name ? ` · ${user.role_name}` : ""}`
    }));
  }

  function startCreate() {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ store_type: "direct", status: "active", store_format: "standard", store_level: "B", channel_tags: ["堂食"], property_tags: [] });
    setOpen(true);
  }

  function startEdit(record: StoreRecord) {
    setPreview(null);
    setEditing(record);
    form.setFieldsValue({
      ...record,
      opened_at: record.opened_at ? dayjs(record.opened_at) : null,
      image_urls_text: (record.image_urls || []).join("\n"),
      area_sqm: record.area_sqm ? Number(record.area_sqm) : undefined,
      latitude: record.latitude ? Number(record.latitude) : undefined,
      longitude: record.longitude ? Number(record.longitude) : undefined
    });
    setOpen(true);
  }

  async function submit(values: StoreFormValues) {
    const imageUrls = parseImageUrls(values.image_urls_text);
    setSaving(true);
    try {
      const payload = {
        code: values.code,
        name: values.name,
        store_type: values.store_type,
        region: values.region || null,
        address: values.address || null,
        manager_user_id: values.manager_user_id ?? null,
        franchisee_user_id: values.franchisee_user_id ?? null,
        status: values.status,
        opened_at: values.opened_at ? dayjs(values.opened_at).format("YYYY-MM-DD") : null,
        cover_image_url: values.cover_image_url || imageUrls[0] || null,
        image_urls: imageUrls,
        store_format: values.store_format || null,
        store_level: values.store_level || null,
        business_district_type: values.business_district_type || null,
        area_sqm: values.area_sqm ?? null,
        seat_count: values.seat_count ?? null,
        contact_phone: values.contact_phone || null,
        operating_hours: values.operating_hours || null,
        channel_tags: values.channel_tags || [],
        property_tags: values.property_tags || [],
        latitude: values.latitude ?? null,
        longitude: values.longitude ?? null
      };
      if (editing) {
        await api.put(`/api/v1/stores/${editing.id}`, payload);
        message.success("门店已更新");
      } else {
        await api.post("/api/v1/stores", payload);
        message.success("门店已创建");
      }
      setOpen(false);
      form.resetFields();
      await load();
    } catch {
      message.error("门店档案保存失败,请检查编码是否重复或字段是否合法");
    } finally {
      setSaving(false);
    }
  }

  async function uploadStoreImage(options: UploadRequestOption) {
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
      const res = await api.post("/api/v1/uploads/store-images", formData, {
        headers: { "Content-Type": "multipart/form-data" }
      });
      const nextUrls = [...editingImageUrls, res.data.url];
      form.setFieldValue("image_urls_text", nextUrls.join("\n"));
      if (!form.getFieldValue("cover_image_url")) {
        form.setFieldValue("cover_image_url", res.data.url);
      }
      message.success("门店图片已上传");
      options.onSuccess?.(res.data);
    } catch {
      message.error("门店图片上传失败,请稍后重试");
      options.onError?.(new Error("upload failed"));
    }
  }

  function removeEditingImage(url: string) {
    const nextUrls = editingImageUrls.filter((item) => item !== url);
    form.setFieldValue("image_urls_text", nextUrls.join("\n"));
    if (form.getFieldValue("cover_image_url") === url) {
      form.setFieldValue("cover_image_url", nextUrls[0] || "");
    }
  }

  return (
    <>
      <section className="flow-band">
        <div>
          <span className="flow-kicker">门店主数据</span>
          <div className="flow-title">已建档 {summary.total} 家,营业中 {summary.active} 家</div>
          <div className="flow-text">直营 {summary.direct} 家 · 加盟 {summary.franchise} 家 · 待绑定负责人 {summary.unbound} 家 · 缺少图片 {summary.missingImages} 家</div>
        </div>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>刷新</Button>
          {canManageStores ? <Button type="primary" onClick={startCreate}>新增门店</Button> : null}
        </Space>
      </section>

      <Card
        className="panel-card"
        title={`门店列表 · ${filteredStores.length}/${summary.total}`}
        extra={
          <div className="task-filter-bar">
            <Input.Search
              allowClear
              placeholder="搜索编码 / 门店 / 区域 / 负责人"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              onSearch={setKeyword}
            />
            <Select
              allowClear
              placeholder="全部类型"
              value={typeFilter}
              onChange={setTypeFilter}
              options={[
                { value: "direct", label: "直营" },
                { value: "franchise", label: "加盟" }
              ]}
            />
            <Select
              allowClear
              placeholder="全部状态"
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: "active", label: "营业" },
                { value: "disabled", label: "停用" }
              ]}
            />
          </div>
        }
      >
        <Table
          loading={loading}
          rowKey="id"
          dataSource={filteredStores}
          locale={{ emptyText: <Empty description="当前筛选下暂无门店" /> }}
          scroll={{ x: 1380 }}
          columns={[
            { title: "编码", dataIndex: "code", width: 110, render: formatStoreCode },
            {
              title: "门店",
              dataIndex: "name",
              width: 260,
              render: (_: string, record: StoreRecord) => {
                const cover = primaryStoreImage(record);
                return (
                  <div className="store-list-cell">
                    <div className="store-list-cover">
                      {cover ? (
                        <Image src={imageSrc(cover)} alt={record.name} preview={false} />
                      ) : (
                        <PictureOutlined />
                      )}
                    </div>
                    <div>
                      <b>{formatStoreName(record.name)}</b>
                      <span>{optionLabel(storeFormatOptions, record.store_format)} · {optionLabel(districtOptions, record.business_district_type)}</span>
                    </div>
                  </div>
                );
              }
            },
            { title: "类型", dataIndex: "store_type", width: 100, render: (value: string) => <Tag color={value === "direct" ? "green" : "gold"}>{value === "direct" ? "直营" : "加盟"}</Tag> },
            { title: "等级", dataIndex: "store_level", width: 90, render: (value: string) => value ? <Tag color={value === "A" ? "green" : value === "B" ? "blue" : "default"}>{value} 级</Tag> : "-" },
            { title: "区域", dataIndex: "region", width: 120, render: (value: string) => formatRegionName(value) },
            { title: "地址", dataIndex: "address", ellipsis: true, render: (value: string) => formatAddress(value) },
            { title: "负责人", dataIndex: "manager_name", width: 130, render: (value: string) => value || "待绑定" },
            { title: "加盟商", dataIndex: "franchisee_name", width: 130, render: (value: string) => value || "-" },
            { title: "渠道", dataIndex: "channel_tags", width: 160, render: (value: string[]) => value?.length ? value.slice(0, 2).map((tag) => <Tag key={tag}>{tag}</Tag>) : "-" },
            { title: "状态", dataIndex: "status", width: 100, render: (value: string) => <Tag color={value === "active" ? "green" : "default"}>{value === "active" ? "营业" : "停用"}</Tag> },
            { title: "开业日期", dataIndex: "opened_at", width: 130, render: (value: string) => value || "-" },
            {
              title: "操作",
              fixed: "right",
              width: 150,
              render: (_: unknown, record: StoreRecord) => (
                <Space>
                  <Button type="link" onClick={() => setPreview(record)}>预览</Button>
                  {canManageStores ? <Button type="link" onClick={() => startEdit(record)}>编辑</Button> : null}
                </Space>
              )
            }
          ]}
        />
      </Card>

      <Drawer title={preview ? `门店预览:${formatStoreName(preview.name)}` : "门店预览"} open={Boolean(preview)} onClose={() => setPreview(null)} width={560} destroyOnHidden>
        {preview ? (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <section className="detail-hero store-profile-hero">
              <div className="store-profile-cover">
                {primaryStoreImage(preview) ? (
                  <Image src={imageSrc(primaryStoreImage(preview))} alt={preview.name} preview />
                ) : (
                  <PictureOutlined />
                )}
              </div>
              <div className="store-profile-title">
                <span className="detail-kicker">{formatStoreCode(preview.code)} · {formatRegionName(preview.region)}</span>
                <h3>{formatStoreName(preview.name)}</h3>
                <p>{preview.address || "暂未维护地址"}</p>
                <Space wrap>
                  <Tag color={preview.status === "active" ? "green" : "default"}>{preview.status === "active" ? "营业" : "停用"}</Tag>
                  <Tag>{optionLabel(storeFormatOptions, preview.store_format)}</Tag>
                  {preview.store_level ? <Tag color={preview.store_level === "A" ? "green" : "blue"}>{preview.store_level} 级门店</Tag> : null}
                </Space>
              </div>
            </section>
            <div className="store-profile-metrics">
              <div><span>面积</span><b>{preview.area_sqm ? `${preview.area_sqm} ㎡` : "-"}</b></div>
              <div><span>座位</span><b>{preview.seat_count ?? "-"}</b></div>
              <div><span>商圈</span><b>{optionLabel(districtOptions, preview.business_district_type)}</b></div>
            </div>
            <Descriptions bordered size="small" column={1}>
              <Descriptions.Item label="门店编码">{formatStoreCode(preview.code)}</Descriptions.Item>
              <Descriptions.Item label="门店类型">{preview.store_type === "direct" ? "直营" : "加盟"}</Descriptions.Item>
              <Descriptions.Item label="门店形态">{optionLabel(storeFormatOptions, preview.store_format)}</Descriptions.Item>
              <Descriptions.Item label="门店等级">{preview.store_level ? `${preview.store_level} 级` : "-"}</Descriptions.Item>
              <Descriptions.Item label="商圈属性">{optionLabel(districtOptions, preview.business_district_type)}</Descriptions.Item>
              <Descriptions.Item label="区域">{formatRegionName(preview.region)}</Descriptions.Item>
              <Descriptions.Item label="地址">{formatAddress(preview.address)}</Descriptions.Item>
              <Descriptions.Item label="门店电话">{preview.contact_phone || "-"}</Descriptions.Item>
              <Descriptions.Item label="营业时间">{preview.operating_hours || "-"}</Descriptions.Item>
              <Descriptions.Item label="负责人">{preview.manager_name || "待绑定"}</Descriptions.Item>
              <Descriptions.Item label="加盟商">{preview.franchisee_name || "-"}</Descriptions.Item>
              <Descriptions.Item label="开业日期">{preview.opened_at || "-"}</Descriptions.Item>
              <Descriptions.Item label="位置坐标">{preview.latitude && preview.longitude ? `${preview.latitude}, ${preview.longitude}` : "-"}</Descriptions.Item>
            </Descriptions>
            <section className="store-profile-tags">
              <div>
                <Typography.Text strong>经营渠道</Typography.Text>
                <Space wrap>{preview.channel_tags?.length ? preview.channel_tags.map((tag) => <Tag key={tag}>{tag}</Tag>) : <Tag>未维护</Tag>}</Space>
              </div>
              <div>
                <Typography.Text strong>门店属性</Typography.Text>
                <Space wrap>{preview.property_tags?.length ? preview.property_tags.map((tag) => <Tag key={tag}>{tag}</Tag>) : <Tag>未维护</Tag>}</Space>
              </div>
            </section>
            <section className="store-profile-gallery">
              <div className="detail-section-head">
                <Typography.Text strong>门店图片</Typography.Text>
                <Tag>{preview.image_urls?.length || 0} 张</Tag>
              </div>
              {preview.image_urls?.length ? (
                <Image.PreviewGroup>
                  <div className="store-gallery-grid">
                    {preview.image_urls.slice(0, 8).map((url) => (
                      <Image key={url} src={imageSrc(url)} alt={preview.name} />
                    ))}
                  </div>
                </Image.PreviewGroup>
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂未上传门店图片" />
              )}
            </section>
            <div className="detail-action-row">
              <Button onClick={() => window.location.href = `/analysis/stores?store_id=${preview.id}`}>查看经营分析</Button>
              {canManageStores ? <Button type="primary" onClick={() => startEdit(preview)}>编辑档案</Button> : null}
            </div>
          </Space>
        ) : null}
      </Drawer>

      <Modal title={editing ? "编辑门店" : "新增门店"} open={open} onCancel={() => setOpen(false)} footer={null} width={860} forceRender destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={submit} preserve={false} initialValues={{ store_type: "direct", status: "active", store_format: "standard", store_level: "B", channel_tags: ["堂食"] }}>
          <section className="store-form-section">
            <Typography.Text strong>门店图片</Typography.Text>
            <Form.Item name="image_urls_text" hidden><Input.TextArea /></Form.Item>
            <Form.Item name="cover_image_url" hidden><Input /></Form.Item>
            <Upload.Dragger
              accept="image/png,image/jpeg,image/webp"
              customRequest={uploadStoreImage}
              disabled={!canManageStores}
              maxCount={1}
              showUploadList={false}
            >
              <p className="product-upload-icon"><UploadOutlined /></p>
              <p className="ant-upload-text">上传门店门头、店内或环境图</p>
              <p className="ant-upload-hint">支持 JPG、PNG、WebP,单张不超过 5MB。首张默认作为封面。</p>
            </Upload.Dragger>
            {editingImageUrls.length ? (
              <div className="store-edit-image-grid">
                {editingImageUrls.map((url) => (
                  <div className="store-edit-image" key={url}>
                    <Image src={imageSrc(url)} alt="门店图片" />
                    <Space>
                      <Button size="small" onClick={() => form.setFieldValue("cover_image_url", url)}>设为封面</Button>
                      <Button size="small" danger onClick={() => removeEditingImage(url)}>移除</Button>
                    </Space>
                  </div>
                ))}
              </div>
            ) : null}
          </section>

          <section className="store-form-grid">
            <Form.Item name="code" label="门店编码" rules={[{ required: true, message: "请输入门店编码" }]}><Input /></Form.Item>
            <Form.Item name="name" label="门店名称" rules={[{ required: true, message: "请输入门店名称" }]}><Input /></Form.Item>
            <Form.Item name="store_type" label="经营类型"><Select options={[{ value: "direct", label: "直营" }, { value: "franchise", label: "加盟" }]} /></Form.Item>
            <Form.Item name="store_format" label="门店形态"><Select options={storeFormatOptions} /></Form.Item>
            <Form.Item name="store_level" label="门店等级"><Select options={[{ value: "A", label: "A 级" }, { value: "B", label: "B 级" }, { value: "C", label: "C 级" }]} /></Form.Item>
            <Form.Item name="business_district_type" label="商圈属性"><Select allowClear options={districtOptions} /></Form.Item>
            <Form.Item name="region" label="区域"><Input placeholder="上海 / 杭州 / 华东一区" /></Form.Item>
            <Form.Item name="address" label="详细地址"><Input /></Form.Item>
            <Form.Item name="area_sqm" label="面积(㎡)"><InputNumber min={0} precision={2} style={{ width: "100%" }} /></Form.Item>
            <Form.Item name="seat_count" label="座位数"><InputNumber min={0} precision={0} style={{ width: "100%" }} /></Form.Item>
            <Form.Item name="contact_phone" label="门店电话"><Input /></Form.Item>
            <Form.Item name="operating_hours" label="营业时间"><Input placeholder="10:00-22:00" /></Form.Item>
            <Form.Item name="manager_user_id" label="负责人"><Select allowClear showSearch optionFilterProp="label" options={userOptions()} /></Form.Item>
            <Form.Item name="franchisee_user_id" label="加盟商 / 投资人"><Select allowClear showSearch optionFilterProp="label" options={userOptions()} /></Form.Item>
            <Form.Item name="status" label="状态"><Select options={[{ value: "active", label: "营业" }, { value: "disabled", label: "停用" }]} /></Form.Item>
            <Form.Item name="opened_at" label="开业日期"><DatePicker style={{ width: "100%" }} /></Form.Item>
            <Form.Item name="latitude" label="纬度"><InputNumber precision={6} style={{ width: "100%" }} /></Form.Item>
            <Form.Item name="longitude" label="经度"><InputNumber precision={6} style={{ width: "100%" }} /></Form.Item>
          </section>

          <section className="store-form-section">
            <Form.Item name="channel_tags" label="经营渠道">
              <Select mode="tags" options={channelOptions.map((item) => ({ value: item, label: item }))} tokenSeparators={[",", ","]} />
            </Form.Item>
            <Form.Item name="property_tags" label="门店属性">
              <Select mode="tags" options={propertyOptions.map((item) => ({ value: item, label: item }))} tokenSeparators={[",", ","]} />
            </Form.Item>
          </section>

          <Space>
            <Button type="primary" htmlType="submit" disabled={!canManageStores} loading={saving}>保存门店档案</Button>
            <Button onClick={() => setOpen(false)}>取消</Button>
          </Space>
        </Form>
      </Modal>
    </>
  );
}
