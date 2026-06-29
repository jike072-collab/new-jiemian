import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { readStoredFile, storeBytes } from "./library";
import { safeStoredName } from "./paths";
import { isTunnelTestRuntime } from "./tunneltest-limits";

const referencePrefix = "video-reference";

function inviteSecret() {
  return process.env.TEST_INVITE_CODE?.trim() || "";
}

function isEnabled() {
  return isTunnelTestRuntime() && Boolean(inviteSecret());
}

function signatureFor(storedName: string) {
  return createHmac("sha256", inviteSecret())
    .update(`tunneltest-reference:${storedName}`)
    .digest("hex");
}

function verifySignature(storedName: string, signature: string | null | undefined) {
  if (!isEnabled() || !signature) return false;
  const expected = signatureFor(storedName);
  const actual = signature.trim();
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

function mimeFromName(name: string) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}

export async function createTunneltestReferenceImageUrl(input: {
  baseUrl?: string | null;
  bytes: Buffer;
  mimeType: string;
}) {
  if (!isEnabled() || !input.baseUrl?.trim()) return "";
  const stored = await storeBytes(input.bytes, input.mimeType, referencePrefix);
  const url = new URL(`/api/tunneltest/reference-images/${encodeURIComponent(stored.storedName)}`, input.baseUrl);
  url.searchParams.set("sig", signatureFor(stored.storedName));
  return url.toString();
}

export async function readTunneltestReferenceImage(storedName: string, signature: string | null | undefined) {
  const safeName = safeStoredName(storedName);
  if (!safeName || safeName !== storedName || !safeName.startsWith(`${referencePrefix}-`)) return null;
  if (!verifySignature(safeName, signature)) return null;
  const bytes = await readStoredFile(safeName).catch(() => null);
  if (!bytes) return null;
  return {
    bytes,
    mimeType: mimeFromName(safeName),
  };
}
