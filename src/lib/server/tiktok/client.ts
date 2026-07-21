import "server-only";

import { createReadStream } from "node:fs";

import { tiktokPrivacyLevels, type TikTokCreatorInfo, type TikTokPrivacyLevel } from "./types";

type FetchLike = typeof fetch;

export class ZernioApiError extends Error {
  code: string;
  status: number;
  retryable: boolean;

  constructor(code: string, message: string, status = 502, retryable = false) {
    super(message);
    this.name = "ZernioApiError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

type ZernioAccount = {
  _id?: string;
  platform?: string;
  profileId?: string | { _id?: string };
  username?: string;
  displayName?: string;
  avatarUrl?: string;
  isActive?: boolean;
};

type ZernioPostPlatform = {
  platform?: string;
  accountId?: string | { _id?: string };
  status?: string;
  platformPostId?: string;
  platformPostUrl?: string;
  publishedAt?: string;
  errorMessage?: string;
  errorCategory?: string;
};

export type ZernioPost = {
  _id?: string;
  status?: string;
  publishedAt?: string;
  platforms?: ZernioPostPlatform[];
};

function boundedText(value: unknown, fallback: string, max = 500) {
  const text = typeof value === "string" ? value.trim() : "";
  return (text || fallback).slice(0, max);
}

function errorFromPayload(payload: unknown, status: number) {
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const nested = record.error && typeof record.error === "object" ? record.error as Record<string, unknown> : {};
  const code = boundedText(nested.code || record.code || record.error, `HTTP_${status}`, 120);
  const message = boundedText(nested.message || record.message || record.error, "Zernio 请求失败。", 500);
  return new ZernioApiError(code, message, status, status === 429 || status >= 500);
}

function apiUrl(baseUrl: string, path: string, query?: Record<string, string | undefined>) {
  const url = new URL(`${baseUrl}${path}`);
  for (const [key, value] of Object.entries(query || {})) {
    if (value) url.searchParams.set(key, value);
  }
  return url.toString();
}

async function requestJson<T>(input: {
  apiKey: string;
  baseUrl: string;
  path: string;
  method?: string;
  body?: unknown;
  query?: Record<string, string | undefined>;
  requestId?: string;
  fetchImpl?: FetchLike;
}) {
  let response: Response;
  try {
    response = await (input.fetchImpl || fetch)(apiUrl(input.baseUrl, input.path, input.query), {
      method: input.method || "GET",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        ...(input.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(input.requestId ? { "x-request-id": input.requestId } : {}),
      },
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    const message = error instanceof Error && error.name === "TimeoutError" ? "Zernio 请求超时。" : "暂时无法连接 Zernio。";
    throw new ZernioApiError("ZERNIO_NETWORK_ERROR", message, 502, true);
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw errorFromPayload(payload, response.status);
  return payload as T;
}

function profileId(value: ZernioAccount["profileId"]) {
  return typeof value === "string" ? value : value?._id || "";
}

function accountId(value: ZernioPostPlatform["accountId"]) {
  return typeof value === "string" ? value : value?._id || "";
}

export async function createZernioProfile(input: { apiKey: string; baseUrl: string; name: string; description: string; fetchImpl?: FetchLike }) {
  const payload = await requestJson<{ profile?: { _id?: string } }>({
    apiKey: input.apiKey,
    baseUrl: input.baseUrl,
    path: "/v1/profiles",
    method: "POST",
    body: { name: input.name.slice(0, 120), description: input.description.slice(0, 250) },
    fetchImpl: input.fetchImpl,
  });
  const id = payload.profile?._id;
  if (!id) throw new ZernioApiError("ZERNIO_PROFILE_MISSING", "Zernio 未返回 Profile 标识。", 502);
  return id;
}

export async function getZernioConnectUrl(input: {
  apiKey: string;
  baseUrl: string;
  profileId: string;
  redirectUrl: string;
  fetchImpl?: FetchLike;
}) {
  const payload = await requestJson<{ authUrl?: string }>({
    apiKey: input.apiKey,
    baseUrl: input.baseUrl,
    path: "/v1/connect/tiktok",
    query: { profileId: input.profileId, redirect_url: input.redirectUrl },
    fetchImpl: input.fetchImpl,
  });
  if (!payload.authUrl) throw new ZernioApiError("ZERNIO_AUTH_URL_MISSING", "Zernio 未返回 TikTok 授权地址。", 502);
  return payload.authUrl;
}

export async function listZernioTikTokAccounts(input: { apiKey: string; baseUrl: string; profileId: string; fetchImpl?: FetchLike }) {
  const payload = await requestJson<{ accounts?: ZernioAccount[] }>({
    apiKey: input.apiKey,
    baseUrl: input.baseUrl,
    path: "/v1/accounts",
    query: { profileId: input.profileId, platform: "tiktok" },
    fetchImpl: input.fetchImpl,
  });
  return (payload.accounts || []).filter((account) => account._id && account.platform === "tiktok" && profileId(account.profileId) === input.profileId);
}

export async function fetchZernioTikTokCreatorInfo(input: { apiKey: string; baseUrl: string; accountId: string; fetchImpl?: FetchLike }): Promise<TikTokCreatorInfo> {
  const payload = await requestJson<{
    creator?: { nickname?: string; canPostMore?: boolean };
    privacyLevels?: Array<{ value?: string }>;
    postingLimits?: { maxVideoDurationSec?: number; interactionSettings?: { comment?: boolean; duet?: boolean; stitch?: boolean } };
  }>({
    apiKey: input.apiKey,
    baseUrl: input.baseUrl,
    path: `/v1/accounts/${encodeURIComponent(input.accountId)}/tiktok/creator-info`,
    query: { mediaType: "video" },
    fetchImpl: input.fetchImpl,
  });
  const options = (payload.privacyLevels || []).map((item) => item.value).filter((value): value is TikTokPrivacyLevel => tiktokPrivacyLevels.includes(value as TikTokPrivacyLevel));
  if (!options.length) throw new ZernioApiError("ZERNIO_CREATOR_INFO_MISSING", "Zernio 未返回 TikTok 发布权限。", 502);
  const settings = payload.postingLimits?.interactionSettings;
  const nickname = boundedText(payload.creator?.nickname, "TikTok", 120);
  return {
    creatorUsername: nickname.replace(/^@/, ""),
    creatorNickname: nickname,
    privacyLevelOptions: options,
    commentDisabled: settings?.comment === false,
    duetDisabled: settings?.duet === false,
    stitchDisabled: settings?.stitch === false,
    maxVideoPostDurationSec: Math.max(0, Number(payload.postingLimits?.maxVideoDurationSec) || 0),
    canPostMore: payload.creator?.canPostMore !== false,
  };
}

export async function presignZernioVideoUpload(input: { apiKey: string; baseUrl: string; filename: string; mimeType: string; fetchImpl?: FetchLike }) {
  const payload = await requestJson<{ uploadUrl?: string; publicUrl?: string }>({
    apiKey: input.apiKey,
    baseUrl: input.baseUrl,
    path: "/v1/media/presign",
    method: "POST",
    body: { filename: input.filename.slice(0, 255), contentType: input.mimeType || "video/mp4" },
    fetchImpl: input.fetchImpl,
  });
  if (!payload.uploadUrl || !payload.publicUrl) throw new ZernioApiError("ZERNIO_MEDIA_URL_MISSING", "Zernio 未返回视频上传地址。", 502);
  return { uploadUrl: payload.uploadUrl, publicUrl: payload.publicUrl };
}

export async function uploadZernioVideo(input: { uploadUrl: string; filePath: string; mimeType: string; fetchImpl?: FetchLike }) {
  let response: Response;
  try {
    response = await (input.fetchImpl || fetch)(input.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": input.mimeType || "video/mp4" },
      body: createReadStream(input.filePath),
      duplex: "half",
      signal: AbortSignal.timeout(180_000),
    } as unknown as RequestInit);
  } catch (error) {
    const message = error instanceof Error && error.name === "TimeoutError" ? "Zernio 视频上传超时。" : "Zernio 视频上传连接中断。";
    throw new ZernioApiError("ZERNIO_MEDIA_UPLOAD_NETWORK_ERROR", message, 502, true);
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw errorFromPayload(payload, response.status);
  }
}

export async function createZernioTikTokPost(input: {
  apiKey: string;
  baseUrl: string;
  accountId: string;
  caption: string;
  mediaUrl: string;
  privacyLevel: TikTokPrivacyLevel;
  disableComment: boolean;
  disableDuet: boolean;
  disableStitch: boolean;
  brandContentToggle: boolean;
  brandOrganicToggle: boolean;
  requestId: string;
  fetchImpl?: FetchLike;
}) {
  try {
    const payload = await requestJson<{ post?: ZernioPost; existingPost?: ZernioPost }>({
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
      path: "/v1/posts",
      method: "POST",
      requestId: input.requestId,
      body: {
        content: input.caption.slice(0, 2200),
        mediaItems: [{ type: "video", url: input.mediaUrl }],
        platforms: [{ platform: "tiktok", accountId: input.accountId }],
        publishNow: true,
        tiktokSettings: {
          privacy_level: input.privacyLevel,
          allow_comment: !input.disableComment,
          allow_duet: !input.disableDuet,
          allow_stitch: !input.disableStitch,
          video_made_with_ai: true,
          content_preview_confirmed: true,
          express_consent_given: true,
          commercialContentType: input.brandContentToggle ? "brand_content" : input.brandOrganicToggle ? "brand_organic" : "none",
        },
      },
      fetchImpl: input.fetchImpl,
    });
    const post = payload.post || payload.existingPost;
    if (!post?._id) throw new ZernioApiError("ZERNIO_POST_MISSING", "Zernio 未返回发布任务。", 502);
    return post;
  } catch (error) {
    if (!(error instanceof ZernioApiError) || error.status !== 409) throw error;
    const existingPostId = /(?:existingPostId|postId)\s*[:=]\s*["']?([A-Za-z0-9_-]+)/i.exec(error.message)?.[1];
    if (!existingPostId) throw error;
    return { _id: existingPostId, status: "processing" } satisfies ZernioPost;
  }
}

export async function fetchZernioPost(input: { apiKey: string; baseUrl: string; postId: string; fetchImpl?: FetchLike }) {
  const payload = await requestJson<{ post?: ZernioPost }>({
    apiKey: input.apiKey,
    baseUrl: input.baseUrl,
    path: `/v1/posts/${encodeURIComponent(input.postId)}`,
    fetchImpl: input.fetchImpl,
  });
  if (!payload.post?._id) throw new ZernioApiError("ZERNIO_POST_MISSING", "Zernio 未返回发布状态。", 502);
  return payload.post;
}

export function zernioTikTokPostResult(post: ZernioPost, expectedAccountId: string) {
  const target = (post.platforms || []).find((item) => item.platform === "tiktok" && accountId(item.accountId) === expectedAccountId);
  return {
    status: boundedText(target?.status || post.status, "processing", 80).toLowerCase(),
    postId: target?.platformPostId || undefined,
    postUrl: target?.platformPostUrl || undefined,
    publishedAt: target?.publishedAt || post.publishedAt || undefined,
    errorCode: target?.errorCategory || undefined,
    errorMessage: target?.errorMessage || undefined,
  };
}
