import "server-only";

import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { createWriteStream } from "node:fs";
import { rename, stat, unlink } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";
import { basename, join } from "node:path";

import { allowedImageMimeTypes, allowedVideoMimeTypes, formatByteLimit, type RemoteMediaKind } from "../upload-limits";
import {
  assertBufferLengthAllowed,
  assertContentLengthAllowed,
  currentRemoteMediaLimitBytes,
} from "./media-upload-guard";
import { assertStorageAllows } from "./storage-capacity";
import { ensureRuntimeDirs, runtimeFileUrl, safeStoredName, uploadsRoot } from "./paths";

export type RemoteMediaDownloadOptions = {
  fallbackMime: string;
  prefix: string;
  headers?: HeadersInit;
  fetchImpl?: typeof fetch;
  lookupImpl?: typeof lookup;
  timeoutMs?: number;
  idleTimeoutMs?: number;
  maxRedirects?: number;
};

type SafeRemoteUrl = {
  url: URL;
  displayUrl: string;
  addresses: Array<{ address: string; family: 4 | 6 }>;
};

const defaultTimeoutMs = 180000;
const defaultIdleTimeoutMs = 30000;
const defaultMaxRedirects = 5;
const metadataHost = "169.254.169.254";
const allowedHostsEnvName = "REMOTE_MEDIA_ALLOWED_HOSTS";

export async function storeRemoteUrlStreamed(url: string, options: RemoteMediaDownloadOptions) {
  await ensureRuntimeDirs();
  const initialKind = remoteMediaKind(options.fallbackMime, options.prefix);
  await assertStorageAllows(initialKind === "video" ? "video-media-write" : "image-media-write", { fresh: true });

  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  const idleTimeoutMs = options.idleTimeoutMs ?? defaultIdleTimeoutMs;
  const controller = new AbortController();
  let timeoutKind: "total" | "idle" | null = null;
  let idleTimer: NodeJS.Timeout | null = null;
  const totalTimer = setTimeout(() => {
    timeoutKind = "total";
    controller.abort(new Error("remote media total timeout"));
  }, timeoutMs);

  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      timeoutKind = "idle";
      controller.abort(new Error("remote media idle timeout"));
    }, idleTimeoutMs);
  };

  const clearIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
  };

  try {
    const safeInitial = await assertSafeRemoteUrl(url, options.lookupImpl);
    const response = await fetchWithSafeRedirects(safeInitial, options, controller.signal);
    if (!response.ok) throw new Error(`Download generated media failed: HTTP ${response.status}`);

    const mimeType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() || options.fallbackMime;
    const kind = remoteMediaKind(mimeType, options.prefix);
    assertAllowedRemoteMime(kind, mimeType);
    assertContentLengthAllowed(response.headers.get("content-length"), kind);
    await assertStorageAllows(kind === "video" ? "video-media-write" : "image-media-write", { fresh: true });
    return await writeRemoteResponseToUploads(response, mimeType, kind, options.prefix, {
      signal: controller.signal,
      resetIdleTimer,
      clearIdleTimer,
    });
  } catch (error) {
    if (controller.signal.aborted || timeoutKind) {
      throw new Error(timeoutKind === "idle" ? "Remote media download timed out while reading the response body." : "Remote media download timed out.");
    }
    throw error;
  } finally {
    clearTimeout(totalTimer);
    clearIdleTimer();
  }
}

