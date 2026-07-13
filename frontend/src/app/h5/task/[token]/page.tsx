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
  pending_confirm: "å¾…ç¡®è®¤",
  confirmed: "å·²ç¡®è®¤",
  processing: "å¤„ç†ä¸­",
  pending_review: "å¾…å®¡æ ¸",
  closed: "å·²å…³é—­",
  archived: "å·²å½’æ¡£",
  overdue: "å·²é€¾æœŸ"
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
        setNotice("æœ¬æœºå­˜å‚¨ç©ºé—´ä¸è¶³ï¼Œè‰ç¨¿æš‚å­˜å¤±è´¥ã€‚è¯·å…ˆä¿ç•™æ–‡å­—å†…å®¹ï¼Œç½‘ç»œæ¢å¤åŽå°½å¿«æäº¤ã€‚");
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
      setNotice("ä»»åŠ¡é“¾æŽ¥æ— æ•ˆæˆ–å·²è¿‡æœŸï¼Œè¯·è”ç³»æ€»éƒ¨è¿è¥é‡æ–°å‘é€ã€‚");
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
          setNotice("ç½‘ç»œå·²æ¢å¤ï¼Œå¯ç»§ç»­æäº¤æš‚å­˜åé¦ˆã€‚");
        }
      }
    }

    function handleOffline() {
      setOnline(false);
      setNotice("å½“å‰ç¦»çº¿ï¼Œåé¦ˆä¼šå…ˆæš‚å­˜åˆ°æœ¬æœºã€‚");
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
      setNotice("å·²ç¡®è®¤æ”¶åˆ°ä»»åŠ¡ã€‚");
    } catch {
      setNotice("ç¡®è®¤å¤±è´¥ï¼Œè¯·ç¨åŽé‡è¯•æˆ–è”ç³»æ€»éƒ¨è¿è¥ã€‚");
    } finally {
      setSubmitting(false);
    }
  }, [params.token]);

  const startProcessing = useCallback(async () => {
    setSubmitting(true);
    try {
      const res = await api.post<RelayResponse>(`/api/v1/relay/tasks/${params.token}/start`);
      setData(res.data);
      setNotice("ä»»åŠ¡å·²è¿›å…¥å¤„ç†ä¸­ï¼Œè¯·å®Œæˆå¤„ç†åŽæäº¤åé¦ˆã€‚");
    } catch {
      setNotice("å¼€å§‹å¤„ç†å¤±è´¥ï¼Œè¯·ç¨åŽé‡è¯•æˆ–è”ç³»æ€»éƒ¨è¿è¥ã€‚");
    } finally {
      setSubmitting(false);
    }
  }, [params.token]);

  const submit = useCallback(async () => {
    if (task?.status !== "processing") {
      setNotice("è¯·å…ˆç¡®è®¤æ”¶åˆ°å¹¶å¼€å§‹å¤„ç†ä»»åŠ¡ï¼Œå†æäº¤åé¦ˆã€‚");
      return;
    }
    const trimmed = result.trim();
    if (!trimmed) {
      setNotice("è¯·è¾“å…¥å¤„ç†ç»“æžœã€‚");
      return;
    }
    if (!navigator.onLine) {
      saveDraft(trimmed, imageUrls, true, submitAttempts);
      setNotice("å½“å‰ç¦»çº¿ï¼Œåé¦ˆå·²æš‚å­˜ï¼Œç½‘ç»œæ¢å¤åŽå¯ç»§ç»­æäº¤ã€‚");
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
      setNotice("åé¦ˆå·²æäº¤ï¼Œç­‰å¾…æ€»éƒ¨å®¡æ ¸ã€‚");
    } catch (error) {
      const nextAttempts = submitAttempts + 1;
      saveDraft(trimmed, imageUrls, true, nextAttempts);
      setNotice(`${requestErrorMessage(error, "æäº¤å¤±è´¥")}ã€‚åé¦ˆå·²æš‚å­˜åˆ°æœ¬æœºï¼Œå¯ç¨åŽé‡è¯•ã€‚`);
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
      setNotice("å½“å‰ç¦»çº¿ï¼Œå›¾ç‰‡éœ€è”ç½‘åŽä¸Šä¼ ã€‚æ–‡å­—åé¦ˆå·²æš‚å­˜ã€‚");
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
            failures.push(`${file.name || "å›¾ç‰‡"} åŽ‹ç¼©åŽä»è¶…è¿‡ 5MB`);
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
          failures.push(`${file.name || "å›¾ç‰‡"}ï¼š${requestErrorMessage(error, "ä¸Šä¼ å¤±è´¥")}`);
        }
      }
      setUploadFailures(failures);
      if (failures.length && uploaded) {
        setNotice(`å·²ä¸Šä¼  ${uploaded} å¼ ï¼Œ${failures.length} å¼ å¤±è´¥ã€‚å¤±è´¥å›¾ç‰‡è¯·é‡æ–°é€‰æ‹©ä¸Šä¼ ã€‚`);
      } else if (failures.length) {
        setNotice("å›¾ç‰‡ä¸Šä¼ å¤±è´¥ï¼Œè¯·æ£€æŸ¥ç½‘ç»œåŽé‡æ–°é€‰æ‹©å›¾ç‰‡ã€‚");
      } else if (uploaded) {
        setNotice(`å·²ä¸Šä¼  ${uploaded} å¼ å›¾ç‰‡ã€‚`);
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
          <span className="h5-brand-dot">{brand.brandShortName.slice(0, 1) || "å±±"}</span>
          <span>{brand.brandShortName} {brand.systemName}</span>
        </div>
        <h1>åº—é•¿ä»»åŠ¡åé¦ˆ</h1>
        <p>å¤„ç†å®ŒæˆåŽæäº¤ç»“æžœï¼Œæ€»éƒ¨è¿è¥ä¼šè¿›å…¥å®¡æ ¸ã€‚</p>
      </section>

      {!online && <div className="h5-status-banner">å½“å‰ç¦»çº¿ï¼Œæ–‡å­—åé¦ˆä¼šæš‚å­˜åˆ°æœ¬æœº</div>}
      {notice && <div className="h5-status-banner">{notice}</div>}
      {draftSavedAt && canEditFeedback && (
        <div className={`h5-status-banner ${draftPending ? "pending" : "saved"}`}>
          {draftPending
            ? `æœ‰æœªæäº¤è‰ç¨¿ï¼Œæœ€è¿‘ä¿å­˜ ${formatDraftTime(draftSavedAt)}${submitAttempts ? `ï¼Œå·²é‡è¯• ${submitAttempts} æ¬¡` : ""}`
            : `è‰ç¨¿å·²ä¿å­˜ ${formatDraftTime(draftSavedAt)}`}
        </div>
      )}

      {loading ? (
        <div className="h5-native-card h5-loader">åŠ è½½ä»»åŠ¡ä¸­...</div>
      ) : task ? (
        <div className="h5-stack">
          <section className="h5-native-card">
            <div className="h5-task-top">
              <div>
                <span className="h5-kicker">é—¨åº—ä»»åŠ¡</span>
                <h2>{task.title}</h2>
                <p>{task.store_name || "æœªå…³è”é—¨åº—"} Â· {task.store_region || "æœªè®¾ç½®åŒºåŸŸ"}</p>
              </div>
              <span className={`h5-pill ${task.priority === "high" ? "danger" : ""}`}>{task.priority === "high" ? "é«˜ä¼˜å…ˆçº§" : "æ™®é€š"}</span>
            </div>

            <div className="h5-meta-grid native">
              <div><span>çŠ¶æ€</span><b>{statusLabel[task.status] || task.status}</b></div>
              <div><span>è´Ÿè´£äºº</span><b>{task.assignee_name || "å¾…æŒ‡æ´¾"}</b></div>
              <div><span>æˆªæ­¢</span><b>{formatDate(task.due_at) || "æœªè®¾ç½®"}</b></div>
              <div><span>åˆ›å»º</span><b>{formatDate(task.created_at)}</b></div>
            </div>

            {task.alert_summary && (
              <div className="h5-alert">
                <span>å¼‚å¸¸è¯´æ˜Ž</span>
                <p>{task.alert_summary}</p>
              </div>
            )}
          </section>

          <section className="h5-native-card">
            <div className="h5-section-head">
              <h2>å¤„ç†åé¦ˆ</h2>
              {locked && <span className="h5-pill">å·²æäº¤</span>}
              {task.status === "pending_confirm" && <span className="h5-pill">å¾…ç¡®è®¤</span>}
              {task.status === "confirmed" && <span className="h5-pill">å·²ç¡®è®¤</span>}
            </div>
            {isReturnedForRework && (
              <div className="h5-review-note">
                <span>æ€»éƒ¨é©³å›žåŽŸå› </span>
                <p>{reviewResult.reviewNote}</p>
              </div>
            )}
            {isReturnedForRework && reviewResult.feedback && (
              <div className="h5-previous-feedback">
                <span>ä¸Šæ¬¡æäº¤å†…å®¹</span>
                <p>{reviewResult.feedback}</p>
                {task.feedback_img_urls?.length ? (
                  <div className="h5-image-grid previous">
                    {task.feedback_img_urls.map((url) => (
                      <div className="h5-image-item" key={url}>
                        <img src={assetUrl(url)} alt="ä¸Šæ¬¡åé¦ˆå›¾ç‰‡" />
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            )}
            {task.status === "pending_confirm" && (
              <div className="h5-alert">
                <span>{isReturnedForRework ? "é‡æ–°æ•´æ”¹" : "ä¸‹ä¸€æ­¥"}</span>
                <p>{isReturnedForRework ? "è¯·å…ˆç¡®è®¤æ”¶åˆ°é©³å›žæ„è§ï¼Œå†å¼€å§‹è¡¥å……æ•´æ”¹ã€‚æ€»éƒ¨ä¼šçœ‹åˆ°æœ¬æ¬¡ä»»åŠ¡å·²é‡æ–°æŽ¥æ”¶ã€‚" : "è¯·å…ˆç¡®è®¤æ”¶åˆ°ä»»åŠ¡ï¼Œæ€»éƒ¨ä¼šçœ‹åˆ°ä»»åŠ¡å·²è¢«æŽ¥æ”¶ã€‚"}</p>
                <button className="h5-submit" type="button" disabled={submitting} onClick={confirmTask}>
                  {submitting ? "ç¡®è®¤ä¸­..." : isReturnedForRework ? "ç¡®è®¤æ”¶åˆ°é©³å›žæ„è§" : "ç¡®è®¤æ”¶åˆ°"}
                </button>
              </div>
            )}
            {task.status === "confirmed" && (
              <div className="h5-alert">
                <span>{isReturnedForRework ? "è¡¥å……å¤„ç†" : "ä¸‹ä¸€æ­¥"}</span>
                <p>{isReturnedForRework ? "å¼€å§‹å¤„ç†åŽï¼Œè¯·å¡«å†™æœ¬æ¬¡è¡¥å……æ•´æ”¹ç»“æžœå¹¶ä¸Šä¼ æ–°çš„å‡­è¯å›¾ç‰‡ã€‚" : "å¼€å§‹å¤„ç†åŽå³å¯å¡«å†™å¤„ç†ç»“æžœå¹¶æäº¤æ€»éƒ¨å®¡æ ¸ã€‚"}</p>
                <button className="h5-submit" type="button" disabled={submitting} onClick={startProcessing}>
                  {submitting ? "å¤„ç†ä¸­..." : isReturnedForRework ? "å¼€å§‹è¡¥å……æ•´æ”¹" : "å¼€å§‹å¤„ç†"}
                </button>
              </div>
            )}
            <textarea
              value={result}
              disabled={!canEditFeedback}
              rows={7}
              placeholder={isReturnedForRework ? "è¯·å¡«å†™æœ¬æ¬¡è¡¥å……æ•´æ”¹ç»“æžœï¼Œä¾‹å¦‚ï¼šå·²æŒ‰æ€»éƒ¨æ„è§é‡æ–°æ‹æ‘„æ•´æ”¹ç…§ç‰‡ï¼Œå¹¶è¡¥å……æ™šé«˜å³°æŽ’ç­å¤ç›˜ã€‚" : "ä¾‹å¦‚ï¼šå·²æ ¸æŸ¥å¤–å–æ´»åŠ¨é…ç½®ï¼Œæ™šé«˜å³°å¢žåŠ  1 åæŽ’ç­ï¼Œå¹¶å®Œæˆé—¨åº—å¤ç›˜ã€‚"}
              onChange={(event) => {
                setResult(event.target.value);
                saveDraft(event.target.value, imageUrls, draftPending);
              }}
            />

            <div className="h5-upload-row">
              <label className={`h5-upload-button ${!canEditFeedback || uploading ? "disabled" : ""}`}>
                {uploading ? "ä¸Šä¼ ä¸­..." : "æ·»åŠ å›¾ç‰‡"}
                <input type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={!canEditFeedback || uploading} onChange={handleImageChange} />
              </label>
              <span>{imageUrls.length}/6 Â· å•å¼ åŽ‹ç¼©åŽä¸è¶…è¿‡ 5MB</span>
            </div>

            {uploadFailures.length > 0 && (
              <div className="h5-upload-failures">
                <b>ä¸Šä¼ å¤±è´¥</b>
                {uploadFailures.slice(0, 3).map((item) => <span key={item}>{item}</span>)}
                {uploadFailures.length > 3 ? <span>è¿˜æœ‰ {uploadFailures.length - 3} å¼ å¤±è´¥ï¼Œè¯·é‡æ–°é€‰æ‹©ä¸Šä¼ ã€‚</span> : null}
              </div>
            )}

            {imageUrls.length > 0 && (
              <div className="h5-image-grid">
                {imageUrls.map((url) => (
                  <div className="h5-image-item" key={url}>
                    <img src={assetUrl(url)} alt="åé¦ˆå›¾ç‰‡" />
                    {canEditFeedback && <button type="button" onClick={() => removeImage(url)}>åˆ é™¤</button>}
                  </div>
                ))}
              </div>
            )}

            <button className="h5-submit" type="button" disabled={!canEditFeedback || submitting} onClick={submit}>
              {locked
                ? "åé¦ˆå·²æäº¤"
                : task.status !== "processing"
                  ? "è¯·å…ˆç¡®è®¤å¹¶å¼€å§‹å¤„ç†"
                  : submitting
                    ? "æäº¤ä¸­..."
                    : draftPending
                      ? "ç»§ç»­æäº¤æš‚å­˜åé¦ˆ"
                      : isReturnedForRework
                        ? "æäº¤è¡¥å……æ•´æ”¹"
                        : "æäº¤åé¦ˆ"}
            </button>
          </section>
        </div>
      ) : (
        <section className="h5-native-card">
          <h2>ä»»åŠ¡ä¸å¯è®¿é—®</h2>
          <p>é“¾æŽ¥æ— æ•ˆã€å·²è¿‡æœŸæˆ–ä»»åŠ¡å·²å…³é—­ï¼Œè¯·è”ç³»æ€»éƒ¨è¿è¥ã€‚</p>
        </section>
      )}
    </main>
  );
}

function splitReviewResult(result?: string) {
  const [feedback, ...reviewParts] = String(result || "").split(/\n\nå®¡æ ¸æ„è§ï¼š/);
  return {
    feedback: feedback.trim(),
    reviewNote: reviewParts.join("\n\nå®¡æ ¸æ„è§ï¼š").trim()
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
    if (error.message.includes("timeout")) return "ç½‘ç»œè¶…æ—¶";
    if (error.message.includes("Network")) return "ç½‘ç»œè¿žæŽ¥å¼‚å¸¸";
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

