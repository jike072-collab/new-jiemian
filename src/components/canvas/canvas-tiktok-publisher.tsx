"use client";

import { CalendarClock, Check, Clock3, Download, ExternalLink, LoaderCircle, LogOut, RefreshCw, Send, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { ApiError, fetchJson, fetchJsonWithCsrf } from "@/lib/client/api";
import type { LibraryItem } from "@/lib/server/types";
import type { TikTokAvailableAccount, TikTokConnectionSummary, TikTokCreatorInfo, TikTokPrivacyLevel, TikTokPublicPublishJob } from "@/lib/server/tiktok/types";
import { composeTikTokCaption, malaysiaTikTokCopyAngles, type MalaysiaTikTokCopyAngle, type TikTokCopyDraft } from "@/lib/tiktok-copy";
import { cn } from "@/lib/utils";

type ConnectionResponse = { configured: boolean; missingConfiguration: string[]; connection: TikTokConnectionSummary | null; availableAccounts: TikTokAvailableAccount[] };
type JobsResponse = { jobs: TikTokPublicPublishJob[]; manualUploadUrl: string };
type CopyResponse = { ok: true; draft: TikTokCopyDraft };
const activeStatuses = new Set(["scheduled", "queued", "uploading", "processing"]);

export function CanvasTikTokPublisher({ item, scope, onDownload, onClose }: {
  item: LibraryItem;
  scope: "personal" | "shared";
  onDownload: () => void;
  onClose: () => void;
}) {
  const [connection, setConnection] = useState<ConnectionResponse | null>(null);
  const [creator, setCreator] = useState<TikTokCreatorInfo | null>(null);
  const [jobs, setJobs] = useState<TikTokPublicPublishJob[]>([]);
  const [manualUploadUrl, setManualUploadUrl] = useState("https://www.tiktok.com/tiktokstudio/upload");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [privacyLevel, setPrivacyLevel] = useState<TikTokPrivacyLevel | "">("");
  const [allowComment, setAllowComment] = useState(true);
  const [allowDuet, setAllowDuet] = useState(true);
  const [allowStitch, setAllowStitch] = useState(true);
  const [brandContent, setBrandContent] = useState(false);
  const [brandOrganic, setBrandOrganic] = useState(false);
  const [mode, setMode] = useState<"now" | "scheduled">("now");
  const [scheduledAt, setScheduledAt] = useState("");
  const [copyAngle, setCopyAngle] = useState<MalaysiaTikTokCopyAngle>("auto");
  const [copyLoading, setCopyLoading] = useState(true);
  const [copyError, setCopyError] = useState("");
  const [title, setTitle] = useState("");
  const [caption, setCaption] = useState("");
  const [hashtags, setHashtags] = useState("");
  const copyRequestId = useRef(0);
  const copyRequestedFor = useRef("");

  const loadJobs = useCallback(async () => {
    const response = await fetchJson<JobsResponse>("/api/tiktok/publish");
    setJobs(response.jobs);
    setManualUploadUrl(response.manualUploadUrl);
    return response.jobs;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      const [connectionResponse] = await Promise.all([fetchJson<ConnectionResponse>("/api/tiktok/connection"), loadJobs()]);
      setConnection(connectionResponse);
      if (connectionResponse.configured && connectionResponse.connection) {
        const response = await fetchJson<{ creator: TikTokCreatorInfo }>("/api/tiktok/creator");
        setCreator(response.creator);
        setPrivacyLevel((current) => current || response.creator.privacyLevelOptions[0] || "");
        setAllowComment(!response.creator.commentDisabled);
        setAllowDuet(!response.creator.duetDisabled);
        setAllowStitch(!response.creator.stitchDisabled);
      } else {
        setCreator(null);
      }
    } catch (error) {
      setMessage(apiMessage(error, "TikTok 状态读取失败。"));
    } finally {
      setLoading(false);
    }
  }, [loadJobs]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const generateCopy = useCallback(async (angle: MalaysiaTikTokCopyAngle) => {
    const requestId = copyRequestId.current + 1;
    copyRequestId.current = requestId;
    setCopyLoading(true);
    setCopyError("");
    try {
      const response = await fetchJsonWithCsrf<CopyResponse>("/api/tiktok/copy", {
        method: "POST",
        body: JSON.stringify({ libraryItemId: item.id, scope, angle }),
      });
      if (copyRequestId.current !== requestId) return;
      setTitle(response.draft.title);
      setCaption(response.draft.caption);
      setHashtags(response.draft.hashtags.join(" "));
      setCopyAngle(response.draft.angle);
    } catch (error) {
      if (copyRequestId.current === requestId) setCopyError(apiMessage(error, "视频文案生成失败，请重新生成。"));
    } finally {
      if (copyRequestId.current === requestId) setCopyLoading(false);
    }
  }, [item.id, scope]);

  useEffect(() => {
    const key = `${scope}:${item.id}`;
    if (copyRequestedFor.current === key) return;
    copyRequestedFor.current = key;
    const timer = window.setTimeout(() => { void generateCopy("auto"); }, 0);
    return () => window.clearTimeout(timer);
  }, [generateCopy, item.id, scope]);

  useEffect(() => {
    if (!jobs.some((job) => activeStatuses.has(job.status))) return;
    const timer = window.setInterval(() => { void loadJobs().catch(() => undefined); }, 5_000);
    return () => window.clearInterval(timer);
  }, [jobs, loadJobs]);

  const itemJobs = useMemo(() => jobs.filter((job) => job.libraryItemId === item.id).slice(0, 6), [item.id, jobs]);
  const immediateLimitReached = mode === "now" && creator?.canPostMore === false;
  const publishCaption = useMemo(() => composeTikTokCaption({
    title,
    caption,
    hashtags: hashtags.split(/[\s,，]+/u).filter(Boolean),
  }), [caption, hashtags, title]);

  const connect = async () => {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetchJsonWithCsrf<{ authorizationUrl: string }>("/api/tiktok/oauth/start", {
        method: "POST",
        body: JSON.stringify({ returnTo: `${window.location.pathname}${window.location.search}` }),
      });
      window.location.assign(response.authorizationUrl);
    } catch (error) {
      setMessage(apiMessage(error, "TikTok 绑定失败。"));
      setBusy(false);
    }
  };

  const claim = async (account: TikTokAvailableAccount) => {
    setBusy(true);
    setMessage("");
    try {
      await fetchJsonWithCsrf("/api/tiktok/connection", {
        method: "POST",
        body: JSON.stringify({ zernioProfileId: account.zernioProfileId, zernioAccountId: account.zernioAccountId }),
      });
      await load();
      setMessage("TikTok 已绑定到当前站内账号。");
    } catch (error) {
      setMessage(apiMessage(error, "TikTok 账号绑定失败。"));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!window.confirm("确定解除当前站内账号与 TikTok 的绑定吗？")) return;
    setBusy(true);
    try {
      await fetchJsonWithCsrf("/api/tiktok/connection", { method: "DELETE" });
      setConnection((current) => current ? { ...current, connection: null } : current);
      setCreator(null);
      setMessage("TikTok 已解绑。");
    } catch (error) {
      setMessage(apiMessage(error, "TikTok 解绑失败。"));
    } finally {
      setBusy(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!privacyLevel) {
      setMessage("请选择发布范围。");
      return;
    }
    if (!title.trim() || !caption.trim()) {
      setMessage("请先生成或填写标题和正文。");
      return;
    }
    let publishAt: string | undefined;
    if (mode === "scheduled") {
      const timestamp = Date.parse(scheduledAt);
      if (!Number.isFinite(timestamp) || timestamp <= Date.now()) {
        setMessage("请选择未来的发布时间。");
        return;
      }
      publishAt = new Date(timestamp).toISOString();
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetchJsonWithCsrf<{ job: TikTokPublicPublishJob }>(`/api/tiktok/publish?scope=${scope}`, {
        method: "POST",
        body: JSON.stringify({
          libraryItemId: item.id,
          idempotencyKey: crypto.randomUUID(),
          caption: publishCaption,
          privacyLevel,
          disableComment: !allowComment,
          disableDuet: !allowDuet,
          disableStitch: !allowStitch,
          brandContentToggle: brandContent,
          brandOrganicToggle: brandOrganic,
          scheduledAt: publishAt,
        }),
      });
      setJobs((current) => [response.job, ...current.filter((job) => job.id !== response.job.id)]);
      setMessage(response.job.status === "scheduled" ? "已加入定时发布。" : "已加入 TikTok 发布队列。");
    } catch (error) {
      setMessage(apiMessage(error, "TikTok 发布任务创建失败。"));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (jobId: string) => {
    setBusy(true);
    try {
      const response = await fetchJsonWithCsrf<{ job: TikTokPublicPublishJob }>("/api/tiktok/publish", {
        method: "DELETE",
        body: JSON.stringify({ jobId }),
      });
      setJobs((current) => current.map((job) => job.id === jobId ? response.job : job));
    } catch (error) {
      setMessage(apiMessage(error, "取消发布失败。"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="canvas-tiktok-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="canvas-tiktok-panel" role="dialog" aria-modal="true" aria-label="发布到 TikTok">
        <header className="canvas-tiktok-panel__header">
          <div><Send /><span><strong>发布到 TikTok</strong><small>{item.title}</small></span></div>
          <button type="button" aria-label="关闭 TikTok 发布" title="关闭" onClick={onClose}><X /></button>
        </header>

        {loading ? <div className="canvas-tiktok-panel__loading"><LoaderCircle className="is-spinning" /><span>正在读取 TikTok 状态</span></div> : null}

        {!loading && connection && !connection.configured ? (
          <div className="canvas-tiktok-panel__manual">
            <strong>Zernio 发布待配置</strong>
            <p>配置完成前可下载视频后手动发布。</p>
            <div>
              <button type="button" onClick={onDownload}><Download />下载视频</button>
              <button type="button" onClick={() => window.open(manualUploadUrl, "_blank", "noopener,noreferrer")}><ExternalLink />打开 TikTok 上传</button>
            </div>
          </div>
        ) : null}

        {!loading && connection?.configured && !connection.connection ? (
          <div className="canvas-tiktok-panel__connect">
            <Send />
            <strong>选择当前站内账号使用的 TikTok</strong>
            <span>每个 TikTok 只能绑定一个站内账号，其他成员不会看到你的发布任务。</span>
            {connection.availableAccounts.length ? (
              <div className="canvas-tiktok-accounts">
                {connection.availableAccounts.map((account) => (
                  <button key={account.zernioAccountId} type="button" disabled={busy} onClick={() => { void claim(account); }}>
                    <Send /><span><strong>{account.displayName}</strong><small>{account.creatorUsername ? `@${account.creatorUsername}` : "TikTok 已连接"}</small></span>
                  </button>
                ))}
              </div>
            ) : <span>当前没有可认领的 TikTok，可能都已绑定其他站内账号。</span>}
            <button type="button" className="is-secondary" disabled={busy} onClick={() => { void connect(); }}>{busy ? <LoaderCircle className="is-spinning" /> : <ExternalLink />}连接新的 TikTok</button>
          </div>
        ) : null}

        {!loading && connection?.connection ? (
          <>
            <div className="canvas-tiktok-account">
              <Send />
              <span><strong>{creator?.creatorNickname || connection.connection.displayName}</strong><small>{creator?.creatorUsername ? `@${creator.creatorUsername}` : "TikTok 已绑定"}</small></span>
              <button type="button" disabled={busy} onClick={() => { void disconnect(); }} aria-label="解除 TikTok 绑定" title="解绑"><LogOut /></button>
            </div>

            {creator ? (
              <form className="canvas-tiktok-form" onSubmit={submit}>
                <section className="canvas-tiktok-copy" aria-label="TikTok 文案">
                  <div className="canvas-tiktok-copy__heading">
                    <span><Sparkles /><strong>马来西亚鞋类文案</strong></span>
                    <button type="button" disabled={copyLoading} onClick={() => { void generateCopy(copyAngle); }}>
                      {copyLoading ? <LoaderCircle className="is-spinning" /> : <RefreshCw />}重新生成
                    </button>
                  </div>
                  <div className="canvas-tiktok-copy__angles" role="tablist" aria-label="文案方向">
                    {malaysiaTikTokCopyAngles.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        role="tab"
                        aria-selected={copyAngle === option.id}
                        className={copyAngle === option.id ? "is-active" : undefined}
                        disabled={copyLoading}
                        onClick={() => {
                          setCopyAngle(option.id);
                          void generateCopy(option.id);
                        }}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  {copyLoading ? (
                    <div className="canvas-tiktok-copy__loading" role="status">
                      <LoaderCircle className="is-spinning" />
                      <span>正在分析视频并生成马来西亚文案</span>
                    </div>
                  ) : null}
                  {copyError ? <div className="canvas-tiktok-copy__error" role="alert">{copyError}</div> : null}
                  <label className="canvas-tiktok-form__field">
                    <span>标题</span>
                    <input value={title} maxLength={80} disabled={copyLoading} onChange={(event) => setTitle(event.target.value)} />
                    <small>{title.length}/80</small>
                  </label>
                  <label className="canvas-tiktok-form__field">
                    <span>正文</span>
                    <textarea value={caption} maxLength={1200} disabled={copyLoading} onChange={(event) => setCaption(event.target.value)} />
                    <small>{caption.length}/1200</small>
                  </label>
                  <label className="canvas-tiktok-form__field">
                    <span>话题</span>
                    <input value={hashtags} maxLength={500} disabled={copyLoading} onChange={(event) => setHashtags(event.target.value)} />
                    <small>{publishCaption.length}/2200</small>
                  </label>
                </section>
                <fieldset>
                  <legend>发布范围</legend>
                  <div className="canvas-tiktok-form__privacy">
                    {creator.privacyLevelOptions.map((value) => (
                      <label key={value} className={privacyLevel === value ? "is-active" : undefined}>
                        <input type="radio" name="tiktok-privacy" value={value} checked={privacyLevel === value} onChange={() => setPrivacyLevel(value)} />
                        <span>{privacyLabel(value)}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div className="canvas-tiktok-form__toggles">
                  <label><input type="checkbox" checked={allowComment} disabled={creator.commentDisabled} onChange={(event) => setAllowComment(event.target.checked)} />允许评论</label>
                  <label><input type="checkbox" checked={allowDuet} disabled={creator.duetDisabled} onChange={(event) => setAllowDuet(event.target.checked)} />允许合拍</label>
                  <label><input type="checkbox" checked={allowStitch} disabled={creator.stitchDisabled} onChange={(event) => setAllowStitch(event.target.checked)} />允许拼接</label>
                  <label><input type="checkbox" checked disabled />AI 生成内容</label>
                  <label><input type="checkbox" checked={brandContent} onChange={(event) => setBrandContent(event.target.checked)} />品牌合作内容</label>
                  <label><input type="checkbox" checked={brandOrganic} onChange={(event) => setBrandOrganic(event.target.checked)} />自有品牌推广</label>
                </div>
                <div className="canvas-tiktok-form__schedule">
                  <div role="tablist" aria-label="发布时间">
                    <button type="button" role="tab" aria-selected={mode === "now"} className={mode === "now" ? "is-active" : undefined} onClick={() => setMode("now")}><Send />立即发布</button>
                    <button type="button" role="tab" aria-selected={mode === "scheduled"} className={mode === "scheduled" ? "is-active" : undefined} onClick={() => setMode("scheduled")}><CalendarClock />定时发布</button>
                  </div>
                  {mode === "scheduled" ? <input type="datetime-local" required value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} /> : null}
                </div>
                <button type="submit" className="canvas-tiktok-form__submit" disabled={busy || copyLoading || !title.trim() || !caption.trim() || !privacyLevel || immediateLimitReached}>
                  {busy ? <LoaderCircle className="is-spinning" /> : mode === "scheduled" ? <CalendarClock /> : <Send />}
                  {busy ? "提交中" : immediateLimitReached ? "已达到当前 API 发布额度" : mode === "scheduled" ? "加入定时发布" : "发布到 TikTok"}
                </button>
              </form>
            ) : <div className="canvas-tiktok-panel__loading"><LoaderCircle className="is-spinning" /><span>正在读取发布权限</span></div>}
          </>
        ) : null}

        {itemJobs.length ? (
          <div className="canvas-tiktok-jobs">
            <div className="canvas-tiktok-jobs__heading"><strong>发布记录</strong><button type="button" onClick={() => { void loadJobs(); }} aria-label="刷新发布记录" title="刷新"><RefreshCw /></button></div>
            {itemJobs.map((job) => (
              <div key={job.id} className={cn("canvas-tiktok-job", `is-${job.status}`)}>
                {job.status === "published" ? <Check /> : activeStatuses.has(job.status) ? <LoaderCircle className="is-spinning" /> : <Clock3 />}
                <span><strong>{jobStatusLabel(job.status)}</strong><small>{formatDate(job.scheduledAt)}{job.errorMessage ? ` - ${job.errorMessage}` : ""}</small></span>
                {job.postUrl ? <a href={job.postUrl} target="_blank" rel="noreferrer" aria-label="打开 TikTok 作品"><ExternalLink /></a> : null}
                {["scheduled", "queued"].includes(job.status) ? <button type="button" disabled={busy} onClick={() => { void cancel(job.id); }}>取消</button> : null}
              </div>
            ))}
          </div>
        ) : null}
        {message ? <div className="canvas-tiktok-panel__message" role="status">{message}</div> : null}
      </section>
    </div>
  );
}

function privacyLabel(value: TikTokPrivacyLevel) {
  if (value === "PUBLIC_TO_EVERYONE") return "公开";
  if (value === "MUTUAL_FOLLOW_FRIENDS") return "互相关注好友";
  if (value === "FOLLOWER_OF_CREATOR") return "粉丝";
  return "仅自己";
}

function jobStatusLabel(status: TikTokPublicPublishJob["status"]) {
  if (status === "scheduled") return "等待定时发布";
  if (status === "queued") return "等待发布";
  if (status === "uploading") return "正在上传";
  if (status === "processing") return "TikTok 处理中";
  if (status === "published") return "已发布";
  if (status === "canceled") return "已取消";
  return "发布失败";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function apiMessage(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : error instanceof Error ? error.message : fallback;
}