async function fetchWithSafeRedirects(initial: SafeRemoteUrl, options: RemoteMediaDownloadOptions, signal: AbortSignal) {
  let current = initial;
  let previousOrigin: string | null = null;
  const maxRedirects = options.maxRedirects ?? defaultMaxRedirects;
  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    const requestHeaders = requestHeadersForRemoteFetch(options.headers, previousOrigin, current.url.origin);
    const response = await fetchSafeRemote(current, requestHeaders, options.fetchImpl, signal);
    if (!isRedirect(response.status)) return response;
    await response.body?.cancel().catch(() => undefined);
    if (redirect === maxRedirects) throw new Error("Remote media download exceeded redirect limit.");
    const location = response.headers.get("location");
    if (!location) throw new Error("Remote media redirect is missing a location.");
    previousOrigin = current.url.origin;
    current = await assertSafeRemoteUrl(new URL(location, current.url).toString(), options.lookupImpl);
  }
  throw new Error("Remote media download exceeded redirect limit.");
}

async function fetchSafeRemote(
  safeUrl: SafeRemoteUrl,
  headers: Headers,
  fetchImpl: typeof fetch | undefined,
  signal: AbortSignal,
) {
  if (fetchImpl) {
    return fetchImpl(safeUrl.url, {
      method: "GET",
      headers,
      redirect: "manual",
      signal,
    });
  }
  return fetchPinnedRemote(safeUrl, headers, signal);
}

async function fetchPinnedRemote(safeUrl: SafeRemoteUrl, headers: Headers, signal: AbortSignal): Promise<Response> {
  const url = safeUrl.url;
  const target = safeUrl.addresses[0];
  if (!target) throw new Error("Remote media URL could not be resolved.");
  const requestImpl = url.protocol === "https:" ? httpsRequest : httpRequest;
  const requestHeaders = new Headers(headers);
  requestHeaders.set("host", url.host);

  return new Promise<Response>((resolvePromise, reject) => {
    const request = requestImpl({
      protocol: url.protocol,
      hostname: target.address,
      family: target.family,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      method: "GET",
      path: `${url.pathname}${url.search}`,
      headers: Object.fromEntries(requestHeaders.entries()),
      servername: url.hostname,
      signal,
    }, (incoming) => {
      const body = Readable.toWeb(incoming) as ReadableStream<Uint8Array>;
      resolvePromise(new Response(body, {
        status: incoming.statusCode || 0,
        statusText: incoming.statusMessage,
        headers: incoming.headers as HeadersInit,
      }));
    });
    request.on("error", reject);
    request.end();
  });
}

async function writeRemoteResponseToUploads(
  response: Response,
  mimeType: string,
  kind: RemoteMediaKind,
  prefix: string,
  options: {
    signal: AbortSignal;
    resetIdleTimer: () => void;
    clearIdleTimer: () => void;
  },
) {
  if (!response.body) throw new Error("Remote media response did not include a body.");
  const safePrefix = safeStoredName(prefix) || "remote-media";
  const storedName = safeStoredName(`${safePrefix}-${randomUUID()}${extensionForMime(mimeType)}`);
  const tempName = safeStoredName(`.remote-${safePrefix}-${randomUUID()}.tmp`);
  const tempPath = join(uploadsRoot, tempName);
  const finalPath = join(uploadsRoot, storedName);
  const limitBytes = currentRemoteLimitBytes(kind);
  let bytesWritten = 0;

  const metered = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      bytesWritten += chunk.byteLength;
      if (bytesWritten > limitBytes) {
        throw new Error(remoteLimitMessage(kind));
      }
      controller.enqueue(chunk);
    },
  });

  try {
    await writeReadableStreamToFile(response.body.pipeThrough(metered), tempPath, options);
    assertBufferLengthAllowed(bytesWritten, kind);
    options.signal.throwIfAborted();
    await rename(tempPath, finalPath);
    options.signal.throwIfAborted();
    const fileStat = await stat(finalPath);
    return {
      storedName,
      url: runtimeFileUrl(storedName),
      mimeType,
      size: fileStat.size,
    };
  } catch (error) {
    await response.body.cancel().catch(() => undefined);
    await unlink(tempPath).catch(() => undefined);
    await unlink(finalPath).catch(() => undefined);
    throw error;
  }
}

