import { createHash } from "node:crypto";

export function nowIso(now?: Date) {
  return (now || new Date()).toISOString();
}

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

export function normalizeIdentifier(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized.includes("@") ? normalizeEmail(normalized) : normalizeUsername(normalized);
}

export function normalizePhone(value: string) {
  const compact = value.trim().replace(/[\s().-]+/g, "");
  if (compact.startsWith("+86")) return compact.slice(3);
  if (compact.startsWith("86") && compact.length === 13) return compact.slice(2);
  return compact;
}

export function isValidPhone(value: string) {
  const phone = normalizePhone(value);
  return /^1[3-9]\d{9}$/.test(phone) || /^\+\d{8,15}$/.test(phone);
}

export function normalizeAuthIdentifier(value: string) {
  const trimmed = value.trim();
  if (trimmed.includes("@")) {
    const email = normalizeEmail(trimmed);
    return isValidEmail(email) ? { kind: "email" as const, value: email } : null;
  }
  const phone = normalizePhone(trimmed);
  if (isValidPhone(phone)) return { kind: "phone" as const, value: phone };
  return null;
}

export function isValidEmail(value: string) {
  const email = normalizeEmail(value);
  return email.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
}

export function isValidUsername(value: string) {
  const username = normalizeUsername(value);
  return username.length >= 3
    && username.length <= 6
    && /^[a-z0-9_.-]+$/.test(username);
}

export function usernameFromEmail(email: string) {
  const prefix = normalizeEmail(email).split("@")[0].replace(/[^a-z0-9_.-]+/g, "-");
  const fallback = `user-${sha256(email).slice(0, 8)}`;
  return (prefix || fallback).slice(0, 24);
}

export function placeholderEmailFromPhone(phone: string) {
  return `phone-${sha256(phone).slice(0, 16)}@phone.aohuang.local`;
}

export function publicSafeString(value: unknown, maxLength = 120) {
  return String(value || "").trim().slice(0, maxLength);
}

export function safeRedirectPath(value: unknown) {
  const redirectTo = String(value || "/").trim();
  if (!redirectTo.startsWith("/")) return "/";
  if (redirectTo.startsWith("//")) return "/";
  if (redirectTo.includes("\\\\")) return "/";
  return redirectTo || "/";
}
