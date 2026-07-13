"use client";

import {
  Alert,
  App,
  Button,
  Card,
  Empty,
  Progress,
  Select,
  Table,
  Tag
} from "antd";
import {
  AlertOutlined,
  ArrowRightOutlined,
  BellOutlined,
  CheckCircleOutlined,
  CloudUploadOutlined,
  DollarOutlined,
  LineChartOutlined,
  ThunderboltOutlined
} from "@ant-design/icons";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { AppShell } from "@/components/layout/AppShell";
import { api } from "@/lib/api";

const ReactECharts = dynamic(() => import("echarts-for-react"), {
  ssr: false,
  loading: () => <div className="chart-loading">å›¾è¡¨åŠ è½½ä¸­</div>
});

type Overview = {
  period: { latest_sales_date: string | null };
  metrics: {
    revenue: number;
    orders: number;
    avg_order: number;
    revenue_delta_pct: number;
    open_alerts: number;
    critical_alerts: number;
    inventory_risk_alerts: number;
    bad_review_alerts: number;
    negative_reviews: number;
    pending_tasks: number;
    closed_tasks: number;
    today_imports: number;
    ai_cost_month: number;
    ai_reports_month: number;
    ai_alerts_month: number;
    saved_hours_month: number;
  };
  summary: string;
};

type AlertRow = {
  id: string;
  store_name?: string;
  alert_type: string;
  level: string;
  title: string;
  status: string;
  responsible_user_name?: string;
};

type RiskStore = {
  id: string;
  store_name: string;
  alert_count: number;
  max_level?: string;
  latest_reason?: string;
};

type ChannelRow = {
  channel: string;
  revenue: number;
  percent: number;
};

type FilterStore = {
  id: string;
  code: string;
  name: string;
  region?: string;
  status: string;
};

type FilterChannel = {
  channel: string;
  usage_count: number;
};

type TrendPoint = {
  biz_date: string;
  revenue: number;
  orders: number;
  avg_order: number;
  alerts: number;
  critical_alerts: number;
  tasks: number;
  closed_tasks: number;
};

type TrendResponse = {
  period: { start_date: string | null; end_date: string | null; days: number };
  filters: { store_id?: string | null; channel?: string | null };
  points: TrendPoint[];
  totals: { revenue: number; orders: number; alerts: number; tasks: number };
};

type FilterResponse = {
  stores: FilterStore[];
  channels: FilterChannel[];
  day_options: number[];
};

type NotificationRecord = {
  id: string;
  channel: string;
  target_type?: string;
  target_id?: string;
  title?: string;
  content?: string;
  status: "pending" | "sent" | "ignored" | "failed";
  retry_count: number;
  sent_at?: string;
};

const emptyOverview: Overview = {
  period: { latest_sales_date: null },
  metrics: {
    revenue: 0,
    orders: 0,
    avg_order: 0,
    revenue_delta_pct: 0,
    open_alerts: 0,
    critical_alerts: 0,
    inventory_risk_alerts: 0,
    bad_review_alerts: 0,
    negative_reviews: 0,
    pending_tasks: 0,
    closed_tasks: 0,
    today_imports: 0,
    ai_cost_month: 0,
    ai_reports_month: 0,
    ai_alerts_month: 0,
    saved_hours_month: 0
  },
  summary: "æš‚æ— ç»è¥æ•°æ®ã€‚è¯·å…ˆå®Œæˆæ•°æ®å¯¼å…¥ã€‚"
};

const emptyTrends: TrendResponse = {
  period: { start_date: null, end_date: null, days: 14 },
  filters: {},
  points: [],
  totals: { revenue: 0, orders: 0, alerts: 0, tasks: 0 }
};

const channelLabel: Record<string, string> = {
  meituan: "ç¾Žå›¢",
  eleme: "é¥¿äº†ä¹ˆ",
  miniapp: "å°ç¨‹åº",
  dine_in: "å ‚é£Ÿ",
  group_buy: "å›¢è´­",
  offline: "çº¿ä¸‹"
};

const alertTypeLabel: Record<string, string> = {
  sales_drop: "é”€å”®ä¸‹æ»‘",
  inventory_risk: "åº“å­˜é£Žé™©",
  bad_review: "è¯„ä»·å¼‚å¸¸",
};