async function writeReadableStreamToFile(
  stream: ReadableStream<Uint8Array>,
  path: string,
  options: {
    signal: AbortSignal;
    resetIdleTimer: () => void;
    clearIdleTimer: () => void;
  },
) {
  const file = createWriteStream(path, { flags: "wx", mode: 0o600 });
  const reader = stream.getReader();
  const abortPromise = new Promise<never>((_resolve, reject) => {
    if (options.signal.aborted) reject(options.signal.reason || new Error("Remote media download aborted."));
    options.signal.addEventListener("abort", () => {
      reject(options.signal.reason || new Error("Remote media download aborted."));
    }, { once: true });
  });
  try {
    options.resetIdleTimer();
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), abortPromise]);
      if (done) break;
      await new Promise<void>((resolvePromise, reject) => {
        file.write(value, (error) => error ? reject(error) : resolvePromise());
      });
      options.resetIdleTimer();
    }
    options.clearIdleTimer();
    await new Promise<void>((resolvePromise, reject) => {
      file.end((error: Error | null | undefined) => error ? reject(error) : resolvePromise());
    });
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    file.destroy();
    throw error;
  } finally {
    options.clearIdleTimer();
    reader.releaseLock();
  }
}

function currentRemoteLimitBytes(kind: RemoteMediaKind) {
  return currentRemoteMediaLimitBytes(kind);
}

function remoteLimitMessage(kind: RemoteMediaKind) {
  return `${kind === "video" ? "视频" : "图片"}不能超过${formatByteLimit(currentRemoteLimitBytes(kind))}`;
}

function assertAllowedRemoteMime(kind: RemoteMediaKind, mimeType: string) {
  if (kind === "video" && allowedVideoMimeTypes.includes(mimeType as (typeof allowedVideoMimeTypes)[number])) return;
  if (kind === "image" && allowedImageMimeTypes.includes(mimeType as (typeof allowedImageMimeTypes)[number])) return;
  throw new Error("Remote media type is not supported.");
}

async function assertSafeRemoteUrl(raw: string, lookupImpl: typeof lookup = lookup): Promise<SafeRemoteUrl> {
  const url = parseHttpUrl(raw);
  assertAllowedRemoteHost(url.hostname);
  if (isUnsafeHostname(url.hostname)) throw new Error("Remote media URL points to a private or local network.");
  const addresses = await lookupImpl(url.hostname, { all: true, verbatim: false });
  if (addresses.length === 0) throw new Error("Remote media URL could not be resolved.");
  for (const address of addresses) {
    if (isUnsafeIp(address.address)) throw new Error("Remote media DNS resolved to a private or local network.");
  }
  return {
    url,
    displayUrl: safeDisplayUrl(url),
    addresses: addresses.map((address) => ({
      address: address.address,
      family: address.family === 6 ? 6 : 4,
    })),
  };
}

function parseHttpUrl(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Remote media URL is invalid.");
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Remote media URL protocol is not allowed.");
  if (url.username || url.password) throw new Error("Remote media URL credentials are not allowed.");
  return url;
}

function isRedirect(status: number) {
  return [301, 302, 303, 307, 308].includes(status);
}

function requestHeadersForRemoteFetch(baseHeaders: HeadersInit | undefined, previousOrigin: string | null, nextOrigin: string) {
  const requestHeaders = new Headers(baseHeaders);
  requestHeaders.delete("host");
  if (previousOrigin && previousOrigin !== nextOrigin && hasSensitiveRemoteHeaders(requestHeaders)) {
    throw new Error("Remote media redirect changed origin while authenticated headers were present.");
  }
  return requestHeaders;
}

function hasSensitiveRemoteHeaders(headers: Headers) {
  for (const [name] of headers.entries()) {
    if (/^(authorization|proxy-authorization|cookie|x-api-key|api-key|x-auth-token|x-access-token|x-amz-security-token)$/i.test(name)) {
      return true;
    }
  }
  return false;
}

