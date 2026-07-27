import "server-only";

import { randomBytes, randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";

import { readLibraryMetadataForOwners, resolveLibraryMediaForOwner } from "@/lib/server/library";
import { resolveUploadPath, safeStoredName } from "@/lib/server/paths";
import type { LibraryItem } from "@/lib/server/types";
import { isCanvasLibraryItemInScope, type CanvasLibraryScope } from "@/lib/canvas/library-scope";
import {
  createZernioProfile,
  createZernioTikTokPost,
  fetchZernioPost,
  fetchZernioTikTokCreatorInfo,
  getZernioConnectUrl,
  listZernioTikTokAccounts,
  presignZernioVideoUpload,
  uploadZernioVideo,
  ZernioApiError,
  zernioTikTokPostResult,
} from "./client";
import { getTikTokConfiguration, requireTikTokConfiguration, requireZernioCredential } from "./config";
import { hashTikTokOAuthState } from "./crypto";
import {
  cancelTikTokPublishJob,
  claimDueTikTokPublishJobs,
  clearTikTokConnection,
  consumeTikTokOAuthState,
  createTikTokOAuthState,
  createTikTokPublishJob,
  getTikTokConnectionByAccountId,
  getTikTokConnection,
  listTikTokConnections,
  listTikTokPublishJobs,
  saveTikTokConnection,
  saveTikTokProfile,
  unlockTikTokPublishJobForRetry,
  updateClaimedTikTokPublishJob,
} from "./repository";
import {
  tiktokPrivacyLevels,
  type TikTokConnectionRecord,
  type TikTokConnectionSummary,
  type TikTokAvailableAccount,
  type TikTokDeliveryMode,
  type TikTokPrivacyLevel,
  type TikTokPublicPublishJob,
  type TikTokPublishJob,
} from "./types";

const oauthTtlMs = 10 * 60 * 1000;
const maxScheduleAheadMs = 90 * 24 * 60 * 60 * 1000;
const retryDelayMs = 60_000;
const statusPollDelayMs = 20_000;
const dailyLimitDelayMs = 60 * 60 * 1000;
const terminalStatuses = new Set<TikTokPublishJob["status"]>(["published", "failed", "canceled"]);

export class TikTokPublishingError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "TikTokPublishingError";
    this.code = code;
    this.status = status;
  }
}

function connectionSummary(connection: TikTokConnectionRecord): TikTokConnectionSummary | null {
  if (!connection.zernioAccountId) return null;
  return {
    connected: true,
    zernioAccountId: connection.zernioAccountId,
    displayName: connection.displayName || connection.creatorUsername || "TikTok",
    avatarUrl: connection.avatarUrl,
    creatorUsername: connection.creatorUsername,
  };
}

export function publicTikTokPublishJob(job: TikTokPublishJob): TikTokPublicPublishJob {
  const hidden = new Set(["userId", "sourceOwnerId", "idempotencyKey", "lockedAt", "lockedBy"]);
  return Object.fromEntries(Object.entries(job).filter(([key]) => !hidden.has(key))) as TikTokPublicPublishJob;
}

export async function tikTokConnectionStatus(userId: string) {
  const config = getTikTokConfiguration();
  const connections = config.configured ? await listTikTokConnections(userId) : [];
  const availableAccounts = config.configured ? await listAvailableTikTokAccounts() : [];
  return {
    configured: config.configured,
    missingConfiguration: config.configured ? [] : config.missing,
    connection: connections[0] ? connectionSummary(connections[0]) : null,
    connections: connections.map(connectionSummary).filter((connection): connection is TikTokConnectionSummary => Boolean(connection)),
    availableAccounts,
  };
}

