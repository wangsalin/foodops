"use client";

import { App, Alert, Button, Card, Drawer, Form, Select, Space, Table, Tag, Typography, Upload } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { UploadFile } from "antd/es/upload/interface";
import {
  BellOutlined,
  CheckCircleOutlined,
  DownloadOutlined,
  ExclamationCircleOutlined,
  FileSearchOutlined,
  HistoryOutlined,
  LinkOutlined,
  UploadOutlined
} from "@ant-design/icons";
import { useCallback, useEffect, useMemo, useState } from "react";

import { api } from "@/lib/api";
import { hasPermission, readStoredPermissions } from "@/lib/permissions";

type ImportType = "sales_daily" | "sales_product" | "inventory" | "reviews";

type ExpectedField = {
  column: string;
  default_column?: string;
  field: string;
  required: boolean;
  note: string;
};

type RowError = {
  row: number;
  code: string;
  message: string;
  detail?: Record<string, unknown>;
};

type ImportPreview = {
  import_type: ImportType;
  file_name: string;
  file_size: number;
  expected_fields: ExpectedField[];
  detected_headers: string[];
  mapping: Record<string, string>;
  missing_required: string[];
  row_errors: RowError[];
  valid: boolean;
  preview_rows: Record<string, string>[];
  rows: Record<string, string>[];
  total_rows: number;
  valid_rows: number;
};

type ImportRecord = {
  id: string;
  import_type: ImportType;
  file_url: string;
  status: "success" | "partial_success" | "failed" | string;
  total_rows: number;
  success_rows: number;
  overwrite_rows: number;
  error_count?: number;
  metadata?: ImportMetadata;
  created_at: string;
};

type ImportRecordDetail = ImportRecord & {
  user_name?: string;
  error_details: RowError[];
  mapping: Record<string, string>;
};

type ImportMetadata = {
  mapping?: Record<string, string>;
  generated_alerts?: number;
  generated_alerts_detail?: GeneratedAlertDetail[];
};

type GeneratedAlertDetail = {
  id: string;
  store_name?: string;
  alert_type: string;
  level: string;
  title: string;
  status: string;
  created_at?: string;
};

const importTypes: { value: ImportType; label: string; hint: string }[] = [
  { value: "sales_daily", label: "门店日销售汇总", hint: "导入后触发销售下滑预警扫描" },
  { value: "sales_product", label: "产品日销售明细", hint: "先完成模板、预检、批次记录，后续接产品分析表" },
  { value: "inventory", label: "库存盘点数据", hint: "先完成模板、预检、批次记录，后续接库存预警规则" },
  { value: "reviews", label: "评价数据", hint: "先完成模板、预检、批次记录，后续接差评分类" }
];

const statusText: Record<string, string> = {
  success: "成功",
  partial_success: "部分成功",
  failed: "失败",
  processing: "处理中"
};

const statusColor: Record<string, string> = {
  success: "green",
  partial_success: "gold",
  failed: "red",
  processing: "blue"
};

const alertTypeText: Record<string, string> = {
  sales_drop: "销售异常",
  inventory_risk: "库存风险",
  bad_review: "评价异常"
};

const alertStatusText: Record<string, string> = {
  open: "待处理",
  processing: "处理中",
  ignored: "已忽略",
  closed: "已关闭"
};

const importFileNameLabel: Record<string, string> = {
  "frontend_e2e_sales_daily.csv": "前端验收门店日销售文件",
  "sales_drop_alert.csv": "销售下滑预警测试文件",
  "sales_daily_dashboard.csv": "经营大屏销售测试文件",
  "sales_daily_test.csv": "门店日销售测试文件",
  "sales_daily_day1.csv": "无 API 试点门店日销售样例",
  "sales_product_day1.csv": "无 API 试点商品销售样例",
  "inventory_day1.csv": "无 API 试点库存样例",
  "reviews_day1.csv": "无 API 试点评价样例"
};