function assertAllowedRemoteHost(hostname: string) {
  const rules = allowedRemoteHostRules();
  if (rules.length === 0) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(`${allowedHostsEnvName} must be configured before production remote media downloads.`);
    }
    return;
  }
  const normalized = normalizeHostname(hostname);
  if (rules.some((rule) => hostMatchesRule(normalized, rule))) return;
  throw new Error("Remote media host is not in the configured allowlist.");
}

function allowedRemoteHostRules() {
  return String(process.env[allowedHostsEnvName] || "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .map(parseAllowedHostRule)
    .filter((rule): rule is { type: "exact" | "subdomain"; host: string } => Boolean(rule));
}

function parseAllowedHostRule(raw: string) {
  if (raw === "*" || raw === ".*" || raw.endsWith(".*")) return null;
  if (raw.startsWith("*.")) {
    const host = normalizeHostname(raw.slice(2));
    return validAllowlistHost(host) ? { type: "subdomain" as const, host } : null;
  }
  const host = normalizeHostname(raw);
  return validAllowlistHost(host) ? { type: "exact" as const, host } : null;
}

function validAllowlistHost(host: string) {
  return Boolean(host && host.includes(".") && !host.startsWith(".") && !host.endsWith("."));
}

function hostMatchesRule(hostname: string, rule: { type: "exact" | "subdomain"; host: string }) {
  if (rule.type === "exact") return hostname === rule.host;
  return hostname.endsWith(`.${rule.host}`) && hostname !== rule.host;
}

function isUnsafeHostname(hostname: string) {
  const normalized = normalizeHostname(hostname);
  if (["localhost", "localhost.localdomain", metadataHost].includes(normalized)) return true;
  if (normalized.endsWith(".localhost")) return true;
  return isIP(normalized) !== 0 && isUnsafeIp(normalized);
}

function normalizeHostname(hostname: string) {
  return hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

function isUnsafeIp(address: string) {
  const normalized = normalizeHostname(address);
  const mappedIpv4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mappedIpv4) return isIpv4Unsafe(mappedIpv4);
  if (normalized === metadataHost) return true;
  if (isIpv4Unsafe(normalized)) return true;
  if (isIpv6Unsafe(normalized)) return true;
  return false;
}

function isIpv4Unsafe(address: string) {
  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return a === 0
    || a === 10
    || a === 127
    || a === 100 && b >= 64 && b <= 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 192 && b === 0)
    || (a === 192 && b === 88)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51)
    || (a === 203 && b === 0)
    || a >= 224;
}

function isIpv6Unsafe(address: string) {
  const normalized = normalizeHostname(address);
  return normalized === "::1"
    || normalized === "::"
    || normalized.startsWith("fe80:")
    || normalized.startsWith("fc")
    || normalized.startsWith("fd")
    || normalized.startsWith("2001:db8:");
}

function safeDisplayUrl(url: URL) {
  return `${url.protocol}//${url.host}${url.pathname ? `/${basename(url.pathname)}` : ""}`;
}

function extensionForMime(mimeType: string, fallback = ".bin") {
  const normalized = mimeType.split(";")[0].trim().toLowerCase();
  if (normalized === "image/png") return ".png";
  if (normalized === "image/jpeg") return ".jpg";
  if (normalized === "image/webp") return ".webp";
  if (normalized === "video/webm") return ".webm";
  if (normalized === "video/quicktime") return ".mov";
  if (normalized === "video/mp4") return ".mp4";
  return fallback;
}

function remoteMediaKind(mimeType: string, prefix: string): RemoteMediaKind {
  return mimeType.toLowerCase().includes("video") || prefix.toLowerCase().includes("video") ? "video" : "image";
}

export const remoteMediaDownloadInternalsForTests = {
  assertAllowedRemoteHost,
  assertSafeRemoteUrl,
  fetchPinnedRemote,
  isUnsafeIp,
  safeDisplayUrl,
};
