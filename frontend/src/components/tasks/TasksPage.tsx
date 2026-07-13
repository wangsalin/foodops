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
  pending_confirm: "å¾…ç¡®è®¤",
  confirmed: "å·²ç¡®è®¤",
  processing: "å¤„ç†ä¸­",
  pending_review: "å¾…å®¡æ ¸",
  closed: "å·²å…³é—­",
  archived: "å·²å½’æ¡£",
  overdue: "å·²é€¾æœŸ"
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
  critical: "ç´§æ€¥",
  high: "é«˜",
  normal: "æ™®é€š",
  low: "ä½Ž"
};

const sourceLabel: Record<string, string> = {
  manual: "手工创建",
  alert: "异常预警",
  inventory_risk: "库存风险",
  bad_review: "评价异常"
};

const alertLevelLabel: Record<string, string> = {
  critical: "ä¸¥é‡",
  high: "é«˜é£Žé™©",
  warning: "é¢„è­¦",
  medium: "ä¸­é£Žé™©",
  low: "ä½Žé£Žé™©",
  normal: "æ™®é€š"
};

const alertTypeLabel: Record<string, string> = {
  sales_drop: "销售下滑",
  inventory_risk: "库存风险",
  bad_review: "评价异常"
};

const notificationStatusLabel: Record<string, string> = {
  pending: "å¾…å¤„ç†",
  sent: "å·²å¤„ç†",
  ignored: "å·²å¿½ç•¥",
  failed: "æŽ¨é€å¤±è´¥"
};

const channelLabel: Record<string, string> = {
  system: "系统内",
  relay: "H5 链接"
};

const auditActionLabel: Record<string, string> = {
  ALERT_TO_TASK: "é¢„è­¦æ´¾å‘ä»»åŠ¡",
  TASK_FEEDBACK_SUBMIT: "åº—é•¿æäº¤åé¦ˆ",
  TASK_REVIEW_APPROVE: "æ€»éƒ¨å®¡æ ¸é€šè¿‡",
  TASK_REVIEW_RETURN: "æ€»éƒ¨é©³å›žé‡æŽ¨",
  TASK_MARK_OVERDUE: "ä»»åŠ¡æ ‡è®°é€¾æœŸ"
};

function formatDateTime(value?: string) {
  if (!value) return "æœªè®¾ç½®";
  return value.replace("T", " ").replace("Z", "").slice(0, 19);
}

function formatSystemTitle(value?: string | null) {
  if (!value) return "æœªå‘½åäº‹é¡¹";
  if (/^codex[-_]/i.test(value)) return "ç³»ç»ŸéªŒæ”¶äº‹é¡¹";
  if (/^Critical$/i.test(value)) return "ä¸¥é‡é¢„è­¦äº‹é¡¹";
  return value
    .replaceAll("Codex", "ç³»ç»ŸéªŒæ”¶")
    .replaceAll("Critical", "ä¸¥é‡")
    .replaceAll("critical", "ä¸¥é‡");
}