async function listAvailableTikTokAccounts(): Promise<TikTokAvailableAccount[]> {
  const config = requireTikTokConfiguration();
  const accounts = (await Promise.all(config.credentials.flatMap((credential) => credential.profileIds.map(async (zernioProfileId) => {
    const profileAccounts = await listZernioTikTokAccounts({ apiKey: credential.apiKey, baseUrl: config.apiBaseUrl, profileId: zernioProfileId });
    return profileAccounts.map((account) => ({ account, credential, zernioProfileId }));
  })))).flat();
  const available: TikTokAvailableAccount[] = [];
  for (const { account, credential, zernioProfileId } of accounts) {
    if (!account._id || account.isActive === false) continue;
    const claimed = await getTikTokConnectionByAccountId(account._id);
    if (claimed) continue;
    available.push({
      zernioCredentialId: credential.id,
      zernioProfileId,
      zernioAccountId: account._id,
      displayName: credential.displayName || account.displayName || account.username || "TikTok",
      avatarUrl: account.avatarUrl,
      creatorUsername: (account.username || "").replace(/^@/, "") || undefined,
    });
  }
  return available;
}

export async function claimTikTokAccount(userId: string, zernioCredentialId: string, zernioProfileId: string, zernioAccountId: string) {
  const credential = requireZernioCredential(zernioCredentialId);
  if (!credential.profileIds.includes(zernioProfileId)) {
    throw new TikTokPublishingError("TIKTOK_PROFILE_NOT_ALLOWED", "该 TikTok Profile 未开放给站内账号。", 403);
  }
  const accounts = await listZernioTikTokAccounts({ apiKey: credential.apiKey, baseUrl: credential.apiBaseUrl, profileId: zernioProfileId });
  const account = accounts.find((item) => item._id === zernioAccountId && item.isActive !== false);
  if (!account?._id) throw new TikTokPublishingError("TIKTOK_ACCOUNT_NOT_CONNECTED", "Zernio 未确认这个 TikTok 账号已连接。", 409);
  const claimed = await getTikTokConnectionByAccountId(account._id);
  if (claimed && claimed.userId !== userId) {
    throw new TikTokPublishingError("TIKTOK_ACCOUNT_ALREADY_CLAIMED", "这个 TikTok 已绑定其他站内账号。", 409);
  }
  const connection = await saveTikTokConnection({
    userId,
    zernioCredentialId: credential.id,
    zernioProfileId,
    zernioAccountId: account._id,
    displayName: credential.displayName || account.displayName || account.username || "TikTok",
    avatarUrl: account.avatarUrl,
    creatorUsername: (account.username || "").replace(/^@/, "") || undefined,
  });
  return connectionSummary(connection);
}

async function ensureZernioProfile(userId: string) {
  const existing = await getTikTokConnection(userId);
  if (existing) return existing;
  const config = requireTikTokConfiguration();
  const zernioProfileId = await createZernioProfile({
    apiKey: config.apiKey,
    baseUrl: config.apiBaseUrl,
    name: `Aohuang Canvas ${userId.slice(0, 8)}`,
    description: `aohuang-user:${userId}`,
  });
  return saveTikTokProfile({ userId, zernioProfileId });
}

export async function beginTikTokOAuth(userId: string, returnTo: string, now = new Date()) {
  const config = requireTikTokConfiguration();
  const connection = await ensureZernioProfile(userId);
  const state = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + oauthTtlMs).toISOString();
  await createTikTokOAuthState({
    stateHash: hashTikTokOAuthState(state),
    userId,
    returnTo: safeTikTokReturnPath(returnTo),
    expiresAt,
  });
  const redirect = new URL(config.redirectUri);
  redirect.searchParams.set("state", state);
  const authorizationUrl = await getZernioConnectUrl({
    apiKey: config.apiKey,
    baseUrl: config.apiBaseUrl,
    profileId: connection.zernioProfileId,
    redirectUrl: redirect.toString(),
  });
  return { state, expiresAt, authorizationUrl };
}

