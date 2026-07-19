"use client";

import {
  BellOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CopyOutlined,
  EyeOutlined,
  FileTextOutlined,
  HistoryOutlined,
  LinkOutlined,
  ReloadOutlined,
  SendOutlined,
  ShopOutlined
} from "@ant-design/icons";
import { App, Button, Card, Descriptions, Drawer, Empty, Form, Image, Input, List, Modal, Popconfirm, Select, Space, Table, Tag, Timeline, Typography } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";

import { api } from "@/lib/api";
import { hasPermission, readStoredPermissions } from "@/lib/permissions";

type TaskRecord = {
  id: string;
  source_type?: string;
  source_id?: string;
  title: string;
  store_name?: string;
  assignee_name?: string;
  department_name?: string;
  status: string;
  priority: string;
  due_at?: string;
  result?: string;
  feedback_img_urls?: string[];
  alert_type?: string;
  alert_level?: string;
  created_at: string;
};

type RelatedAlert = {
  id: string;
  alert_type?: string;
  level?: string;
  title?: string;
  summary?: string;
  status?: string;
  store_name?: string;
  created_at?: string;
};

type TaskNotification = {
  id: string;
  channel: string;
  title?: string;
  content?: string;
  status: string;
  retry_count: number;
  sent_at?: string;
  created_at?: string;
};

type TaskAuditLog = {
  id: string;
  action: string;
  module: string;
  object_type?: string;
  result: string;
  created_at: string;
};

type TaskDetail = TaskRecord & {
  related_alert?: RelatedAlert | null;
  notifications?: TaskNotification[];
  audit_logs?: TaskAuditLog[];
};

type FeedbackFormValues = {
  result: string;
};

type ReviewFormValues = {
  note?: string;
};

type SupervisorTaskFilter = "all" | "scoped_store" | "pending_review" | "overdue" | "high" | "open";

const statusLabel: Record<string, string> = {
  pending_confirm: "待确认",
  confirmed: "已确认",
  processing: "处理中",
  pending_review: "待审核",
  closed: "已关闭",
  archived: "已归档",
  overdue: "已逾期"
};

const statusColor: Record<string, string> = {
  pending_confirm: "gold",
  confirmed: "blue",
  processing: "cyan",
  pending_review: "purple",
  closed: "green",
  archived: "default",
  overdue: "red"
};

const priorityLabel: Record<string, string> = {
  critical: "紧急",
  high: "高",
  normal: "普通",
  low: "低"
};

const sourceLabel: Record<string, string> = {
  manual: "手工创建",
  alert: "异常预警",
  inventory_risk: "库存风险",
  bad_review: "评价异常"
};

const alertLevelLabel: Record<string, string> = {
  critical: "严重",
  high: "高风险",
  warning: "预警",
  medium: "中风险",
  low: "低风险",
  normal: "普通"
};

const alertTypeLabel: Record<string, string> = {
  sales_drop: "销售下滑",
  inventory_risk: "库存风险",
  bad_review: "评价异常"
};

const notificationStatusLabel: Record<string, string> = {
  pending: "待处理",
  sent: "已处理",
  ignored: "已忽略",
  failed: "推送失败"
};

const channelLabel: Record<string, string> = {
  system: "系统内",
  relay: "H5 链接"
};

const auditActionLabel: Record<string, string> = {
  ALERT_TO_TASK: "预警派发任务",
  TASK_FEEDBACK_SUBMIT: "店长提交反馈",
  TASK_REVIEW_APPROVE: "总部审核通过",
  TASK_REVIEW_RETURN: "总部驳回重推",
  TASK_MARK_OVERDUE: "任务标记逾期"
};

function formatDateTime(value?: string) {
  if (!value) return "未设置";
  return value.replace("T", " ").replace("Z", "").slice(0, 19);
}

function formatSystemTitle(value?: string | null) {
  if (!value) return "未命名事项";
  if (/^codex[-_]/i.test(value)) return "系统验收事项";
  if (/^Critical$/i.test(value)) return "严重预警事项";
  return value
    .replaceAll("Codex", "系统验收")
    .replaceAll("Critical", "严重")
    .replaceAll("critical", "严重");
}

