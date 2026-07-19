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
  loading: () => <div className="chart-loading">图表加载中</div>
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
  summary: "暂无经营数据。请先完成数据导入。"
};

const emptyTrends: TrendResponse = {
  period: { start_date: null, end_date: null, days: 14 },
  filters: {},
  points: [],
  totals: { revenue: 0, orders: 0, alerts: 0, tasks: 0 }
};

const channelLabel: Record<string, string> = {
  meituan: "美团",
  eleme: "饿了么",
  miniapp: "小程序",
  dine_in: "堂食",
  group_buy: "团购",
  offline: "线下"
};

const alertTypeLabel: Record<string, string> = {
  sales_drop: "销售下滑",
  inventory_risk: "库存风险",
  bad_review: "评价异常",
};

const alertLevelLabel: Record<string, string> = {
  critical: "严重",
  high: "高风险",
  warning: "预警",
  medium: "中风险",
  low: "低风险",
  normal: "普通"
};

const targetTypeLabel: Record<string, string> = {
  alert: "预警",
  task: "任务",
  ai: "AI",
  system: "系统"
};

function formatMoney(value: number) {
  return `¥${value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(value?: string | null) {
  if (!value) return "暂无";
  return value.slice(0, 10);
}

function formatStoreName(value?: string | null) {
  if (!value) return "未关联门店";
  if (/^Scope Store/i.test(value)) return "测试门店";
  return value;
}

function formatAlertTitle(value?: string | null) {
  if (!value) return "未命名预警";
  if (/^codex[-_]/i.test(value)) return "系统验收预警";
  return sanitizeBusinessText(value);
}

function sanitizeBusinessText(value?: string | null) {
  if (!value) return "";
  return value
    .replaceAll("Codex", "系统验收")
    .replaceAll("Critical", "严重")
    .replaceAll("critical", "严重")
    .replaceAll("high", "高风险");
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
      message.error("经营看板数据加载失败,请确认后端服务和登录状态");
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
  const selectedStoreName = filters.stores.find((item) => item.id === selectedStore)?.name || "全部可见门店";

  const kpis = [
    {
      key: "revenue",
      icon: <DollarOutlined />,
      title: "最新营收",
      value: formatMoney(metrics.revenue),
      note: `较上一营业日 ${metrics.revenue_delta_pct >= 0 ? "+" : ""}${metrics.revenue_delta_pct}%`,
      tone: metrics.revenue_delta_pct >= 0 ? "good" : "danger"
    },
    {
      key: "orders",
      icon: <LineChartOutlined />,
      title: "订单量",
      value: metrics.orders.toLocaleString("zh-CN"),
      note: `客单价 ${formatMoney(metrics.avg_order)}`,
      tone: "neutral"
    },
    {
      key: "alerts",
      icon: <AlertOutlined />,
      title: "开放预警",
      value: `${metrics.open_alerts} 条`,
      note: `严重 ${metrics.critical_alerts} 条`,
      tone: metrics.critical_alerts > 0 ? "danger" : "warn"
    },
    {
      key: "tasks",
      icon: <CheckCircleOutlined />,
      title: "任务闭环",
      value: `${closureRate}%`,
      note: `待处理 ${metrics.pending_tasks} 个,已闭环 ${metrics.closed_tasks} 个`,
      tone: metrics.pending_tasks > 0 ? "warn" : "good",
      progress: closureRate
    },
    {
      key: "imports",
      icon: <CloudUploadOutlined />,
      title: "今日导入",
      value: `${metrics.today_imports} 次`,
      note: "导入后自动触发 V1 预警规则",
      tone: "neutral"
    },
    {
      key: "ai",
      icon: <ThunderboltOutlined />,
      title: "AI 摘要",
      value: `${metrics.ai_reports_month} 份`,
      note: `本月节省约 ${metrics.saved_hours_month} 小时`,
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
          name: "营收",
          axisLabel: { formatter: "¥{value}" },
          splitLine: { lineStyle: { color: "rgba(219, 228, 238, 0.75)" } }
        },
        {
          type: "value",
          name: "数量",
          axisLabel: { margin: 12 },
          splitLine: { show: false }
        }
      ],
      series: [
        {
          name: selectedChannel ? `${channelLabel[selectedChannel] || selectedChannel}营收` : "营收",
          type: "line",
          smooth: true,
          yAxisIndex: 0,
          symbolSize: 7,
          lineStyle: { width: 3 },
          areaStyle: { color: "rgba(86, 148, 53, 0.12)" },
          data: trends.points.map((item) => item.revenue)
        },
        {
          name: "订单",
          type: "bar",
          yAxisIndex: 1,
          barMaxWidth: 18,
          itemStyle: { borderRadius: [5, 5, 0, 0] },
          data: trends.points.map((item) => item.orders)
        },
        {
          name: "预警",
          type: "line",
          yAxisIndex: 1,
          smooth: true,
          symbolSize: 6,
          lineStyle: { width: 2 },
          data: trends.points.map((item) => item.alerts)
        },
        {
          name: "任务",
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
    const channelName = selectedChannel ? channelLabel[selectedChannel] || selectedChannel : "全部渠道";
    const rows: unknown[][] = [
      ["模块", "指标", "值", "备注"],
      ["经营概览", "最新营业日", formatDate(overview.period.latest_sales_date), selectedStoreName],
      ["经营概览", "最新营收", metrics.revenue, `较上一营业日 ${metrics.revenue_delta_pct}%`],
      ["经营概览", "订单量", metrics.orders, `客单价 ${metrics.avg_order}`],
      ["经营概览", "开放预警", metrics.open_alerts, `严重 ${metrics.critical_alerts} 条`],
      ["经营概览", "任务闭环率", `${closureRate}%`, `待处理 ${metrics.pending_tasks} 个,已闭环 ${metrics.closed_tasks} 个`],
      ["经营概览", "AI 摘要", metrics.ai_reports_month, `本月节省约 ${metrics.saved_hours_month} 小时`],
      ["AI 今日摘要", "经营摘要", overview.summary, ""],
      ["趋势汇总", "筛选门店", selectedStoreName, ""],
      ["趋势汇总", "筛选渠道", channelName, ""],
      ["趋势汇总", "周期", `${formatDate(trends.period.start_date)} 至 ${formatDate(trends.period.end_date)}`, `近 ${selectedDays} 天`],
      ["趋势汇总", "周期营收", trends.totals.revenue, ""],
      ["趋势汇总", "周期订单", trends.totals.orders, ""],
      ["趋势汇总", "新增预警", trends.totals.alerts, ""],
      ["趋势汇总", "新增任务", trends.totals.tasks, ""],
      [],
      ["趋势明细", "日期", "营收", "订单", "预警", "任务"],
      ...trends.points.map((item) => ["趋势明细", item.biz_date, item.revenue, item.orders, item.alerts, item.tasks]),
      [],
      ["预警队列", "门店", "类型", "标题", "等级", "状态"],
      ...alerts.map((item) => [
        "预警队列",
        formatStoreName(item.store_name),
        alertTypeLabel[item.alert_type] || item.alert_type,
        formatAlertTitle(item.title),
        alertLevelLabel[item.level] || item.level,
        item.status
      ]),
      [],
      ["渠道表现", "渠道", "营收", "占比"],
      ...channels.map((item) => ["渠道表现", channelLabel[item.channel] || item.channel, item.revenue, `${item.percent}%`])
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
          <span>经营趋势</span>
          <small>
            {selectedStoreName} · {formatDate(trends.period.start_date)} 至 {formatDate(trends.period.end_date)}
          </small>
        </div>
      }
      extra={
        <div className="dashboard-filter-bar">
          <Select
            allowClear
            showSearch
            placeholder="全部门店"
            optionFilterProp="label"
            value={selectedStore}
            onChange={setSelectedStore}
            options={filters.stores.map((item) => ({ value: item.id, label: `${formatStoreName(item.name)} (${item.code})` }))}
          />
          <Select
            allowClear
            placeholder="全部渠道"
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
            options={filters.day_options.map((item) => ({ value: item, label: `近 ${item} 天` }))}
          />
        </div>
      }
    >
      {trends.points.length ? (
        <>
          <div className="dashboard-trend-summary">
            <span>周期营收 {formatMoney(trends.totals.revenue)}</span>
            <span>订单 {trends.totals.orders} 笔</span>
            <span>新增预警 {trends.totals.alerts} 条</span>
            <span>新增任务 {trends.totals.tasks} 个</span>
          </div>
          <ReactECharts option={trendOption} style={{ height: 286 }} />
          <div className="dashboard-chart-note">
            口径:营收和订单来自门店日销售汇总;预警和任务按创建日期统计;选择渠道时仅切换营收口径,订单仍为门店总订单。
          </div>
        </>
      ) : (
        <Empty description="暂无趋势数据,请先导入门店日销售汇总" />
      )}
    </Card>
  );

  const dashboardClosureCard = (
    <Card className="panel-card dashboard-closure-card" title="闭环状态" loading={loading}>
      <div className="closure-ring">
        <Progress type="circle" percent={closureRate} size={118} strokeColor="#569435" />
        <div>
          <b>{metrics.pending_tasks}</b>
          <span>个任务待处理</span>
        </div>
      </div>
      <div className="closure-steps">
        <div>
          <span>导入</span>
          <strong>{metrics.today_imports}</strong>
        </div>
        <div>
          <span>预警</span>
          <strong>{metrics.open_alerts}</strong>
        </div>
        <div>
          <span>闭环</span>
          <strong>{metrics.closed_tasks}</strong>
        </div>
      </div>
      <Button block onClick={() => router.push("/tasks")} icon={<ArrowRightOutlined />}>
        进入任务中心
      </Button>
    </Card>
  );

  const dashboardRiskCard = (
    <Card className="panel-card dashboard-risk-card" title="高风险门店" loading={loading}>
      {riskStores.length ? (
        <div className="risk-list">
          {riskStores.slice(0, 4).map((item) => (
            <button className="risk-item store-risk-button" key={item.id} onClick={() => router.push(`/analysis/stores?store_id=${item.id}`)}>
              <div>
                <div className="risk-title">{formatStoreName(item.store_name)}</div>
                <div className="risk-meta">{item.latest_reason ? formatAlertTitle(item.latest_reason) : `开放预警 ${item.alert_count} 条`}</div>
              </div>
              <Tag color={item.max_level === "critical" || item.max_level === "high" ? "red" : "orange"}>{item.alert_count} 条</Tag>
            </button>
          ))}
        </div>
      ) : (
        <Empty description="暂无高风险门店" />
      )}
    </Card>
  );

  const dashboardAlertsCard = (
    <Card className="panel-card dashboard-alerts-card" title="异常预警队列" loading={loading}>
      <Table
        pagination={false}
        rowKey="id"
        dataSource={alerts.slice(0, 5)}
        size="small"
        scroll={{ x: 560 }}
        locale={{ emptyText: <Empty description="暂无预警" /> }}
        columns={[
          { title: "门店", dataIndex: "store_name", width: 160, render: (value: string) => formatStoreName(value) },
          { title: "标题", dataIndex: "title", render: (value: string) => formatAlertTitle(value) },
          {
            title: "等级",
            dataIndex: "level",
            width: 82,
            render: (level: string) => <Tag color={level === "critical" || level === "high" ? "red" : "orange"}>{alertLevelLabel[level] || level}</Tag>
          },
          {
            title: "动作",
            width: 76,
            render: (_: unknown, record: AlertRow) => (
              <Button size="small" onClick={() => router.push(`/alerts?alert_id=${record.id}`)}>
                处理
              </Button>
            )
          }
        ]}
      />
    </Card>
  );

  const dashboardActivityCard = (
    <Card className="panel-card dashboard-activity-card" title="实时动态" loading={loading}>
      {notifications.length ? (
        <div className="activity-timeline">
          {notifications.map((item) => (
            <button className="activity-item" key={item.id} onClick={() => router.push(activityHref(item))}>
              <span className="activity-dot"><BellOutlined /></span>
              <span>
                <b>{formatAlertTitle(item.title || "系统通知")}</b>
                <small>
                  {targetTypeLabel[item.target_type || ""] || item.target_type || "系统"} · {item.status === "pending" ? "待处理" : "已记录"}
                </small>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <Empty description="暂无实时动态" />
      )}
    </Card>
  );

  const dashboardInsightCard = (
    <Card className="panel-card dashboard-insight-card" title="经营洞察" loading={loading}>
      <div className="dashboard-insight-grid">
        <div className="dashboard-insight-summary">
          <Alert type="info" showIcon message="AI 摘要" description={sanitizeBusinessText(overview.summary)} />
          <div className="dashboard-ai-stats">
            <div>
              <span>归因预警</span>
              <b>{metrics.ai_alerts_month} 条</b>
            </div>
            <div>
              <span>生成摘要</span>
              <b>{metrics.ai_reports_month} 份</b>
            </div>
            <div>
              <span>节省时长</span>
              <b>{metrics.saved_hours_month} 小时</b>
            </div>
          </div>
          <Button onClick={() => router.push("/alerts")} icon={<ArrowRightOutlined />}>
            查看本地规则预警
          </Button>
        </div>
        <div className="dashboard-insight-channels">
          <div className="dashboard-insight-subtitle">渠道表现</div>
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
            <Empty description="暂无渠道数据" />
          )}
        </div>
      </div>
    </Card>
  );

  return (
    <AppShell>
      <section className="dashboard-kpi-grid dashboard-workbench-kpis" aria-label="经营核心指标">
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

      <section className="dashboard-workbench dashboard-workbench-v2" aria-label="经营看板工作台">
        <div className="dashboard-workbench-primary">
          {dashboardTrendCard}
          {dashboardAlertsCard}
          {dashboardInsightCard}
        </div>
        <aside className="dashboard-workbench-sidebar" aria-label="处理侧栏">
          {dashboardClosureCard}
          {dashboardRiskCard}
          {dashboardActivityCard}
        </aside>
      </section>

      <section className="dashboard-action-dock" aria-label="今日处理台">
        <Card className="panel-card dashboard-action-card" title="今日处理台">
          <div className="dashboard-action-grid">
            <button className="dashboard-action-item danger" onClick={() => router.push("/alerts")}>
              <span><AlertOutlined /></span>
              <div>
                <b>处理开放预警</b>
                <small>{metrics.open_alerts} 条开放,严重 {metrics.critical_alerts} 条</small>
              </div>
              <em>查看</em>
            </button>
            <button className="dashboard-action-item warning" onClick={() => router.push("/tasks")}>
              <span><CheckCircleOutlined /></span>
              <div>
                <b>推进整改任务</b>
                <small>{metrics.pending_tasks} 个待处理,已闭环 {metrics.closed_tasks} 个</small>
              </div>
              <em>进入</em>
            </button>
            <button className="dashboard-action-item" onClick={() => router.push("/alerts")}>
              <span><ThunderboltOutlined /></span>
              <div>
                <b>查看规则归因</b>
                <small>{metrics.ai_alerts_month} 条本地归因记录,{metrics.ai_reports_month} 份本地摘要</small>
              </div>
              <em>查看</em>
            </button>
            <button className="dashboard-action-item" onClick={() => router.push("/data/imports")}>
              <span><CloudUploadOutlined /></span>
              <div>
                <b>补充经营数据</b>
                <small>今日导入 {metrics.today_imports} 次,导入后触发规则</small>
              </div>
              <em>导入</em>
            </button>
          </div>
        </Card>
      </section>
    </AppShell>
  );
}
