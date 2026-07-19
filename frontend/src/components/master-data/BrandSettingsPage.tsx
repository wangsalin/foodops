"use client";

import {
  BgColorsOutlined,
  BookOutlined,
  CheckCircleOutlined,
  CloudOutlined,
  CommentOutlined,
  FileTextOutlined,
  HeartOutlined,
  UploadOutlined
} from "@ant-design/icons";
import { App, Button, Card, Col, Form, Input, Row, Space, Tabs, Tag, Typography, Upload } from "antd";
import type { UploadRequestOption } from "rc-upload/lib/interface";
import { useCallback, useEffect, useMemo, useState } from "react";

import { api } from "@/lib/api";
import { hasPermission, readStoredPermissions } from "@/lib/permissions";
import {
  defaultBrandConfig,
  normalizeBrandConfig,
  resolveBrandAssetUrl,
  type BrandAiPolicy,
  type BrandAsset,
  type BrandCulture,
  type BrandDocs,
  type BrandExpression
} from "@/lib/brand";

type BrandAssetForm = {
  system_name?: string;
  brand_name?: string;
  brand_short_name?: string;
  logo_url?: string;
  favicon_url?: string;
  primary_color?: string;
  accent_color?: string;
  font_cn?: string;
  font_en?: string;
  slogan?: string;
  tone?: string;
  forbidden_rules?: string;
  culture?: BrandCulture;
  expression?: BrandExpression;
  ai_policy?: BrandAiPolicy;
  brand_docs?: BrandDocs;
};

type BrandDocKey = keyof BrandDocs;
type BrandImageField = "logo_url" | "favicon_url";

const defaultBrand: BrandAssetForm = {
  system_name: defaultBrandConfig.systemName,
  brand_name: defaultBrandConfig.brandName,
  brand_short_name: defaultBrandConfig.brandShortName,
  logo_url: defaultBrandConfig.logoUrl,
  favicon_url: defaultBrandConfig.faviconUrl,
  primary_color: defaultBrandConfig.primaryColor,
  accent_color: defaultBrandConfig.accentColor,
  font_cn: defaultBrandConfig.fontCn,
  font_en: defaultBrandConfig.fontEn,
  slogan: defaultBrandConfig.slogan,
  tone: defaultBrandConfig.tone,
  forbidden_rules: defaultBrandConfig.forbiddenRules,
  culture: defaultBrandConfig.culture,
  expression: defaultBrandConfig.expression,
  ai_policy: defaultBrandConfig.aiPolicy,
  brand_docs: defaultBrandConfig.brandDocs
};

function brandAssetToForm(data?: BrandAsset | null): BrandAssetForm {
  const normalized = normalizeBrandConfig(data);
  return {
    system_name: normalized.systemName,
    brand_name: normalized.brandName,
    brand_short_name: normalized.brandShortName,
    logo_url: normalized.logoUrl,
    favicon_url: normalized.faviconUrl,
    primary_color: normalized.primaryColor,
    accent_color: normalized.accentColor,
    font_cn: normalized.fontCn,
    font_en: normalized.fontEn,
    slogan: normalized.slogan,
    tone: normalized.tone,
    forbidden_rules: normalized.forbiddenRules,
    culture: normalized.culture,
    expression: normalized.expression,
    ai_policy: normalized.aiPolicy,
    brand_docs: normalized.brandDocs
  };
}

function formToBrandAsset(values: BrandAssetForm): BrandAsset {
  return {
    system_name: values.system_name,
    brand_name: values.brand_name,
    brand_short_name: values.brand_short_name,
    logo_url: values.logo_url,
    favicon_url: values.favicon_url,
    primary_color: values.primary_color,
    accent_color: values.accent_color,
    font_cn: values.font_cn,
    font_en: values.font_en,
    slogan: values.slogan,
    tone: values.tone,
    forbidden_rules: values.forbidden_rules,
    culture: values.culture,
    expression: values.expression,
    ai_policy: values.ai_policy,
    brand_docs: values.brand_docs
  };
}