function splitReviewResult(result?: string) {
  const [feedback, ...reviewParts] = String(result || "").split(/\n\n审核意见:/);
  return {
    feedback: feedback.trim(),
    reviewNote: reviewParts.join("\n\n审核意见:").trim()
  };
}

function shortText(value?: string, fallback = "-") {
  const text = String(value || "").trim();
  return text || fallback;
}

function assetUrl(url: string) {
  if (url.startsWith("http")) return url;
  return `${api.defaults.baseURL}${url}`;
}

function isTaskOverdue(item: TaskRecord) {
  if (["closed", "archived"].includes(item.status)) return false;
  if (item.status === "overdue") return true;
  if (!item.due_at) return false;
  const dueAt = new Date(item.due_at).getTime();
  return Number.isFinite(dueAt) && dueAt < Date.now();
}

function isOpenTask(item: TaskRecord) {
  return !["closed", "archived"].includes(item.status);
}

function priorityColor(value?: string) {
  if (value === "critical") return "red";
  if (value === "high") return "volcano";
  if (value === "low") return "blue";
  return "default";
}

function taskProgressItems(status: string) {
  const steps = [
    { key: "pending_confirm", label: "已派发", description: "任务已生成并推送给负责人" },
    { key: "confirmed", label: "已确认", description: "负责人已确认收到任务" },
    { key: "processing", label: "处理中", description: "门店正在处理并准备反馈" },
    { key: "pending_review", label: "待审核", description: "门店已提交反馈,等待总部复核" },
    { key: "closed", label: "已关闭", description: "总部已审核通过并关闭任务" }
  ];
  const statusOrder = ["pending_confirm", "confirmed", "processing", "pending_review", "closed", "archived"];
  const currentIndex = statusOrder.indexOf(status);
  return steps.map((step, index) => ({
    color: currentIndex >= index ? "green" : "gray",
    children: (
      <div>
        <b>{step.label}</b>
        <span>{step.description}</span>
      </div>
    )
  }));
}