function splitReviewResult(result?: string) {
  const [feedback, ...reviewParts] = String(result || "").split(/\n\nå®¡æ ¸æ„è§ï¼š/);
  return {
    feedback: feedback.trim(),
    reviewNote: reviewParts.join("\n\nå®¡æ ¸æ„è§ï¼š").trim()
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
    { key: "pending_confirm", label: "å·²æ´¾å‘", description: "ä»»åŠ¡å·²ç”Ÿæˆå¹¶æŽ¨é€ç»™è´Ÿè´£äºº" },
    { key: "confirmed", label: "å·²ç¡®è®¤", description: "è´Ÿè´£äººå·²ç¡®è®¤æ”¶åˆ°ä»»åŠ¡" },
    { key: "processing", label: "å¤„ç†ä¸­", description: "é—¨åº—æ­£åœ¨å¤„ç†å¹¶å‡†å¤‡åé¦ˆ" },
    { key: "pending_review", label: "å¾…å®¡æ ¸", description: "é—¨åº—å·²æäº¤åé¦ˆï¼Œç­‰å¾…æ€»éƒ¨å¤æ ¸" },
    { key: "closed", label: "å·²å…³é—­", description: "æ€»éƒ¨å·²å®¡æ ¸é€šè¿‡å¹¶å…³é—­ä»»åŠ¡" }
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
      message.error("ä»»åŠ¡æ•°æ®åŠ è½½å¤±è´¥ï¼Œè¯·ç¡®è®¤åŽç«¯æœåŠ¡å’Œç™»å½•çŠ¶æ€");
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
      message.error("ä»»åŠ¡è¯¦æƒ…åŠ è½½å¤±è´¥");
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
      message.success("ä»»åŠ¡çŠ¶æ€å·²æ›´æ–°");
      await load();
      if (currentTask?.id === record.id) {
        await refreshTaskDetail(record.id);
      }
    } catch {
      message.error("ä»»åŠ¡çŠ¶æ€æ›´æ–°å¤±è´¥");
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
      message.success("åé¦ˆå·²æäº¤ï¼Œä»»åŠ¡è¿›å…¥å¾…å®¡æ ¸");
      setFeedbackOpen(false);
      await load();
      await refreshTaskDetail(currentTask.id);
    } catch {
      message.error("åé¦ˆæäº¤å¤±è´¥");
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
      message.success(approved ? "ä»»åŠ¡å·²å®¡æ ¸é€šè¿‡å¹¶å…³é—­" : "ä»»åŠ¡å·²é©³å›žï¼Œå¹¶å·²é‡æ–°æŽ¨é€ç»™é—¨åº—è´Ÿè´£äºº");
      setReviewOpen(false);
      await load();
      await refreshTaskDetail(currentTask.id);
    } catch {
      message.error("ä»»åŠ¡å®¡æ ¸å¤±è´¥");
    }
  }

  async function generateH5Link(record: TaskRecord) {
    setTokenLoadingId(record.id);
    try {
      const res = await api.post("/api/v1/relay/generate-token", { task_id: record.id });
      setH5Url(res.data.h5_url);
      setCurrentTask(record);
      setH5Open(true);
      message.success(`H5 é“¾æŽ¥å·²ç”Ÿæˆï¼Œå·²å†™å…¥${res.data.notification_channel || "system"}æŽ¨é€é€šçŸ¥ï¼Œç­‰å¾…è´Ÿè´£äººç¡®è®¤`);
      if (detailOpen) {
        await refreshTaskDetail(record.id);
      }
    } catch {
      message.error("H5 é“¾æŽ¥ç”Ÿæˆå¤±è´¥");
    } finally {
      setTokenLoadingId(null);
    }
  }

  return (
    <>
      <section className="flow-band">
        <div>
          <span className="flow-kicker">ä»»åŠ¡é—­çŽ¯</span>
          <div className="flow-title">æ‰¿æŽ¥é¢„è­¦æ´¾å•ã€åº—é•¿åé¦ˆä¸Žæ€»éƒ¨å®¡æ ¸</div>
          <div className="flow-text">
            ä»»åŠ¡é—­çŽ¯è¦†ç›–æ´¾å‘ç¡®è®¤ã€é—¨åº—å¤„ç†ã€H5 åé¦ˆã€æ€»éƒ¨å¤æ ¸é€šè¿‡æˆ–é©³å›žé‡æŽ¨ã€‚
          </div>
        </div>
        <Space wrap>
          <Tag color="purple">å¾…å®¡æ ¸ {summary.pendingReview}</Tag>
          <Tag color="cyan">å¤„ç†ä¸­ {summary.processing}</Tag>
          <Tag color="red">é€¾æœŸ {summary.overdue}</Tag>
          <Tag color="green">å·²å…³é—­ {summary.closed}</Tag>
          <Tag>å·²å½’æ¡£ {summary.archived}</Tag>
          <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>
            åˆ·æ–°
          </Button>
        </Space>
      </section>

      <Card
        className="panel-card"
        title={`ä»»åŠ¡åˆ—è¡¨ Â· ${filteredTasks.length}/${summary.total}`}
        extra={
          <div className="task-filter-bar">
            <Input.Search
              allowClear
              placeholder="æœç´¢ä»»åŠ¡ / é—¨åº— / è´Ÿè´£äºº"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              onSearch={setKeyword}
            />
            <Select
              value={supervisorFilter}
              onChange={setSupervisorFilter}
              options={[
                { value: "all", label: "å…¨éƒ¨ä»»åŠ¡" },
                { value: "scoped_store", label: "ç®¡è¾–é—¨åº—ä»»åŠ¡" },
                { value: "pending_review", label: "å¾…æˆ‘å®¡æ ¸" },
                { value: "overdue", label: "é€¾æœŸä»»åŠ¡" },
                { value: "high", label: "é«˜ä¼˜å…ˆçº§" },
                { value: "open", label: "æœªå…³é—­ä»»åŠ¡" }
              ]}
            />
            <Select
              allowClear
              placeholder="å…¨éƒ¨çŠ¶æ€"
              value={statusFilter}
              onChange={setStatusFilter}
              options={Object.entries(statusLabel).map(([value, label]) => ({ value, label }))}
            />
            <Select
              allowClear
              placeholder="å…¨éƒ¨ä¼˜å…ˆçº§"
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
          locale={{ emptyText: <Empty description="æš‚æ— ä»»åŠ¡" /> }}
          columns={[
            {
              title: "ä»»åŠ¡",
              dataIndex: "title",
              width: 330,
              render: (_: string, record: TaskRecord) => (
                <div>
                  <div className="risk-title">{formatSystemTitle(record.title)}</div>
                  <div className="risk-meta">
                    æ¥æºï¼š{sourceLabel[record.source_type || ""] || "æ‰‹åŠ¨åˆ›å»º"} Â· {record.store_name || "æœªå…³è”é—¨åº—"}
                  </div>
                </div>
              )
            },
            { title: "è´Ÿè´£äºº", dataIndex: "assignee_name", width: 120, render: (value: string) => value || "å¾…æŒ‡æ´¾" },
            {
              title: "ä¼˜å…ˆçº§",
              dataIndex: "priority",
              width: 96,
              render: (value: string) => <Tag color={priorityColor(value)}>{priorityLabel[value] || value}</Tag>
            },
            {
              title: "çŠ¶æ€",
              dataIndex: "status",
              width: 110,
              render: (value: string) => <Tag color={statusColor[value] || "default"}>{statusLabel[value] || value}</Tag>
            },
            { title: "æˆªæ­¢æ—¶é—´", dataIndex: "due_at", width: 210, render: (value: string) => formatDateTime(value) },
            { title: "åˆ›å»ºæ—¶é—´", dataIndex: "created_at", width: 210, render: formatDateTime },
            {
              title: "æ“ä½œ",
              fixed: "right",
              width: 380,
              render: (_: unknown, record: TaskRecord) => (
                <Space wrap>
                  <Button size="small" icon={<EyeOutlined />} onClick={() => openDetail(record)}>
                    è¯¦æƒ…
                  </Button>
                  {canManageTasks ? (
                    <>
                      <Button size="small" onClick={() => updateStatus(record, "confirmed")} disabled={record.status !== "pending_confirm"}>
                        ç¡®è®¤
                      </Button>
                      <Button
                        size="small"
                        onClick={() => updateStatus(record, "processing")}
                        disabled={!["confirmed", "overdue"].includes(record.status)}
                      >
                        å¤„ç†
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
                        title="ç¡®è®¤å½’æ¡£è¯¥ä»»åŠ¡ï¼Ÿ"
                        okText="ç¡®è®¤"
                        cancelText="å–æ¶ˆ"
                        onConfirm={() => updateStatus(record, "archived")}
                      >
                        <Button size="small" disabled={record.status !== "closed"}>
                          å½’æ¡£
                        </Button>
                      </Popconfirm>
                    </>
                  ) : null}
                  {canFeedbackTasks ? (
                    <Button size="small" type="primary" onClick={() => openFeedback(record)} disabled={record.status !== "processing"}>
                      åé¦ˆ
                    </Button>
                  ) : null}
                  {canApproveTasks ? (
                    <>
                      <Button size="small" onClick={() => openReview(record, "approve")} disabled={record.status !== "pending_review"}>
                        é€šè¿‡
                      </Button>
                      <Button size="small" danger onClick={() => openReview(record, "return")} disabled={record.status !== "pending_review"}>
                        é©³å›žé‡æŽ¨
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
        title={currentTask ? `ä»»åŠ¡è¯¦æƒ…ï¼š${formatSystemTitle(currentTask.title)}` : "ä»»åŠ¡è¯¦æƒ…"}
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
                  <Tag color={priorityColor(currentTask.priority)}>ä¼˜å…ˆçº§ï¼š{priorityLabel[currentTask.priority] || currentTask.priority}</Tag>
                  <Tag>{sourceLabel[currentTask.source_type || ""] || "æ‰‹åŠ¨åˆ›å»º"}</Tag>
                </Space>
                <Typography.Title level={4}>{formatSystemTitle(currentTask.title)}</Typography.Title>
                <Typography.Paragraph type="secondary">
                  {currentTask.store_name || "æœªå…³è”é—¨åº—"} Â· {currentTask.department_name || "æœªè®¾ç½®éƒ¨é—¨"} Â· {currentTask.assignee_name || "å¾…æŒ‡æ´¾"}
                </Typography.Paragraph>
              </div>
              <div className="task-detail-h5-hint">
                <FileTextOutlined />
                <span>H5 åé¦ˆå›žæµåŽï¼Œä»»åŠ¡è¿›å…¥æ€»éƒ¨å®¡æ ¸ã€‚</span>
              </div>
            </div>

            <div className="task-detail-metrics">
              <div>
                <span>å½“å‰çŠ¶æ€</span>
                <b>{statusLabel[currentTask.status] || currentTask.status}</b>
              </div>
              <div>
                <span>æˆªæ­¢æ—¶é—´</span>
                <b>{formatDateTime(currentTask.due_at)}</b>
              </div>
              <div>
                <span>é€šçŸ¥è®°å½•</span>
                <b>{currentTask.notifications?.length ?? 0} æ¡</b>
              </div>
              <div>
                <span>å®¡è®¡è®°å½•</span>
                <b>{currentTask.audit_logs?.length ?? 0} æ¡</b>
              </div>
            </div>

            <div className="task-detail-section">
              <div className="task-detail-section-head">
                <CheckCircleOutlined />
                <span>é—­çŽ¯è¿›åº¦</span>
              </div>
              <Timeline className="task-progress-timeline" items={taskProgressItems(currentTask.status)} />
            </div>

            <div className="task-detail-section">
              <div className="task-detail-section-head">
                <ShopOutlined />
                <span>å…³è”é¢„è­¦</span>
              </div>
              {currentTask.related_alert ? (
                <div className="task-related-alert">
                  <Space wrap>
                    <Tag color={currentTask.related_alert.level === "critical" ? "red" : "orange"}>{alertLevelLabel[currentTask.related_alert.level || "normal"] || currentTask.related_alert.level || "æ™®é€š"}</Tag>
                    <Tag>{statusLabel[currentTask.related_alert.status || ""] || currentTask.related_alert.status || "-"}</Tag>
                    <Tag>{alertTypeLabel[currentTask.related_alert.alert_type || ""] || currentTask.related_alert.alert_type || "-"}</Tag>
                  </Space>
                  <b>{formatSystemTitle(currentTask.related_alert.title || "æœªå‘½åé¢„è­¦")}</b>
                  <p>{shortText(currentTask.related_alert.summary, "æš‚æ— å½’å› æ‘˜è¦")}</p>
                  <Button size="small" icon={<LinkOutlined />} onClick={() => (window.location.href = `/alerts?alert_id=${currentTask.related_alert?.id}`)}>
                    æŸ¥çœ‹é¢„è­¦
                  </Button>
                </div>
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="æœªå…³è”é¢„è­¦" />
              )}
            </div>

            <div className="task-detail-section">
              <div className="task-detail-section-head">
                <FileTextOutlined />
                <span>ç›¸å…³ SOP/çŸ¥è¯†æ£€ç´¢</span>
              </div>
            </div>

            <div className="task-detail-section">
              <div className="task-detail-section-head">
                <FileTextOutlined />
                <span>åº—é•¿åé¦ˆä¸Žå®¡æ ¸</span>
              </div>
              {currentTask.result ? (
                <div className="task-feedback-block">
                  <div>
                    <Typography.Text type="secondary">åº—é•¿å¤„ç†ç»“æžœ</Typography.Text>
                    <p>{splitReviewResult(currentTask.result).feedback}</p>
                  </div>
                  {splitReviewResult(currentTask.result).reviewNote ? (
                    <div>
                      <Typography.Text type="secondary">æ€»éƒ¨å®¡æ ¸æ„è§</Typography.Text>
                      <p>{splitReviewResult(currentTask.result).reviewNote}</p>
                    </div>
                  ) : null}
                  {currentTask.feedback_img_urls?.length ? (
                    <div className="task-feedback-images">
                      <Typography.Text type="secondary">æ•´æ”¹å‡­è¯å›¾ç‰‡</Typography.Text>
                      <Image.PreviewGroup>
                        {currentTask.feedback_img_urls.map((url, index) => (
                          <Image key={url} src={assetUrl(url)} alt={`æ•´æ”¹å‡­è¯ ${index + 1}`} />
                        ))}
                      </Image.PreviewGroup>
                    </div>
                  ) : null}
                </div>
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="é—¨åº—å°šæœªæäº¤åé¦ˆ" />
              )}
            </div>

            <div className="task-detail-section">
              <div className="task-detail-section-head">
                <BellOutlined />
                <span>å…³è”é€šçŸ¥</span>
              </div>
              {currentTask.notifications?.length ? (
                <List
                  className="task-detail-list"
                  dataSource={currentTask.notifications}
                  renderItem={(item) => (
                    <List.Item
                      actions={[
                        <Button key="notification" size="small" type="link" onClick={() => (window.location.href = `/notifications?notification_id=${item.id}`)}>
                          æŸ¥çœ‹
                        </Button>
                      ]}
                    >
                      <List.Item.Meta
                        title={
                          <Space wrap>
                            <span>{formatSystemTitle(item.title || "æœªå‘½åé€šçŸ¥")}</span>
                            <Tag>{channelLabel[item.channel] || item.channel}</Tag>
                            <Tag color={item.status === "failed" ? "red" : item.status === "sent" ? "green" : "gold"}>
                              {notificationStatusLabel[item.status] || item.status}
                            </Tag>
                          </Space>
                        }
                        description={`é‡è¯• ${item.retry_count} æ¬¡ Â· ${formatDateTime(item.sent_at || item.created_at)}`}
                      />
                    </List.Item>
                  )}
                />
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="æš‚æ— å…³è”é€šçŸ¥" />
              )}
            </div>

            <div className="task-detail-section">
              <div className="task-detail-section-head">
                <HistoryOutlined />
                <span>å®¡è®¡è®°å½•</span>
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
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="æš‚æ— å®¡è®¡è®°å½•" />
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
                    ç”Ÿæˆ H5 é“¾æŽ¥
                  </Button>
                  <Popconfirm
                    title="ç¡®è®¤å½’æ¡£è¯¥ä»»åŠ¡ï¼Ÿ"
                    okText="ç¡®è®¤"
                    cancelText="å–æ¶ˆ"
                    onConfirm={() => updateStatus(currentTask, "archived")}
                  >
                    <Button disabled={currentTask.status !== "closed"}>å½’æ¡£</Button>
                  </Popconfirm>
                </>
              ) : null}
              {canFeedbackTasks ? (
                <Button type="primary" onClick={() => openFeedback(currentTask)} disabled={currentTask.status !== "processing"}>
                  æäº¤åé¦ˆ
                </Button>
              ) : null}
              {canApproveTasks ? (
                <>
                  <Button onClick={() => openReview(currentTask, "approve")} disabled={currentTask.status !== "pending_review"}>
                    é€šè¿‡å¹¶å…³é—­
                  </Button>
                  <Button danger onClick={() => openReview(currentTask, "return")} disabled={currentTask.status !== "pending_review"}>
                    é©³å›žå¹¶é‡æŽ¨é—¨åº—
                  </Button>
                </>
              ) : null}
            </Space>
            {detailLoading ? <div className="task-detail-loading">æ­£åœ¨åˆ·æ–°ä»»åŠ¡è¯¦æƒ…...</div> : null}
          </Space>
        ) : null}
      </Drawer>

      <Modal className="responsive-modal task-flow-modal" title="æäº¤å¤„ç†åé¦ˆ" open={feedbackOpen} onCancel={() => setFeedbackOpen(false)} footer={null} forceRender destroyOnHidden zIndex={1300}>
        <Form form={feedbackForm} preserve={false} layout="vertical" onFinish={submitFeedback}>
          <Form.Item name="result" label="å¤„ç†ç»“æžœ" rules={[{ required: true, message: "è¯·è¾“å…¥å¤„ç†ç»“æžœ" }]}>
            <Input.TextArea rows={4} placeholder="ä¾‹å¦‚ï¼šå·²è”ç³»é—¨åº—å¤ç›˜å‡ºæ¯æµç¨‹ï¼Œä»Šæ—¥æ™šé«˜å³°å¢žåŠ  1 åæŽ’ç­ã€‚" />
          </Form.Item>
          <Space className="modal-action-row">
            <Button type="primary" htmlType="submit">
              æäº¤åé¦ˆ
            </Button>
            <Button onClick={() => setFeedbackOpen(false)}>å–æ¶ˆ</Button>
          </Space>
        </Form>
      </Modal>

      <Modal
        className="responsive-modal task-flow-modal"
        title={reviewMode === "approve" ? "å®¡æ ¸é€šè¿‡" : "é©³å›žå¹¶é‡æ–°æŽ¨é€é—¨åº—"}
        open={reviewOpen}
        onCancel={() => setReviewOpen(false)}
        footer={null}
        forceRender
        destroyOnHidden
        zIndex={1300}
      >
        {currentTask?.result ? (
          <div className="review-result-box">
            <Typography.Text type="secondary">é—¨åº—åé¦ˆ</Typography.Text>
            <div>{splitReviewResult(currentTask.result).feedback}</div>
            {currentTask.feedback_img_urls?.length ? (
              <div className="task-feedback-images compact">
                <Typography.Text type="secondary">æ•´æ”¹å‡­è¯å›¾ç‰‡</Typography.Text>
                <Image.PreviewGroup>
                  {currentTask.feedback_img_urls.map((url, index) => (
                    <Image key={url} src={assetUrl(url)} alt={`æ•´æ”¹å‡­è¯ ${index + 1}`} />
                  ))}
                </Image.PreviewGroup>
              </div>
            ) : null}
          </div>
        ) : null}
        <Form form={reviewForm} preserve={false} layout="vertical" onFinish={submitReview}>
          <Form.Item
            name="note"
            label={reviewMode === "approve" ? "å®¡æ ¸æ„è§" : "é©³å›žåŽŸå› "}
            rules={reviewMode === "return" ? [{ required: true, message: "è¯·å¡«å†™é©³å›žåŽŸå› ï¼Œé—¨åº—è´Ÿè´£äººä¼šåœ¨ H5 ä¸­çœ‹åˆ°è¿™æ¡è¯´æ˜Ž" }] : undefined}
          >
            <Input.TextArea
              rows={4}
              placeholder={reviewMode === "approve" ? "å¯å¡«å†™æ€»éƒ¨å¤æ ¸æ„è§ï¼Œç•™ç©ºåˆ™ç›´æŽ¥å…³é—­ä»»åŠ¡ã€‚" : "è¯´æ˜Žé—¨åº—éœ€è¦é‡æ–°æ•´æ”¹æˆ–è¡¥å……åé¦ˆçš„å†…å®¹ï¼Œæäº¤åŽä¼šé‡æ–°ç”Ÿæˆ H5 é“¾æŽ¥å¹¶æŽ¨é€ã€‚"}
            />
          </Form.Item>
          <Space className="modal-action-row">
            <Button type="primary" danger={reviewMode === "return"} htmlType="submit">
              {reviewMode === "approve" ? "é€šè¿‡å¹¶å…³é—­" : "é©³å›žå¹¶é‡æ–°æŽ¨é€"}
            </Button>
            <Button onClick={() => setReviewOpen(false)}>å–æ¶ˆ</Button>
          </Space>
        </Form>
      </Modal>

      <Modal className="responsive-modal task-flow-modal" title={`åº—é•¿ H5 é“¾æŽ¥${currentTask ? `ï¼š${formatSystemTitle(currentTask.title)}` : ""}`} open={h5Open} onCancel={() => setH5Open(false)} footer={null} zIndex={1300}>
        <Space direction="vertical" style={{ width: "100%" }}>
          <Typography.Text type="secondary">å°†é“¾æŽ¥å‘é€ç»™åº—é•¿åŽï¼Œåé¦ˆä¼šå›žæµåˆ°å½“å‰ä»»åŠ¡å¹¶è¿›å…¥æ€»éƒ¨å®¡æ ¸ã€‚</Typography.Text>
          <Input.TextArea value={h5Url} rows={3} readOnly />
          <Space className="modal-action-row">
            <Button
              type="primary"
              icon={<CopyOutlined />}
              onClick={async () => {
                await navigator.clipboard.writeText(h5Url);
                message.success("é“¾æŽ¥å·²å¤åˆ¶");
              }}
            >
              å¤åˆ¶é“¾æŽ¥
            </Button>
            <Button icon={<LinkOutlined />} onClick={() => window.open(h5Url, "_blank", "noopener,noreferrer")}>æ‰“å¼€ H5</Button>
          </Space>
        </Space>
      </Modal>
    </>
  );
}

