import "server-only";

import { randomUUID } from "node:crypto";
import { readdir, stat, unlink, writeFile } from "node:fs/promises";
import { extname } from "node:path";

import { hmacSha256, timingSafeStringEqual } from "./auth/secrets";
import { ensureRuntimeDirs, resolveUploadPath } from "./paths";

const referencePrefix = "provider-reference-";
const referenceLifetimeSeconds = 2 * 60 * 60;
const referenceNamePattern = /^provider-reference-(\d{10})-([a-f0-9-]{36})(\.[a-z0-9]+)\.tmp$/i;
let lastCleanupAt = 0;

function publicBaseUrl() {
  const value = process.env.APP_PUBLIC_BASE_URL || process.env.PUBLIC_APP_URL || process.env.NEXT_PUBLIC_APP_URL || "";
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("invalid protocol");
    return url.toString().replace(/\/+$/, "");
  } catch {
    throw new Error("视频参考素材需要配置 APP_PUBLIC_BASE_URL。");
  }
}

function extensionFor(fileName: string, mimeType: string) {
  const extension = extname(fileName).toLowerCase();
  if (/^\.[a-z0-9]{2,5}$/.test(extension)) return extension;
  if (mimeType === "video/webm") return ".webm";
  if (mimeType === "video/quicktime") return ".mov";
  if (mimeType.startsWith("video/")) return ".mp4";
  if (mimeType === "audio/mpeg") return ".mp3";
  if (mimeType === "audio/wav" || mimeType === "audio/x-wav") return ".wav";
  return ".m4a";
}

function signatureValue(name: string, expires: number) {
  return hmacSha256(`provider-reference:${name}:${expires}`);
}

async function cleanupExpiredProviderReferences(nowSeconds: number) {
  if (Date.now() - lastCleanupAt < 60_000) return;
  lastCleanupAt = Date.now();
  await ensureRuntimeDirs();
  const names = await readdir(resolveUploadPath("."));
  const expired = names
    .filter((name) => name.startsWith(referencePrefix))
    .map((name) => ({ name, match: referenceNamePattern.exec(name) }))
    .filter((entry): entry is { name: string; match: RegExpExecArray } => Boolean(entry.match) && Number(entry.match?.[1]) < nowSeconds)
    .slice(0, 20);
  await Promise.all(expired.map((entry) => unlink(resolveUploadPath(entry.name)).catch(() => undefined)));
}

export async function storeProviderReference(input: { bytes: Buffer; mimeType: string; fileName: string }) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const expires = nowSeconds + referenceLifetimeSeconds;
  await cleanupExpiredProviderReferences(nowSeconds);
  const name = `${referencePrefix}${expires}-${randomUUID()}${extensionFor(input.fileName, input.mimeType)}.tmp`;
  await writeFile(resolveUploadPath(name), input.bytes, { mode: 0o600, flag: "wx" });
  const signature = signatureValue(name, expires);
  return {
    name,
    path: resolveUploadPath(name),
    url: `${publicBaseUrl()}/api/provider-reference/${encodeURIComponent(name)}/${expires}/${encodeURIComponent(signature)}`,
  };
}

export async function resolveProviderReference(name: string, expiresValue: string | null, signature: string | null) {
  const match = referenceNamePattern.exec(name);
  const expires = Number(expiresValue);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!match || !Number.isSafeInteger(expires) || expires !== Number(match[1]) || expires < nowSeconds || !signature) return null;
  if (!timingSafeStringEqual(signatureValue(name, expires), signature)) return null;
  const path = resolveUploadPath(name);
  const metadata = await stat(path).catch(() => null);
  if (!metadata?.isFile()) return null;
  return { path, size: metadata.size };
}

export function providerReferenceMimeType(name: string) {
  const normalized = name.toLowerCase().replace(/\.tmp$/, "");
  if (normalized.endsWith(".webm")) return "video/webm";
  if (normalized.endsWith(".mov")) return "video/quicktime";
  if (normalized.endsWith(".mp4")) return "video/mp4";
  if (normalized.endsWith(".mp3")) return "audio/mpeg";
  if (normalized.endsWith(".wav")) return "audio/wav";
  if (normalized.endsWith(".m4a")) return "audio/mp4";
  return "application/octet-stream";
}