const noApiImportGuide = [
  {
    step: 1,
    importType: "sales_daily" as ImportType,
    title: "门店日销售",
    sample: "docs/no-api-import-samples/sales_daily_day1.csv",
    result: "生成经营日期，联动看板、销售预警和门店日报"
  },
  {
    step: 2,
    importType: "sales_product" as ImportType,
    title: "商品销售明细",
    sample: "docs/no-api-import-samples/sales_product_day1.csv",
    result: "补充产品排行、商品分析和督导诊断"
  },
  {
    step: 3,
    importType: "inventory" as ImportType,
    title: "库存快照",
    sample: "docs/no-api-import-samples/inventory_day1.csv",
    result: "触发库存风险识别，进入库存看板"
  },
  {
    step: 4,
    importType: "reviews" as ImportType,
    title: "顾客评价",
    sample: "docs/no-api-import-samples/reviews_day1.csv",
    result: "联动评价看板、负向评价预警和舆情试点"
  }
];

const noApiAcceptanceDocPath = "docs/NO_API_DATA_IMPORT_ACCEPTANCE.md";

const importTypeOrderLabel: Record<ImportType, string> = {
  sales_daily: "第 1 步",
  sales_product: "第 2 步",
  inventory: "第 3 步",
  reviews: "第 4 步"
};

const importErrorAdvice: Record<string, { title: string; action: string }> = {
  IMPORT_TEMPLATE_INVALID: {
    title: "模板列不匹配",
    action: "下载当前类型的系统模板，或把文件表头改成模板里的列名。"
  },
  IMPORT_EMPTY_FILE: {
    title: "文件没有数据",
    action: "保留表头后至少填写 1 行数据，再重新上传预检。"
  },
  STORE_NOT_FOUND: {
    title: "门店编码无法匹配",
    action: "先到主数据 / 门店检查编码是否存在，并确认当前账号有该门店权限。"
  },
  PRODUCT_NOT_FOUND: {
    title: "SKU 不存在或未启用",
    action: "先到主数据 / 商品维护对应 SKU，并确认商品状态为启用。"
  },
  IMPORT_FIELD_REQUIRED: {
    title: "必填字段为空",
    action: "检查对应列是否为空，尤其是日期、门店编码、SKU、数量、金额等必填列。"
  },
  IMPORT_DATE_INVALID: {
    title: "日期格式错误",
    action: "日期统一填写为 YYYY-MM-DD，例如 2026-06-26。"
  },
  IMPORT_DATETIME_INVALID: {
    title: "时间格式错误",
    action: "评价时间统一填写为 YYYY-MM-DD HH:mm，例如 2026-06-26 14:30。"
  },
  IMPORT_NUMBER_INVALID: {
    title: "数字格式错误",
    action: "金额、库存、消耗量只保留数字和小数点，不要带元、kg、杯等单位。"
  },
  IMPORT_NUMBER_NEGATIVE: {
    title: "数字不能为负",
    action: "把金额、库存、入库量、消耗量改为 0 或正数。"
  },
  IMPORT_INTEGER_INVALID: {
    title: "整数格式错误",
    action: "订单数和销售数量必须是整数，不要填写小数或单位。"
  },
  IMPORT_INTEGER_NEGATIVE: {
    title: "整数不能为负",
    action: "订单数和销售数量改为 0 或正整数。"
  },
  IMPORT_RATING_INVALID: {
    title: "评分范围错误",
    action: "评价评分填写 1 到 5 之间的数字。"
  },
  IMPORT_BOOLEAN_INVALID: {
    title: "是否字段格式错误",
    action: "是否已回复只填写 是 / 否，也可使用 true / false。"
  }
};

function formatImportFileName(value?: string) {
  if (!value) return "未记录文件";
  const name = value.split(/[\\/]/).pop() || value;
  return importFileNameLabel[name] || name;
}

