"use client";

import {
  AlertOutlined,
  AppstoreOutlined,
  AuditOutlined,
  BellOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  ExperimentOutlined,
  LogoutOutlined,
  MenuOutlined,
  SettingOutlined,
  ShopOutlined,
  TeamOutlined
} from "@ant-design/icons";
import { App, Avatar, Badge, Button, Drawer, Input, Layout, Menu, Tag, Typography } from "antd";
import type { MenuProps } from "antd";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { api } from "@/lib/api";
import { clearSession, getRefreshToken } from "@/lib/auth";
import { canRead, type PermissionMap, readStoredPermissions } from "@/lib/permissions";
import { moduleForRoute } from "@/lib/route-permissions";

const { Header, Sider, Content } = Layout;

type NavItem = {
  key: string;
  icon: ReactNode;
  label: string;
  module: string;
};

type NavGroup = {
  title: string;
  items: NavItem[];
};

type StoredUser = {
  name?: string;
  username?: string;
  role?: string;
};

const navGroups: NavGroup[] = [
  {
    title: "Operations",
    items: [
      { key: "/dashboard", icon: <DashboardOutlined />, label: "Dashboard", module: "dashboard" },
      { key: "/data/imports", icon: <DatabaseOutlined />, label: "Data Import", module: "imports" },
      { key: "/alerts", icon: <AlertOutlined />, label: "Alerts", module: "alerts" },
      { key: "/tasks", icon: <AlertOutlined />, label: "Tasks", module: "tasks" },
      { key: "/notifications", icon: <BellOutlined />, label: "Notifications", module: "alerts" }
    ]
  },
  {
    title: "Master Data",
    items: [
      { key: "/system/stores", icon: <ShopOutlined />, label: "Stores", module: "stores" },
      { key: "/system/products", icon: <AppstoreOutlined />, label: "Products", module: "products" },
      { key: "/system/materials", icon: <ExperimentOutlined />, label: "Materials", module: "materials" },
      { key: "/system/users", icon: <TeamOutlined />, label: "Users", module: "users" },
      { key: "/system/settings", icon: <SettingOutlined />, label: "Brand Settings", module: "system" }
    ]
  },
  {
    title: "System",
    items: [
      { key: "/system/environment", icon: <SettingOutlined />, label: "Environment", module: "system" },
      { key: "/system/audit", icon: <AuditOutlined />, label: "Audit Logs", module: "system" }
    ]
  }
];

const items = navGroups.flatMap((group) => group.items);

const pageMeta: Record<string, { title: string; subtitle: string }> = {
  "/dashboard": { title: "Dashboard", subtitle: "Revenue, alerts, tasks and store execution in one view" },
  "/data/imports": { title: "Data Import", subtitle: "Import CSV/XLSX operating data and generate local alerts" },
  "/alerts": { title: "Alerts", subtitle: "Review sales, inventory and review risks" },
  "/tasks": { title: "Tasks", subtitle: "Dispatch work, collect store feedback and close the loop" },
  "/notifications": { title: "Notifications", subtitle: "Local system notifications and task reminders" },
  "/system/stores": { title: "Stores", subtitle: "Maintain store profiles and owners" },
  "/system/products": { title: "Products", subtitle: "Maintain SKUs, categories, prices and status" },
  "/system/materials": { title: "Materials", subtitle: "Maintain materials and safety stock" },
  "/system/users": { title: "Users", subtitle: "Maintain users, roles and data scopes" },
  "/system/settings": { title: "Brand Settings", subtitle: "Configure public Community demo brand settings" },
  "/system/environment": { title: "Environment", subtitle: "Check local service health" },
  "/system/audit": { title: "Audit Logs", subtitle: "Trace imports, alerts, tasks and user actions" }
};

