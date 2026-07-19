"use client";

import {
  AlertOutlined,
  BellOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  EyeOutlined,
  ReloadOutlined,
  SearchOutlined,
  SendOutlined
} from "@ant-design/icons";
import { App, Button, Card, Descriptions, Empty, Input, List, Popconfirm, Select, Space, Tag, Typography } from "antd";
import { useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { api } from "@/lib/api";
import { hasPermission, readStoredPermissions } from "@/lib/permissions";

type NotificationStatus = "pending" | "sent" | "ignored" | "failed";
type FilterValue = NotificationStatus | "all";

type NotificationRecord = {
  id: string;
  channel: string;
  target_type?: string;
  target_id?: string;
  title?: string;
  content?: string;
  status: NotificationStatus;
  retry_count: number;
  sent_at?: string;
  created_at?: string;
  updated_at?: string;
  recipient_user_id?: string;
  recipient_name?: string;
  recipient_username?: string;
  recipient_phone?: string;
};

type NotificationSummary = {
  pending: number;
  sent: number;
  ignored: number;
  failed: number;
  total: number;
  channels?: Record<string, Record<string, number>>;
};

const statusLabel: Record<NotificationStatus, string> = {
  pending: "待处理",
  sent: "已发送",
  ignored: "已忽略",
  failed: "发送失败"
};

const statusColor: Record<NotificationStatus, string> = {
  pending: "gold",
  sent: "green",
  ignored: "default",
  failed: "red"
};

const channelLabel: Record<string, string> = {
  system: "系统内",
  relay: "H5 链接"
};

const targetTypeLabel: Record<string, string> = {
  alert: "预警",
  task: "任务",
  system: "系统"
};

const targetTypeIcon: Record<string, ReactNode> = {
  alert: <AlertOutlined />,
  task: <ClockCircleOutlined />,
  system: <BellOutlined />
};

function targetLabel(record: NotificationRecord) {
  return targetTypeLabel[record.target_type || ""] || record.target_type || "系统";
}

function recipientName(record: NotificationRecord) {
  return record.recipient_name || record.recipient_username || "系统内工作台";
}

function shortId(value?: string) {
  if (!value) return "-";
  if (value.length <= 18) return value;
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function formatDateTime(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function openTarget(record: NotificationRecord) {
  if (record.target_type === "task" && record.target_id) {
    window.location.href = `/tasks?task_id=${record.target_id}`;
    return;
  }
  if (record.target_type === "alert" && record.target_id) {
    window.location.href = `/alerts?alert_id=${record.target_id}`;
  }
}

function canOpenTarget(record: NotificationRecord) {
  return Boolean(record.target_id && (record.target_type === "task" || record.target_type === "alert"));
}

export function NotificationsPage() {
  const searchParams = useSearchParams();
  const notificationId = searchParams.get("notification_id");
  const [records, setRecords] = useState<NotificationRecord[]>([]);
  const [summary, setSummary] = useState<NotificationSummary | null>(null);
  const [status, setStatus] = useState<FilterValue>("pending");
  const [targetType, setTargetType] = useState("all");
  const [keywordInput, setKeywordInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [currentRecord, setCurrentRecord] = useState<NotificationRecord | null>(null);
  const [permissions, setPermissions] = useState(() => readStoredPermissions());
  const { message } = App.useApp();
  const canManageNotifications = hasPermission(permissions, "notifications", "manage") || hasPermission(permissions, "alerts", "manage");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (status !== "all") params.status = status;
      if (targetType !== "all") params.target_type = targetType;
      if (keyword.trim()) params.q = keyword.trim();
      const [listRes, summaryRes] = await Promise.all([
        api.get("/api/v1/notifications", { params }),
        api.get("/api/v1/notifications/summary")
      ]);
      setRecords(listRes.data);
      setSummary(summaryRes.data);
    } catch {
      message.error("通知数据加载失败,请确认后端服务和登录状态");
    } finally {
      setLoading(false);
    }
  }, [keyword, message, status, targetType]);

  useEffect(() => {
    setPermissions(readStoredPermissions());
    if (notificationId) setStatus("all");
  }, [notificationId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!notificationId) return;
    api
      .get(`/api/v1/notifications/${notificationId}`)
      .then((res) => setCurrentRecord(res.data))
      .catch(() => message.error("通知详情加载失败"));
  }, [message, notificationId]);

  useEffect(() => {
    if (!records.length) {
      if (!notificationId) setCurrentRecord(null);
      return;
    }
    if (!currentRecord || !records.some((item) => item.id === currentRecord.id)) {
      setCurrentRecord(records[0]);
    }
  }, [currentRecord, notificationId, records]);

  const filteredHint = useMemo(() => {
    const parts = [
      status === "all" ? "全部状态" : statusLabel[status],
      targetType === "all" ? "全部类型" : targetTypeLabel[targetType] || targetType
    ];
    if (keyword) parts.push(`关键词:${keyword}`);
    return parts.join(" / ");
  }, [keyword, status, targetType]);

  async function updateStatus(record: NotificationRecord, nextStatus: NotificationStatus) {
    setUpdatingId(record.id);
    try {
      const res = await api.put(`/api/v1/notifications/${record.id}/status`, { status: nextStatus });
      setCurrentRecord(res.data);
      await load();
      message.success(nextStatus === "sent" ? "通知已标记为已发送" : "通知已忽略");
    } catch {
      message.error("通知状态更新失败");
    } finally {
      setUpdatingId(null);
    }
  }

  async function retryNotification(record: NotificationRecord) {
    setUpdatingId(record.id);
    try {
      const res = await api.post(`/api/v1/notifications/${record.id}/retry`);
      setCurrentRecord(res.data);
      await load();
      message.success("通知已重新写入系统内队列");
    } catch {
      message.error("通知重试失败");
    } finally {
      setUpdatingId(null);
    }
  }

  function runPrimaryAction(record: NotificationRecord) {
    if (record.status === "failed") {
      void retryNotification(record);
      return;
    }
    if (canOpenTarget(record)) {
      openTarget(record);
      return;
    }
    setCurrentRecord(record);
  }

  return (
    <>
      <section className="flow-band notification-hero">
        <div>
          <span className="flow-kicker">通知中心</span>
          <div className="flow-title">待处理通知 · {summary?.pending ?? 0} / 全部 {summary?.total ?? 0}</div>
          <div className="flow-text">Community 版只保留系统内通知,用于预警、任务和反馈闭环。</div>
        </div>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>刷新</Button>
          <Button onClick={() => { setStatus("pending"); setTargetType("all"); setKeywordInput(""); setKeyword(""); }}>重置筛选</Button>
        </Space>
      </section>

      <div className="dashboard-grid notification-metrics">
        {(["pending", "failed", "sent", "ignored"] as NotificationStatus[]).map((item) => (
          <Card key={item} className="metric-card panel-card" loading={loading}>
            <Typography.Text type="secondary">{statusLabel[item]}</Typography.Text>
            <div className="ai-big-number">{summary?.[item] ?? 0}</div>
            <div className="metric-foot">系统内通知</div>
          </Card>
        ))}
      </div>

      <Card className="panel-card notification-filter-card" style={{ marginTop: 16 }}>
        <div className="notification-filter-grid">
          <Select
            value={status}
            onChange={setStatus}
            options={[
              { label: "待处理", value: "pending" },
              { label: "全部状态", value: "all" },
              { label: "已发送", value: "sent" },
              { label: "已忽略", value: "ignored" },
              { label: "发送失败", value: "failed" }
            ]}
          />
          <Select
            value={targetType}
            onChange={setTargetType}
            options={[
              { label: "全部类型", value: "all" },
              { label: "任务", value: "task" },
              { label: "预警", value: "alert" },
              { label: "系统", value: "system" }
            ]}
          />
          <Input.Search
            allowClear
            value={keywordInput}
            placeholder="搜索标题、内容或关联对象"
            enterButton={<SearchOutlined />}
            onChange={(event) => {
              setKeywordInput(event.target.value);
              if (!event.target.value) setKeyword("");
            }}
            onSearch={(value) => setKeyword(value.trim())}
          />
        </div>
        <div className="notification-filter-hint">{filteredHint}</div>
      </Card>

      <div className="notification-workbench">
        <Card className="panel-card notification-list-card" title={`通知队列 · ${records.length} 条`} loading={loading}>
          {records.length ? (
            <List
              className="notification-inbox-list"
              dataSource={records}
              renderItem={(record) => (
                <List.Item
                  className={currentRecord?.id === record.id ? "notification-inbox-item is-active" : "notification-inbox-item"}
                  onClick={() => setCurrentRecord(record)}
                >
                  <div className="notification-row-main">
                    <div className={`notification-type-dot type-${record.target_type || "system"}`}>{targetTypeIcon[record.target_type || "system"] || <BellOutlined />}</div>
                    <div className="notification-row-content">
                      <Space size={6} wrap className="notification-row-tags">
                        <Tag color={statusColor[record.status]}>{statusLabel[record.status]}</Tag>
                        <Tag>{targetLabel(record)}</Tag>
                        <Tag>{channelLabel[record.channel] || record.channel}</Tag>
                      </Space>
                      <div className="notification-row-title">{record.title || "未命名通知"}</div>
                      <div className="notification-row-summary">{record.content || "无通知内容"}</div>
                      <div className="notification-row-meta">
                        接收人:{recipientName(record)} · 对象:{shortId(record.target_id)} · 创建 {formatDateTime(record.created_at)}
                      </div>
                    </div>
                  </div>
                  <Space className="notification-row-actions" wrap onClick={(event) => event.stopPropagation()}>
                    <Button type={record.status === "failed" || canOpenTarget(record) ? "primary" : "default"} size="small" onClick={() => runPrimaryAction(record)} loading={updatingId === record.id}>
                      {record.status === "failed" ? "重试" : canOpenTarget(record) ? "打开" : "详情"}
                    </Button>
                    <Button size="small" icon={<EyeOutlined />} onClick={() => setCurrentRecord(record)}>详情</Button>
                  </Space>
                </List.Item>
              )}
            />
          ) : (
            <Empty description="当前筛选下暂无通知" />
          )}
        </Card>

        <Card className="panel-card notification-detail-panel" title="通知详情">
          {currentRecord ? (
            <Space direction="vertical" size={16} style={{ width: "100%" }}>
              <div className="notification-detail-head">
                <div className={`notification-type-dot type-${currentRecord.target_type || "system"}`}>
                  {targetTypeIcon[currentRecord.target_type || "system"] || <BellOutlined />}
                </div>
                <div>
                  <Space size={6} wrap>
                    <Tag color={statusColor[currentRecord.status]}>{statusLabel[currentRecord.status]}</Tag>
                    <Tag>{targetLabel(currentRecord)}</Tag>
                    <Tag>{channelLabel[currentRecord.channel] || currentRecord.channel}</Tag>
                  </Space>
                  <div className="notification-detail-title">{currentRecord.title || "未命名通知"}</div>
                </div>
              </div>

              <Descriptions bordered column={1} size="small">
                <Descriptions.Item label="关联对象">{targetLabel(currentRecord)} · {shortId(currentRecord.target_id)}</Descriptions.Item>
                <Descriptions.Item label="接收人">{recipientName(currentRecord)}</Descriptions.Item>
                <Descriptions.Item label="通知渠道">{channelLabel[currentRecord.channel] || currentRecord.channel}</Descriptions.Item>
                <Descriptions.Item label="重试次数">{currentRecord.retry_count}</Descriptions.Item>
                <Descriptions.Item label="创建时间">{formatDateTime(currentRecord.created_at)}</Descriptions.Item>
                <Descriptions.Item label="处理时间">{formatDateTime(currentRecord.sent_at)}</Descriptions.Item>
                <Descriptions.Item label="更新时间">{formatDateTime(currentRecord.updated_at)}</Descriptions.Item>
              </Descriptions>

              <Card className="panel-card audit-detail-card" title="通知内容">
                <Typography.Paragraph className="notification-content-text">{currentRecord.content || "无通知内容"}</Typography.Paragraph>
              </Card>

              <div className="notification-action-bar">
                <Button type="primary" icon={currentRecord.status === "failed" ? <SendOutlined /> : <EyeOutlined />} loading={updatingId === currentRecord.id} onClick={() => runPrimaryAction(currentRecord)}>
                  {currentRecord.status === "failed" ? "重试通知" : canOpenTarget(currentRecord) ? "打开关联对象" : "查看详情"}
                </Button>
                {canManageNotifications ? (
                  <>
                    <Popconfirm title="确认标记为已发送?" okText="确认" cancelText="取消" onConfirm={() => updateStatus(currentRecord, "sent")}>
                      <Button icon={<CheckCircleOutlined />} disabled={currentRecord.status !== "pending"} loading={updatingId === currentRecord.id}>标记已发送</Button>
                    </Popconfirm>
                    <Popconfirm title="确认忽略这条通知?" okText="确认" cancelText="取消" onConfirm={() => updateStatus(currentRecord, "ignored")}>
                      <Button disabled={currentRecord.status !== "pending"} loading={updatingId === currentRecord.id}>忽略</Button>
                    </Popconfirm>
                  </>
                ) : null}
              </div>
            </Space>
          ) : (
            <Empty description="请选择一条通知查看详情" />
          )}
        </Card>
      </div>
    </>
  );
}