export async function finishTikTokOAuth(input: {
  userId: string;
  state: string;
  connected: string;
  profileId: string;
  accountId: string;
}) {
  const config = requireTikTokConfiguration();
  const state = await consumeTikTokOAuthState(hashTikTokOAuthState(input.state));
  if (!state || state.userId !== input.userId || input.connected !== "tiktok" || !input.profileId || !input.accountId) {
    throw new TikTokPublishingError("TIKTOK_OAUTH_STATE_INVALID", "TikTok 绑定已过期或回调无效，请重新绑定。", 400);
  }
  const profile = await getTikTokConnection(input.userId);
  if (!profile || profile.zernioProfileId !== input.profileId) {
    throw new TikTokPublishingError("TIKTOK_OAUTH_PROFILE_MISMATCH", "TikTok 授权与当前账号不匹配。", 403);
  }
  const accounts = await listZernioTikTokAccounts({
    apiKey: config.apiKey,
    baseUrl: config.apiBaseUrl,
    profileId: profile.zernioProfileId,
  });
  const account = accounts.find((item) => item._id === input.accountId && item.isActive !== false);
  if (!account?._id) throw new TikTokPublishingError("TIKTOK_ACCOUNT_NOT_CONNECTED", "Zernio 未确认 TikTok 账号绑定。", 502);
  await saveTikTokConnection({
    userId: input.userId,
    zernioCredentialId: "default",
    zernioProfileId: profile.zernioProfileId,
    zernioAccountId: account._id,
    displayName: account.displayName || account.username || "TikTok",
    avatarUrl: account.avatarUrl,
    creatorUsername: (account.username || "").replace(/^@/, "") || undefined,
  });
  return { returnTo: state.returnTo };
}

export async function disconnectTikTok(userId: string, zernioAccountId: string) {
  requireTikTokConfiguration();
  const connection = await getTikTokConnectionByAccountId(zernioAccountId);
  if (!connection || connection.userId !== userId) return false;
  await clearTikTokConnection(userId, zernioAccountId);
  return true;
}

async function requiredTikTokConnection(userId: string, zernioAccountId?: string) {
  const connection = zernioAccountId
    ? await getTikTokConnectionByAccountId(zernioAccountId)
    : (await listTikTokConnections(userId))[0];
  if (!connection?.zernioAccountId || connection.userId !== userId) {
    throw new TikTokPublishingError("TIKTOK_NOT_CONNECTED", "请选择当前站内账号已绑定的 TikTok。", 409);
  }
  return connection;
}

export async function getTikTokCreatorInfo(userId: string, zernioAccountId: string) {
  const connection = await requiredTikTokConnection(userId, zernioAccountId);
  const credential = requireZernioCredential(connection.zernioCredentialId);
  const creator = await fetchZernioTikTokCreatorInfo({ apiKey: credential.apiKey, baseUrl: credential.apiBaseUrl, accountId: connection.zernioAccountId! });
  return { ...creator, creatorUsername: connection.creatorUsername || creator.creatorUsername };
}

async function findPublishableVideo(libraryItemId: string, ownerIds: readonly string[], scope?: CanvasLibraryScope) {
  const item = (await readLibraryMetadataForOwners(ownerIds)).find((candidate) => (
    candidate.id === libraryItemId && (!scope || isCanvasLibraryItemInScope(candidate, scope))
  ));
  if (!item || item.type !== "video" || item.status !== "done" || !item.ownerLocalUserId) {
    throw new TikTokPublishingError("TIKTOK_VIDEO_NOT_FOUND", "视频不存在、尚未完成或无权发布。", 404);
  }
  const output = await resolveLibraryMediaForOwner(item.id, item.ownerLocalUserId);
  if (!output.storedName) throw new TikTokPublishingError("TIKTOK_VIDEO_FILE_MISSING", "视频文件尚未保存到服务器。", 409);
  return { item, output, sourceOwnerId: item.ownerLocalUserId };
}