const alertLevelLabel: Record<string, string> = {
  critical: "ä¸¥é‡",
  high: "é«˜é£Žé™©",
  warning: "é¢„è­¦",
  medium: "ä¸­é£Žé™©",
  low: "ä½Žé£Žé™©",
  normal: "æ™®é€š"
};

const targetTypeLabel: Record<string, string> = {
  alert: "é¢„è­¦",
  task: "ä»»åŠ¡",
  ai: "AI",
  system: "ç³»ç»Ÿ"
};

function formatMoney(value: number) {
  return `Â¥${value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(value?: string | null) {
  if (!value) return "æš‚æ— ";
  return value.slice(0, 10);
}

function formatStoreName(value?: string | null) {
  if (!value) return "æœªå…³è”é—¨åº—";
  if (/^Scope Store/i.test(value)) return "æµ‹è¯•é—¨åº—";
  return value;
}

function formatAlertTitle(value?: string | null) {
  if (!value) return "æœªå‘½åé¢„è­¦";
  if (/^codex[-_]/i.test(value)) return "ç³»ç»ŸéªŒæ”¶é¢„è­¦";
  return sanitizeBusinessText(value);
}

function sanitizeBusinessText(value?: string | null) {
  if (!value) return "";
  return value
    .replaceAll("Codex", "ç³»ç»ŸéªŒæ”¶")
    .replaceAll("Critical", "ä¸¥é‡")
    .replaceAll("critical", "ä¸¥é‡")
    .replaceAll("high", "é«˜é£Žé™©");
}

function activityHref(record: NotificationRecord) {
  if (record.target_type === "task" && record.target_id) return `/tasks?task_id=${record.target_id}`;
  if (record.target_type === "alert" && record.target_id) return `/alerts?alert_id=${record.target_id}`;
  return "/notifications";
}

function csvCell(value: unknown) {
  return `"${String(value ?? "").replaceAll("\"", "\"\"")}"`;
}

