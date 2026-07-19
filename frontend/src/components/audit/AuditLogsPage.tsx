"use client";

import { EyeOutlined, LinkOutlined, ReloadOutlined } from "@ant-design/icons";
import { App, Button, Card, DatePicker, Descriptions, Drawer, Empty, Input, Select, Space, Table, Tag, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";

const { RangePicker } = DatePicker;

type AuditLogRecord = {
  id: string;
  user_id?: string | null;
  user_name?: string | null;
  username?: string | null;
  action?: string | null;
  module?: string | null;
  object_type?: string | null;
  object_id?: string | null;
  result?: string | null;
  ip?: string | null;
  method?: string | null;
  request_path?: string | null;
  status_code?: number | null;
  detail?: Record<string, unknown> | null;
  created_at: string;
};

type AuditSummary = {
  total: number;
  success: number;
  failure: number;
  last_24h: number;
  top_actions: { action: string; count: number }[];
};

type AuditResponse = {
  items: AuditLogRecord[];
  total: number;
  page: number;
  page_size: number;
  summary: AuditSummary;
};

type AuditDetail = {
  audit: AuditLogRecord;
  task?: {
    id: string;
    title?: string | null;
    status?: string | null;
    priority?: string | null;
    due_at?: string | null;
    result?: string | null;
    store_name?: string | null;
  } | null;
  notifications: {
    id: string;
    channel: string;
    target_type?: string | null;
    target_id?: string | null;
    title?: string | null;
    content?: string | null;
    status: string;
    sent_at?: string | null;
  }[];
};

const actionLabel: Record<string, string> = {
  LOGIN: "登录",
  CREATE: "创建",
  UPDATE: "更新",
  DELETE: "删除",
  DEPARTMENT_CREATE: "部门创建",
  DEPARTMENT_UPDATE: "部门更新",
  DEPARTMENT_DELETE: "部门删除",
  DEPARTMENT_ROLES_UPDATE: "部门角色配置",
  ROLE_CREATE: "角色创建",
  ROLE_UPDATE: "角色更新",
  ROLE_DELETE: "角色删除",
  USER_CREATE: "人员创建",
  USER_UPDATE: "人员更新",
  USER_PASSWORD_RESET: "密码重置",
  USER_STORE_SCOPE_UPDATE: "可见门店更新",
  STORE_CREATE: "门店创建",
  STORE_UPDATE: "门店更新",
  PRODUCT_CREATE: "产品创建",
  PRODUCT_UPDATE: "产品更新",
  PRODUCT_DELETE: "产品删除",
  MATERIAL_CREATE: "原料创建",
  MATERIAL_UPDATE: "原料更新",
  SUPPLIER_CREATE: "供应商创建",
  SUPPLIER_UPDATE: "供应商更新",
  BRAND_UPDATE: "品牌设置更新",
  IMPORT_CONFIRM: "导入确认",
  ALERT_SALES_DROP_GENERATED: "销售预警生成",
  ALERT_TO_TASK: "预警转任务",
  TASK_FEEDBACK_SUBMIT: "任务反馈提交",
  TASK_REVIEW_APPROVE: "任务审核通过",
  TASK_REVIEW_RETURN: "任务审核退回",
  AI_DAILY_REPORT_RUN: "AI 经营日报",
  AI_ATTRIBUTION_RUN: "AI 异常归因",
  NOTIFICATION_STATUS_UPDATE: "通知状态更新",
  TASK_OVERDUE_MARKED: "任务逾期标记"
};

const moduleLabel: Record<string, string> = {
  auth: "认证",
  imports: "数据导入",
  alerts: "异常预警",
  tasks: "任务中心",
  relay: "店长 H5",
  ai: "AI 运行",
  notifications: "通知中心",
  stores: "门店",
  products: "产品",
  materials: "原料",
  suppliers: "供应商",
  brand: "品牌",
  dashboard: "看板",
  users: "人员权限",
  system: "系统",
  org: "组织权限"
};

const objectTypeLabel: Record<string, string> = {
  system: "系统",
  department: "部门",
  role: "角色",
  user: "人员",
  store: "门店",
  product: "产品",
  material: "原料",
  supplier: "供应商",
  task: "任务",
  alert: "预警",
  notification: "通知",
  import_job: "导入任务",
  agent_run: "AI 运行",
  model_provider: "模型供应商",
  prompt_template: "提示词模板",
  brand: "品牌设置"
};

const actionOptions = [
  "DEPARTMENT_CREATE",
  "DEPARTMENT_UPDATE",
  "DEPARTMENT_ROLES_UPDATE",
  "ROLE_CREATE",
  "ROLE_UPDATE",
  "USER_CREATE",
  "USER_UPDATE",
  "USER_PASSWORD_RESET",
  "USER_STORE_SCOPE_UPDATE",
  "IMPORT_CONFIRM",
  "ALERT_SALES_DROP_GENERATED",
  "ALERT_TO_TASK",
  "TASK_FEEDBACK_SUBMIT",
  "TASK_REVIEW_APPROVE",
  "TASK_REVIEW_RETURN",
  "AI_DAILY_REPORT_RUN",
  "AI_ATTRIBUTION_RUN",
  "NOTIFICATION_STATUS_UPDATE",
  "LOGIN",
  "CREATE",
  "UPDATE",
  "DELETE"
].map((value) => ({ value, label: actionLabel[value] || value }));

const moduleOptions = ["imports", "alerts", "tasks", "relay", "ai", "notifications", "auth", "stores", "products", "materials", "suppliers", "brand", "org", "users", "system"].map((value) => ({
  value,
  label: moduleLabel[value] || value
}));

const taskStatusLabel: Record<string, string> = {
  pending_confirm: "待确认",
  confirmed: "已确认",
  processing: "处理中",
  pending_review: "待审核",
  closed: "已关闭",
  archived: "已归档",
  overdue: "已逾期"
};

const taskPriorityLabel: Record<string, string> = {
  critical: "紧急",
  high: "高",
  normal: "普通",
  low: "低"
};

const notificationStatusLabel: Record<string, string> = {
  pending: "待处理",
  sent: "已发送",
  ignored: "已忽略",
  failed: "发送失败"
};

export function AuditLogsPage() {
  const [records, setRecords] = useState<AuditLogRecord[]>([]);
  const [summary, setSummary] = useState<AuditSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<string | undefined>(() => readQueryParam("action"));
  const [moduleName, setModuleName] = useState<string | undefined>(() => readQueryParam("module"));
  const [result, setResult] = useState<string | undefined>();
  const [keywordInput, setKeywordInput] = useState(() => readQueryParam("object") || readQueryParam("keyword") || "");
  const [keyword, setKeyword] = useState(() => readQueryParam("object") || readQueryParam("keyword") || "");
  const [dateRange, setDateRange] = useState<[string, string] | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [total, setTotal] = useState(0);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<AuditDetail | null>(null);
  const { message } = App.useApp();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = {
        page,
        page_size: pageSize
      };
      if (action) params.action = action;
      if (moduleName) params.module = moduleName;
      if (result) params.result = result;
      if (keyword) params.keyword = keyword;
      if (dateRange) {
        params.date_from = dateRange[0];
        params.date_to = dateRange[1];
      }
      const res = await api.get<AuditResponse>("/api/v1/audit-logs", { params });
      setRecords(res.data.items);
      setSummary(res.data.summary);
      setTotal(res.data.total);
    } catch {
      message.error("审计日志加载失败,请确认权限和后端服务状态");
    } finally {
      setLoading(false);
    }
  }, [action, dateRange, keyword, message, moduleName, page, pageSize, result]);

  useEffect(() => {
    load();
  }, [load]);

  function resetFilters() {
    setAction(undefined);
    setModuleName(undefined);
    setResult(undefined);
    setKeywordInput("");
    setKeyword("");
    setDateRange(null);
    setPage(1);
  }

  async function openDetail(record: AuditLogRecord) {
    setDetailOpen(true);
    setDetailLoading(true);
    try {
      const res = await api.get<AuditDetail>(`/api/v1/audit-logs/${record.id}`);
      setDetail(res.data);
    } catch {
      message.error("审计详情加载失败");
    } finally {
      setDetailLoading(false);
    }
  }

  function openAuditTarget(record: AuditLogRecord) {
    const target = auditTargetRoute(record);
    if (target) window.location.href = target;
  }

  return (
    <>
      <section className="flow-band">
        <div>
          <span className="flow-kicker">审计追踪</span>
          <div className="flow-title">关键动作留痕 · 最近 24 小时 {summary?.last_24h ?? 0} 条</div>
          <div className="flow-text">用于追踪导入确认、预警派发、店长反馈和 AI 归因等 V1 闭环动作。</div>
        </div>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>
            刷新
          </Button>
          <Button onClick={resetFilters}>重置筛选</Button>
        </Space>
      </section>

      <div className="dashboard-grid audit-metrics">
        <Card className="metric-card panel-card" loading={loading}>
          <Typography.Text type="secondary">审计总数</Typography.Text>
          <div className="ai-big-number">{summary?.total ?? 0}</div>
          <div className="metric-foot">当前租户</div>
        </Card>
        <Card className="metric-card panel-card" loading={loading}>
          <Typography.Text type="secondary">成功动作</Typography.Text>
          <div className="ai-big-number">{summary?.success ?? 0}</div>
          <div className="metric-foot">业务正常完成</div>
        </Card>
        <Card className="metric-card panel-card" loading={loading}>
          <Typography.Text type="secondary">异常动作</Typography.Text>
          <div className="ai-big-number">{summary?.failure ?? 0}</div>
          <div className="metric-foot danger">需排查</div>
        </Card>
        <Card className="metric-card panel-card" loading={loading}>
          <Typography.Text type="secondary">高频动作</Typography.Text>
          <div className="audit-action-stack">
            {(summary?.top_actions || []).slice(0, 3).map((item) => (
              <span key={item.action}>
                {actionLabel[item.action] || item.action} · {item.count}
              </span>
            ))}
          </div>
        </Card>
      </div>

      <Card className="panel-card" title="审计日志" style={{ marginTop: 16 }}>
        <div className="audit-filter-row">
          <Select
            allowClear
            placeholder="动作"
            value={action}
            onChange={(value) => {
              setAction(value);
              setPage(1);
            }}
            options={actionOptions}
            style={{ width: 180 }}
          />
          <Select
            allowClear
            placeholder="模块"
            value={moduleName}
            onChange={(value) => {
              setModuleName(value);
              setPage(1);
            }}
            options={moduleOptions}
            style={{ width: 150 }}
          />
          <Select
            allowClear
            placeholder="结果"
            value={result}
            onChange={(value) => {
              setResult(value);
              setPage(1);
            }}
            options={[
              { value: "success", label: "成功" },
              { value: "failure", label: "失败" },
              { value: "partial_success", label: "部分成功" }
            ]}
            style={{ width: 130 }}
          />
          <RangePicker
            showTime
            onChange={(values) => {
              setDateRange(values ? [values[0]!.toISOString(), values[1]!.toISOString()] : null);
              setPage(1);
            }}
          />
          <Input.Search
            allowClear
            enterButton="搜索"
            placeholder="对象、用户、路径、动作"
            value={keywordInput}
            onChange={(event) => setKeywordInput(event.target.value)}
            onSearch={(value) => {
              setKeyword(value.trim());
              setPage(1);
            }}
            style={{ width: 260 }}
          />
        </div>

        <Table
          rowKey="id"
          loading={loading}
          dataSource={records}
          scroll={{ x: 1380 }}
          locale={{ emptyText: <Empty description="暂无审计日志" /> }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            onChange: (nextPage, nextPageSize) => {
              setPage(nextPage);
              setPageSize(nextPageSize);
            }
          }}
          columns={[
            {
              title: "动作",
              dataIndex: "action",
              width: 180,
              render: (value: string) => (
                <div>
                  <div className="risk-title">{actionLabel[value] || value || "-"}</div>
                  <div className="risk-meta">{value || "-"}</div>
                </div>
              )
            },
            {
              title: "模块",
              dataIndex: "module",
              width: 120,
              render: (value: string) => moduleLabel[value] || value || "-"
            },
            {
              title: "结果",
              dataIndex: "result",
              width: 110,
              render: (value: string) => <Tag color={resultColor(value)}>{resultLabel(value)}</Tag>
            },
            {
              title: "对象",
              width: 260,
              render: (_: unknown, record: AuditLogRecord) => (
                <div>
                  <div className="risk-title">{objectTypeLabel[record.object_type || "system"] || record.object_type || "系统"}</div>
                  <div className="risk-meta">{record.object_id || "-"}</div>
                </div>
              )
            },
            {
              title: "操作者",
              width: 220,
              render: (_: unknown, record: AuditLogRecord) => (
                <div>
                  <div className="risk-title">{record.user_name || record.username || "系统"}</div>
                  <div className="risk-meta">{record.user_id || "-"}</div>
                </div>
              )
            },
            {
              title: "请求",
              width: 220,
              render: (_: unknown, record: AuditLogRecord) => (
                <div>
                  <div className="risk-title">{[record.method, record.status_code].filter(Boolean).join(" · ") || "-"}</div>
                  <div className="risk-meta">{record.request_path || "-"}</div>
                </div>
              )
            },
            {
              title: "IP",
              dataIndex: "ip",
              width: 130,
              render: (value: string) => value || "-"
            },
            {
              title: "时间",
              dataIndex: "created_at",
              width: 210,
              render: (value: string) => value || "-"
            },
            {
              title: "操作",
              fixed: "right",
              width: 150,
              render: (_: unknown, record: AuditLogRecord) => (
                <Space wrap>
                  <Button size="small" icon={<EyeOutlined />} onClick={() => openDetail(record)}>
                    详情
                  </Button>
                  <Button
                    size="small"
                    icon={<LinkOutlined />}
                    disabled={!auditTargetRoute(record)}
                    onClick={() => openAuditTarget(record)}
                  />
                </Space>
              )
            }
          ]}
        />
      </Card>

      <Drawer
        className="audit-detail-drawer"
        title="审计详情"
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        width={560}
        loading={detailLoading}
        destroyOnHidden
      >
        {detail ? (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Descriptions bordered size="small" column={1}>
              <Descriptions.Item label="动作">{actionLabel[detail.audit.action || ""] || detail.audit.action || "-"}</Descriptions.Item>
              <Descriptions.Item label="模块">{moduleLabel[detail.audit.module || ""] || detail.audit.module || "-"}</Descriptions.Item>
              <Descriptions.Item label="对象">{`${objectTypeLabel[detail.audit.object_type || ""] || detail.audit.object_type || "-"} · ${detail.audit.object_id || "-"}`}</Descriptions.Item>
              <Descriptions.Item label="操作者">{detail.audit.user_name || detail.audit.username || detail.audit.user_id || "系统"}</Descriptions.Item>
              <Descriptions.Item label="结果"><Tag color={resultColor(detail.audit.result || "")}>{resultLabel(detail.audit.result || "")}</Tag></Descriptions.Item>
              <Descriptions.Item label="请求">{[detail.audit.method, detail.audit.request_path].filter(Boolean).join(" ") || "-"}</Descriptions.Item>
              <Descriptions.Item label="状态码">{detail.audit.status_code || "-"}</Descriptions.Item>
              <Descriptions.Item label="IP">{detail.audit.ip || "-"}</Descriptions.Item>
              <Descriptions.Item label="时间">{detail.audit.created_at || "-"}</Descriptions.Item>
            </Descriptions>

            {hasAuditDetail(detail.audit.detail) ? (
              <Card className="panel-card audit-detail-card" title="请求上下文">
                <pre className="audit-detail-pre">{formatAuditDetail(detail.audit.detail)}</pre>
              </Card>
            ) : null}

            {detail.task ? (
              <Card className="panel-card audit-detail-card" title="关联任务">
                <div className="risk-title">{detail.task.title || detail.task.id}</div>
                <div className="risk-meta">
                  {detail.task.store_name || "未关联门店"} · {taskStatusLabel[detail.task.status || ""] || detail.task.status || "-"} · {taskPriorityLabel[detail.task.priority || ""] || detail.task.priority || "-"}
                </div>
                {detail.task.result ? <pre className="audit-detail-pre">{detail.task.result}</pre> : null}
              </Card>
            ) : null}

            <Card className="panel-card audit-detail-card" title={`关联通知 · ${detail.notifications.length}`}>
              {detail.notifications.length ? (
                <div className="audit-notification-stack">
                  {detail.notifications.map((item) => (
                    <div key={item.id} className="audit-notification-item">
                      <Space align="start" style={{ justifyContent: "space-between", width: "100%" }}>
                        <div>
                          <div className="risk-title">{item.title || "未命名通知"}</div>
                          <div className="risk-meta">{item.content || "无通知内容"}</div>
                        </div>
                        <Tag color={item.status === "pending" ? "gold" : item.status === "sent" ? "green" : "default"}>{notificationStatusLabel[item.status] || item.status}</Tag>
                      </Space>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty description="暂无关联通知" />
              )}
            </Card>

            <Space className="detail-action-row" wrap>
              <Button
                icon={<LinkOutlined />}
                disabled={!auditTargetRoute(detail.audit)}
                onClick={() => openAuditTarget(detail.audit)}
              >
                查看审计对象
              </Button>
              {detail.task ? (
                <Button icon={<LinkOutlined />} onClick={() => window.location.href = `/tasks?task_id=${detail.task?.id}`}>
                  打开关联任务
                </Button>
              ) : null}
              {detail.notifications.length ? (
                <Button icon={<LinkOutlined />} onClick={() => window.location.href = `/notifications?notification_id=${detail.notifications[0].id}`}>
                  打开关联通知
                </Button>
              ) : null}
            </Space>
          </Space>
        ) : (
          <Empty description="请选择一条审计日志" />
        )}
      </Drawer>
    </>
  );
}

function readQueryParam(name: string): string | undefined {
  if (typeof window === "undefined") return undefined;
  return new URLSearchParams(window.location.search).get(name) || undefined;
}

function resultLabel(value?: string | null) {
  if (value === "success") return "成功";
  if (value === "partial_success") return "部分成功";
  if (value === "failure") return "失败";
  return value || "-";
}

function resultColor(value?: string | null) {
  if (value === "success") return "green";
  if (value === "partial_success") return "gold";
  return "red";
}

function auditTargetRoute(record: AuditLogRecord) {
  if (!record.object_id) return "";
  const id = encodeURIComponent(record.object_id);
  switch (record.object_type) {
    case "task":
      return `/tasks?task_id=${id}`;
    case "alert":
      return `/alerts?alert_id=${id}`;
    case "notification":
      return `/notifications?notification_id=${id}`;
    case "user":
      return `/system/users?user_id=${id}`;
    case "role":
      return `/system/org?role_id=${id}`;
    case "department":
      return `/system/org?department_id=${id}`;
    case "store":
      return `/system/stores?store_id=${id}`;
    case "product":
      return `/system/products?product_id=${id}`;
    case "material":
      return `/system/materials?material_id=${id}`;
    case "supplier":
      return `/system/materials?supplier_id=${id}`;
    case "import_job":
      return `/data/imports?job_id=${id}`;
    case "agent_run":
      return `/ai/role-assistants?run_id=${id}`;
    case "model_provider":
    case "prompt_template":
      return `/system/models?object_id=${id}`;
    case "brand":
      return "/system/settings";
    default:
      return "";
  }
}

function hasAuditDetail(detail?: Record<string, unknown> | null) {
  return Boolean(detail && Object.keys(detail).length);
}

function formatAuditDetail(detail?: Record<string, unknown> | null) {
  if (!detail) return "{}";
  return JSON.stringify(detail, null, 2);
}