function scheduleTime(value: unknown, now: Date) {
  const requested = typeof value === "string" && value.trim() ? Date.parse(value) : now.getTime();
  if (!Number.isFinite(requested)) throw new TikTokPublishingError("TIKTOK_SCHEDULE_INVALID", "发布时间无效。", 400);
  if (requested > now.getTime() + maxScheduleAheadMs) throw new TikTokPublishingError("TIKTOK_SCHEDULE_TOO_FAR", "定时发布最多可设置 90 天。", 400);
  return new Date(Math.max(now.getTime(), requested)).toISOString();
}

export async function scheduleTikTokPublish(input: {
  userId: string;
  zernioAccountId: string;
  ownerIds: readonly string[];
  scope: CanvasLibraryScope;
  libraryItemId: string;
  idempotencyKey: string;
  caption: string;
  privacyLevel: string;
  disableComment: boolean;
  disableDuet: boolean;
  disableStitch: boolean;
  brandContentToggle: boolean;
  brandOrganicToggle: boolean;
  deliveryMode: string;
  scheduledAt?: string;
  now?: Date;
}) {
  requireTikTokConfiguration();
  const now = input.now || new Date();
  if (!tiktokPrivacyLevels.includes(input.privacyLevel as TikTokPrivacyLevel)) {
    throw new TikTokPublishingError("TIKTOK_PRIVACY_REQUIRED", "请选择 TikTok 可用的发布范围。", 400);
  }
  if (input.idempotencyKey.trim().length < 8 || input.idempotencyKey.length > 255) {
    throw new TikTokPublishingError("TIKTOK_IDEMPOTENCY_INVALID", "发布请求标识无效。", 400);
  }
  if (input.deliveryMode !== "direct" && input.deliveryMode !== "creator_inbox") {
    throw new TikTokPublishingError("TIKTOK_DELIVERY_MODE_INVALID", "请选择有效的 TikTok 发布方式。", 400);
  }
  const deliveryMode = input.deliveryMode as TikTokDeliveryMode;
  if (deliveryMode === "creator_inbox" && input.scheduledAt && Date.parse(input.scheduledAt) > now.getTime() + 15_000) {
    throw new TikTokPublishingError("TIKTOK_DRAFT_SCHEDULE_UNAVAILABLE", "TikTok 草稿箱模式不能定时，请在 TikTok 内选音乐后发布。", 400);
  }
  const scheduledAt = scheduleTime(input.scheduledAt, now);
  const connection = await requiredTikTokConnection(input.userId, input.zernioAccountId);
  const credential = requireZernioCredential(connection.zernioCredentialId);
  const [{ item, sourceOwnerId }, creatorResponse] = await Promise.all([
    findPublishableVideo(input.libraryItemId, input.ownerIds, input.scope),
    fetchZernioTikTokCreatorInfo({ apiKey: credential.apiKey, baseUrl: credential.apiBaseUrl, accountId: connection.zernioAccountId! }),
  ]);
  const creator = { ...creatorResponse, creatorUsername: connection.creatorUsername || creatorResponse.creatorUsername };
  const privacyLevel = input.privacyLevel as TikTokPrivacyLevel;
  if (!creator.privacyLevelOptions.includes(privacyLevel)) {
    throw new TikTokPublishingError("TIKTOK_PRIVACY_UNAVAILABLE", "该 TikTok 账号当前不允许这个发布范围。", 400);
  }
  if (deliveryMode === "direct" && scheduledAt <= new Date(now.getTime() + 15_000).toISOString() && !creator.canPostMore) {
    throw new TikTokPublishingError("TIKTOK_DAILY_LIMIT", "该 TikTok 账号当前已达到官方 API 发布上限，请稍后再试。", 429);
  }
  const duration = Number(item.params.duration || 0);
  if (duration > 0 && creator.maxVideoPostDurationSec > 0 && duration > creator.maxVideoPostDurationSec) {
    throw new TikTokPublishingError("TIKTOK_VIDEO_TOO_LONG", `该账号最多发布 ${creator.maxVideoPostDurationSec} 秒视频。`, 400);
  }
  const job = await createTikTokPublishJob({
    userId: input.userId,
    zernioCredentialId: connection.zernioCredentialId,
    zernioAccountId: input.zernioAccountId,
    sourceOwnerId,
    libraryItemId: item.id,
    idempotencyKey: input.idempotencyKey.trim(),
    caption: input.caption.trim().slice(0, 2200),
    privacyLevel,
    disableComment: creator.commentDisabled || input.disableComment,
    disableDuet: creator.duetDisabled || input.disableDuet,
    disableStitch: creator.stitchDisabled || input.disableStitch,
    brandContentToggle: input.brandContentToggle,
    brandOrganicToggle: input.brandOrganicToggle,
    deliveryMode,
    scheduledAt,
  });
  return publicTikTokPublishJob(job);
}

