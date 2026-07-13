import { api } from "@/lib/api";
import { canRead, readStoredPermissions } from "@/lib/permissions";

export type BrandAsset = {
  system_name?: string | null;
  brand_name?: string | null;
  brand_short_name?: string | null;
  logo_url?: string | null;
  favicon_url?: string | null;
  primary_color?: string | null;
  accent_color?: string | null;
  font_cn?: string | null;
  font_en?: string | null;
  slogan?: string | null;
  tone?: string | null;
  forbidden_rules?: string | null;
  culture?: BrandCulture | null;
  expression?: BrandExpression | null;
  ai_policy?: BrandAiPolicy | null;
  brand_docs?: BrandDocs | null;
};

export type BrandCulture = {
  mission?: string;
  vision?: string;
  values?: string;
  brand_story?: string;
  business_philosophy?: string;
  service_philosophy?: string;
  service_promise?: string;
};

export type BrandExpression = {
  voice_keywords?: string;
  common_phrases?: string;
  banned_words?: string;
  customer_reply_style?: string;
  store_task_style?: string;
  report_style?: string;
};

export type BrandAiPolicy = {
  daily_report_rules?: string;
  attribution_rules?: string;
  operation_advice_rules?: string;
  output_boundaries?: string;
};

export type BrandDocs = {
  culture_manual_url?: string;
  service_manual_url?: string;
  training_manual_url?: string;
  visual_spec_url?: string;
};

export type BrandConfig = {
  systemName: string;
  brandName: string;
  brandShortName: string;
  logoUrl: string;
  logoSrc: string;
  faviconUrl: string;
  primaryColor: string;
  accentColor: string;
  fontCn: string;
  fontEn: string;
  slogan: string;
  tone: string;
  forbiddenRules: string;
  culture: BrandCulture;
  expression: BrandExpression;
  aiPolicy: BrandAiPolicy;
  brandDocs: BrandDocs;
};

export const defaultBrandConfig: BrandConfig = {
  systemName: "FoodOps Community",
  brandName: "FoodOps Demo Brand",
  brandShortName: "FoodOps",
  logoUrl: "/logo.svg",
  logoSrc: "/logo.svg",
  faviconUrl: "",
  primaryColor: "#3f7d3b",
  accentColor: "#8a6f3d",
  fontCn: "system-ui",
  fontEn: "Inter / system-ui",
  slogan: "Brand-owned operations data, alerts, tasks and feedback.",
  tone: "Calm, operational, auditable and local-first.",
  forbiddenRules: "Community demo data must remain fictional. External platform integrations are Enterprise plugins.",
  culture: {
    mission: "Help chain stores close operating issues with clear data and accountable tasks.",
    vision: "A local-first operations console every brand can inspect and extend.",
    values: "Transparent, practical, auditable.",
    brand_story: "FoodOps Community ships a fictional demo brand so teams can evaluate the operating loop safely.",
    business_philosophy: "Start from facts, create tasks, review outcomes.",
    service_philosophy: "Make store work visible and actionable.",
    service_promise: "No real customer data, no external API dependency, no hidden model calls."
  },
  expression: {
    voice_keywords: "clear, calm, specific",
    common_phrases: "dashboard, alert, task, feedback, audit",
    banned_words: "real customer names, private platform credentials, unsupported guarantees",
    customer_reply_style: "specific and accountable",
    store_task_style: "clear deadline, owner and acceptance criteria",
    report_style: "conclusion first, evidence second, action third"
  },
  aiPolicy: {
    daily_report_rules: "Use local deterministic summaries in Community.",
    attribution_rules: "Describe possible causes only when data supports them.",
    operation_advice_rules: "Every suggestion must map to a store, product, alert or task.",
    output_boundaries: "Do not call external models or invent unavailable data."
  },
  brandDocs: {
    culture_manual_url: "",
    service_manual_url: "",
    training_manual_url: "",
    visual_spec_url: ""
  }
};

export function resolveBrandAssetUrl(url?: string | null) {
  const value = (url || "").trim();
  if (!value) return defaultBrandConfig.logoSrc;
  if (/^(https?:|data:|blob:)/i.test(value)) return value;
  if (value.startsWith("/uploads/")) {
    const base = (api.defaults.baseURL || "").replace(/\/$/, "");
    return `${base}${value}`;
  }
  return value;
}

export function normalizeBrandConfig(data?: BrandAsset | null): BrandConfig {
  const logoUrl = data?.logo_url || defaultBrandConfig.logoUrl;
  return {
    systemName: data?.system_name || defaultBrandConfig.systemName,
    brandName: data?.brand_name || defaultBrandConfig.brandName,
    brandShortName: data?.brand_short_name || defaultBrandConfig.brandShortName,
    logoUrl,
    logoSrc: resolveBrandAssetUrl(logoUrl),
    faviconUrl: data?.favicon_url || defaultBrandConfig.faviconUrl,
    primaryColor: data?.primary_color || defaultBrandConfig.primaryColor,
    accentColor: data?.accent_color || defaultBrandConfig.accentColor,
    fontCn: data?.font_cn || defaultBrandConfig.fontCn,
    fontEn: data?.font_en || defaultBrandConfig.fontEn,
    slogan: data?.slogan || defaultBrandConfig.slogan,
    tone: data?.tone || defaultBrandConfig.tone,
    forbiddenRules: data?.forbidden_rules || defaultBrandConfig.forbiddenRules,
    culture: { ...defaultBrandConfig.culture, ...(data?.culture || {}) },
    expression: { ...defaultBrandConfig.expression, ...(data?.expression || {}) },
    aiPolicy: { ...defaultBrandConfig.aiPolicy, ...(data?.ai_policy || {}) },
    brandDocs: { ...defaultBrandConfig.brandDocs, ...(data?.brand_docs || {}) }
  };
}

export async function fetchBrandConfig() {
  const hasToken = typeof window !== "undefined" && !!window.localStorage.getItem("foodops_token");
  const canReadSystemBrand = hasToken && canRead(readStoredPermissions(), "system");
  const endpoint = canReadSystemBrand ? "/api/v1/brand-assets" : "/api/v1/brand-assets/public";
  const res = await api.get<BrandAsset | null>(endpoint);
  return normalizeBrandConfig(res.data);
}
