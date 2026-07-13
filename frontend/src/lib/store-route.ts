const STORE_ID_KEY = "foodops_store_active_store_id";

export function readActiveStoreId() {
  if (typeof window === "undefined") return "";
  const fromUrl = new URLSearchParams(window.location.search).get("store_id");
  return fromUrl || window.localStorage.getItem(STORE_ID_KEY) || "";
}

export function saveActiveStoreId(storeId: string) {
  if (typeof window === "undefined") return;
  if (storeId) {
    window.localStorage.setItem(STORE_ID_KEY, storeId);
  } else {
    window.localStorage.removeItem(STORE_ID_KEY);
  }
}

export function storeParams(extra?: Record<string, string | undefined>) {
  const params: Record<string, string> = {};
  const storeId = readActiveStoreId();
  if (storeId) params.store_id = storeId;
  Object.entries(extra || {}).forEach(([key, value]) => {
    if (value) params[key] = value;
  });
  return Object.keys(params).length ? params : undefined;
}

export function storeHref(path: string, storeId = readActiveStoreId()) {
  if (!storeId) return path;
  const [base, query = ""] = path.split("?");
  const params = new URLSearchParams(query);
  params.set("store_id", storeId);
  return `${base}?${params.toString()}`;
}
