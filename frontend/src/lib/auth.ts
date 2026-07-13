export function saveSession(token: string, user: unknown, refreshToken?: string) {
  window.localStorage.setItem("foodops_token", token);
  window.localStorage.setItem("foodops_user", JSON.stringify(user));
  if (refreshToken) {
    window.localStorage.setItem("foodops_refresh_token", refreshToken);
  }
}

export function saveStoreSession(token: string, user: unknown, refreshToken?: string) {
  window.localStorage.setItem("foodops_store_token", token);
  window.localStorage.setItem("foodops_store_user", JSON.stringify(user));
  if (refreshToken) {
    window.localStorage.setItem("foodops_store_refresh_token", refreshToken);
  }
}

export function clearSession() {
  window.localStorage.removeItem("foodops_token");
  window.localStorage.removeItem("foodops_refresh_token");
  window.localStorage.removeItem("foodops_user");
}

export function clearStoreSession() {
  window.localStorage.removeItem("foodops_store_token");
  window.localStorage.removeItem("foodops_store_refresh_token");
  window.localStorage.removeItem("foodops_store_user");
}

export function getRefreshToken() {
  return window.localStorage.getItem("foodops_refresh_token");
}

export function getStoreRefreshToken() {
  return window.localStorage.getItem("foodops_store_refresh_token");
}