export function BrandSettingsPage() {
  const [form] = Form.useForm<BrandAssetForm>();
  const { message } = App.useApp();
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [uploadingImageField, setUploadingImageField] = useState<BrandImageField | null>(null);
  const [uploadingDocKey, setUploadingDocKey] = useState<BrandDocKey | null>(null);
  const [permissions, setPermissions] = useState(() => readStoredPermissions());
  const watched = Form.useWatch([], form) || defaultBrand;
  const preview = useMemo(() => normalizeBrandConfig(formToBrandAsset(watched)), [watched]);
  const canManageSystem = hasPermission(permissions, "system", "manage");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<BrandAsset | null>("/api/v1/brand-assets");
      form.setFieldsValue(brandAssetToForm(res.data));
    } catch {
      form.setFieldsValue(defaultBrand);
      message.warning("品牌配置暂未从后端读取,已使用本地默认值。");
    } finally {
      setLoading(false);
    }
  }, [form, message]);

  useEffect(() => {
    setPermissions(readStoredPermissions());
    load();
  }, [load]);

  function uploadBrandImage(field: BrandImageField, label: string) {
    return async (options: UploadRequestOption) => {
      if (!canManageSystem) {
        const uploadError = new Error("No system manage permission");
        options.onError?.(uploadError);
        message.warning("当前账号没有系统管理权限,不能上传品牌素材");
        return;
      }
      setUploadingImageField(field);
      try {
        const file = options.file as File;
        const data = new FormData();
        data.append("file", file);
        const res = await api.post("/api/v1/uploads/brand-assets", data, {
          headers: { "Content-Type": "multipart/form-data" }
        });
        form.setFieldValue(field, res.data.url);
        options.onSuccess?.(res.data);
        message.success(`${label}已上传,保存后生效。`);
      } catch (error) {
        const uploadError = error instanceof Error ? error : new Error(`${label} upload failed`);
        options.onError?.(uploadError);
        message.error(`${label}上传失败,请确认文件类型为 JPG、PNG、WebP 或 ICO,且不超过 5MB。`);
      } finally {
        setUploadingImageField(null);
      }
    };
  }

  function uploadBrandDoc(field: BrandDocKey) {
    return async (options: UploadRequestOption) => {
      if (!canManageSystem) {
        const uploadError = new Error("No system manage permission");
        options.onError?.(uploadError);
        message.warning("当前账号没有系统管理权限,不能上传品牌资料");
        return;
      }
      setUploadingDocKey(field);
      try {
        const file = options.file as File;
        const data = new FormData();
        data.append("file", file);
        const res = await api.post("/api/v1/uploads/brand-docs", data, {
          headers: { "Content-Type": "multipart/form-data" }
        });
        form.setFieldValue(["brand_docs", field], res.data.url);
        options.onSuccess?.(res.data);
        message.success("资料已上传,保存后生效。");
      } catch (error) {
        const uploadError = error instanceof Error ? error : new Error("Brand document upload failed");
        options.onError?.(uploadError);
        message.error("资料上传失败,请确认文件类型为 PDF、Word、Excel 或图片,且不超过 20MB。");
      } finally {
        setUploadingDocKey(null);
      }
    };
  }

  async function save(values: BrandAssetForm) {
    if (!canManageSystem) {
      message.warning("当前账号没有系统管理权限,不能修改品牌设置");
      return;
    }
    setSaving(true);
    try {
      await api.put("/api/v1/brand-assets", formToBrandAsset(values));
      window.dispatchEvent(new CustomEvent("foodops:brand-updated"));
      message.success("品牌设置已保存,AI 与页面将使用最新品牌规范。");
      await load();
    } catch {
      message.error("品牌设置保存失败,请检查登录状态和 system 管理权限。");
    } finally {
      setSaving(false);
    }
  }

  const tabItems = [
    {
      key: "asset",
      label: "基础品牌",
      children: <BrandAssetFields form={form} preview={preview} uploadBrandImage={uploadBrandImage} uploadingImageField={uploadingImageField} canManage={canManageSystem} />
    },
    {
      key: "culture",
      label: "企业文化",
      children: <CultureFields />
    },
    {
      key: "expression",
      label: "表达规范",
      children: <ExpressionFields />
    },
    {
      key: "ai",
      label: "AI 约束",
      children: <AiPolicyFields />
    },
    {
      key: "docs",
      label: "品牌资料",
      children: <BrandDocsFields uploadBrandDoc={uploadBrandDoc} uploadingDocKey={uploadingDocKey} canManage={canManageSystem} />
    }
  ];

  return (
    <main className="brand-settings-page">
      <section className="brand-settings-hero">
        <div>
          <Typography.Text className="section-kicker">Brand system</Typography.Text>
          <Typography.Title level={3}>品牌设置</Typography.Title>
          <Typography.Paragraph>
            统一维护品牌资产、企业文化、表达口径和 AI 输出边界。保存后将用于登录页、后台框架、经营大屏、AI 日报和异常归因。
          </Typography.Paragraph>
        </div>
        <div className="brand-settings-status">
          <Tag icon={<CheckCircleOutlined />} color="green">V1 本地生效</Tag>
          <Tag icon={<BgColorsOutlined />} color="gold">社区品牌</Tag>
          <Tag icon={<CloudOutlined />} color="blue">本地规则约束</Tag>
        </div>
      </section>

      <Row gutter={[16, 16]} align="top">
        <Col xs={24} xl={16}>
          <Card className="panel-card brand-settings-card" loading={loading}>
            <Form form={form} layout="vertical" onFinish={save} initialValues={defaultBrand} requiredMark={false} disabled={!canManageSystem}>
              <Tabs className="brand-settings-tabs" items={tabItems} />
              <div className="brand-settings-actions">
                <Button type="primary" htmlType="submit" loading={saving} disabled={!canManageSystem}>保存品牌设置</Button>
                <Button disabled={!canManageSystem} onClick={() => form.setFieldsValue(defaultBrand)}>恢复默认规范</Button>
              </div>
            </Form>
          </Card>
        </Col>

        <Col xs={24} xl={8}>
          <BrandPreview preview={preview} />
        </Col>
      </Row>
    </main>
  );
}