function downloadCsv(filename: string, rows: unknown[][]) {
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export default function DashboardPage() {
  const router = useRouter();
  const [overview, setOverview] = useState<Overview>(emptyOverview);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [riskStores, setRiskStores] = useState<RiskStore[]>([]);
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [filters, setFilters] = useState<FilterResponse>({ stores: [], channels: [], day_options: [7, 14, 30, 60] });
  const [trends, setTrends] = useState<TrendResponse>(emptyTrends);
  const [selectedStore, setSelectedStore] = useState<string>();
  const [selectedChannel, setSelectedChannel] = useState<string>();
  const [selectedDays, setSelectedDays] = useState(14);
  const [loading, setLoading] = useState(false);
  const { message } = App.useApp();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const trendParams = new URLSearchParams({ days: String(selectedDays) });
      if (selectedStore) trendParams.set("store_id", selectedStore);
      if (selectedChannel) trendParams.set("channel", selectedChannel);
      const [overviewRes, alertsRes, riskRes, channelRes, filterRes, trendRes, notificationRes] = await Promise.all([
        api.get("/api/v1/dashboard/overview"),
        api.get("/api/v1/dashboard/alerts"),
        api.get("/api/v1/dashboard/risk-stores"),
        api.get("/api/v1/dashboard/channels"),
        api.get("/api/v1/dashboard/filters"),
        api.get(`/api/v1/dashboard/trends?${trendParams.toString()}`),
        api.get("/api/v1/notifications", { params: { limit: 6 } })
      ]);
      setOverview(overviewRes.data);
      setAlerts(alertsRes.data);
      setRiskStores(riskRes.data);
      setChannels(channelRes.data);
      setFilters(filterRes.data);
      setTrends(trendRes.data);
      setNotifications(notificationRes.data);
    } catch {
      message.error("ç»è¥çœ‹æ¿æ•°æ®åŠ è½½å¤±è´¥ï¼Œè¯·ç¡®è®¤åŽç«¯æœåŠ¡å’Œç™»å½•çŠ¶æ€");
    } finally {
      setLoading(false);
    }
  }, [message, selectedChannel, selectedDays, selectedStore]);

  useEffect(() => {
    load();
  }, [load]);

  const metrics = overview.metrics;
  const closedTotal = metrics.closed_tasks + metrics.pending_tasks;
  const closureRate = closedTotal ? Math.round((metrics.closed_tasks / closedTotal) * 100) : 0;
  const selectedStoreName = filters.stores.find((item) => item.id === selectedStore)?.name || "å…¨éƒ¨å¯è§é—¨åº—";

  const kpis = [
    {
      key: "revenue",
      icon: <DollarOutlined />,
      title: "æœ€æ–°è¥æ”¶",
      value: formatMoney(metrics.revenue),
      note: `è¾ƒä¸Šä¸€è¥ä¸šæ—¥ ${metrics.revenue_delta_pct >= 0 ? "+" : ""}${metrics.revenue_delta_pct}%`,
      tone: metrics.revenue_delta_pct >= 0 ? "good" : "danger"
    },
    {
      key: "orders",
      icon: <LineChartOutlined />,
      title: "è®¢å•é‡",
      value: metrics.orders.toLocaleString("zh-CN"),
      note: `å®¢å•ä»· ${formatMoney(metrics.avg_order)}`,
      tone: "neutral"
    },
    {
      key: "alerts",
      icon: <AlertOutlined />,
      title: "å¼€æ”¾é¢„è­¦",
      value: `${metrics.open_alerts} æ¡`,
      note: `ä¸¥é‡ ${metrics.critical_alerts} æ¡`,
      tone: metrics.critical_alerts > 0 ? "danger" : "warn"
    },
    {
      key: "tasks",
      icon: <CheckCircleOutlined />,
      title: "ä»»åŠ¡é—­çŽ¯",
      value: `${closureRate}%`,
      note: `å¾…å¤„ç† ${metrics.pending_tasks} ä¸ªï¼Œå·²é—­çŽ¯ ${metrics.closed_tasks} ä¸ª`,
      tone: metrics.pending_tasks > 0 ? "warn" : "good",
      progress: closureRate
    },
    {
      key: "imports",
      icon: <CloudUploadOutlined />,
      title: "ä»Šæ—¥å¯¼å…¥",
      value: `${metrics.today_imports} æ¬¡`,
      note: "å¯¼å…¥åŽè‡ªåŠ¨è§¦å‘ V1 é¢„è­¦è§„åˆ™",
      tone: "neutral"
    },
    {
      key: "ai",
      icon: <ThunderboltOutlined />,
      title: "AI æ‘˜è¦",
      value: `${metrics.ai_reports_month} ä»½`,
      note: `æœ¬æœˆèŠ‚çœçº¦ ${metrics.saved_hours_month} å°æ—¶`,
      tone: "good"
    }
  ];

  const trendOption = useMemo(
    () => ({
      color: ["#569435", "#1f7a8c", "#e49b2f", "#dc6b4a"],
      grid: { top: 62, right: 56, bottom: 42, left: 58 },
      tooltip: { trigger: "axis" },
      legend: {
        top: 4,
        left: 0,
        itemGap: 18,
        itemWidth: 22,
        itemHeight: 10
      },
      xAxis: {
        type: "category",
        data: trends.points.map((item) => item.biz_date.slice(5)),
        axisTick: { show: false },
        axisLine: { lineStyle: { color: "#dbe4ee" } }
      },
      yAxis: [
        {
          type: "value",
          name: "è¥æ”¶",
          axisLabel: { formatter: "Â¥{value}" },
          splitLine: { lineStyle: { color: "rgba(219, 228, 238, 0.75)" } }
        },
        {
          type: "value",
          name: "æ•°é‡",
          axisLabel: { margin: 12 },
          splitLine: { show: false }
        }
      ],
      series: [
        {
          name: selectedChannel ? `${channelLabel[selectedChannel] || selectedChannel}è¥æ”¶` : "è¥æ”¶",
          type: "line",
          smooth: true,
          yAxisIndex: 0,
          symbolSize: 7,
          lineStyle: { width: 3 },
          areaStyle: { color: "rgba(86, 148, 53, 0.12)" },
          data: trends.points.map((item) => item.revenue)
        },
        {
          name: "è®¢å•",
          type: "bar",
          yAxisIndex: 1,
          barMaxWidth: 18,
          itemStyle: { borderRadius: [5, 5, 0, 0] },
          data: trends.points.map((item) => item.orders)
        },
        {
          name: "é¢„è­¦",
          type: "line",
          yAxisIndex: 1,
          smooth: true,
          symbolSize: 6,
          lineStyle: { width: 2 },
          data: trends.points.map((item) => item.alerts)
        },
        {
          name: "ä»»åŠ¡",
          type: "line",
          yAxisIndex: 1,
          smooth: true,
          symbolSize: 6,
          lineStyle: { width: 2 },
          data: trends.points.map((item) => item.tasks)
        }
      ]
    }),
    [selectedChannel, trends.points]
  );

  const exportDashboardCsv = useCallback(() => {
    const channelName = selectedChannel ? channelLabel[selectedChannel] || selectedChannel : "å…¨éƒ¨æ¸ é“";
    const rows: unknown[][] = [
      ["æ¨¡å—", "æŒ‡æ ‡", "å€¼", "å¤‡æ³¨"],
      ["ç»è¥æ¦‚è§ˆ", "æœ€æ–°è¥ä¸šæ—¥", formatDate(overview.period.latest_sales_date), selectedStoreName],
      ["ç»è¥æ¦‚è§ˆ", "æœ€æ–°è¥æ”¶", metrics.revenue, `è¾ƒä¸Šä¸€è¥ä¸šæ—¥ ${metrics.revenue_delta_pct}%`],
      ["ç»è¥æ¦‚è§ˆ", "è®¢å•é‡", metrics.orders, `å®¢å•ä»· ${metrics.avg_order}`],
      ["ç»è¥æ¦‚è§ˆ", "å¼€æ”¾é¢„è­¦", metrics.open_alerts, `ä¸¥é‡ ${metrics.critical_alerts} æ¡`],
      ["ç»è¥æ¦‚è§ˆ", "ä»»åŠ¡é—­çŽ¯çŽ‡", `${closureRate}%`, `å¾…å¤„ç† ${metrics.pending_tasks} ä¸ªï¼Œå·²é—­çŽ¯ ${metrics.closed_tasks} ä¸ª`],
      ["ç»è¥æ¦‚è§ˆ", "AI æ‘˜è¦", metrics.ai_reports_month, `æœ¬æœˆèŠ‚çœçº¦ ${metrics.saved_hours_month} å°æ—¶`],
      ["AI ä»Šæ—¥æ‘˜è¦", "ç»è¥æ‘˜è¦", overview.summary, ""],
      ["è¶‹åŠ¿æ±‡æ€»", "ç­›é€‰é—¨åº—", selectedStoreName, ""],
      ["è¶‹åŠ¿æ±‡æ€»", "ç­›é€‰æ¸ é“", channelName, ""],
      ["è¶‹åŠ¿æ±‡æ€»", "å‘¨æœŸ", `${formatDate(trends.period.start_date)} è‡³ ${formatDate(trends.period.end_date)}`, `è¿‘ ${selectedDays} å¤©`],
      ["è¶‹åŠ¿æ±‡æ€»", "å‘¨æœŸè¥æ”¶", trends.totals.revenue, ""],
      ["è¶‹åŠ¿æ±‡æ€»", "å‘¨æœŸè®¢å•", trends.totals.orders, ""],
      ["è¶‹åŠ¿æ±‡æ€»", "æ–°å¢žé¢„è­¦", trends.totals.alerts, ""],
      ["è¶‹åŠ¿æ±‡æ€»", "æ–°å¢žä»»åŠ¡", trends.totals.tasks, ""],
      [],
      ["è¶‹åŠ¿æ˜Žç»†", "æ—¥æœŸ", "è¥æ”¶", "è®¢å•", "é¢„è­¦", "ä»»åŠ¡"],
      ...trends.points.map((item) => ["è¶‹åŠ¿æ˜Žç»†", item.biz_date, item.revenue, item.orders, item.alerts, item.tasks]),
      [],
      ["é¢„è­¦é˜Ÿåˆ—", "é—¨åº—", "ç±»åž‹", "æ ‡é¢˜", "ç­‰çº§", "çŠ¶æ€"],
      ...alerts.map((item) => [
        "é¢„è­¦é˜Ÿåˆ—",
        formatStoreName(item.store_name),
        alertTypeLabel[item.alert_type] || item.alert_type,
        formatAlertTitle(item.title),
        alertLevelLabel[item.level] || item.level,
        item.status
      ]),
      [],
      ["æ¸ é“è¡¨çŽ°", "æ¸ é“", "è¥æ”¶", "å æ¯”"],
      ...channels.map((item) => ["æ¸ é“è¡¨çŽ°", channelLabel[item.channel] || item.channel, item.revenue, `${item.percent}%`])
    ];
    downloadCsv(`foodops-dashboard-${new Date().toISOString().slice(0, 10)}.csv`, rows);
  }, [alerts, channels, closureRate, metrics, overview, selectedChannel, selectedDays, selectedStoreName, trends]);

  useEffect(() => {
    function handleExport(event: Event) {
      exportDashboardCsv();
      const customEvent = event as CustomEvent<{ handled?: boolean }>;
      if (customEvent.detail) customEvent.detail.handled = true;
    }

    window.addEventListener("foodops:export-current-page", handleExport);
    return () => window.removeEventListener("foodops:export-current-page", handleExport);
  }, [exportDashboardCsv]);

  const dashboardTrendCard = (
    <Card
      className="panel-card dashboard-trend-card"
      loading={loading}
      title={
        <div className="dashboard-section-title">
          <span>ç»è¥è¶‹åŠ¿</span>
          <small>
            {selectedStoreName} Â· {formatDate(trends.period.start_date)} è‡³ {formatDate(trends.period.end_date)}
          </small>
        </div>
      }
      extra={
        <div className="dashboard-filter-bar">
          <Select
            allowClear
            showSearch
            placeholder="å…¨éƒ¨é—¨åº—"
            optionFilterProp="label"
            value={selectedStore}
            onChange={setSelectedStore}
            options={filters.stores.map((item) => ({ value: item.id, label: `${formatStoreName(item.name)} (${item.code})` }))}
          />
          <Select
            allowClear
            placeholder="å…¨éƒ¨æ¸ é“"
            value={selectedChannel}
            onChange={setSelectedChannel}
            options={filters.channels.map((item) => ({
              value: item.channel,
              label: channelLabel[item.channel] || item.channel
            }))}
          />
          <Select
            value={selectedDays}
            onChange={setSelectedDays}
            options={filters.day_options.map((item) => ({ value: item, label: `è¿‘ ${item} å¤©` }))}
          />
        </div>
      }
    >
      {trends.points.length ? (
        <>
          <div className="dashboard-trend-summary">
            <span>å‘¨æœŸè¥æ”¶ {formatMoney(trends.totals.revenue)}</span>
            <span>è®¢å• {trends.totals.orders} ç¬”</span>
            <span>æ–°å¢žé¢„è­¦ {trends.totals.alerts} æ¡</span>
            <span>æ–°å¢žä»»åŠ¡ {trends.totals.tasks} ä¸ª</span>
          </div>
          <ReactECharts option={trendOption} style={{ height: 286 }} />
          <div className="dashboard-chart-note">
            å£å¾„ï¼šè¥æ”¶å’Œè®¢å•æ¥è‡ªé—¨åº—æ—¥é”€å”®æ±‡æ€»ï¼›é¢„è­¦å’Œä»»åŠ¡æŒ‰åˆ›å»ºæ—¥æœŸç»Ÿè®¡ï¼›é€‰æ‹©æ¸ é“æ—¶ä»…åˆ‡æ¢è¥æ”¶å£å¾„ï¼Œè®¢å•ä»ä¸ºé—¨åº—æ€»è®¢å•ã€‚
          </div>
        </>
      ) : (
        <Empty description="æš‚æ— è¶‹åŠ¿æ•°æ®ï¼Œè¯·å…ˆå¯¼å…¥é—¨åº—æ—¥é”€å”®æ±‡æ€»" />
      )}
    </Card>
  );

  const dashboardClosureCard = (
    <Card className="panel-card dashboard-closure-card" title="é—­çŽ¯çŠ¶æ€" loading={loading}>
      <div className="closure-ring">
        <Progress type="circle" percent={closureRate} size={118} strokeColor="#569435" />
        <div>
          <b>{metrics.pending_tasks}</b>
          <span>ä¸ªä»»åŠ¡å¾…å¤„ç†</span>
        </div>
      </div>
      <div className="closure-steps">
        <div>
          <span>å¯¼å…¥</span>
          <strong>{metrics.today_imports}</strong>
        </div>
        <div>
          <span>é¢„è­¦</span>
          <strong>{metrics.open_alerts}</strong>
        </div>
        <div>
          <span>é—­çŽ¯</span>
          <strong>{metrics.closed_tasks}</strong>
        </div>
      </div>
      <Button block onClick={() => router.push("/tasks")} icon={<ArrowRightOutlined />}>
        è¿›å…¥ä»»åŠ¡ä¸­å¿ƒ
      </Button>
    </Card>
  );

  const dashboardRiskCard = (
    <Card className="panel-card dashboard-risk-card" title="é«˜é£Žé™©é—¨åº—" loading={loading}>
      {riskStores.length ? (
        <div className="risk-list">
          {riskStores.slice(0, 4).map((item) => (
            <button className="risk-item store-risk-button" key={item.id} onClick={() => router.push(`/analysis/stores?store_id=${item.id}`)}>
              <div>
                <div className="risk-title">{formatStoreName(item.store_name)}</div>
                <div className="risk-meta">{item.latest_reason ? formatAlertTitle(item.latest_reason) : `å¼€æ”¾é¢„è­¦ ${item.alert_count} æ¡`}</div>
              </div>
              <Tag color={item.max_level === "critical" || item.max_level === "high" ? "red" : "orange"}>{item.alert_count} æ¡</Tag>
            </button>
          ))}
        </div>
      ) : (
        <Empty description="æš‚æ— é«˜é£Žé™©é—¨åº—" />
      )}
    </Card>
  );

  const dashboardAlertsCard = (
    <Card className="panel-card dashboard-alerts-card" title="å¼‚å¸¸é¢„è­¦é˜Ÿåˆ—" loading={loading}>
      <Table
        pagination={false}
        rowKey="id"
        dataSource={alerts.slice(0, 5)}
        size="small"
        scroll={{ x: 560 }}
        locale={{ emptyText: <Empty description="æš‚æ— é¢„è­¦" /> }}
        columns={[
          { title: "é—¨åº—", dataIndex: "store_name", width: 160, render: (value: string) => formatStoreName(value) },
          { title: "æ ‡é¢˜", dataIndex: "title", render: (value: string) => formatAlertTitle(value) },
          {
            title: "ç­‰çº§",
            dataIndex: "level",
            width: 82,
            render: (level: string) => <Tag color={level === "critical" || level === "high" ? "red" : "orange"}>{alertLevelLabel[level] || level}</Tag>
          },
          {
            title: "åŠ¨ä½œ",
            width: 76,
            render: (_: unknown, record: AlertRow) => (
              <Button size="small" onClick={() => router.push(`/alerts?alert_id=${record.id}`)}>
                å¤„ç†
              </Button>
            )
          }
        ]}
      />
    </Card>
  );

  const dashboardActivityCard = (
    <Card className="panel-card dashboard-activity-card" title="å®žæ—¶åŠ¨æ€" loading={loading}>
      {notifications.length ? (
        <div className="activity-timeline">
          {notifications.map((item) => (
            <button className="activity-item" key={item.id} onClick={() => router.push(activityHref(item))}>
              <span className="activity-dot"><BellOutlined /></span>
              <span>
                <b>{formatAlertTitle(item.title || "ç³»ç»Ÿé€šçŸ¥")}</b>
                <small>
                  {targetTypeLabel[item.target_type || ""] || item.target_type || "ç³»ç»Ÿ"} Â· {item.status === "pending" ? "å¾…å¤„ç†" : "å·²è®°å½•"}
                </small>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <Empty description="æš‚æ— å®žæ—¶åŠ¨æ€" />
      )}
    </Card>
  );

  const dashboardInsightCard = (
    <Card className="panel-card dashboard-insight-card" title="ç»è¥æ´žå¯Ÿ" loading={loading}>
      <div className="dashboard-insight-grid">
        <div className="dashboard-insight-summary">
          <Alert type="info" showIcon message="AI æ‘˜è¦" description={sanitizeBusinessText(overview.summary)} />
          <div className="dashboard-ai-stats">
            <div>
              <span>å½’å› é¢„è­¦</span>
              <b>{metrics.ai_alerts_month} æ¡</b>
            </div>
            <div>
              <span>ç”Ÿæˆæ‘˜è¦</span>
              <b>{metrics.ai_reports_month} ä»½</b>
            </div>
            <div>
              <span>èŠ‚çœæ—¶é•¿</span>
              <b>{metrics.saved_hours_month} å°æ—¶</b>
            </div>
          </div>
          <Button onClick={() => router.push("/alerts")} icon={<ArrowRightOutlined />}>
            æŸ¥çœ‹æœ¬åœ°è§„åˆ™é¢„è­¦
          </Button>
        </div>
        <div className="dashboard-insight-channels">
          <div className="dashboard-insight-subtitle">æ¸ é“è¡¨çŽ°</div>
          {channels.length ? (
            <div className="dashboard-channel-grid">
              {channels.map((item) => (
                <div className="progress-row" key={item.channel}>
                  <span>{channelLabel[item.channel] || item.channel}</span>
                  <Progress percent={item.percent} showInfo={false} strokeColor="#569435" />
                  <b>{item.percent}%</b>
                </div>
              ))}
            </div>
          ) : (
            <Empty description="æš‚æ— æ¸ é“æ•°æ®" />
          )}
        </div>
      </div>
    </Card>
  );

  return (
    <AppShell>
      <section className="dashboard-kpi-grid dashboard-workbench-kpis" aria-label="ç»è¥æ ¸å¿ƒæŒ‡æ ‡">
        {kpis.map((item) => (
          <Card className={`dashboard-kpi-card dashboard-kpi-${item.tone}`} key={item.key} loading={loading}>
            <div className="dashboard-kpi-head">
              <span className="dashboard-kpi-icon">{item.icon}</span>
              <span className="dashboard-kpi-note">{item.note}</span>
            </div>
            <div className="dashboard-kpi-title">{item.title}</div>
            <div className="dashboard-kpi-value">{item.value}</div>
            {typeof item.progress === "number" ? (
              <Progress percent={item.progress} showInfo={false} strokeColor="#569435" trailColor="rgba(223,232,207,0.9)" />
            ) : null}
          </Card>
        ))}
      </section>

      <section className="dashboard-workbench dashboard-workbench-v2" aria-label="ç»è¥çœ‹æ¿å·¥ä½œå°">
        <div className="dashboard-workbench-primary">
          {dashboardTrendCard}
          {dashboardAlertsCard}
          {dashboardInsightCard}
        </div>
        <aside className="dashboard-workbench-sidebar" aria-label="å¤„ç†ä¾§æ ">
          {dashboardClosureCard}
          {dashboardRiskCard}
          {dashboardActivityCard}
        </aside>
      </section>

      <section className="dashboard-action-dock" aria-label="ä»Šæ—¥å¤„ç†å°">
        <Card className="panel-card dashboard-action-card" title="ä»Šæ—¥å¤„ç†å°">
          <div className="dashboard-action-grid">
            <button className="dashboard-action-item danger" onClick={() => router.push("/alerts")}>
              <span><AlertOutlined /></span>
              <div>
                <b>å¤„ç†å¼€æ”¾é¢„è­¦</b>
                <small>{metrics.open_alerts} æ¡å¼€æ”¾ï¼Œä¸¥é‡ {metrics.critical_alerts} æ¡</small>
              </div>
              <em>æŸ¥çœ‹</em>
            </button>
            <button className="dashboard-action-item warning" onClick={() => router.push("/tasks")}>
              <span><CheckCircleOutlined /></span>
              <div>
                <b>æŽ¨è¿›æ•´æ”¹ä»»åŠ¡</b>
                <small>{metrics.pending_tasks} ä¸ªå¾…å¤„ç†ï¼Œå·²é—­çŽ¯ {metrics.closed_tasks} ä¸ª</small>
              </div>
              <em>è¿›å…¥</em>
            </button>
            <button className="dashboard-action-item" onClick={() => router.push("/alerts")}>
              <span><ThunderboltOutlined /></span>
              <div>
                <b>æŸ¥çœ‹è§„åˆ™å½’å› </b>
                <small>{metrics.ai_alerts_month} æ¡æœ¬åœ°å½’å› è®°å½•ï¼Œ{metrics.ai_reports_month} ä»½æœ¬åœ°æ‘˜è¦</small>
              </div>
              <em>æŸ¥çœ‹</em>
            </button>
            <button className="dashboard-action-item" onClick={() => router.push("/data/imports")}>
              <span><CloudUploadOutlined /></span>
              <div>
                <b>è¡¥å……ç»è¥æ•°æ®</b>
                <small>ä»Šæ—¥å¯¼å…¥ {metrics.today_imports} æ¬¡ï¼Œå¯¼å…¥åŽè§¦å‘è§„åˆ™</small>
              </div>
              <em>å¯¼å…¥</em>
            </button>
          </div>
        </Card>
      </section>
    </AppShell>
  );
}

