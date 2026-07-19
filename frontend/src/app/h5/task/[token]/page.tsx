"use client";

/* eslint-disable @next/next/no-img-element */

import { ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";

import { api } from "@/lib/api";
import { useBrandConfig } from "@/lib/useBrandConfig";

type RelayTask = {
  id: string;
  source_type?: string;
  source_id?: string;
  title: string;
  status: string;
  priority: string;
  result?: string;
  feedback_img_urls?: string[];
  assignee_name?: string;
  store_name?: string;
  store_region?: string;
  alert_level?: string;
  alert_summary?: string;
  due_at?: string;
  created_at: string;
};

type RelayResponse = {
  token_status: string;
  task: RelayTask;
};

type DraftFeedback = {
  result: string;
  imageUrls: string[];
  pending: boolean;
  updatedAt?: string;
  submitAttempts?: number;
};

const statusLabel: Record<string, string> = {
  pending_confirm: "待确认",
  confirmed: "已确认",
  processing: "处理中",
  pending_review: "待审核",
  closed: "已关闭",
  archived: "已归档",
  overdue: "已逾期"
};

const maxImageBytes = 5 * 1024 * 1024;

export default function H5TaskPage({ params }: { params: { token: string } }) {
  const brand = useBrandConfig();
  const draftKey = useMemo(() => `foodops_h5_feedback_${params.token.slice(0, 48)}`, [params.token]);
  const [data, setData] = useState<RelayResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState("");
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [draftPending, setDraftPending] = useState(false);
  const [draftSavedAt, setDraftSavedAt] = useState("");
  const [submitAttempts, setSubmitAttempts] = useState(0);
  const [uploadFailures, setUploadFailures] = useState<string[]>([]);
  const [online, setOnline] = useState(true);

  const saveDraft = useCallback(
    (nextResult: string, nextImageUrls: string[], pending: boolean, attempts = submitAttempts) => {
      const updatedAt = new Date().toISOString();
      const draft: DraftFeedback = { result: nextResult, imageUrls: nextImageUrls, pending, updatedAt, submitAttempts: attempts };
      try {
        window.localStorage.setItem(draftKey, JSON.stringify(draft));
        setDraftPending(pending);
        setDraftSavedAt(updatedAt);
        setSubmitAttempts(attempts);
      } catch {
        setNotice("本机存储空间不足,草稿暂存失败。请先保留文字内容,网络恢复后尽快提交。");
      }
    },
    [draftKey, submitAttempts]
  );

  const clearDraft = useCallback(() => {
    window.localStorage.removeItem(draftKey);
    setDraftPending(false);
    setDraftSavedAt("");
    setSubmitAttempts(0);
  }, [draftKey]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<RelayResponse>(`/api/v1/relay/tasks/${params.token}`);
      setData(res.data);
      const task = res.data.task;
      const rawDraft = window.localStorage.getItem(draftKey);
      const draft = parseDraft(rawDraft);
      const reviewResult = splitReviewResult(task.result);
      const isReturnedForRework = ["pending_confirm", "confirmed", "processing"].includes(task.status) && Boolean(reviewResult.reviewNote);
      setResult(isReturnedForRework ? draft?.result || "" : task.result || draft?.result || "");
      setImageUrls(isReturnedForRework ? draft?.imageUrls || [] : task.feedback_img_urls?.length ? task.feedback_img_urls : draft?.imageUrls || []);
      setDraftPending(Boolean(draft?.pending));
      setDraftSavedAt(draft?.updatedAt || "");
      setSubmitAttempts(draft?.submitAttempts || 0);
    } catch {
      setNotice("任务链接无效或已过期,请联系总部运营重新发送。");
    } finally {
      setLoading(false);
    }
  }, [draftKey, params.token]);

  useEffect(() => {
    setOnline(navigator.onLine);
    load();

    function handleOnline() {
      setOnline(true);
      const rawDraft = window.localStorage.getItem(draftKey);
      if (rawDraft) {
        const draft = parseDraft(rawDraft);
        if (draft?.pending) {
          setNotice("网络已恢复,可继续提交暂存反馈。");
        }
      }
    }

    function handleOffline() {
      setOnline(false);
      setNotice("当前离线,反馈会先暂存到本机。");
    }

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [draftKey, load]);

  const task = data?.task;
  const reviewResult = useMemo(() => splitReviewResult(task?.result), [task?.result]);
  const isReturnedForRework = Boolean(
    task && ["pending_confirm", "confirmed", "processing"].includes(task.status) && reviewResult.reviewNote
  );
  const locked = data?.token_status === "feedback_submitted" || task?.status === "pending_review" || task?.status === "closed";
  const canEditFeedback = task?.status === "processing" && !locked;

  const confirmTask = useCallback(async () => {
    setSubmitting(true);
    try {
      const res = await api.post<RelayResponse>(`/api/v1/relay/tasks/${params.token}/confirm`);
      setData(res.data);
      setNotice("已确认收到任务。");
    } catch {
      setNotice("确认失败,请稍后重试或联系总部运营。");
    } finally {
      setSubmitting(false);
    }
  }, [params.token]);

  const startProcessing = useCallback(async () => {
    setSubmitting(true);
    try {
      const res = await api.post<RelayResponse>(`/api/v1/relay/tasks/${params.token}/start`);
      setData(res.data);
      setNotice("任务已进入处理中,请完成处理后提交反馈。");
    } catch {
      setNotice("开始处理失败,请稍后重试或联系总部运营。");
    } finally {
      setSubmitting(false);
    }
  }, [params.token]);

  const submit = useCallback(async () => {
    if (task?.status !== "processing") {
      setNotice("请先确认收到并开始处理任务,再提交反馈。");
      return;
    }
    const trimmed = result.trim();
    if (!trimmed) {
      setNotice("请输入处理结果。");
      return;
    }
    if (!navigator.onLine) {
      saveDraft(trimmed, imageUrls, true, submitAttempts);
      setNotice("当前离线,反馈已暂存,网络恢复后可继续提交。");
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.post<RelayResponse>(`/api/v1/relay/tasks/${params.token}/feedback`, {
        result: trimmed,
        feedback_img_urls: imageUrls
      });
      setData(res.data);
      clearDraft();
      setNotice("反馈已提交,等待总部审核。");
    } catch (error) {
      const nextAttempts = submitAttempts + 1;
      saveDraft(trimmed, imageUrls, true, nextAttempts);
      setNotice(`${requestErrorMessage(error, "提交失败")}。反馈已暂存到本机,可稍后重试。`);
    } finally {
      setSubmitting(false);
    }
  }, [clearDraft, imageUrls, params.token, result, saveDraft, submitAttempts, task?.status]);

  async function handleImageChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length || !canEditFeedback) return;
    setUploadFailures([]);
    if (!navigator.onLine) {
      setNotice("当前离线,图片需联网后上传。文字反馈已暂存。");
      saveDraft(result, imageUrls, draftPending);
      return;
    }

    setUploading(true);
    const failures: string[] = [];
    let uploaded = 0;
    try {
      for (const file of files.slice(0, Math.max(0, 6 - imageUrls.length))) {
        try {
          const compressed = await compressImage(file);
          if (compressed.size > maxImageBytes) {
            failures.push(`${file.name || "图片"} 压缩后仍超过 5MB`);
            continue;
          }

          const formData = new FormData();
          formData.append("relay_token", params.token);
          formData.append("file", compressed, `feedback-${Date.now()}.webp`);
          const res = await api.post<{ url: string }>("/api/v1/uploads/images", formData);
          uploaded += 1;
          setImageUrls((prev) => {
            const next = [...prev, res.data.url];
            saveDraft(result, next, draftPending);
            return next;
          });
        } catch (error) {
          failures.push(`${file.name || "图片"}:${requestErrorMessage(error, "上传失败")}`);
        }
      }
      setUploadFailures(failures);
      if (failures.length && uploaded) {
        setNotice(`已上传 ${uploaded} 张,${failures.length} 张失败。失败图片请重新选择上传。`);
      } else if (failures.length) {
        setNotice("图片上传失败,请检查网络后重新选择图片。");
      } else if (uploaded) {
        setNotice(`已上传 ${uploaded} 张图片。`);
      }
    } finally {
      setUploading(false);
    }
  }

  function removeImage(url: string) {
    setImageUrls((prev) => {
      const next = prev.filter((item) => item !== url);
      saveDraft(result, next, draftPending);
      return next;
    });
  }

  return (
    <main className="h5-shell">
      <section className="h5-mobile-header">
        <div className="h5-brand-row">
          <span className="h5-brand-dot">{brand.brandShortName.slice(0, 1) || "山"}</span>
          <span>{brand.brandShortName} {brand.systemName}</span>
        </div>
        <h1>店长任务反馈</h1>
        <p>处理完成后提交结果,总部运营会进入审核。</p>
      </section>

      {!online && <div className="h5-status-banner">当前离线,文字反馈会暂存到本机</div>}
      {notice && <div className="h5-status-banner">{notice}</div>}
      {draftSavedAt && canEditFeedback && (
        <div className={`h5-status-banner ${draftPending ? "pending" : "saved"}`}>
          {draftPending
            ? `有未提交草稿,最近保存 ${formatDraftTime(draftSavedAt)}${submitAttempts ? `,已重试 ${submitAttempts} 次` : ""}`
            : `草稿已保存 ${formatDraftTime(draftSavedAt)}`}
        </div>
      )}

      {loading ? (
        <div className="h5-native-card h5-loader">加载任务中...</div>
      ) : task ? (
        <div className="h5-stack">
          <section className="h5-native-card">
            <div className="h5-task-top">
              <div>
                <span className="h5-kicker">门店任务</span>
                <h2>{task.title}</h2>
                <p>{task.store_name || "未关联门店"} · {task.store_region || "未设置区域"}</p>
              </div>
              <span className={`h5-pill ${task.priority === "high" ? "danger" : ""}`}>{task.priority === "high" ? "高优先级" : "普通"}</span>
            </div>

            <div className="h5-meta-grid native">
              <div><span>状态</span><b>{statusLabel[task.status] || task.status}</b></div>
              <div><span>负责人</span><b>{task.assignee_name || "待指派"}</b></div>
              <div><span>截止</span><b>{formatDate(task.due_at) || "未设置"}</b></div>
              <div><span>创建</span><b>{formatDate(task.created_at)}</b></div>
            </div>

            {task.alert_summary && (
              <div className="h5-alert">
                <span>异常说明</span>
                <p>{task.alert_summary}</p>
              </div>
            )}
          </section>

          <section className="h5-native-card">
            <div className="h5-section-head">
              <h2>处理反馈</h2>
              {locked && <span className="h5-pill">已提交</span>}
              {task.status === "pending_confirm" && <span className="h5-pill">待确认</span>}
              {task.status === "confirmed" && <span className="h5-pill">已确认</span>}
            </div>
            {isReturnedForRework && (
              <div className="h5-review-note">
                <span>总部驳回原因</span>
                <p>{reviewResult.reviewNote}</p>
              </div>
            )}
            {isReturnedForRework && reviewResult.feedback && (
              <div className="h5-previous-feedback">
                <span>上次提交内容</span>
                <p>{reviewResult.feedback}</p>
                {task.feedback_img_urls?.length ? (
                  <div className="h5-image-grid previous">
                    {task.feedback_img_urls.map((url) => (
                      <div className="h5-image-item" key={url}>
                        <img src={assetUrl(url)} alt="上次反馈图片" />
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            )}
            {task.status === "pending_confirm" && (
              <div className="h5-alert">
                <span>{isReturnedForRework ? "重新整改" : "下一步"}</span>
                <p>{isReturnedForRework ? "请先确认收到驳回意见,再开始补充整改。总部会看到本次任务已重新接收。" : "请先确认收到任务,总部会看到任务已被接收。"}</p>
                <button className="h5-submit" type="button" disabled={submitting} onClick={confirmTask}>
                  {submitting ? "确认中..." : isReturnedForRework ? "确认收到驳回意见" : "确认收到"}
                </button>
              </div>
            )}
            {task.status === "confirmed" && (
              <div className="h5-alert">
                <span>{isReturnedForRework ? "补充处理" : "下一步"}</span>
                <p>{isReturnedForRework ? "开始处理后,请填写本次补充整改结果并上传新的凭证图片。" : "开始处理后即可填写处理结果并提交总部审核。"}</p>
                <button className="h5-submit" type="button" disabled={submitting} onClick={startProcessing}>
                  {submitting ? "处理中..." : isReturnedForRework ? "开始补充整改" : "开始处理"}
                </button>
              </div>
            )}
            <textarea
              value={result}
              disabled={!canEditFeedback}
              rows={7}
              placeholder={isReturnedForRework ? "请填写本次补充整改结果,例如:已按总部意见重新拍摄整改照片,并补充晚高峰排班复盘。" : "例如:已核查外卖活动配置,晚高峰增加 1 名排班,并完成门店复盘。"}
              onChange={(event) => {
                setResult(event.target.value);
                saveDraft(event.target.value, imageUrls, draftPending);
              }}
            />

            <div className="h5-upload-row">
              <label className={`h5-upload-button ${!canEditFeedback || uploading ? "disabled" : ""}`}>
                {uploading ? "上传中..." : "添加图片"}
                <input type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={!canEditFeedback || uploading} onChange={handleImageChange} />
              </label>
              <span>{imageUrls.length}/6 · 单张压缩后不超过 5MB</span>
            </div>

            {uploadFailures.length > 0 && (
              <div className="h5-upload-failures">
                <b>上传失败</b>
                {uploadFailures.slice(0, 3).map((item) => <span key={item}>{item}</span>)}
                {uploadFailures.length > 3 ? <span>还有 {uploadFailures.length - 3} 张失败,请重新选择上传。</span> : null}
              </div>
            )}

            {imageUrls.length > 0 && (
              <div className="h5-image-grid">
                {imageUrls.map((url) => (
                  <div className="h5-image-item" key={url}>
                    <img src={assetUrl(url)} alt="反馈图片" />
                    {canEditFeedback && <button type="button" onClick={() => removeImage(url)}>删除</button>}
                  </div>
                ))}
              </div>
            )}

            <button className="h5-submit" type="button" disabled={!canEditFeedback || submitting} onClick={submit}>
              {locked
                ? "反馈已提交"
                : task.status !== "processing"
                  ? "请先确认并开始处理"
                  : submitting
                    ? "提交中..."
                    : draftPending
                      ? "继续提交暂存反馈"
                      : isReturnedForRework
                        ? "提交补充整改"
                        : "提交反馈"}
            </button>
          </section>
        </div>
      ) : (
        <section className="h5-native-card">
          <h2>任务不可访问</h2>
          <p>链接无效、已过期或任务已关闭,请联系总部运营。</p>
        </section>
      )}
    </main>
  );
}

function splitReviewResult(result?: string) {
  const [feedback, ...reviewParts] = String(result || "").split(/\n\n审核意见:/);
  return {
    feedback: feedback.trim(),
    reviewNote: reviewParts.join("\n\n审核意见:").trim()
  };
}

function parseDraft(rawDraft: string | null): DraftFeedback | null {
  if (!rawDraft) return null;
  try {
    const draft = JSON.parse(rawDraft) as DraftFeedback;
    if (!draft || typeof draft !== "object") return null;
    return {
      result: typeof draft.result === "string" ? draft.result : "",
      imageUrls: Array.isArray(draft.imageUrls) ? draft.imageUrls.filter((item) => typeof item === "string") : [],
      pending: Boolean(draft.pending),
      updatedAt: typeof draft.updatedAt === "string" ? draft.updatedAt : "",
      submitAttempts: typeof draft.submitAttempts === "number" ? draft.submitAttempts : 0
    };
  } catch {
    return null;
  }
}

function formatDraftTime(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function requestErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "response" in error) {
    const data = (error as { response?: { data?: { message?: string; detail?: string } } }).response?.data;
    if (data?.message) return data.message;
    if (typeof data?.detail === "string") return data.detail;
  }
  if (error instanceof Error && error.message) {
    if (error.message.includes("timeout")) return "网络超时";
    if (error.message.includes("Network")) return "网络连接异常";
  }
  return fallback;
}

function assetUrl(url: string) {
  if (url.startsWith("http")) return url;
  return `${api.defaults.baseURL}${url}`;
}

function formatDate(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}


async function compressImage(file: File): Promise<Blob> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error("Unsupported image type");
  }

  const image = await loadImage(file);
  const maxSide = 1600;
  const ratio = Math.min(1, maxSide / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * ratio));
  const height = Math.max(1, Math.round(image.height * ratio));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is not available");
  context.drawImage(image, 0, 0, width, height);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Image compression failed"));
          return;
        }
        resolve(blob);
      },
      "image/webp",
      0.82
    );
  });
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image load failed"));
    };
    image.src = url;
  });
}