function BrandAssetFields({
  form,
  preview,
  uploadBrandImage,
  uploadingImageField,
  canManage
}: {
  form: ReturnType<typeof Form.useForm<BrandAssetForm>>[0];
  preview: ReturnType<typeof normalizeBrandConfig>;
  uploadBrandImage: (field: BrandImageField, label: string) => (options: UploadRequestOption) => Promise<void>;
  uploadingImageField: BrandImageField | null;
  canManage: boolean;
}) {
  return (
    <div className="brand-tab-panel">
      <div className="brand-logo-editor">
        <div className="brand-logo-editor-preview">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={resolveBrandAssetUrl(preview.logoUrl)} alt="品牌 Logo" />
        </div>
        <div className="brand-logo-editor-actions">
          <Typography.Text strong>Logo 与系统识别</Typography.Text>
          <Typography.Text type="secondary">建议使用透明背景 PNG 或 WebP。系统名称会展示在登录页、侧边栏和经营大屏。</Typography.Text>
          <Space wrap>
            <Upload accept="image/png,image/jpeg,image/webp" customRequest={uploadBrandImage("logo_url", "Logo")} maxCount={1} showUploadList={false}>
              <Button icon={<UploadOutlined />} disabled={!canManage} loading={uploadingImageField === "logo_url"}>上传 Logo</Button>
            </Upload>
            <Button disabled={!canManage} onClick={() => form.setFieldValue("logo_url", defaultBrand.logo_url)}>使用默认 Logo</Button>
          </Space>
        </div>
      </div>

      <Row gutter={12}>
        <Col xs={24} md={12}>
          <Form.Item name="system_name" label="系统名称" rules={[{ required: true, message: "请输入系统名称" }]}>
            <Input placeholder="FoodOps Community" />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item name="brand_name" label="品牌/组织名称" rules={[{ required: true, message: "请输入品牌名称" }]}>
            <Input placeholder="Community Operations" />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item name="brand_short_name" label="品牌简称">
            <Input placeholder="FoodOps" />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item label="Favicon / 移动端图标地址" className="brand-doc-form-item">
            <div className="brand-doc-upload-control">
              <Form.Item name="favicon_url" noStyle>
                <Input placeholder="/favicon.ico" />
              </Form.Item>
              <Upload accept=".ico,image/png,image/jpeg,image/webp,image/x-icon,image/vnd.microsoft.icon" customRequest={uploadBrandImage("favicon_url", "图标")} maxCount={1} showUploadList={false}>
                <Button icon={<UploadOutlined />} disabled={!canManage} loading={uploadingImageField === "favicon_url"}>上传图标</Button>
              </Upload>
            </div>
          </Form.Item>
        </Col>
      </Row>

      <Form.Item name="slogan" label="品牌口号">
        <Input placeholder="好味道的秘密藏在出品里,经营的答案沉在数据里。" />
      </Form.Item>

      <Form.Item name="logo_url" label="Logo 地址" rules={[{ required: true, message: "请输入 Logo 地址或上传图片" }]}>
        <Input placeholder="/logo.svg" />
      </Form.Item>

      <Row gutter={12}>
        <Col xs={24} md={12}>
          <Form.Item name="primary_color" label="主色" rules={[{ required: true, message: "请选择主色" }]}>
            <Input type="color" className="color-input" />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item name="accent_color" label="辅助色" rules={[{ required: true, message: "请选择辅助色" }]}>
            <Input type="color" className="color-input" />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item name="font_cn" label="中文字体">
            <Input placeholder="PingFang SC / Microsoft YaHei" />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item name="font_en" label="英文字体">
            <Input placeholder="Inter / system-ui" />
          </Form.Item>
        </Col>
      </Row>
    </div>
  );
}

