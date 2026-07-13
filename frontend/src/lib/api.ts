import axios from "axios";

import { clearSession, clearStoreSession, getRefreshToken, getStoreRefreshToken, saveSession, saveStoreSession } from "@/lib/auth";

const LOCAL_API_BASE_URL = "http://127.0.0.1:23101";

const resolveApiBaseUrl = () => {
  const configuredBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  if (configuredBaseUrl) return configuredBaseUrl.replace(/\/$/, "");

  if (typeof window !== "undefined") {
    const { hostname, origin } = window.location;
    const isLocalHost = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
    if (!isLocalHost) return origin;
  }

  return LOCAL_API_BASE_URL;
};

const API_BASE_URL = resolveApiBaseUrl();

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000
});

api.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const requestUrl = config.url || "";
    if (requestUrl.includes("/auth/login")) {
      delete config.headers.Authorization;
      return config;
    }

    const token = shouldUseStoreToken(requestUrl)
      ? window.localStorage.getItem("foodops_store_token")
      : window.localStorage.getItem("foodops_token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config as (typeof error.config & { _retry?: boolean }) | undefined;
    const status = error.response?.status;
    const requestUrl = original?.url || "";
    const storeRequest = shouldUseStoreToken(requestUrl);
    if (
      typeof window === "undefined" ||
      status !== 401 ||
      !original ||
      original._retry ||
      requestUrl.includes("/auth/login") ||
      requestUrl.includes("/auth/refresh")
    ) {
      return Promise.reject(error);
    }

    const refreshToken = storeRequest ? getStoreRefreshToken() : getRefreshToken();
    const accessToken = window.localStorage.getItem(storeRequest ? "foodops_store_token" : "foodops_token");
    if (!refreshToken) {
      storeRequest ? clearStoreSession() : clearSession();
      redirectAfterAuthFailure(storeRequest);
      return Promise.reject(error);
    }

    try {
      original._retry = true;
      const refreshPath = storeRequest ? "/api/v1/store/auth/refresh" : "/api/v1/auth/refresh";
      const { data } = await axios.post(
        `${API_BASE_URL}${refreshPath}`,
        { refresh_token: refreshToken, access_token: accessToken },
        { timeout: 30000 }
      );
      if (storeRequest) {
        saveStoreSession(data.access_token, data.user, data.refresh_token);
      } else {
        saveSession(data.access_token, data.user, data.refresh_token);
      }
      original.headers = original.headers || {};
      original.headers.Authorization = `Bearer ${data.access_token}`;
      if (requestUrl.includes("/auth/logout")) {
        original.data = JSON.stringify({ refresh_token: data.refresh_token });
      }
      return api(original);
    } catch (refreshError) {
      storeRequest ? clearStoreSession() : clearSession();
      redirectAfterAuthFailure(storeRequest);
      return Promise.reject(refreshError);
    }
  }
);

function isStoreRequest(url: string) {
  const path = requestPath(url);
  return (
    path === "/api/v1/store" ||
    path.startsWith("/api/v1/store/") ||
    path.startsWith("/api/v1/uploads/store-task-feedback") ||
    path.startsWith("/api/v1/uploads/store-social-publish-screenshot")
  );
}

function shouldUseStoreToken(url: string) {
  const path = requestPath(url);
  if (isStoreRequest(url)) return true;
  if (typeof window === "undefined") return false;
  return path.startsWith("/api/v1/knowledge") && window.location.pathname.startsWith("/store");
}

function requestPath(url: string) {
  try {
    return new URL(url, API_BASE_URL).pathname;
  } catch {
    return url.split("?")[0] || url;
  }
}

function redirectAfterAuthFailure(storeRequest: boolean) {
  if (typeof window === "undefined") return;
  const targetPath = storeRequest ? "/store/login" : "/login";
  window.dispatchEvent(new CustomEvent("foodops:session-expired", { detail: { storeRequest } }));
  if (window.location.pathname !== targetPath) {
    window.location.assign(targetPath);
  }
}