function readStoredUser(): StoredUser {
  if (typeof window === "undefined") return {};
  const raw = window.localStorage.getItem("foodops_user");
  if (!raw) return {};
  try {
    return JSON.parse(raw) as StoredUser;
  } catch {
    return {};
  }
}

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [permissions, setPermissions] = useState<PermissionMap>({});
  const [pendingNotifications, setPendingNotifications] = useState(0);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState<StoredUser>({});
  const [searchValue, setSearchValue] = useState("");
  const { message } = App.useApp();
  const meta = metaForPath(pathname);
  const visibleItems = useMemo(() => items.filter((item) => canRead(permissions, item.module)), [permissions]);
  const menuItems = useMemo<MenuProps["items"]>(
    () =>
      navGroups
        .map((group) => {
          const children = group.items
            .filter((item) => canRead(permissions, item.module))
            .map(({ module: _module, ...item }) => item);
          if (!children.length) return null;
          return { type: "group" as const, label: group.title, children };
        })
        .filter(Boolean),
    [permissions]
  );
  const currentModule = moduleForRoute(pathname);
  const canUseCurrentPage = !currentModule || canRead(permissions, currentModule);
  const userName = currentUser.name || currentUser.username || "Admin";
  const userRole = currentUser.role || "Community";

  function navigateTo(key: string) {
    router.push(key);
    setMobileMenuOpen(false);
  }

  async function logout() {
    const refreshToken = getRefreshToken();
    try {
      await api.post("/api/v1/auth/logout", { refresh_token: refreshToken });
    } catch {
      // Local session cleanup must still run when the token is already invalid.
    }
    clearSession();
    setMobileMenuOpen(false);
    router.push("/login");
  }

  function runGlobalSearch(value: string) {
    const keyword = value.trim();
    if (!keyword) {
      message.info("Enter a search term");
      return;
    }
    const target = keyword.toLowerCase().includes("task")
      ? "/tasks"
      : keyword.toLowerCase().includes("alert")
        ? "/alerts"
        : keyword.toLowerCase().includes("store")
          ? "/system/stores"
          : "/dashboard";
    router.push(`${target}?keyword=${encodeURIComponent(keyword)}`);
  }

  useEffect(() => {
    const token = window.localStorage.getItem("foodops_token");
    if (!token) {
      router.replace("/login");
      return;
    }
    setPermissions(readStoredPermissions());
    setCurrentUser(readStoredUser());
    setReady(true);
    api
      .get("/api/v1/auth/me")
      .then((res) => {
        const user = {
          id: res.data.id,
          tenant_id: res.data.tenant_id,
          name: res.data.name,
          username: res.data.username,
          role: res.data.role_name,
          permissions: res.data.permissions || {}
        };
        window.localStorage.setItem("foodops_user", JSON.stringify(user));
        setPermissions(user.permissions);
        setCurrentUser(user);
      })
      .catch(() => {
        // The response interceptor handles expired sessions; keep the shell stable for transient errors.
      });
  }, [router]);

  useEffect(() => {
    if (!ready || canUseCurrentPage) return;
    router.replace(visibleItems[0]?.key || "/login");
  }, [canUseCurrentPage, ready, router, visibleItems]);

  useEffect(() => {
    if (!ready) return;
    api
      .get("/api/v1/notifications/summary")
      .then((res) => setPendingNotifications(res.data.pending || 0))
      .catch(() => setPendingNotifications(0));
  }, [ready, pathname]);

  if (!ready) {
    return null;
  }

  return (
    <Layout className="app-shell">
      <Sider width={268} className="app-sider">
        <div className="app-brand">
          <div className="app-brand-mark">FO</div>
          <div className="app-brand-copy">
            <div className="app-brand-title">FoodOps Community</div>
            <div className="app-brand-sub">Local AI operations loop</div>
          </div>
        </div>
        <div className="app-nav-scroll">
          <Menu
            className="app-nav-menu"
            theme="light"
            mode="inline"
            selectedKeys={[pathname]}
            items={menuItems}
            onClick={({ key }) => navigateTo(key)}
          />
        </div>
        <div className="app-sider-user">
          <Avatar className="app-sider-avatar">{userName.slice(0, 1).toUpperCase()}</Avatar>
          <div className="app-sider-user-copy">
            <b>{userName}</b>
            <span>{userRole}</span>
          </div>
          <Button type="text" icon={<LogoutOutlined />} onClick={logout} aria-label="Log out" />
        </div>
      </Sider>
      <Layout>
        <Header className="app-header">
          <div className="app-header-main">
            <Button
              className="app-mobile-menu-button"
              type="text"
              icon={<MenuOutlined />}
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation"
            />
            <div className="app-header-title">
              <Typography.Title level={3} style={{ margin: 0 }}>
                {meta.title}
              </Typography.Title>
              <Typography.Text type="secondary">{meta.subtitle}</Typography.Text>
            </div>
          </div>
          <div className="app-header-actions">
            <Input.Search
              allowClear
              enterButton
              placeholder="Search stores, tasks, alerts"
              style={{ width: 360 }}
              value={searchValue}
              onChange={(event) => setSearchValue(event.target.value)}
              onSearch={runGlobalSearch}
            />
            <Tag color="green">Community</Tag>
            <Button
              type="text"
              onClick={() => router.push("/notifications")}
              icon={
                <Badge size="small" count={pendingNotifications}>
                  <BellOutlined />
                </Badge>
              }
            />
            <Avatar style={{ background: "#3f7d3b", color: "#fff", fontWeight: 900 }}>{userName.slice(0, 1).toUpperCase()}</Avatar>
            <Button icon={<LogoutOutlined />} onClick={logout} />
          </div>
        </Header>
        <Content className="app-content">{children}</Content>
      </Layout>
      <Drawer
        className="app-mobile-drawer"
        title="FoodOps Community"
        placement="left"
        open={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        width={300}
      >
        <Menu
          className="app-nav-menu"
          theme="light"
          mode="inline"
          selectedKeys={[pathname]}
          items={menuItems}
          onClick={({ key }) => navigateTo(key)}
        />
      </Drawer>
    </Layout>
  );
}

function metaForPath(pathname: string) {
  return pageMeta[pathname] || pageMeta["/dashboard"];
}