export async function getTikTokPublishJobs(userId: string) {
  return (await listTikTokPublishJobs(userId)).map(publicTikTokPublishJob);
}

export async function cancelTikTokPublish(userId: string, jobId: string) {
  const job = await cancelTikTokPublishJob(userId, jobId);
  if (!job) throw new TikTokPublishingError("TIKTOK_JOB_NOT_CANCELABLE", "该任务已开始发布，不能取消。", 409);
  return publicTikTokPublishJob(job);
}

async function resolveJobVideo(job: TikTokPublishJob) {
  const { output } = await findPublishableVideo(job.libraryItemId, [job.sourceOwnerId]);
  const storedName = safeStoredName(output.storedName || "");
  if (!storedName || storedName !== output.storedName) throw new TikTokPublishingError("TIKTOK_VIDEO_FILE_INVALID", "视频文件名无效。", 409);
  const path = resolveUploadPath(storedName);
  const file = await stat(path);
  if (!file.isFile() || file.size <= 0) throw new TikTokPublishingError("TIKTOK_VIDEO_FILE_MISSING", "视频文件不存在。", 404);
  return { path, size: file.size, mimeType: output.mimeType || "video/mp4", storedName };
}

function nextIso(delayMs: number) { return new Date(Date.now() + delayMs).toISOString(); }

async function persistZernioStatus(job: TikTokPublishJob, workerId: string, postId: string, result: ReturnType<typeof zernioTikTokPostResult>) {
  if (result.status === "published") {
    await updateClaimedTikTokPublishJob(job.id, workerId, {
      status: "published",
      zernioPostId: postId,
      tiktokPostId: result.postId || "",
      postUrl: result.postUrl || "",
      publishedAt: result.publishedAt || new Date().toISOString(),
      errorCode: "",
      errorMessage: "",
      releaseLock: true,
    });
    return;
  }
  if (result.status === "failed") {
    await updateClaimedTikTokPublishJob(job.id, workerId, {
      status: "failed",
      zernioPostId: postId,
      errorCode: result.errorCode || "ZERNIO_PUBLISH_FAILED",
      errorMessage: result.errorMessage || "TikTok 发布失败。",
      releaseLock: true,
    });
    return;
  }
  await unlockTikTokPublishJobForRetry(job.id, workerId, {
    status: "processing",
    nextAttemptAt: nextIso(statusPollDelayMs),
  });
}