export function ImportsPage() {
  const [importType, setImportType] = useState<ImportType>("sales_daily");
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [records, setRecords] = useState<ImportRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [errorDrawerOpen, setErrorDrawerOpen] = useState(false);
  const [detailDrawerOpen, setDetailDrawerOpen] = useState(false);
  const [recordErrors, setRecordErrors] = useState<RowError[]>([]);
  const [recordErrorTitle, setRecordErrorTitle] = useState("");
  const [recordDetail, setRecordDetail] = useState<ImportRecordDetail | null>(null);
  const [currentMapping, setCurrentMapping] = useState<Record<string, string>>({});
  const [targetJobId, setTargetJobId] = useState<string | null>(null);
  const [autoOpenedJobId, setAutoOpenedJobId] = useState<string | null>(null);
  const [permissions, setPermissions] = useState(() => readStoredPermissions());
  const { message } = App.useApp();
  const canManageImports = hasPermission(permissions, "imports", "manage");

  const selectedType = useMemo(() => importTypes.find((item) => item.value === importType)!, [importType]);

  const loadRecords = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/api/v1/imports/records");
      setRecords(res.data);
    } catch {
      message.error("导入记录加载失败，请确认后端服务和登录状态");
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    setPermissions(readStoredPermissions());
    setTargetJobId(new URLSearchParams(window.location.search).get("job_id"));
    loadRecords();
  }, [loadRecords]);

  useEffect(() => {
    setCurrentMapping(readSavedMapping(importType));
  }, [importType]);

  function downloadTemplate() {
    window.open(`${api.defaults.baseURL}/api/v1/imports/templates/${importType}`, "_blank", "noopener,noreferrer");
  }

  function updateMapping(field: string, column: string) {
    if (!canManageImports) return;
    setCurrentMapping((current) => ({ ...current, [field]: column }));
    setPreview((current) =>
      current
        ? {
            ...current,
            mapping: { ...current.mapping, [field]: column },
            expected_fields: current.expected_fields.map((item) => (item.field === field ? { ...item, column } : item))
          }
        : current
    );
  }

  function saveCurrentMapping() {
    const mapping = preview?.mapping || currentMapping;
    if (!Object.keys(mapping).length) {
      message.warning("请先完成一次预检后再保存映射");
      return;
    }
    window.localStorage.setItem(mappingStorageKey(importType), JSON.stringify(mapping));
    setCurrentMapping(mapping);
    message.success("字段映射已保存，下次选择该导入类型会自动复用");
  }

  function clearSavedMapping() {
    window.localStorage.removeItem(mappingStorageKey(importType));
    setCurrentMapping({});
    setPreview(null);
    message.success("已清除当前导入类型的本地字段映射");
  }

  async function uploadPreview() {
    if (!canManageImports) {
      message.warning("当前账号没有数据导入管理权限，不能上传预检");
      return;
    }
    const file = fileList[0]?.originFileObj;
    if (!file) {
      message.warning("请先选择 CSV 或 XLSX 文件");
      return;
    }
    const formData = new FormData();
    formData.append("import_type", importType);
    if (Object.keys(currentMapping).length) {
      formData.append("mapping_json", JSON.stringify(currentMapping));
    }
    formData.append("file", file);
    setPreviewing(true);
    try {
      const res = await api.post("/api/v1/imports/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" }
      });
      setPreview(res.data);
      setCurrentMapping(res.data.mapping || {});
      if (res.data.missing_required?.length) {
        message.warning("预检发现缺少必填列");
      } else if (res.data.row_errors?.length) {
        message.warning("预检发现错误行，可确认后跳过错误行");
      } else {
        message.success("预检通过，可以确认导入");
      }
    } catch {
      message.error("上传预检失败，请检查文件格式或登录状态");
    } finally {
      setPreviewing(false);
    }
  }

  async function confirmImport() {
    if (!canManageImports) {
      message.warning("当前账号没有数据导入管理权限，不能确认导入");
      return;
    }
    if (!preview) {
      message.warning("请先上传并完成预检");
      return;
    }
    if (preview.missing_required.length || preview.valid_rows === 0) {
      message.warning("当前文件没有可导入的数据，请先修正模板列或数据行");
      return;
    }
    setConfirming(true);
    try {
      const res = await api.post("/api/v1/imports/confirm", {
        import_type: preview.import_type,
        file_name: preview.file_name,
        total_rows: preview.total_rows,
        success_rows: preview.valid_rows,
        overwrite_rows: 0,
        mapping: preview.mapping,
        rows: preview.rows,
        errors: preview.import_type === "sales_daily" ? [] : preview.row_errors
      });
      const generatedAlerts = Number(res.data.metadata?.generated_alerts || 0);
      message.success(
        generatedAlerts
          ? `数据已导入，生成 ${generatedAlerts} 条预警`
          : preview.row_errors.length
            ? "已导入可用数据，错误行已写入记录"
            : "数据已导入并生成记录"
      );
      setPreview(null);
      setFileList([]);
      await loadRecords();
      await openRecordDetail(res.data);
    } catch {
      message.error("确认导入失败，请检查数据内容、数据库服务或登录状态");
    } finally {
      setConfirming(false);
    }
  }

  async function openRecordErrors(record: ImportRecord) {
    try {
      const res = await api.get(`/api/v1/imports/records/${record.id}/errors`);
      setRecordErrors(res.data.errors || []);
      setRecordErrorTitle(`${typeLabel(record.import_type)} - ${formatImportFileName(record.file_url)}`);
      setErrorDrawerOpen(true);
    } catch {
      message.error("错误记录加载失败");
    }
  }

  const openRecordDetail = useCallback(
    async (record: ImportRecord) => {
      try {
        const res = await api.get(`/api/v1/imports/records/${record.id}`);
        setRecordDetail(res.data);
        setDetailDrawerOpen(true);
      } catch {
        message.error("导入详情加载失败");
      }
    },
    [message]
  );

  useEffect(() => {
    if (!targetJobId || autoOpenedJobId === targetJobId || !records.length) return;
    const matched = records.find((item) => item.id === targetJobId);
    if (!matched) return;
    openRecordDetail(matched);
    setAutoOpenedJobId(targetJobId);
  }, [autoOpenedJobId, openRecordDetail, records, targetJobId]);

  async function downloadRecordErrors(record: ImportRecord) {
    try {
      const res = await api.get(`/api/v1/imports/records/${record.id}/errors/download`, { responseType: "blob" });
      downloadBlob(res.data, `${record.import_type}_errors_${record.id}.csv`);
    } catch {
      message.error("错误明细下载失败");
    }
  }

  function downloadPreviewErrors() {
    if (!preview?.row_errors.length) return;
    const content = errorsToCsv(preview.row_errors);
    downloadBlob(new Blob([`\uFEFF${content}`], { type: "text/csv;charset=utf-8" }), `${preview.import_type}_preview_errors.csv`);
  }

  const canConfirm = Boolean(canManageImports && preview && !preview.missing_required.length && preview.valid_rows > 0);

  const fieldColumns: ColumnsType<ExpectedField> = [
    {
      title: "文件列映射",
      dataIndex: "column",
      width: 190,
      render: (column: string, row) => (
        <Select
          size="small"
          value={column}
          style={{ width: "100%" }}
          options={(preview?.detected_headers || []).map((header) => ({ value: header, label: header }))}
          disabled={!canManageImports}
          onChange={(value) => updateMapping(row.field, value)}
        />
      )
    },
    { title: "字段", dataIndex: "field", width: 130 },
    {
      title: "要求",
      dataIndex: "required",
      width: 92,
      render: (required: boolean) => <Tag color={required ? "red" : "default"}>{required ? "必填" : "可选"}</Tag>
    },
    { title: "说明", dataIndex: "note" },
    {
      title: "检测",
      width: 110,
      render: (_, row) => {
        const matched = preview?.detected_headers.includes(row.column);
        const missing = row.required && !matched;
        return <Tag color={missing ? "red" : matched ? "green" : "default"}>{missing ? "缺失" : matched ? "已匹配" : "未提供"}</Tag>;
      }
    }
  ];

  const recordColumns: ColumnsType<ImportRecord> = [
    { title: "类型", dataIndex: "import_type", render: (value: ImportType) => typeLabel(value), width: 150 },
    { title: "文件", dataIndex: "file_url", render: formatImportFileName },
    {
      title: "状态",
      dataIndex: "status",
      width: 120,
      render: (status: string) => <Tag color={statusColor[status] || "default"}>{statusText[status] || status}</Tag>
    },
    { title: "总行数", dataIndex: "total_rows", width: 92 },
    { title: "成功", dataIndex: "success_rows", width: 82 },
    { title: "覆盖", dataIndex: "overwrite_rows", width: 82 },
    { title: "错误", dataIndex: "error_count", width: 82, render: (value: number | undefined) => value ?? 0 },
    {
      title: "操作",
      width: 180,
      render: (_, record) => (
        <Space size={4}>
          <Button size="small" type="link" onClick={() => openRecordDetail(record)}>
            详情
          </Button>
          <Button size="small" type="link" disabled={!record.error_count} onClick={() => openRecordErrors(record)}>
            错误
          </Button>
          <Button size="small" type="link" disabled={!record.error_count} onClick={() => downloadRecordErrors(record)}>
            下载
          </Button>
        </Space>
      )
    },
    { title: "创建时间", dataIndex: "created_at", width: 210, render: formatDateTime }
  ];

  return (
    <>
      <section className="flow-band">
        <div>
          <div className="flow-kicker">第二阶段数据导入</div>
          <div className="flow-title">模板下载、上传预检、错误行反馈、确认导入</div>
          <div className="flow-text">销售日报确认后会写入经营数据并触发规则扫描；其他三类先完成 V1 导入批次与预检闭环。</div>
        </div>
        <Space wrap>
          <Button icon={<DownloadOutlined />} onClick={downloadTemplate}>
            下载当前模板
          </Button>
          <Button onClick={saveCurrentMapping} disabled={!preview}>
            保存字段映射
          </Button>
          <Button onClick={clearSavedMapping}>
            清除映射
          </Button>
          <Button type="primary" icon={<FileSearchOutlined />} loading={previewing} disabled={!canManageImports} onClick={uploadPreview}>
            上传预检
          </Button>
        </Space>
      </section>

      <Card className="panel-card no-api-import-guide" title="无 API 试点导入指引">
        <div className="no-api-guide-head">
          <div>
            <Typography.Text strong>推荐每天按 4 步导入</Typography.Text>
            <Typography.Paragraph type="secondary">
              当前没有 POS / 外卖平台 API 时，使用本地文件完成 3 天试点验收。先确认门店、商品、原料主数据编码存在，再上传真实经营文件。
            </Typography.Paragraph>
          </div>
          <div className="no-api-guide-doc">
            <LinkOutlined />
            <span>验收包</span>
            <b>{noApiAcceptanceDocPath}</b>
          </div>
        </div>
        <div className="no-api-guide-steps">
          {noApiImportGuide.map((item) => (
            <button
              className={item.importType === importType ? "active" : ""}
              type="button"
              key={item.importType}
              onClick={() => {
                setImportType(item.importType);
                setPreview(null);
                setFileList([]);
              }}
            >
              <span>{item.step}</span>
              <div>
                <b>{item.title}</b>
                <small>{item.result}</small>
                <em>{item.sample}</em>
              </div>
            </button>
          ))}
        </div>
      </Card>

      <div className="work-grid import-work-grid">
        <Card className="panel-card" title="导入文件">
          <Form layout="vertical">
            <Form.Item label="导入类型">
              <Select
                value={importType}
                onChange={(value) => {
                  setImportType(value);
                  setPreview(null);
                  setFileList([]);
                }}
                options={importTypes.map((item) => ({ value: item.value, label: item.label }))}
              />
              <div className="small-muted import-type-hint">{selectedType.hint}</div>
            </Form.Item>
            <Form.Item label="模板文件">
              <div className="import-upload-row">
                <Button icon={<DownloadOutlined />} onClick={downloadTemplate}>
                  下载 XLSX 模板
                </Button>
                <Upload
                  accept=".csv,.xlsx,.xlsm"
                  maxCount={1}
                  fileList={fileList}
                  disabled={!canManageImports}
                  beforeUpload={() => false}
                  onChange={({ fileList: next }) => {
                    setFileList(next);
                    setPreview(null);
                  }}
                >
                  <Button icon={<UploadOutlined />} disabled={!canManageImports}>选择文件</Button>
                </Upload>
                <Button type="primary" icon={<FileSearchOutlined />} loading={previewing} disabled={!canManageImports} onClick={uploadPreview}>
                  生成预检
                </Button>
              </div>
            </Form.Item>
          </Form>

          {preview ? (
            <div className="import-preview">
              <div className="import-preview-head">
                <div>
                  <b>{preview.file_name}</b>
                  <span>
                    {Math.ceil(preview.file_size / 1024)} KB · 共 {preview.total_rows} 行 · 可导入 {preview.valid_rows} 行
                  </span>
                </div>
                <Button type="primary" icon={<CheckCircleOutlined />} loading={confirming} disabled={!canConfirm} onClick={confirmImport}>
                  确认导入
                </Button>
              </div>

              {preview.missing_required.length ? (
                <Alert
                  type="error"
                  showIcon
                  message={`缺少必填列：${preview.missing_required.join("、")}`}
                  description={<ImportErrorAdvicePanel errors={preview.row_errors} missingRequired={preview.missing_required} />}
                />
              ) : preview.row_errors.length ? (
                <Alert
                  type="warning"
                  showIcon
                  message={`发现 ${preview.row_errors.length} 条错误行，确认导入时会跳过错误行并写入错误记录。`}
                  description={<ImportErrorAdvicePanel errors={preview.row_errors} />}
                />
              ) : (
                <Alert type="success" showIcon message="预检通过，字段和数据格式可导入。" />
              )}

              <Table size="small" pagination={false} rowKey="field" dataSource={preview.expected_fields} columns={fieldColumns} />
            </div>
          ) : (
            <div className="import-empty">
              <ExclamationCircleOutlined />
              <div>
                <b>先下载模板，再上传 CSV 或 XLSX 文件</b>
                <span>系统会检查必填列、日期、数字、门店编码和错误行。</span>
              </div>
            </div>
          )}
        </Card>

        <Card className="panel-card" title="预检结果">
          <div className="import-check-grid">
            <div>
              <span>文件行数</span>
              <b>{preview?.total_rows ?? "-"}</b>
            </div>
            <div>
              <span>可导入</span>
              <b>{preview?.valid_rows ?? "-"}</b>
            </div>
            <div>
              <span>错误行</span>
              <b>{preview?.row_errors.length ?? "-"}</b>
            </div>
          </div>
          <div className="risk-list import-type-list">
            {importTypes.map((item) => (
              <div className="risk-item" key={item.value}>
                <div>
                  <div className="risk-title">{item.label}</div>
                  <div className="risk-meta">{importTypeOrderLabel[item.value]} · {typeLabel(item.value)}</div>
                </div>
                <Tag color={item.value === importType ? "green" : "default"}>{item.value === importType ? "当前" : "可选"}</Tag>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {preview?.row_errors.length ? (
        <Card
          className="panel-card"
          title="错误行预览"
          extra={<Button icon={<DownloadOutlined />} onClick={downloadPreviewErrors}>下载错误明细</Button>}
          style={{ marginTop: 16 }}
        >
          <Table
            size="small"
            rowKey={(row) => `${row.row}-${row.code}`}
            dataSource={preview.row_errors}
            pagination={{ pageSize: 6 }}
            columns={[
              { title: "行号", dataIndex: "row", width: 90 },
              { title: "错误码", dataIndex: "code", width: 190 },
              { title: "原因", dataIndex: "message" },
              { title: "处理建议", width: 300, render: (_, row) => importErrorHelp(row).action }
            ]}
          />
        </Card>
      ) : null}

      <Card className="panel-card" title="导入记录" style={{ marginTop: 16 }}>
        <Table loading={loading} rowKey="id" dataSource={records} columns={recordColumns} scroll={{ x: 1100 }} />
      </Card>

      <Drawer className="task-detail-drawer import-detail-drawer" title="导入详情" open={detailDrawerOpen} onClose={() => setDetailDrawerOpen(false)} width={720}>
        {recordDetail ? (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <div className="task-detail-head">
              <div>
                <Space wrap size={8}>
                  <Tag color={statusColor[recordDetail.status] || "default"}>{statusText[recordDetail.status] || recordDetail.status}</Tag>
                  <Tag>{typeLabel(recordDetail.import_type)}</Tag>
                  <Tag>{recordDetail.user_name || "系统用户"}</Tag>
                </Space>
                <Typography.Title level={4}>{formatImportFileName(recordDetail.file_url)}</Typography.Title>
                <Typography.Paragraph type="secondary">
                  导入时间 {formatDateTime(recordDetail.created_at)}，字段映射和错误行会保留在审计链路中。
                </Typography.Paragraph>
              </div>
              <div className="task-detail-h5-hint">
                <HistoryOutlined />
                <span>确认导入后，销售、库存和评价数据会立即参与 V1 预警规则扫描。</span>
              </div>
            </div>

            <div className="task-detail-metrics">
              <div>
                <span>总行数</span>
                <b>{recordDetail.total_rows}</b>
              </div>
              <div>
                <span>成功行</span>
                <b>{recordDetail.success_rows}</b>
              </div>
              <div>
                <span>错误行</span>
                <b>{recordDetail.error_count || 0}</b>
              </div>
              <div>
                <span>生成预警</span>
                <b>{generatedAlerts(recordDetail).length || Number(recordDetail.metadata?.generated_alerts || 0)}</b>
              </div>
            </div>

            <div className="task-detail-section">
              <div className="task-detail-section-head">
                <CheckCircleOutlined />
                <span>导入结果</span>
              </div>
              <div className="import-result-grid">
                <div>
                  <span>覆盖行</span>
                  <b>{recordDetail.overwrite_rows}</b>
                </div>
                <div>
                  <span>成功率</span>
                  <b>{recordDetail.total_rows ? `${Math.round((recordDetail.success_rows / recordDetail.total_rows) * 100)}%` : "-"}</b>
                </div>
                <div>
                  <span>导入人</span>
                  <b>{recordDetail.user_name || "-"}</b>
                </div>
              </div>
            </div>

            <div className="task-detail-section">
              <div className="task-detail-section-head">
                <BellOutlined />
                <span>生成预警</span>
              </div>
              {generatedAlerts(recordDetail).length ? (
                <div className="import-alert-stack">
                  {generatedAlerts(recordDetail).map((alert) => (
                    <div className="import-alert-item" key={alert.id}>
                      <div>
                        <Space wrap size={6}>
                          <Tag color={alert.level === "critical" || alert.level === "high" ? "red" : "orange"}>{alert.level === "critical" ? "严重" : "预警"}</Tag>
                          <Tag>{alertTypeText[alert.alert_type] || alert.alert_type}</Tag>
                          <Tag>{alertStatusText[alert.status] || alert.status}</Tag>
                        </Space>
                        <b>{alert.title}</b>
                        <span>{alert.store_name || "未关联门店"} · {formatDateTime(alert.created_at)}</span>
                      </div>
                      <Button size="small" type="primary" icon={<LinkOutlined />} onClick={() => (window.location.href = `/alerts?alert_id=${alert.id}`)}>
                        查看预警
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="import-empty compact">
                  <ExclamationCircleOutlined />
                  <div>
                    <b>本批次没有生成预警</b>
                    <span>数据已入库，可继续在经营看板、门店分析或产品分析中查看经营结果。</span>
                  </div>
                </div>
              )}
            </div>

            {recordDetail.error_count ? (
              <div className="task-detail-section">
                <div className="task-detail-section-head">
                  <ExclamationCircleOutlined />
                  <span>错误行处理</span>
                </div>
                <div className="import-error-action">
                  <span>有 {recordDetail.error_count} 条数据未入库，建议下载后修正，再重新导入同一模板。</span>
                  <Space wrap>
                    <Button onClick={() => openRecordErrors(recordDetail)}>查看错误</Button>
                    <Button icon={<DownloadOutlined />} onClick={() => downloadRecordErrors(recordDetail)}>下载错误明细</Button>
                  </Space>
                </div>
              </div>
            ) : null}

            <div className="task-detail-section">
              <div className="task-detail-section-head">
                <FileSearchOutlined />
                <span>字段映射</span>
              </div>
              <Table
                size="small"
                pagination={false}
                rowKey="field"
                dataSource={Object.entries(recordDetail.mapping || {}).map(([field, column]) => ({ field, column }))}
                columns={[
                  { title: "字段", dataIndex: "field" },
                  { title: "文件列", dataIndex: "column" }
                ]}
              />
            </div>
          </Space>
        ) : null}
      </Drawer>

      <Drawer title={recordErrorTitle || "错误记录"} open={errorDrawerOpen} onClose={() => setErrorDrawerOpen(false)} width={560}>
        {recordErrors.length ? <ImportErrorAdvicePanel errors={recordErrors} /> : null}
        <Table
          size="small"
          rowKey={(row) => `${row.row}-${row.code}`}
          dataSource={recordErrors}
          pagination={false}
          columns={[
            { title: "行号", dataIndex: "row", width: 80 },
            { title: "错误码", dataIndex: "code", width: 180 },
            { title: "原因", dataIndex: "message" },
            { title: "建议", render: (_, row) => importErrorHelp(row).action }
          ]}
          locale={{ emptyText: "暂无错误记录" }}
        />
      </Drawer>
    </>
  );
}

function typeLabel(type: ImportType) {
  return importTypes.find((item) => item.value === type)?.label || type;
}

function ImportErrorAdvicePanel({ errors, missingRequired = [] }: { errors: RowError[]; missingRequired?: string[] }) {
  const grouped = errorAdviceGroups(errors, missingRequired);
  if (!grouped.length) return null;
  return (
    <div className="import-error-advice">
      {grouped.map((item) => (
        <div key={item.code}>
          <Tag color={item.severity}>{item.count} 条</Tag>
          <div>
            <b>{item.title}</b>
            <span>{item.action}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function errorAdviceGroups(errors: RowError[], missingRequired: string[] = []) {
  const counts = new Map<string, number>();
  for (const error of errors) {
    counts.set(error.code, (counts.get(error.code) || 0) + 1);
  }
  if (missingRequired.length) {
    counts.set("IMPORT_TEMPLATE_INVALID", Math.max(counts.get("IMPORT_TEMPLATE_INVALID") || 0, missingRequired.length));
  }
  return Array.from(counts.entries()).map(([code, count]) => {
    const advice = importErrorAdvice[code] || { title: code, action: "下载错误明细，按行检查后重新上传预检。" };
    return {
      code,
      count,
      severity: code.includes("NOT_FOUND") || code.includes("TEMPLATE") ? "red" : "gold",
      ...advice
    };
  });
}

function importErrorHelp(error: RowError) {
  return importErrorAdvice[error.code] || { title: error.code, action: "下载错误明细，按行检查后重新上传预检。" };
}

function mappingStorageKey(importType: ImportType) {
  return `foodops_import_mapping_${importType}`;
}

function readSavedMapping(importType: ImportType): Record<string, string> {
  if (typeof window === "undefined") return {};
  const raw = window.localStorage.getItem(mappingStorageKey(importType));
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch {
    return {};
  }
}

function generatedAlerts(record: ImportRecordDetail): GeneratedAlertDetail[] {
  return Array.isArray(record.metadata?.generated_alerts_detail) ? record.metadata.generated_alerts_detail : [];
}

function formatDateTime(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

function errorsToCsv(errors: RowError[]) {
  const rows = [
    ["row", "code", "message", "detail"],
    ...errors.map((error) => [
      String(error.row || ""),
      error.code || "",
      error.message || "",
      JSON.stringify(error.detail || {})
    ])
  ];
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

function csvCell(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}
