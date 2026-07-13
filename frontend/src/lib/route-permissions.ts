export type RoutePermissionRule = {
  path: string;
  module: string;
};

export const routePermissionRules: readonly RoutePermissionRule[] = [
  { path: "/dashboard", module: "dashboard" },
  { path: "/data/imports", module: "imports" },
  { path: "/alerts", module: "alerts" },
  { path: "/tasks", module: "tasks" },
  { path: "/notifications", module: "alerts" },
  { path: "/system/stores", module: "stores" },
  { path: "/system/products", module: "products" },
  { path: "/system/materials", module: "materials" },
  { path: "/system/settings", module: "system" },
  { path: "/system/environment", module: "system" },
  { path: "/system/org", module: "users" },
  { path: "/system/users", module: "users" },
  { path: "/system/audit", module: "system" }
] as const;

export function moduleForRoute(pathname: string): string | null {
  const exact = routePermissionRules.find((item) => pathname === item.path);
  if (exact) return exact.module;
  const nested = routePermissionRules.find((item) => pathname.startsWith(`${item.path}/`));
  return nested?.module || null;
}
