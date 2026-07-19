"use client";

import {
  CloudServerOutlined,
  LockOutlined,
  SafetyCertificateOutlined,
  UserOutlined
} from "@ant-design/icons";
import { Alert, Button, Checkbox, Form, Input, Space, Typography } from "antd";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { api } from "@/lib/api";
import { clearSession, saveSession } from "@/lib/auth";
import { useBrandConfig } from "@/lib/useBrandConfig";

type LoginValues = {
  username: string;
  password: string;
  remember?: boolean;
};

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const brand = useBrandConfig();

  async function onFinish(values: LoginValues) {
    setError("");
    setLoading(true);
    clearSession();
    try {
      const { username, password } = values;
      const { data } = await api.post("/api/v1/auth/login", { username, password });
      saveSession(data.access_token, data.user, data.refresh_token);
      router.push("/dashboard");
    } catch {
      setError("账号或密码错误,请检查后重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-visual" aria-label="FoodOps Community operations loop">
        <div className="login-visual-bg" aria-hidden="true" />
        <div className="login-visual-backdrop" />
        <div className="login-visual-content">
          <div className="login-brand-block">
            <div className="brand-login-logo">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="brand-logo-img" src={brand.logoSrc} alt="FoodOps Community" width={118} style={{ maxWidth: 118, height: "auto" }} />
            </div>
            <span>{brand.systemName}</span>
          </div>

          <div className="login-hero-copy">
            <Typography.Text className="login-eyebrow">{brand.brandName}</Typography.Text>
            <Typography.Title>{brand.slogan}</Typography.Title>
            <Typography.Paragraph>
              面向连锁餐饮的本地经营闭环:数据导入、经营看板、异常预警、任务派发、门店 H5 反馈和审计追踪。
            </Typography.Paragraph>
          </div>

          <div className="login-visual-footnote">
            <span />
            Community operations workspace
          </div>
        </div>
      </section>

      <section className="login-panel" aria-label="登录 FoodOps">
        <div className="login-form-card">
          <div className="login-mobile-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="brand-logo-img" src={brand.logoSrc} alt="FoodOps Community" width={118} style={{ maxWidth: 118, height: "auto" }} />
            <span>{brand.systemName}</span>
          </div>

          <div className="login-status-row">
            <span className="login-status-chip">本地核心</span>
            <span className="login-status-chip">岗位权限</span>
            <span className="login-status-chip">全量审计</span>
          </div>

          <div className="login-title-block">
            <Typography.Text className="login-eyebrow">欢迎回来</Typography.Text>
            <Typography.Title level={1}>登录工作台</Typography.Title>
            <Typography.Paragraph>
              使用系统账号进入经营看板,处理门店异常、任务派发和门店反馈。
            </Typography.Paragraph>
          </div>

          {error ? <Alert type="error" message={error} showIcon className="login-alert" /> : null}

          <Form layout="vertical" size="large" requiredMark={false} onFinish={onFinish} initialValues={{ remember: true }}>
            <Form.Item name="username" label="账号" rules={[{ required: true, message: "请输入账号" }]}>
              <Input prefix={<UserOutlined />} placeholder="admin" autoComplete="username" />
            </Form.Item>
            <Form.Item name="password" label="密码" rules={[{ required: true, message: "请输入密码" }]}>
              <Input.Password prefix={<LockOutlined />} placeholder="请输入密码" autoComplete="current-password" />
            </Form.Item>

            <div className="login-form-row">
              <Form.Item name="remember" valuePropName="checked" noStyle>
                <Checkbox>记住我</Checkbox>
              </Form.Item>
              <button className="login-text-button" type="button">忘记密码?</button>
            </div>

            <Button type="primary" htmlType="submit" block loading={loading} className="login-submit">
              立即登录
            </Button>
          </Form>

          <div className="login-security-note">
            <Space direction="vertical" size={8}>
              <Typography.Text><SafetyCertificateOutlined /> Community 版本使用自建认证和本地权限中间件。</Typography.Text>
              <Typography.Text><CloudServerOutlined /> 核心经营数据保存在本地 PostgreSQL。</Typography.Text>
            </Space>
          </div>
        </div>
      </section>
    </main>
  );
}
