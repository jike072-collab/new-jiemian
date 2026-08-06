"use client";

import { Check, Copy, FileText, Film, LoaderCircle, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type SyntheticEvent } from "react";

import { ApiError, fetchJson } from "@/lib/client/api";
import type { LibraryItem } from "@/lib/server/types";
import type { TikTokConnectionSummary, TikTokPublicPublishJob, TikTokPublishStatus } from "@/lib/server/tiktok/types";
import {
  formatShanghaiDate,
  formatShanghaiTime,
  groupTodayTikTokCaptionJobs,
} from "@/lib/tiktok-caption-dashboard";
import { cn } from "@/lib/utils";

type ConnectionResponse = { connections: TikTokConnectionSummary[] };
type JobsResponse = { jobs: TikTokPublicPublishJob[] };
const activeStatuses = new Set<TikTokPublishStatus>(["scheduled", "queued", "uploading", "processing"]);

export function CanvasTikTokCaptions({ scope, library, onClose }: {
  scope: "personal" | "shared";
  library: LibraryItem[];
  onClose: () => void;
}) {
  const [connections, setConnections] = useState<TikTokConnectionSummary[]>([]);
  const [jobs, setJobs] = useState<TikTokPublicPublishJob[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [copiedJobId, setCopiedJobId] = useState("");
  const [loadedAt, setLoadedAt] = useState(() => new Date());
  const loadingRef = useRef(false);

  const load = useCallback(async (background = false) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    if (background) setRefreshing(true);
    else setLoading(true);
    try {
      const [connectionResponse, jobsResponse] = await Promise.all([
        fetchJson<ConnectionResponse>("/api/tiktok/connection"),
        fetchJson<JobsResponse>("/api/tiktok/publish"),
      ]);
      setConnections(connectionResponse.connections || []);
      setJobs(jobsResponse.jobs || []);
      setLoadedAt(new Date());
      setError("");
    } catch (loadError) {
      setError(readErrorMessage(loadError));
    } finally {
      loadingRef.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const initialTimer = window.setTimeout(() => { void load(); }, 0);
    const refreshTimer = window.setInterval(() => { void load(true); }, 5_000);
    const refreshOnFocus = () => { void load(true); };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void load(true);
    };
    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(refreshTimer);
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [load]);

  const accountGroups = useMemo(
    () => groupTodayTikTokCaptionJobs(connections, jobs, loadedAt),
    [connections, jobs, loadedAt],
  );
  const todayTotal = useMemo(
    () => accountGroups.reduce((total, account) => total + account.jobs.length, 0),
    [accountGroups],
  );
  const selectedAccount = accountGroups.find((account) => account.accountId === selectedAccountId) || accountGroups[0];
  const libraryById = useMemo(() => new Map(library.map((item) => [item.id, item])), [library]);
  const hasActiveJobs = jobs.some((job) => activeStatuses.has(job.status));

  const copyCaption = async (job: TikTokPublicPublishJob) => {
    if (!job.caption.trim()) return;
    try {
      await writeClipboard(job.caption);
      setCopiedJobId(job.id);
      window.setTimeout(() => setCopiedJobId((current) => current === job.id ? "" : current), 1_600);
    } catch {
      setError("文案复制失败，请长按文案手动复制。");
    }
  };

  return (
    <div className="canvas-tiktok-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="canvas-tiktok-panel canvas-tiktok-captions" role="dialog" aria-modal="true" aria-label="今日发布文案">
        <header className="canvas-tiktok-panel__header">
          <div>
            <FileText />
            <span><strong>今日文案</strong><small>{formatShanghaiDate(loadedAt)} · {todayTotal} 条</small></span>
          </div>
          <div className="canvas-tiktok-captions__header-actions">
            <button type="button" aria-label="刷新文案" title="刷新" disabled={refreshing} onClick={() => { void load(true); }}>
              <RefreshCw className={refreshing ? "is-spinning" : undefined} />
            </button>
            <button type="button" aria-label="关闭今日文案" title="关闭" onClick={onClose}><X /></button>
          </div>
        </header>

        {loading ? (
          <div className="canvas-tiktok-panel__loading"><LoaderCircle className="is-spinning" /><span>正在读取今日发布记录</span></div>
        ) : null}

        {!loading && error && !accountGroups.length ? (
          <div className="canvas-tiktok-panel__error" role="alert">
            <span>{error}</span>
            <button type="button" onClick={() => { void load(); }}><RefreshCw />重新读取</button>
          </div>
        ) : null}

        {!loading && accountGroups.length ? (
          <div className="canvas-tiktok-captions__body">
            <nav className="canvas-tiktok-captions__accounts" aria-label="TikTok 账号文案">
              {accountGroups.map((account) => (
                <button
                  key={account.accountId}
                  type="button"
                  className={account.accountId === selectedAccount?.accountId ? "is-active" : undefined}
                  aria-current={account.accountId === selectedAccount?.accountId ? "page" : undefined}
                  onClick={() => setSelectedAccountId(account.accountId)}
                >
                  <span>{account.displayName}</span>
                  <strong>{account.jobs.length} 条</strong>
                </button>
              ))}
            </nav>

            <div className="canvas-tiktok-captions__jobs">
              <header>
                <span><strong>{selectedAccount?.displayName}</strong><small>{hasActiveJobs ? "发布状态实时更新中" : "今日 Creator Inbox"}</small></span>
                <b>{selectedAccount?.jobs.length || 0}</b>
              </header>

              {error ? <div className="canvas-tiktok-captions__inline-error" role="status">{error}</div> : null}

              {selectedAccount?.jobs.length ? selectedAccount.jobs.map((job, index) => {
                const item = libraryById.get(job.libraryItemId);
                return (
                  <article className="canvas-tiktok-caption" key={job.id}>
                    <div className="canvas-tiktok-caption__preview">
                      <video
                        src={captionVideoUrl(job.libraryItemId, scope)}
                        muted
                        playsInline
                        preload="metadata"
                        aria-label={`${item?.title || "发布视频"}预览`}
                        onLoadedMetadata={seekPreviewFrame}
                      />
                      <Film aria-hidden="true" />
                    </div>
                    <div className="canvas-tiktok-caption__content">
                      <div className="canvas-tiktok-caption__meta">
                        <span><strong>{index + 1}/{selectedAccount.jobs.length}</strong><small>{item?.title || `视频 ${job.libraryItemId.slice(-6)}`}</small></span>
                        <span className={cn("canvas-tiktok-caption__status", `is-${job.status}`)}>{formatShanghaiTime(job.scheduledAt)} · {publishStatusLabel(job.status)}</span>
                      </div>
                      <button type="button" disabled={!job.caption.trim()} onClick={() => { void copyCaption(job); }}>
                        {copiedJobId === job.id ? <Check /> : <Copy />}
                        {copiedJobId === job.id ? "已复制" : "复制"}
                      </button>
                    </div>
                  </article>
                );
              }) : (
                <div className="canvas-tiktok-captions__empty">该账号今天还没有 Creator Inbox 发布任务。</div>
              )}
            </div>
          </div>
        ) : null}

        {!loading && !error && !accountGroups.length ? (
          <div className="canvas-tiktok-captions__empty is-panel">当前没有已绑定的 TikTok 账号。</div>
        ) : null}
      </section>
    </div>
  );
}

function captionVideoUrl(libraryItemId: string, scope: "personal" | "shared") {
  return `/api/library/${encodeURIComponent(libraryItemId)}/media?scope=${scope}`;
}

function seekPreviewFrame(event: SyntheticEvent<HTMLVideoElement>) {
  const video = event.currentTarget;
  if (!Number.isFinite(video.duration) || video.duration <= 0) return;
  video.currentTime = Math.min(0.5, Math.max(0.1, video.duration / 10));
}

function publishStatusLabel(status: TikTokPublishStatus) {
  if (status === "scheduled") return "待到点";
  if (status === "queued") return "排队中";
  if (status === "uploading") return "上传中";
  if (status === "processing") return "送达中";
  if (status === "published") return "已送达";
  if (status === "failed") return "送达失败";
  return "已取消";
}

function readErrorMessage(error: unknown) {
  if (error instanceof ApiError && error.message) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return "今日文案读取失败，请重新刷新。";
}

async function writeClipboard(value: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Some mobile browsers expose Clipboard API but deny writes outside their preferred path.
    }
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Clipboard unavailable");
}
