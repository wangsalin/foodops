"use client";

import { App, Button, Card, DatePicker, Drawer, Empty, Form, Input, List, Modal, Select, Space, Table, Tag, Timeline, Typography } from "antd";
import {
  BellOutlined,
  CheckCircleOutlined,
  CopyOutlined,
  EyeOutlined,
  FileTextOutlined,
  HistoryOutlined,
  LinkOutlined,
  ReloadOutlined,
  SendOutlined,
  ShopOutlined
} from "@ant-design/icons";
import { useCallback, useEffect, useMemo, useState } from "react";

import { api } from "@/lib/api";
import { hasPermission, readStoredPermissions } from "@/lib/permissions";

type AlertRecord = {
  id: string;
  store_name?: string;
  alert_type: string;
  level: string;
  title: string;
  summary?: string;
  status: string;
  responsible_user_id?: string;
  responsible_user_name?: string;
  due_at?: string;
  created_at: string;
};

type AlertTask = {
  id: string;
  title: string;
  department_name?: string;
  assignee_name?: string;
  status: string;
  priority: string;
  due_at?: string;
  result?: string;
  created_at?: string;
};

type AlertNotification = {
  id: string;
  channel: string;
  target_type?: string;
  target_id?: string;
  title?: string;
  content?: string;
  status: string;
  retry_count?: number;
  sent_at?: string;
  recipient_user_name?: string;
};

type AlertAuditLog = {
  id: string;
  user_name?: string;
  action: string;
  module?: string;
  object_type?: string;
  object_id?: string;
  result: string;
  created_at?: string;
};

type AlertDetail = AlertRecord & {
  tasks?: AlertTask[];
  notifications?: AlertNotification[];
  audit_logs?: AlertAuditLog[];
};

type DispatchUser = {
  id: string;
  name: string;
  username: string;
  phone?: string;
  department_name?: string;
  role_name?: string;
};

type DispatchDepartment = {
  id: string;
  name: string;
  type?: string;
  sort?: number;
};

type AlertTaskFormValues = {
  title?: string;
  department_id?: string;
  assignee_id?: string;
  priority?: "normal" | "high";
  due_at?: { toISOString: () => string };
  note?: string;
};

type SupervisorAlertFilter = "all" | "scoped_store" | "high_risk" | "dispatchable" | "open" | "unassigned";

const typeLabel: Record<string, string> = {
  sales_drop: "销售异常",
  bad_review: "差评异常",
  inventory_risk: "库存风险"
};

const statusLabel: Record<string, string> = {
  open: "待处理",
  processing: "处理中",
  ignored: "已忽略",
  closed: "已关闭"
};

const statusColor: Record<string, string> = {
  open: "gold",
  processing: "blue",
  ignored: "default",
  closed: "green"
};

const taskStatusLabel: Record<string, string> = {
  pending_confirm: "待确认",
  processing: "处理中",
  pending_review: "待审核",
  closed: "已关闭",
  archived: "已归档"
};

const priorityLabel: Record<string, string> = {
  critical: "紧急",
  high: "高",
  normal: "普通",
  low: "低"
};

const channelLabel: Record<string, string> = {
  system: "系统内",
  h5: "H5"
};

const notificationStatusLabel: Record<string, string> = {
  pending: "待发送",
  sent: "已发送",
  failed: "发送失败",
  skipped: "已跳过",
  processed: "已处理"
};

const auditActionLabel: Record<string, string> = {
  ALERT_TO_TASK: "预警派发为任务",
  ALERT_STATUS_UPDATE: "预警状态更新",
  TASK_STATUS_UPDATE: "任务状态更新",
  TASK_FEEDBACK_SUBMIT: "店长提交反馈",
  TASK_REVIEW: "总部审核任务"
};

