import "server-only";

import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { rename, stat, unlink } from "node:fs/promises";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { basename, join } from "node:path";

import { formatByteLimit, type RemoteMediaKind } from "../upload-limits";
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
  maxRedirects?: number;
};

type SafeRemoteUrl = {
  url: URL;
  displayUrl: string;
};

const defaultTimeoutMs = 180000;
const defaultMaxRedirects = 5;
const metadataHost = "169.254.169.254";

export async function storeRemoteUrlStreamed(url: string, options: RemoteMediaDownloadOptions) {
  await ensureRuntimeDirs();
  const initialKind = remoteMediaKind(options.fallbackMime, options.prefix);
  await assertStorageAllows(initialKind === "video" ? "video-media-write" : "image-media-write", { fresh: true });
  const safeInitial = await assertSafeRemoteUrl(url, options.lookupImpl);
  const response = await fetchWithSafeRedirects(safeInitial, options);
  if (!response.ok) throw new Error(`Download generated media failed: HTTP ${response.status}`);

  const mimeType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() || options.fallbackMime;
  const kind = remoteMediaKind(mimeType, options.prefix);
  assertAllowedRemoteMime(kind, mimeType);
  assertContentLengthAllowed(response.headers.get("content-length"), kind);
  await assertStorageAllows(kind === "video" ? "video-media-write" : "image-media-write", { fresh: true });
  return writeRemoteResponseToUploads(response, mimeType, kind, options.prefix);
}

async function fetchWithSafeRedirects(initial: SafeRemoteUrl, options: RemoteMediaDownloadOptions) {
  const fetchImpl = options.fetchImpl || fetch;
  let current = initial;
  const maxRedirects = options.maxRedirects ?? defaultMaxRedirects;
  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? defaultTimeoutMs);
    try {
      const response = await fetchImpl(current.url, {
        method: "GET",
        headers: options.headers,
        redirect: "manual",
        signal: controller.signal,
      });
      if (!isRedirect(response.status)) return response;
      if (redirect === maxRedirects) throw new Error("Remote media download exceeded redirect limit.");
      const location = response.headers.get("location");
      if (!location) throw new Error("Remote media redirect is missing a location.");
      current = await assertSafeRemoteUrl(new URL(location, current.url).toString(), options.lookupImpl);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("Remote media download exceeded redirect limit.");
}

async function writeRemoteResponseToUploads(response: Response, mimeType: string, kind: RemoteMediaKind, prefix: string) {
  if (!response.body) throw new Error("Remote media response did not include a body.");
  const storedName = safeStoredName(`${prefix}-${randomUUID()}${extensionForMime(mimeType)}`);
  const tempName = safeStoredName(`.remote-${prefix}-${randomUUID()}.tmp`);
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
    await writeReadableStreamToFile(response.body.pipeThrough(metered), tempPath);
    assertBufferLengthAllowed(bytesWritten, kind);
    await rename(tempPath, finalPath);
    const fileStat = await stat(finalPath);
    return {
      storedName,
      url: runtimeFileUrl(storedName),
      mimeType,
      size: fileStat.size,
    };
  } catch (error) {
    await unlink(tempPath).catch(() => undefined);
    await unlink(finalPath).catch(() => undefined);
    throw error;
  }
}

async function writeReadableStreamToFile(stream: ReadableStream<Uint8Array>, path: string) {
  const file = createWriteStream(path, { flags: "wx", mode: 0o600 });
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      await new Promise<void>((resolve, reject) => {
        file.write(value, (error) => error ? reject(error) : resolve());
      });
    }
    await new Promise<void>((resolve, reject) => {
      file.end((error: Error | null | undefined) => error ? reject(error) : resolve());
    });
  } catch (error) {
    file.destroy();
    throw error;
  } finally {
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
  if (kind === "video" && ["video/mp4", "video/webm", "video/quicktime"].includes(mimeType)) return;
  if (kind === "image" && ["image/png", "image/jpeg", "image/webp"].includes(mimeType)) return;
  throw new Error("Remote media type is not supported.");
}

async function assertSafeRemoteUrl(raw: string, lookupImpl: typeof lookup = lookup): Promise<SafeRemoteUrl> {
  const url = parseHttpUrl(raw);
  if (isUnsafeHostname(url.hostname)) throw new Error("Remote media URL points to a private or local network.");
  const addresses = await lookupImpl(url.hostname, { all: true, verbatim: false });
  if (addresses.length === 0) throw new Error("Remote media URL could not be resolved.");
  for (const address of addresses) {
    if (isUnsafeIp(address.address)) throw new Error("Remote media DNS resolved to a private or local network.");
  }
  return { url, displayUrl: safeDisplayUrl(url) };
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

function isUnsafeHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (["localhost", "localhost.localdomain", metadataHost].includes(normalized)) return true;
  if (normalized.endsWith(".localhost")) return true;
  return isIP(normalized) !== 0 && isUnsafeIp(normalized);
}

function isUnsafeIp(address: string) {
  const normalized = address.toLowerCase();
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
  const normalized = address.replace(/^\[|\]$/g, "");
  return normalized === "::1"
    || normalized === "::"
    || normalized.startsWith("fe80:")
    || normalized.startsWith("fc")
    || normalized.startsWith("fd")
    || normalized.startsWith("2001:db8:")
    || normalized.startsWith("::ffff:127.")
    || normalized.startsWith("::ffff:10.")
    || normalized.startsWith("::ffff:192.168.")
    || normalized.startsWith("::ffff:169.254.");
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
  assertSafeRemoteUrl,
  isUnsafeIp,
  safeDisplayUrl,
};