function CultureFields() {
  return (
    <div className="brand-tab-panel">
      <div className="brand-section-note">
        <HeartOutlined />
        <div>
          <b>企业文化会进入 AI 日报和归因口径</b>
          <span>用于约束系统输出的价值观、服务承诺和经营判断方式。</span>
        </div>
      </div>
      <Row gutter={12}>
        <Col xs={24} md={12}>
          <Form.Item name={["culture", "mission"]} label="企业使命">
            <Input.TextArea rows={3} placeholder="企业为什么存在,解决什么经营问题。" />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item name={["culture", "vision"]} label="企业愿景">
            <Input.TextArea rows={3} placeholder="希望成为怎样的品牌或经营组织。" />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item name={["culture", "values"]} label="核心价值观">
            <Input.TextArea rows={4} placeholder="例如:真实、清爽、负责、持续复盘。" />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item name={["culture", "brand_story"]} label="品牌故事">
            <Input.TextArea rows={4} placeholder="描述品牌来源、茶饮理念、门店经营坚持。" />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item name={["culture", "business_philosophy"]} label="经营理念">
            <Input.TextArea rows={3} placeholder="总部如何看数据、门店、任务和复盘。" />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item name={["culture", "service_philosophy"]} label="服务理念">
            <Input.TextArea rows={3} placeholder="门店对顾客体验的基本态度。" />
          </Form.Item>
        </Col>
      </Row>
      <Form.Item name={["culture", "service_promise"]} label="顾客承诺">
        <Input.TextArea rows={3} placeholder="例如:口感稳定、出品干净、反馈及时、问题闭环。" />
      </Form.Item>
    </div>
  );
}