export function TasksPage() {
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>();
  const [priorityFilter, setPriorityFilter] = useState<string>();
  const [supervisorFilter, setSupervisorFilter] = useState<SupervisorTaskFilter>("all");
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [reviewMode, setReviewMode] = useState<"approve" | "return">("approve");
  const [h5Open, setH5Open] = useState(false);
  const [h5Url, setH5Url] = useState("");
  const [tokenLoadingId, setTokenLoadingId] = useState<string | null>(null);
  const [currentTask, setCurrentTask] = useState<TaskDetail | null>(null);
  const [focusTaskId, setFocusTaskId] = useState<string | null>(null);
  const [permissions, setPermissions] = useState(() => readStoredPermissions());
  const [feedbackForm] = Form.useForm<FeedbackFormValues>();
  const [reviewForm] = Form.useForm<ReviewFormValues>();
  const { message } = App.useApp();

  const summary = useMemo(() => {
    return tasks.reduce(
      (acc, item) => {
        acc.total += 1;
        if (item.status === "pending_review") acc.pendingReview += 1;
        if (item.status === "processing") acc.processing += 1;
        if (isTaskOverdue(item)) acc.overdue += 1;
        if (item.status === "closed") acc.closed += 1;
        if (item.status === "archived") acc.archived += 1;
        return acc;
      },
      { total: 0, pendingReview: 0, processing: 0, overdue: 0, closed: 0, archived: 0 }
    );
  }, [tasks]);
  const filteredTasks = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    return tasks.filter((item) => {
      if (statusFilter && item.status !== statusFilter) return false;
      if (priorityFilter && item.priority !== priorityFilter) return false;
      if (supervisorFilter === "scoped_store" && !item.store_name) return false;
      if (supervisorFilter === "pending_review" && item.status !== "pending_review") return false;
      if (supervisorFilter === "overdue" && !isTaskOverdue(item)) return false;
      if (supervisorFilter === "high" && !["critical", "high"].includes(item.priority) && !["critical", "high"].includes(item.alert_level || "")) return false;
      if (supervisorFilter === "open" && !isOpenTask(item)) return false;
      if (!normalizedKeyword) return true;
      return [item.title, item.store_name, item.assignee_name, item.department_name, item.result]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedKeyword));
    });
  }, [keyword, priorityFilter, statusFilter, supervisorFilter, tasks]);
  const canManageTasks = hasPermission(permissions, "tasks", "manage");
  const canFeedbackTasks = hasPermission(permissions, "tasks", "feedback");
  const canApproveTasks = hasPermission(permissions, "tasks", "approve");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/api/v1/tasks");
      setTasks(res.data);
    } catch {
      message.error("任务数据加载失败,请确认后端服务和登录状态");
    } finally {
      setLoading(false);
    }
  }, [message]);

  const refreshTaskDetail = useCallback(async (taskId: string) => {
    setDetailLoading(true);
    try {
      const res = await api.get(`/api/v1/tasks/${taskId}`);
      setCurrentTask(res.data);
    } catch {
      message.error("任务详情加载失败");
    } finally {
      setDetailLoading(false);
    }
  }, [message]);

  const openDetail = useCallback(
    (record: TaskRecord) => {
      setCurrentTask(record);
      setDetailOpen(true);
      refreshTaskDetail(record.id);
    },
    [refreshTaskDetail]
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const taskId = new URLSearchParams(window.location.search).get("task_id");
    setFocusTaskId(taskId);
    setPermissions(readStoredPermissions());
  }, []);

  useEffect(() => {
    if (!focusTaskId || !tasks.length || detailOpen) return;
    const matched = tasks.find((item) => item.id === focusTaskId);
    if (!matched) return;
    openDetail(matched);
  }, [detailOpen, focusTaskId, openDetail, tasks]);

  useEffect(() => {
    if (!currentTask) return;
    const latestTask = tasks.find((item) => item.id === currentTask.id);
    if (
      latestTask &&
      (latestTask.status !== currentTask.status ||
        latestTask.result !== currentTask.result ||
        latestTask.priority !== currentTask.priority ||
        latestTask.assignee_name !== currentTask.assignee_name ||
        latestTask.department_name !== currentTask.department_name)
    ) {
      setCurrentTask({
        ...currentTask,
        ...latestTask,
        related_alert: currentTask.related_alert,
        notifications: currentTask.notifications,
        audit_logs: currentTask.audit_logs
      });
    }
  }, [currentTask, tasks]);

  async function updateStatus(record: TaskRecord, status: string) {
    try {
      await api.put(`/api/v1/tasks/${record.id}/status`, { status });
      message.success("任务状态已更新");
      await load();
      if (currentTask?.id === record.id) {
        await refreshTaskDetail(record.id);
      }
    } catch {
      message.error("任务状态更新失败");
    }
  }

  function openFeedback(record: TaskRecord) {
    setCurrentTask(record);
    feedbackForm.resetFields();
    setFeedbackOpen(true);
  }

  async function submitFeedback(values: FeedbackFormValues) {
    if (!currentTask) return;
    try {
      await api.post(`/api/v1/tasks/${currentTask.id}/feedback`, {
        result: values.result,
        feedback_img_urls: []
      });
      message.success("反馈已提交,任务进入待审核");
      setFeedbackOpen(false);
      await load();
      await refreshTaskDetail(currentTask.id);
    } catch {
      message.error("反馈提交失败");
    }
  }

  function openReview(record: TaskRecord, mode: "approve" | "return") {
    setCurrentTask(record);
    setReviewMode(mode);
    reviewForm.resetFields();
    setReviewOpen(true);
  }

  async function submitReview(values: ReviewFormValues) {
    if (!currentTask) return;
    const approved = reviewMode === "approve";
    try {
      await api.post(`/api/v1/tasks/${currentTask.id}/review`, {
        approved,
        note: values.note
      });
      message.success(approved ? "任务已审核通过并关闭" : "任务已驳回,并已重新推送给门店负责人");
      setReviewOpen(false);
      await load();
      await refreshTaskDetail(currentTask.id);
    } catch {
      message.error("任务审核失败");
    }
  }

  async function generateH5Link(record: TaskRecord) {
    setTokenLoadingId(record.id);
    try {
      const res = await api.post("/api/v1/relay/generate-token", { task_id: record.id });
      setH5Url(res.data.h5_url);
      setCurrentTask(record);
      setH5Open(true);
      message.success(`H5 链接已生成,已写入${res.data.notification_channel || "system"}推送通知,等待负责人确认`);
      if (detailOpen) {
        await refreshTaskDetail(record.id);
      }
    } catch {
      message.error("H5 链接生成失败");
    } finally {
      setTokenLoadingId(null);
    }
  }

  return (
    <>
      <section className="flow-band">
        <div>
          <span className="flow-kicker">任务闭环</span>
          <div className="flow-title">承接预警派单、店长反馈与总部审核</div>
          <div className="flow-text">
            任务闭环覆盖派发确认、门店处理、H5 反馈、总部复核通过或驳回重推。
          </div>
        </div>
        <Space wrap>
          <Tag color="purple">待审核 {summary.pendingReview}</Tag>
          <Tag color="cyan">处理中 {summary.processing}</Tag>
          <Tag color="red">逾期 {summary.overdue}</Tag>
          <Tag color="green">已关闭 {summary.closed}</Tag>
          <Tag>已归档 {summary.archived}</Tag>
          <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>
            刷新
          </Button>
        </Space>
      </section>

      <Card
        className="panel-card"
        title={`任务列表 · ${filteredTasks.length}/${summary.total}`}
        extra={
          <div className="task-filter-bar">
            <Input.Search
              allowClear
              placeholder="搜索任务 / 门店 / 负责人"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              onSearch={setKeyword}
            />
            <Select
              value={supervisorFilter}
              onChange={setSupervisorFilter}
              options={[
                { value: "all", label: "全部任务" },
                { value: "scoped_store", label: "管辖门店任务" },
                { value: "pending_review", label: "待我审核" },
                { value: "overdue", label: "逾期任务" },
                { value: "high", label: "高优先级" },
                { value: "open", label: "未关闭任务" }
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
              placeholder="全部优先级"
              value={priorityFilter}
              onChange={setPriorityFilter}
              options={Object.entries(priorityLabel).map(([value, label]) => ({ value, label }))}
            />
          </div>
        }
      >
        <Table
          loading={loading}
          rowKey="id"
          dataSource={filteredTasks}
          scroll={{ x: 1180 }}
          rowClassName={(record) => (record.id === focusTaskId ? "table-row-focus" : "")}
          locale={{ emptyText: <Empty description="暂无任务" /> }}
          columns={[
            {
              title: "任务",
              dataIndex: "title",
              width: 330,
              render: (_: string, record: TaskRecord) => (
                <div>
                  <div className="risk-title">{formatSystemTitle(record.title)}</div>
                  <div className="risk-meta">
                    来源:{sourceLabel[record.source_type || ""] || "手动创建"} · {record.store_name || "未关联门店"}
                  </div>
                </div>
              )
            },
            { title: "负责人", dataIndex: "assignee_name", width: 120, render: (value: string) => value || "待指派" },
            {
              title: "优先级",
              dataIndex: "priority",
              width: 96,
              render: (value: string) => <Tag color={priorityColor(value)}>{priorityLabel[value] || value}</Tag>
            },
            {
              title: "状态",
              dataIndex: "status",
              width: 110,
              render: (value: string) => <Tag color={statusColor[value] || "default"}>{statusLabel[value] || value}</Tag>
            },
            { title: "截止时间", dataIndex: "due_at", width: 210, render: (value: string) => formatDateTime(value) },
            { title: "创建时间", dataIndex: "created_at", width: 210, render: formatDateTime },
            {
              title: "操作",
              fixed: "right",
              width: 380,
              render: (_: unknown, record: TaskRecord) => (
                <Space wrap>
                  <Button size="small" icon={<EyeOutlined />} onClick={() => openDetail(record)}>
                    详情
                  </Button>
                  {canManageTasks ? (
                    <>
                      <Button size="small" onClick={() => updateStatus(record, "confirmed")} disabled={record.status !== "pending_confirm"}>
                        确认
                      </Button>
                      <Button
                        size="small"
                        onClick={() => updateStatus(record, "processing")}
                        disabled={!["confirmed", "overdue"].includes(record.status)}
                      >
                        处理
                      </Button>
                      <Button
                        size="small"
                        onClick={() => generateH5Link(record)}
                        loading={tokenLoadingId === record.id}
                        disabled={["closed", "archived", "pending_review"].includes(record.status)}
                      >
                        H5
                      </Button>
                      <Popconfirm
                        title="确认归档该任务?"
                        okText="确认"
                        cancelText="取消"
                        onConfirm={() => updateStatus(record, "archived")}
                      >
                        <Button size="small" disabled={record.status !== "closed"}>
                          归档
                        </Button>
                      </Popconfirm>
                    </>
                  ) : null}
                  {canFeedbackTasks ? (
                    <Button size="small" type="primary" onClick={() => openFeedback(record)} disabled={record.status !== "processing"}>
                      反馈
                    </Button>
                  ) : null}
                  {canApproveTasks ? (
                    <>
                      <Button size="small" onClick={() => openReview(record, "approve")} disabled={record.status !== "pending_review"}>
                        通过
                      </Button>
                      <Button size="small" danger onClick={() => openReview(record, "return")} disabled={record.status !== "pending_review"}>
                        驳回重推
                      </Button>
                    </>
                  ) : null}
                </Space>
              )
            }
          ]}
        />
      </Card>

      <Drawer
        className="task-detail-drawer"
        title={currentTask ? `任务详情:${formatSystemTitle(currentTask.title)}` : "任务详情"}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        width={720}
      >
        {currentTask ? (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <div className="task-detail-head">
              <div>
                <Space wrap size={8}>
                  <Tag color={statusColor[currentTask.status] || "default"}>{statusLabel[currentTask.status] || currentTask.status}</Tag>
                  <Tag color={priorityColor(currentTask.priority)}>优先级:{priorityLabel[currentTask.priority] || currentTask.priority}</Tag>
                  <Tag>{sourceLabel[currentTask.source_type || ""] || "手动创建"}</Tag>
                </Space>
                <Typography.Title level={4}>{formatSystemTitle(currentTask.title)}</Typography.Title>
                <Typography.Paragraph type="secondary">
                  {currentTask.store_name || "未关联门店"} · {currentTask.department_name || "未设置部门"} · {currentTask.assignee_name || "待指派"}
                </Typography.Paragraph>
              </div>
              <div className="task-detail-h5-hint">
                <FileTextOutlined />
                <span>H5 反馈回流后,任务进入总部审核。</span>
              </div>
            </div>

            <div className="task-detail-metrics">
              <div>
                <span>当前状态</span>
                <b>{statusLabel[currentTask.status] || currentTask.status}</b>
              </div>
              <div>
                <span>截止时间</span>
                <b>{formatDateTime(currentTask.due_at)}</b>
              </div>
              <div>
                <span>通知记录</span>
                <b>{currentTask.notifications?.length ?? 0} 条</b>
              </div>
              <div>
                <span>审计记录</span>
                <b>{currentTask.audit_logs?.length ?? 0} 条</b>
              </div>
            </div>

            <div className="task-detail-section">
              <div className="task-detail-section-head">
                <CheckCircleOutlined />
                <span>闭环进度</span>
              </div>
              <Timeline className="task-progress-timeline" items={taskProgressItems(currentTask.status)} />
            </div>

            <div className="task-detail-section">
              <div className="task-detail-section-head">
                <ShopOutlined />
                <span>关联预警</span>
              </div>
              {currentTask.related_alert ? (
                <div className="task-related-alert">
                  <Space wrap>
                    <Tag color={currentTask.related_alert.level === "critical" ? "red" : "orange"}>{alertLevelLabel[currentTask.related_alert.level || "normal"] || currentTask.related_alert.level || "普通"}</Tag>
                    <Tag>{statusLabel[currentTask.related_alert.status || ""] || currentTask.related_alert.status || "-"}</Tag>
                    <Tag>{alertTypeLabel[currentTask.related_alert.alert_type || ""] || currentTask.related_alert.alert_type || "-"}</Tag>
                  </Space>
                  <b>{formatSystemTitle(currentTask.related_alert.title || "未命名预警")}</b>
                  <p>{shortText(currentTask.related_alert.summary, "暂无归因摘要")}</p>
                  <Button size="small" icon={<LinkOutlined />} onClick={() => (window.location.href = `/alerts?alert_id=${currentTask.related_alert?.id}`)}>
                    查看预警
                  </Button>
                </div>
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未关联预警" />
              )}
            </div>

            <div className="task-detail-section">
              <div className="task-detail-section-head">
                <FileTextOutlined />
                <span>相关 SOP/知识检索</span>
              </div>
            </div>

            <div className="task-detail-section">
              <div className="task-detail-section-head">
                <FileTextOutlined />
                <span>店长反馈与审核</span>
              </div>
              {currentTask.result ? (
                <div className="task-feedback-block">
                  <div>
                    <Typography.Text type="secondary">店长处理结果</Typography.Text>
                    <p>{splitReviewResult(currentTask.result).feedback}</p>
                  </div>
                  {splitReviewResult(currentTask.result).reviewNote ? (
                    <div>
                      <Typography.Text type="secondary">总部审核意见</Typography.Text>
                      <p>{splitReviewResult(currentTask.result).reviewNote}</p>
                    </div>
                  ) : null}
                  {currentTask.feedback_img_urls?.length ? (
                    <div className="task-feedback-images">
                      <Typography.Text type="secondary">整改凭证图片</Typography.Text>
                      <Image.PreviewGroup>
                        {currentTask.feedback_img_urls.map((url, index) => (
                          <Image key={url} src={assetUrl(url)} alt={`整改凭证 ${index + 1}`} />
                        ))}
                      </Image.PreviewGroup>
                    </div>
                  ) : null}
                </div>
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="门店尚未提交反馈" />
              )}
            </div>

            <div className="task-detail-section">
              <div className="task-detail-section-head">
                <BellOutlined />
                <span>关联通知</span>
              </div>
              {currentTask.notifications?.length ? (
                <List
                  className="task-detail-list"
                  dataSource={currentTask.notifications}
                  renderItem={(item) => (
                    <List.Item
                      actions={[
                        <Button key="notification" size="small" type="link" onClick={() => (window.location.href = `/notifications?notification_id=${item.id}`)}>
                          查看
                        </Button>
                      ]}
                    >
                      <List.Item.Meta
                        title={
                          <Space wrap>
                            <span>{formatSystemTitle(item.title || "未命名通知")}</span>
                            <Tag>{channelLabel[item.channel] || item.channel}</Tag>
                            <Tag color={item.status === "failed" ? "red" : item.status === "sent" ? "green" : "gold"}>
                              {notificationStatusLabel[item.status] || item.status}
                            </Tag>
                          </Space>
                        }
                        description={`重试 ${item.retry_count} 次 · ${formatDateTime(item.sent_at || item.created_at)}`}
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
              {currentTask.audit_logs?.length ? (
                <Timeline
                  className="task-audit-timeline"
                  items={currentTask.audit_logs.map((item) => ({
                    color: item.result === "success" ? "green" : "red",
                    children: (
                      <div>
                        <b>{auditActionLabel[item.action] || item.action}</b>
                        <span>{formatDateTime(item.created_at)}</span>
                      </div>
                    )
                  }))}
                />
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无审计记录" />
              )}
            </div>

            <Space className="detail-action-row" wrap>
              {canManageTasks ? (
                <>
                  <Button
                    icon={<LinkOutlined />}
                    onClick={() => generateH5Link(currentTask)}
                    loading={tokenLoadingId === currentTask.id}
                    disabled={["closed", "archived", "pending_review"].includes(currentTask.status)}
                  >
                    生成 H5 链接
                  </Button>
                  <Popconfirm
                    title="确认归档该任务?"
                    okText="确认"
                    cancelText="取消"
                    onConfirm={() => updateStatus(currentTask, "archived")}
                  >
                    <Button disabled={currentTask.status !== "closed"}>归档</Button>
                  </Popconfirm>
                </>
              ) : null}
              {canFeedbackTasks ? (
                <Button type="primary" onClick={() => openFeedback(currentTask)} disabled={currentTask.status !== "processing"}>
                  提交反馈
                </Button>
              ) : null}
              {canApproveTasks ? (
                <>
                  <Button onClick={() => openReview(currentTask, "approve")} disabled={currentTask.status !== "pending_review"}>
                    通过并关闭
                  </Button>
                  <Button danger onClick={() => openReview(currentTask, "return")} disabled={currentTask.status !== "pending_review"}>
                    驳回并重推门店
                  </Button>
                </>
              ) : null}
            </Space>
            {detailLoading ? <div className="task-detail-loading">正在刷新任务详情...</div> : null}
          </Space>
        ) : null}
      </Drawer>

      <Modal className="responsive-modal task-flow-modal" title="提交处理反馈" open={feedbackOpen} onCancel={() => setFeedbackOpen(false)} footer={null} forceRender destroyOnHidden zIndex={1300}>
        <Form form={feedbackForm} preserve={false} layout="vertical" onFinish={submitFeedback}>
          <Form.Item name="result" label="处理结果" rules={[{ required: true, message: "请输入处理结果" }]}>
            <Input.TextArea rows={4} placeholder="例如:已联系门店复盘出杯流程,今日晚高峰增加 1 名排班。" />
          </Form.Item>
          <Space className="modal-action-row">
            <Button type="primary" htmlType="submit">
              提交反馈
            </Button>
            <Button onClick={() => setFeedbackOpen(false)}>取消</Button>
          </Space>
        </Form>
      </Modal>

      <Modal
        className="responsive-modal task-flow-modal"
        title={reviewMode === "approve" ? "审核通过" : "驳回并重新推送门店"}
        open={reviewOpen}
        onCancel={() => setReviewOpen(false)}
        footer={null}
        forceRender
        destroyOnHidden
        zIndex={1300}
      >
        {currentTask?.result ? (
          <div className="review-result-box">
            <Typography.Text type="secondary">门店反馈</Typography.Text>
            <div>{splitReviewResult(currentTask.result).feedback}</div>
            {currentTask.feedback_img_urls?.length ? (
              <div className="task-feedback-images compact">
                <Typography.Text type="secondary">整改凭证图片</Typography.Text>
                <Image.PreviewGroup>
                  {currentTask.feedback_img_urls.map((url, index) => (
                    <Image key={url} src={assetUrl(url)} alt={`整改凭证 ${index + 1}`} />
                  ))}
                </Image.PreviewGroup>
              </div>
            ) : null}
          </div>
        ) : null}
        <Form form={reviewForm} preserve={false} layout="vertical" onFinish={submitReview}>
          <Form.Item
            name="note"
            label={reviewMode === "approve" ? "审核意见" : "驳回原因"}
            rules={reviewMode === "return" ? [{ required: true, message: "请填写驳回原因,门店负责人会在 H5 中看到这条说明" }] : undefined}
          >
            <Input.TextArea
              rows={4}
              placeholder={reviewMode === "approve" ? "可填写总部复核意见,留空则直接关闭任务。" : "说明门店需要重新整改或补充反馈的内容,提交后会重新生成 H5 链接并推送。"}
            />
          </Form.Item>
          <Space className="modal-action-row">
            <Button type="primary" danger={reviewMode === "return"} htmlType="submit">
              {reviewMode === "approve" ? "通过并关闭" : "驳回并重新推送"}
            </Button>
            <Button onClick={() => setReviewOpen(false)}>取消</Button>
          </Space>
        </Form>
      </Modal>

      <Modal className="responsive-modal task-flow-modal" title={`店长 H5 链接${currentTask ? `:${formatSystemTitle(currentTask.title)}` : ""}`} open={h5Open} onCancel={() => setH5Open(false)} footer={null} zIndex={1300}>
        <Space direction="vertical" style={{ width: "100%" }}>
          <Typography.Text type="secondary">将链接发送给店长后,反馈会回流到当前任务并进入总部审核。</Typography.Text>
          <Input.TextArea value={h5Url} rows={3} readOnly />
          <Space className="modal-action-row">
            <Button
              type="primary"
              icon={<CopyOutlined />}
              onClick={async () => {
                await navigator.clipboard.writeText(h5Url);
                message.success("链接已复制");
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
