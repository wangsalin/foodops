"use client";

import {
  CheckCircleOutlined,
  CloudServerOutlined,
  DatabaseOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined
} from "@ant-design/icons";
import { Alert, Button, Card, Descriptions, Skeleton, Space, Tag, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";

type StatusValue = "ok" | "disabled" | "missing" | string;

type StatusItem = {
  key: string;
  name: string;
  status: StatusValue;
  detail: string;
};

type EnvironmentStatus = {
  backend: {
    app_env: string;
    debug: boolean;
    api_title: string;
    database_url: string;
    redis_url: string;
    h5_base_url: string;
    request_host?: string;
  };
  services: StatusItem[];
  integrations: StatusItem[];
  ai: {
    providers: number;
    routes: number;
    active_rule_templates: number;
    mode: string;
  };
  security: {
    app_secret_configured: boolean;
    jwt_algorithm: string;
  };
  community: {
    mode: string;
    version: string;
    scope: string[];
  };
  warnings: string[];
};

const frontendApiBase = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:23101";
const frontendAppName = process.env.NEXT_PUBLIC_APP_NAME || "FoodOps Community";
const frontendVersion = process.env.NEXT_PUBLIC_APP_VERSION || "0.1.0";
const frontendH5Base = process.env.NEXT_PUBLIC_H5_BASE_URL || "http://127.0.0.1:23000";

function statusColor(status: StatusValue) {
  if (status === "ok") return "green";
  if (status === "disabled") return "default";
  if (status === "missing") return "gold";
  return "blue";
}

function statusLabel(status: StatusValue) {
  if (status === "ok") return "Ready";
  if (status === "disabled") return "Disabled";
  if (status === "missing") return "Missing";
  return status || "-";
}

function maskUrl(value: string) {
  return value.replace(/:[^:@/]+@/, ":***@");
}

export function EnvironmentStatusPage() {
  const [data, setData] = useState<EnvironmentStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<EnvironmentStatus>("/system/environment");
      setData(res.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !data) {
    return <Skeleton active paragraph={{ rows: 8 }} />;
  }

  return (
    <Space direction="vertical" size={16} className="system-page">
      <div className="system-page__header">
        <div>
          <Typography.Title level={3}>运行环境</Typography.Title>
          <Typography.Text type="secondary">Community edition local runtime and reserved integration boundaries.</Typography.Text>
        </div>
        <Button icon={<ReloadOutlined />} loading={loading} onClick={load}>
          刷新
        </Button>
      </div>

      {data?.warnings?.length ? (
        <Alert type="warning" showIcon message="配置提醒" description={data.warnings.join("；")} />
      ) : null}

      <Card title="应用">
        <Descriptions bordered size="small" column={{ xs: 1, md: 2 }}>
          <Descriptions.Item label="前端应用">{frontendAppName}</Descriptions.Item>
          <Descriptions.Item label="前端版本">{frontendVersion}</Descriptions.Item>
          <Descriptions.Item label="API Base">{frontendApiBase}</Descriptions.Item>
          <Descriptions.Item label="H5 Base">{frontendH5Base}</Descriptions.Item>
          <Descriptions.Item label="后端环境">{data?.backend.app_env || "-"}</Descriptions.Item>
          <Descriptions.Item label="调试模式">{data?.backend.debug ? "enabled" : "disabled"}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Card title="本地服务">
        <div className="system-status-grid">
          {(data?.services || []).map((item) => (
            <Card key={item.key} size="small">
              <Space align="start">
                {item.key === "postgres" ? <DatabaseOutlined /> : <CloudServerOutlined />}
                <div>
                  <Typography.Text strong>{item.name}</Typography.Text>
                  <div>
                    <Tag color={statusColor(item.status)}>{statusLabel(item.status)}</Tag>
                  </div>
                  <Typography.Text type="secondary">{item.detail}</Typography.Text>
                </div>
              </Space>
            </Card>
          ))}
        </div>
      </Card>

      <Card title="Community 能力边界">
        <Space direction="vertical" size={12}>
          <Space wrap>
            {(data?.community.scope || []).map((item) => (
              <Tag key={item} icon={<CheckCircleOutlined />} color="green">
                {item}
              </Tag>
            ))}
          </Space>
          <Descriptions bordered size="small" column={{ xs: 1, md: 2 }}>
            <Descriptions.Item label="AI 模式">{data?.ai.mode || "local_rules"}</Descriptions.Item>
            <Descriptions.Item label="模型供应商">{data?.ai.providers ?? 0}</Descriptions.Item>
            <Descriptions.Item label="通知模式">system</Descriptions.Item>
            <Descriptions.Item label="安全算法">{data?.security.jwt_algorithm || "-"}</Descriptions.Item>
          </Descriptions>
        </Space>
      </Card>

      <Card title="企业插件预留">
        <div className="system-status-grid">
          {(data?.integrations || []).map((item) => (
            <Card key={item.key} size="small">
              <Space align="start">
                <SafetyCertificateOutlined />
                <div>
                  <Typography.Text strong>{item.name}</Typography.Text>
                  <div>
                    <Tag color={statusColor(item.status)}>{statusLabel(item.status)}</Tag>
                  </div>
                  <Typography.Text type="secondary">{item.detail}</Typography.Text>
                </div>
              </Space>
            </Card>
          ))}
        </div>
      </Card>

      <Card title="后端连接">
        <Descriptions bordered size="small" column={1}>
          <Descriptions.Item label="API">{data?.backend.api_title || "-"}</Descriptions.Item>
          <Descriptions.Item label="Database">{maskUrl(data?.backend.database_url || "")}</Descriptions.Item>
          <Descriptions.Item label="Redis">{data?.backend.redis_url || "-"}</Descriptions.Item>
          <Descriptions.Item label="Request Host">{data?.backend.request_host || "-"}</Descriptions.Item>
        </Descriptions>
      </Card>
    </Space>
  );
}

export default EnvironmentStatusPage;