function ExpressionFields() {
  return (
    <div className="brand-tab-panel">
      <div className="brand-section-note">
        <CommentOutlined />
        <div>
          <b>表达规范控制系统文案与 AI 语言风格</b>
          <span>用于日报、任务说明、归因草稿和运营建议保持同一品牌口径。</span>
        </div>
      </div>
      <Form.Item name="tone" label="品牌语气">
        <Input.TextArea rows={3} placeholder="描述整体语气,例如清爽、茶感、年轻、可信赖。" />
      </Form.Item>
      <Row gutter={12}>
        <Col xs={24} md={12}>
          <Form.Item name={["expression", "voice_keywords"]} label="语气关键词">
            <Input.TextArea rows={3} placeholder="清爽、具体、克制、可信赖、带茶感" />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item name={["expression", "common_phrases"]} label="常用表达">
            <Input.TextArea rows={3} placeholder="经营看板、门店闭环、真实数据、今日重点" />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item name={["expression", "customer_reply_style"]} label="顾客回复风格">
            <Input.TextArea rows={3} placeholder="真诚、具体、先回应感受,再说明处理动作。" />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item name={["expression", "store_task_style"]} label="门店任务风格">
            <Input.TextArea rows={3} placeholder="明确问题、负责人、截止时间和验收口径。" />
          </Form.Item>
        </Col>
      </Row>
      <Form.Item name={["expression", "report_style"]} label="经营报告风格">
        <Input.TextArea rows={3} placeholder="先结论、再数据、再建议,避免空泛形容。" />
      </Form.Item>
      <Form.Item name="forbidden_rules" label="品牌禁用规则">
        <Input.TextArea rows={3} placeholder="描述不能出现的视觉、文案、框架或数据使用规则。" />
      </Form.Item>
      <Form.Item name={["expression", "banned_words"]} label="禁用词 / 禁用表达">
        <Input.TextArea rows={3} placeholder="夸大承诺、未经验证的归因、外部自动代理框架等。" />
      </Form.Item>
    </div>
  );
}

function AiPolicyFields() {
  return (
    <div className="brand-tab-panel">
      <div className="brand-section-note">
        <CloudOutlined />
        <div>
          <b>AI 约束会注入受控 AI</b>
          <span>仅影响 V1 已有日报、异常归因和运营建议口径,不接入外部自动代理框架。</span>
        </div>
      </div>
      <Row gutter={12}>
        <Col xs={24} md={12}>
          <Form.Item name={["ai_policy", "daily_report_rules"]} label="AI 日报规则">
            <Input.TextArea rows={4} placeholder="日报先输出经营结论,再列风险和跟进事项。" />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item name={["ai_policy", "attribution_rules"]} label="异常归因规则">
            <Input.TextArea rows={4} placeholder="归因只给可人工复核的可能原因,不直接判定责任。" />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item name={["ai_policy", "operation_advice_rules"]} label="运营建议规则">
            <Input.TextArea rows={4} placeholder="建议必须对应门店、产品、渠道或任务动作。" />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item name={["ai_policy", "output_boundaries"]} label="输出边界">
            <Input.TextArea rows={4} placeholder="不得编造数据,不得请求外部工具,不得输出未经验证的结论。" />
          </Form.Item>
        </Col>
      </Row>
    </div>
  );
}

