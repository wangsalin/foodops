import type { PermissionValue } from "@/lib/permissions";

export type RolePermissionValue = "none" | "read" | "manage" | "approve" | "feedback";

export type RolePermissionModule = {
  key: string;
  label: string;
  values: readonly RolePermissionValue[];
};

export const permissionValueLabel: Record<RolePermissionValue, string> = {
  none: "无权限",
  read: "只读",
  manage: "管理",
  approve: "审核",
  feedback: "反馈"
};

export const permissionValueColor: Record<RolePermissionValue, string> = {
  none: "default",
  read: "blue",
  manage: "green",
  approve: "purple",
  feedback: "gold"
};

export const rolePermissionModules: readonly RolePermissionModule[] = [
  { key: "dashboard", label: "经营看板", values: ["none", "read"] },
  { key: "stores", label: "门店档案", values: ["none", "read", "manage"] },
  { key: "products", label: "产品档案", values: ["none", "read", "manage"] },
  { key: "materials", label: "原料与供应商", values: ["none", "read", "manage"] },
  { key: "imports", label: "数据导入", values: ["none", "read", "manage"] },
  { key: "alerts", label: "异常预警", values: ["none", "read", "manage", "approve"] },
  { key: "tasks", label: "任务闭环", values: ["none", "read", "manage", "approve", "feedback"] },
  { key: "notifications", label: "系统通知", values: ["none", "read", "manage"] },
  { key: "users", label: "组织与人员", values: ["none", "read", "manage"] },
  { key: "audit", label: "审计日志", values: ["none", "read"] },
  { key: "system", label: "系统设置", values: ["none", "read", "manage"] }
] as const;

export function createDefaultRolePermissions(): Record<string, RolePermissionValue> {
  return rolePermissionModules.reduce<Record<string, RolePermissionValue>>((acc, item) => {
    acc[item.key] = item.key === "dashboard" ? "read" : "none";
    return acc;
  }, {});
}

export function normalizeRolePermissionValue(value: PermissionValue | string | undefined): RolePermissionValue {
  if (value === "read" || value === "manage" || value === "approve" || value === "feedback") {
    return value;
  }
  return "none";
}

export function rolePermissionLabel(value: PermissionValue | string | undefined): string {
  return permissionValueLabel[normalizeRolePermissionValue(value)];
}

export function rolePermissionColor(value: PermissionValue | string | undefined): string {
  return permissionValueColor[normalizeRolePermissionValue(value)];
}
