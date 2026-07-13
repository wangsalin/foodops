export type PermissionValue = "none" | "read" | "manage" | "approve" | "feedback" | "request" | "publish" | "all" | "*";

export type PermissionMap = Record<string, PermissionValue | Record<string, boolean> | undefined>;

type StoredUser = {
  permissions?: PermissionMap;
};

const readLike = new Set<PermissionValue>(["read", "manage", "approve", "feedback", "request", "publish", "all", "*"]);

export function readStoredPermissions(): PermissionMap {
  if (typeof window === "undefined") return {};
  const raw = window.localStorage.getItem("foodops_user");
  if (!raw) return {};
  try {
    const user = JSON.parse(raw) as StoredUser;
    return user.permissions || {};
  } catch {
    return {};
  }
}

export function hasPermission(permissions: PermissionMap, module: string, required: PermissionValue = "read"): boolean {
  if (hasModulePermission(permissions.system, "manage")) return true;
  return hasModulePermission(permissions[module], required);
}

export function canRead(permissions: PermissionMap, module: string): boolean {
  return hasPermission(permissions, module, "read");
}

export function canManage(permissions: PermissionMap, module: string): boolean {
  return hasPermission(permissions, module, "manage");
}

function hasModulePermission(value: PermissionMap[string], required: PermissionValue): boolean {
  if (!value || value === "none") return false;
  if (typeof value === "string") {
    if (value === "manage" || value === "all" || value === "*") return true;
    if (required === "read") return readLike.has(value);
    return value === required;
  }
  if (value.manage || value["*"]) return true;
  if (value[required]) return true;
  if (required === "read") return ["read", "approve", "feedback", "request", "publish"].some((key) => value[key]);
  return false;
}