function BrandDocsFields({
  uploadBrandDoc,
  uploadingDocKey,
  canManage
}: {
  uploadBrandDoc: (field: BrandDocKey) => (options: UploadRequestOption) => Promise<void>;
  uploadingDocKey: BrandDocKey | null;
  canManage: boolean;
}) {
  return (
    <div className="brand-tab-panel">
      <div className="brand-section-note">
        <BookOutlined />
        <div>
          <b>品牌资料索引</b>
          <span>V1 先记录本地资料地址;后续可与企业知识库 `brand / training / policy` 分类打通。</span>
        </div>
      </div>
      <Row gutter={12}>
        <Col xs={24} md={12}>
          <BrandDocUploadField
            field="culture_manual_url"
            label="企业文化手册"
            uploadBrandDoc={uploadBrandDoc}
            uploadingDocKey={uploadingDocKey}
            canManage={canManage}
          />
        </Col>
        <Col xs={24} md={12}>
          <BrandDocUploadField
            field="service_manual_url"
            label="门店服务手册"
            uploadBrandDoc={uploadBrandDoc}
            uploadingDocKey={uploadingDocKey}
            canManage={canManage}
          />
        </Col>
        <Col xs={24} md={12}>
          <BrandDocUploadField
            field="training_manual_url"
            label="培训资料"
            uploadBrandDoc={uploadBrandDoc}
            uploadingDocKey={uploadingDocKey}
            canManage={canManage}
          />
        </Col>
        <Col xs={24} md={12}>
          <BrandDocUploadField
            field="visual_spec_url"
            label="视觉规范"
            uploadBrandDoc={uploadBrandDoc}
            uploadingDocKey={uploadingDocKey}
            canManage={canManage}
          />
        </Col>
      </Row>
    </div>
  );
}

function BrandDocUploadField({
  field,
  label,
  uploadBrandDoc,
  uploadingDocKey,
  canManage
}: {
  field: BrandDocKey;
  label: string;
  uploadBrandDoc: (field: BrandDocKey) => (options: UploadRequestOption) => Promise<void>;
  uploadingDocKey: BrandDocKey | null;
  canManage: boolean;
}) {
  return (
    <Form.Item label={label} className="brand-doc-form-item">
      <div className="brand-doc-upload-control">
        <Form.Item name={["brand_docs", field]} noStyle>
          <Input placeholder="/uploads/brand-docs/..." />
        </Form.Item>
        <Upload
          accept=".pdf,.doc,.docx,.xls,.xlsx,image/png,image/jpeg,image/webp"
          maxCount={1}
          showUploadList={false}
          customRequest={uploadBrandDoc(field)}
        >
          <Button icon={<UploadOutlined />} disabled={!canManage} loading={uploadingDocKey === field}>上传</Button>
        </Upload>
      </div>
    </Form.Item>
  );
}

function BrandPreview({ preview }: { preview: ReturnType<typeof normalizeBrandConfig> }) {
  const cultureItems = [
    ["使命", preview.culture.mission],
    ["愿景", preview.culture.vision],
    ["价值观", preview.culture.values],
    ["顾客承诺", preview.culture.service_promise]
  ].filter(([, value]) => value);

  return (
    <Card className="panel-card brand-preview-card" title="品牌实时预览">
      <div className="brand-preview-logo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={preview.logoSrc} alt="品牌 Logo 预览" />
      </div>
      <div
        className="brand-preview-sample"
        style={{
          borderColor: preview.primaryColor,
          background: `linear-gradient(135deg, ${preview.primaryColor}18, #ffffffcc)`
        }}
      >
        <div className="brand-preview-kicker" style={{ color: preview.primaryColor }}>
          {preview.systemName}
        </div>
        <h3>{preview.brandName}</h3>
        <p>{preview.slogan}</p>
        <span style={{ backgroundColor: preview.accentColor }}>{preview.brandShortName}</span>
      </div>
      <div className="brand-rule-panel">
        <Typography.Text strong><HeartOutlined /> 企业文化</Typography.Text>
        {cultureItems.length ? (
          <ul className="brand-culture-preview">
            {cultureItems.map(([label, value]) => (
              <li key={label}>
                <b>{label}</b>
                <span>{value}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p>暂未维护企业文化。</p>
        )}
      </div>
      <div className="brand-rule-panel">
        <Typography.Text strong><FileTextOutlined /> AI 输出边界</Typography.Text>
        <p>{preview.aiPolicy.output_boundaries || preview.forbiddenRules}</p>
      </div>
    </Card>
  );
}