async function processClaimedJob(job: TikTokPublishJob, workerId: string) {
  if (terminalStatuses.has(job.status)) return;
  const connection = await requiredTikTokConnection(job.userId, job.zernioAccountId);
  const config = requireZernioCredential(job.zernioCredentialId || connection.zernioCredentialId);
  const accountId = connection.zernioAccountId!;

  if (job.zernioPostId) {
    const post = await fetchZernioPost({ apiKey: config.apiKey, baseUrl: config.apiBaseUrl, postId: job.zernioPostId });
    await persistZernioStatus(job, workerId, job.zernioPostId, zernioTikTokPostResult(post, accountId));
    return;
  }

  const creator = await fetchZernioTikTokCreatorInfo({ apiKey: config.apiKey, baseUrl: config.apiBaseUrl, accountId });
  if (job.deliveryMode === "direct" && !creator.canPostMore) {
    await unlockTikTokPublishJobForRetry(job.id, workerId, {
      status: "queued",
      nextAttemptAt: nextIso(dailyLimitDelayMs),
      errorCode: "TIKTOK_DAILY_LIMIT",
      errorMessage: "TikTok 官方 API 每日发布额度已用完，系统将在稍后继续尝试。",
    });
    return;
  }

  const video = await resolveJobVideo(job);
  const upload = await presignZernioVideoUpload({
    apiKey: config.apiKey,
    baseUrl: config.apiBaseUrl,
    filename: video.storedName,
    mimeType: video.mimeType,
  });
  await updateClaimedTikTokPublishJob(job.id, workerId, { status: "uploading", errorCode: "", errorMessage: "" });
  await uploadZernioVideo({ uploadUrl: upload.uploadUrl, filePath: video.path, fileSize: video.size, mimeType: video.mimeType });
  await updateClaimedTikTokPublishJob(job.id, workerId, { uploadedBytes: video.size });
  const post = await createZernioTikTokPost({
    apiKey: config.apiKey,
    baseUrl: config.apiBaseUrl,
    accountId,
    caption: job.caption,
    mediaUrl: upload.publicUrl,
    privacyLevel: job.privacyLevel,
    disableComment: job.disableComment,
    disableDuet: job.disableDuet,
    disableStitch: job.disableStitch,
    brandContentToggle: job.brandContentToggle,
    brandOrganicToggle: job.brandOrganicToggle,
    deliveryMode: job.deliveryMode,
    requestId: job.id,
  });
  const postId = post._id!;
  await updateClaimedTikTokPublishJob(job.id, workerId, { status: "processing", zernioPostId: postId, uploadedBytes: video.size });
  await persistZernioStatus(job, workerId, postId, zernioTikTokPostResult(post, accountId));
}

export async function processDueTikTokPublishJobs(input: { workerId?: string; limit?: number } = {}) {
  const config = getTikTokConfiguration();
  if (!config.configured) return { configured: false, claimed: 0, processed: 0, failed: 0 };
  const workerId = input.workerId || `worker-${randomUUID()}`;
  const jobs = await claimDueTikTokPublishJobs(workerId, input.limit || 1);
  let processed = 0;
  let failed = 0;
  for (const job of jobs) {
    try {
      await processClaimedJob(job, workerId);
      processed += 1;
    } catch (error) {
      failed += 1;
      const api = error instanceof ZernioApiError ? error : null;
      const publishing = error instanceof TikTokPublishingError ? error : null;
      const retryable = Boolean(api?.retryable) && job.attempts < 4;
      await unlockTikTokPublishJobForRetry(job.id, workerId, {
        status: retryable ? (job.zernioPostId ? "processing" : "queued") : "failed",
        nextAttemptAt: nextIso(retryable ? retryDelayMs : statusPollDelayMs),
        errorCode: api?.code || publishing?.code || "TIKTOK_PUBLISH_ERROR",
        errorMessage: (api?.message || publishing?.message || "TikTok 发布失败。").slice(0, 500),
      });
    }
  }
  return { configured: true, claimed: jobs.length, processed, failed };
}

export function safeTikTokReturnPath(value: string) {
  if (!value.startsWith("/canvas") || value.startsWith("//")) return "/canvas?scope=personal";
  try {
    const url = new URL(value, "https://aohuang888.cn");
    if (url.origin !== "https://aohuang888.cn" || !url.pathname.startsWith("/canvas")) return "/canvas?scope=personal";
    return `${url.pathname}${url.search}`.slice(0, 500);
  } catch {
    return "/canvas?scope=personal";
  }
}

export function manualTikTokUploadUrl() { return "https://www.tiktok.com/tiktokstudio/upload"; }
export type TikTokPublishableLibraryItem = Pick<LibraryItem, "id" | "title" | "prompt" | "type" | "status">;