function formatDateTime(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function shortText(value?: string, fallback = "暂无内容") {
  const normalized = formatAlertText(value);
  if (!normalized.trim()) return fallback;
  return normalized.length > 160 ? `${normalized.slice(0, 160)}...` : normalized;
}

function alertLevelLabel(level: string) {
  if (level === "critical") return "严重";
  if (level === "high") return "高风险";
  return "预警";
}

function formatAlertText(value?: string | null) {
  if (!value) return "";
  return value
    .replace(/codex-alert-dispatch-check-\d+/gi, "系统验收预警派发检查")
    .replace(/codex-notification-link-check-\d+/gi, "系统验收通知链接检查")
    .replace(/\bcodex-[a-z0-9-]+\b/gi, "系统验收事项")
    .replace(/\bCodex\b/g, "系统验收")
    .replace(/\bCritical\b/g, "严重")
    .replace(/\bcritical\b/g, "严重")
    .replace(/\btemporary\b/gi, "临时")
    .replace(/\brestart\b/gi, "重启")
    .replace(/\bbackend\b/gi, "后端服务")
    .replace(/\bnotification\b/gi, "通知")
    .replace(/\bdispatch\b/gi, "派发")
    .replace(/\bcross-page\b/gi, "跨页面")
    .replace(/\bflow\b/gi, "流程")
    .replace(/\blink\b/gi, "链接")
    .replace(/\bcenter\b/gi, "中心")
    .replace(/\balert\b/gi, "预警")
    .replace(/\bcheck\b/gi, "检查")
    .replace(/\bafter\b/gi, "后");
}

function formatAlertType(value?: string | null) {
  if (!value) return "未分类";
  return typeLabel[value] || formatAlertText(value) || value;
}

function isHighRiskAlert(item: AlertRecord) {
  return item.level === "critical" || item.level === "high";
}

function isDispatchableAlert(item: AlertRecord) {
  return !["ignored", "closed"].includes(item.status);
}

function priorityColor(value?: string) {
  if (value === "critical") return "red";
  if (value === "high") return "volcano";
  if (value === "low") return "blue";
  return "default";
}

export function AlertsPage() {
  const [alerts, setAlerts] = useState<AlertRecord[]>([]);
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>();
  const [typeFilter, setTypeFilter] = useState<string>();
  const [levelFilter, setLevelFilter] = useState<string>();
  const [supervisorFilter, setSupervisorFilter] = useState<SupervisorAlertFilter>("all");
  const [loading, setLoading] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [taskingId, setTaskingId] = useState<string | null>(null);
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [h5Open, setH5Open] = useState(false);
  const [h5Url, setH5Url] = useState("");
  const [dispatchUsers, setDispatchUsers] = useState<DispatchUser[]>([]);
  const [dispatchDepartments, setDispatchDepartments] = useState<DispatchDepartment[]>([]);
  const [currentAlert, setCurrentAlert] = useState<AlertDetail | null>(null);
  const [targetAlertId, setTargetAlertId] = useState<string | null>(null);
  const [autoOpenedAlertId, setAutoOpenedAlertId] = useState<string | null>(null);
  const [permissions, setPermissions] = useState(() => readStoredPermissions());
  const [dispatchForm] = Form.useForm<AlertTaskFormValues>();
  const { message } = App.useApp();
  const canManageAlerts = hasPermission(permissions, "alerts", "manage");

  const summary = useMemo(() => {
    return alerts.reduce(
      (acc, item) => {
        acc.total += 1;
        if (item.status === "open") acc.open += 1;
        if (item.status === "processing") acc.processing += 1;
        if (isHighRiskAlert(item)) acc.highRisk += 1;
        if (isDispatchableAlert(item)) acc.dispatchable += 1;
        if (!item.responsible_user_id) acc.unassigned += 1;
        return acc;
      },
      { total: 0, open: 0, processing: 0, highRisk: 0, dispatchable: 0, unassigned: 0 }
    );
  }, [alerts]);

  const filteredAlerts = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    return alerts.filter((item) => {
      if (statusFilter && item.status !== statusFilter) return false;
      if (typeFilter && item.alert_type !== typeFilter) return false;
      if (levelFilter && item.level !== levelFilter) return false;
      if (supervisorFilter === "scoped_store" && !item.store_name) return false;
      if (supervisorFilter === "high_risk" && !isHighRiskAlert(item)) return false;
      if (supervisorFilter === "dispatchable" && !isDispatchableAlert(item)) return false;
      if (supervisorFilter === "open" && item.status !== "open") return false;
      if (supervisorFilter === "unassigned" && item.responsible_user_id) return false;
      if (!normalizedKeyword) return true;
      return [item.title, item.summary, item.store_name, item.responsible_user_name, item.alert_type]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedKeyword));
    });
  }, [alerts, keyword, levelFilter, statusFilter, supervisorFilter, typeFilter]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [alertRes, optionRes] = await Promise.all([
        api.get("/api/v1/alerts"),
        api.get("/api/v1/alerts/dispatch-options")
      ]);
      setAlerts(alertRes.data);
      setDispatchUsers(optionRes.data.users || []);
      setDispatchDepartments(optionRes.data.departments || []);
    } catch {
      message.error("预警数据加载失败，请确认后端服务和登录状态");
    } finally {
      setLoading(false);
    }
  }, [message]);

  const openDispatch = useCallback((record: AlertRecord) => {
    setCurrentAlert(record);
    setDispatchOpen(true);
  }, []);

  const openDetail = useCallback(
    async (record: AlertRecord) => {
      setCurrentAlert((previous) => (previous?.id === record.id ? { ...previous, ...record } : record));
      setDetailOpen(true);
      setDetailLoading(true);
      try {
        const res = await api.get(`/api/v1/alerts/${record.id}`);
        setCurrentAlert(res.data);
      } catch {
        message.error("预警详情加载失败");
      } finally {
        setDetailLoading(false);
      }
    },
    [message]
  );

  useEffect(() => {
    setPermissions(readStoredPermissions());
    setTargetAlertId(new URLSearchParams(window.location.search).get("alert_id"));
    load();
  }, [load]);

  useEffect(() => {
    if (!targetAlertId || autoOpenedAlertId === targetAlertId || !alerts.length) return;
    const matched = alerts.find((item) => item.id === targetAlertId);
    if (!matched) return;
    openDetail(matched);
    setAutoOpenedAlertId(targetAlertId);
  }, [alerts, autoOpenedAlertId, openDetail, targetAlertId]);

  useEffect(() => {
    if (!dispatchOpen || !currentAlert) return;
    dispatchForm.setFieldsValue({
      title: formatAlertText(currentAlert.title),
      assignee_id: currentAlert.responsible_user_id,
      priority: currentAlert.level === "critical" || currentAlert.level === "high" ? "high" : "normal",
      note: currentAlert.summary ? `归因草稿：${formatAlertText(currentAlert.summary)}` : undefined
    });
  }, [currentAlert, dispatchForm, dispatchOpen]);

  async function updateStatus(record: AlertRecord, status: string) {
    try {
      await api.put(`/api/v1/alerts/${record.id}/status`, { status });
      message.success("预警状态已更新");
      await load();
      if (detailOpen && currentAlert?.id === record.id) {
        await openDetail(record);
      }
    } catch {
      message.error("预警状态更新失败");
    }
  }

  async function toTask(values: AlertTaskFormValues) {
    if (!currentAlert) return;
    setTaskingId(currentAlert.id);
    try {
      const res = await api.post(`/api/v1/alerts/${currentAlert.id}/to-task`, {
        title: values.title,
        department_id: values.department_id,
        assignee_id: values.assignee_id,
        priority: values.priority || "normal",
        due_at: values.due_at ? values.due_at.toISOString() : undefined,
        note: values.note
      });
      setDispatchOpen(false);
      dispatchForm.resetFields();
      setH5Url(res.data.h5_url || "");
      if (res.data.h5_url) {
        setH5Open(true);
      }
      message.success(res.data.h5_url ? "预警已派发，H5 链接已生成，等待负责人确认收到" : "预警已派发");
      await load();
      if (detailOpen) {
        await openDetail(currentAlert);
      }
    } catch {
      message.error("预警转任务失败");
    } finally {
      setTaskingId(null);
    }
  }

  return (
    <>
      <section className="flow-band">
        <div>
          <span className="flow-kicker">预警派发</span>
          <div className="flow-title">从异常预警生成任务，并同步生成店长 H5 链接</div>
          <div className="flow-text">运营确认预警后，可补充处理说明、优先级和截止时间，再派发给门店处理。</div>
        </div>
        <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>
          刷新
        </Button>
      </section>

      <Card
        className="panel-card"
        title={`预警列表 · ${filteredAlerts.length}/${summary.total}`}
        extra={
          <div className="task-filter-bar">
            <Input.Search
              allowClear
              placeholder="搜索预警 / 门店 / 负责人"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              onSearch={setKeyword}
            />
            <Select
              value={supervisorFilter}
              onChange={setSupervisorFilter}
              options={[
                { value: "all", label: "全部预警" },
                { value: "scoped_store", label: "管辖门店预警" },
                { value: "high_risk", label: "高风险预警" },
                { value: "dispatchable", label: "待转任务" },
                { value: "open", label: "待处理" },
                { value: "unassigned", label: "未指派负责人" }
              ]}
            />
            <Select
              allowClear
              placeholder="全部状态"
              value={statusFilter}
              onChange={setStatusFilter}
              options={Object.entries(statusLabel).map(([value, label]) => ({ value, label }))}
            />
            <Select
              allowClear
              placeholder="全部类型"
              value={typeFilter}
              onChange={setTypeFilter}
              options={Object.entries(typeLabel).map(([value, label]) => ({ value, label }))}
            />
            <Select
              allowClear
              placeholder="全部等级"
              value={levelFilter}
              onChange={setLevelFilter}
              options={[
                { value: "critical", label: "严重" },
                { value: "high", label: "高风险" },
                { value: "warning", label: "预警" }
              ]}
            />
          </div>
        }
      >
        <Table
          loading={loading}
          rowKey="id"
          dataSource={filteredAlerts}
          scroll={{ x: 1120 }}
          locale={{ emptyText: <Empty description="暂无预警" /> }}
          columns={[
            { title: "门店", dataIndex: "store_name", width: 150, render: (value: string) => formatAlertText(value) || "未关联" },
            { title: "类型", dataIndex: "alert_type", width: 120, render: (value: string) => formatAlertType(value) },
            {
              title: "等级",
              dataIndex: "level",
              width: 96,
              render: (level: string) => <Tag color={level === "critical" || level === "high" ? "red" : "orange"}>{level === "critical" ? "严重" : "预警"}</Tag>
            },
            {
              title: "标题",
              dataIndex: "title",
              render: (_: string, record: AlertRecord) => (
                <div>
                  <div className="risk-title">{formatAlertText(record.title)}</div>
                  <div className="risk-meta">{shortText(record.summary, "暂无归因草稿")}</div>
                </div>
              )
            },
            { title: "负责人", dataIndex: "responsible_user_name", width: 120, render: (value: string) => value || "待指派" },
            {
              title: "状态",
              dataIndex: "status",
              width: 110,
              render: (status: string) => <Tag color={statusColor[status] || "default"}>{statusLabel[status] || status}</Tag>
            },
            { title: "创建时间", dataIndex: "created_at", width: 210, render: formatDateTime },
            {
              title: "操作",
              width: 230,
              render: (_: unknown, record: AlertRecord) => (
                <Space wrap>
                  <Button size="small" icon={<EyeOutlined />} onClick={() => openDetail(record)}>
                    查看
                  </Button>
                  {canManageAlerts ? (
                    <>
                      <Button
                        size="small"
                        type="primary"
                        icon={<SendOutlined />}
                        loading={taskingId === record.id}
                        onClick={() => openDispatch(record)}
                        disabled={record.status === "ignored" || record.status === "closed"}
                      >
                        派发
                      </Button>
                      <Button size="small" onClick={() => updateStatus(record, "processing")} disabled={record.status === "processing"}>
                        处理中
                      </Button>
                      <Button size="small" onClick={() => updateStatus(record, "ignored")} disabled={record.status === "ignored"}>
                        忽略
                      </Button>
                    </>
                  ) : (
                    <Tag>只读</Tag>
                  )}
                </Space>
              )
            }
          ]}
        />
      </Card>

      <Drawer
        className="task-detail-drawer alert-detail-drawer"
        title={currentAlert ? `预警详情：${formatAlertText(currentAlert.title)}` : "预警详情"}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        width={720}
      >
        {currentAlert ? (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <div className="task-detail-head">
              <div>
                <Space wrap size={8}>
                  <Tag color={currentAlert.level === "critical" || currentAlert.level === "high" ? "red" : "orange"}>{alertLevelLabel(currentAlert.level)}</Tag>
                  <Tag color={statusColor[currentAlert.status] || "default"}>{statusLabel[currentAlert.status] || currentAlert.status}</Tag>
                  <Tag>{formatAlertType(currentAlert.alert_type)}</Tag>
                </Space>
                <Typography.Title level={4}>{formatAlertText(currentAlert.title)}</Typography.Title>
                <Typography.Paragraph type="secondary">
                  {formatAlertText(currentAlert.store_name) || "未关联门店"} · {currentAlert.responsible_user_name || "待指派负责人"} · {formatDateTime(currentAlert.created_at)}
                </Typography.Paragraph>
              </div>
              <div className="task-detail-h5-hint">
                <CheckCircleOutlined />
                <span>先确认归因，再派发任务。店长 H5 反馈、通知和审计记录会回流到这里。</span>
              </div>
            </div>

            <div className="task-detail-metrics">
              <div>
                <span>当前状态</span>
                <b>{statusLabel[currentAlert.status] || currentAlert.status}</b>
              </div>
              <div>
                <span>截止时间</span>
                <b>{formatDateTime(currentAlert.due_at)}</b>
              </div>
              <div>
                <span>关联任务</span>
                <b>{currentAlert.tasks?.length ?? 0} 条</b>
              </div>
              <div>
                <span>通知记录</span>
                <b>{currentAlert.notifications?.length ?? 0} 条</b>
              </div>
            </div>

            <div className="task-detail-section">
              <div className="task-detail-section-head">
                <FileTextOutlined />
                <span>AI 归因摘要</span>
              </div>
              <div className="task-related-alert">
                <p>{formatAlertText(currentAlert.summary) || "暂无归因摘要，等待数据导入或 AI 归因任务生成。"}</p>
              </div>
            </div>

            <div className="task-detail-section">
              <div className="task-detail-section-head">
                <ShopOutlined />
                <span>关联任务</span>
              </div>
              {currentAlert.tasks?.length ? (
                <List
                  className="task-detail-list"
                  dataSource={currentAlert.tasks}
                  renderItem={(item) => (
                    <List.Item
                      actions={[
                        <Button key="task" size="small" type="link" onClick={() => (window.location.href = `/tasks?task_id=${item.id}`)}>
                          查看任务
                        </Button>
                      ]}
                    >
                      <List.Item.Meta
                        title={
                          <Space wrap>
                            <span>{formatAlertText(item.title)}</span>
                            <Tag color={item.status === "closed" ? "green" : item.status === "pending_review" ? "purple" : "blue"}>
                              {taskStatusLabel[item.status] || item.status}
                            </Tag>
                            <Tag color={priorityColor(item.priority)}>优先级：{priorityLabel[item.priority] || item.priority}</Tag>
                          </Space>
                        }
                        description={`${item.assignee_name || "待指派"} · ${item.department_name || "未设置部门"} · 截止 ${formatDateTime(item.due_at)}`}
                      />
                    </List.Item>
                  )}
                />
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无关联任务，可从底部派发给负责人" />
              )}
            </div>

            <div className="task-detail-section">
              <div className="task-detail-section-head">
                <BellOutlined />
                <span>关联通知</span>
              </div>
              {currentAlert.notifications?.length ? (
                <List
                  className="task-detail-list"
                  dataSource={currentAlert.notifications}
                  renderItem={(item) => (
                    <List.Item
                      actions={[
                        <Button key="notification" size="small" type="link" onClick={() => (window.location.href = `/notifications?notification_id=${item.id}`)}>
                          查看通知
                        </Button>
                      ]}
                    >
                      <List.Item.Meta
                        title={
                          <Space wrap>
                            <span>{formatAlertText(item.title) || "未命名通知"}</span>
                            <Tag>{channelLabel[item.channel] || item.channel}</Tag>
                            <Tag color={item.status === "failed" ? "red" : item.status === "sent" || item.status === "processed" ? "green" : "gold"}>
                              {notificationStatusLabel[item.status] || item.status}
                            </Tag>
                          </Space>
                        }
                        description={`${item.recipient_user_name || "系统"} · 重试 ${item.retry_count || 0} 次 · ${formatDateTime(item.sent_at)}`}
                      />
                    </List.Item>
                  )}
                />
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无关联通知" />
              )}
            </div>

            <div className="task-detail-section">
              <div className="task-detail-section-head">
                <HistoryOutlined />
                <span>审计记录</span>
              </div>
              {currentAlert.audit_logs?.length ? (
                <Timeline
                  className="task-audit-timeline"
                  items={currentAlert.audit_logs.map((item) => ({
                    color: item.result === "success" ? "green" : "red",
                    children: (
                      <div>
                        <b>{auditActionLabel[item.action] || item.action}</b>
                        <span>
                          {item.user_name || "系统"} · {formatDateTime(item.created_at)}
                        </span>
                      </div>
                    )
                  }))}
                />
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无审计记录" />
              )}
            </div>

            <Space className="detail-action-row" wrap>
              {canManageAlerts ? (
                <>
                  <Button
                    type="primary"
                    icon={<SendOutlined />}
                    loading={taskingId === currentAlert.id}
                    onClick={() => openDispatch(currentAlert)}
                    disabled={currentAlert.status === "ignored" || currentAlert.status === "closed"}
                  >
                    派发任务
                  </Button>
                  <Button onClick={() => updateStatus(currentAlert, "processing")} disabled={currentAlert.status === "processing"}>
                    标记处理中
                  </Button>
                  <Button onClick={() => updateStatus(currentAlert, "ignored")} disabled={currentAlert.status === "ignored" || currentAlert.status === "closed"}>
                    忽略预警
                  </Button>
                </>
              ) : null}
              <Button icon={<ReloadOutlined />} onClick={() => openDetail(currentAlert)} loading={detailLoading}>
                刷新详情
              </Button>
            </Space>
            {detailLoading ? <div className="task-detail-loading">正在刷新预警详情...</div> : null}
          </Space>
        ) : null}
      </Drawer>

      <Modal
        title={currentAlert ? `派发任务：${formatAlertText(currentAlert.title)}` : "派发任务"}
        open={dispatchOpen}
        onCancel={() => setDispatchOpen(false)}
        footer={null}
        forceRender
        destroyOnHidden
      >
        <Form form={dispatchForm} preserve={false} layout="vertical" onFinish={toTask}>
          <Form.Item name="title" label="任务标题" rules={[{ required: true, message: "请输入任务标题" }]}>
            <Input placeholder="例如：复盘门店销售下滑原因" />
          </Form.Item>
          <div className="task-form-grid">
            <Form.Item name="assignee_id" label="责任人" rules={[{ required: true, message: "请选择责任人" }]}>
              <Select
                showSearch
                optionFilterProp="label"
                placeholder="选择店长或督导"
                options={dispatchUsers.map((user) => ({
                  value: user.id,
                  label: `${user.name}${user.department_name ? ` · ${user.department_name}` : ""}${user.role_name ? ` · ${user.role_name}` : ""}`
                }))}
              />
            </Form.Item>
            <Form.Item name="department_id" label="责任部门">
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                placeholder="可选"
                options={dispatchDepartments.map((department) => ({ value: department.id, label: department.name }))}
              />
            </Form.Item>
          </div>
          <div className="task-form-grid">
            <Form.Item name="priority" label="优先级" rules={[{ required: true, message: "请选择优先级" }]}>
              <Select
                options={[
                  { label: "普通", value: "normal" },
                  { label: "高", value: "high" }
                ]}
              />
            </Form.Item>
            <Form.Item name="due_at" label="截止时间">
              <DatePicker showTime style={{ width: "100%" }} />
            </Form.Item>
          </div>
          <Form.Item name="note" label="派单说明">
            <Input.TextArea rows={4} placeholder="写给运营留档的处理说明；店长 H5 将展示任务标题、门店和预警归因。" />
          </Form.Item>
          <Space>
            <Button type="primary" icon={<SendOutlined />} htmlType="submit" loading={Boolean(taskingId)}>
              派发并生成 H5
            </Button>
            <Button onClick={() => setDispatchOpen(false)}>取消</Button>
          </Space>
        </Form>
      </Modal>

      <Modal title="店长 H5 链接" open={h5Open} onCancel={() => setH5Open(false)} footer={null}>
        <Space direction="vertical" style={{ width: "100%" }}>
          <Typography.Text type="secondary">任务已生成并等待负责人确认，确认收到并开始处理后即可提交反馈。</Typography.Text>
          <Input.TextArea value={h5Url} rows={3} readOnly />
          <Space>
            <Button
              type="primary"
              icon={<CopyOutlined />}
              onClick={async () => {
                await navigator.clipboard.writeText(h5Url);
                message.success("H5 链接已复制");
              }}
            >
              复制链接
            </Button>
            <Button icon={<LinkOutlined />} onClick={() => window.open(h5Url, "_blank", "noopener,noreferrer")}>打开 H5</Button>
          </Space>
        </Space>
      </Modal>
    </>
  );
}
