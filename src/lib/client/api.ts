import type { ErrorDiagnostic } from "@/lib/error-diagnostic-catalog";

type ApiErrorPayload = {
  code?: string;
  message?: string;
  uiState?: string;
  retryAfterSeconds?: number;
  error?: string;
  diagnostic?: ErrorDiagnostic;
};

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly uiState?: string;
  readonly retryAfterSeconds?: number;
  readonly diagnostic?: ErrorDiagnostic;

  constructor(message: string, status: number, payload: ApiErrorPayload = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = payload.diagnostic?.code || payload.code;
    this.uiState = payload.uiState;
    this.retryAfterSeconds = payload.retryAfterSeconds;
    this.diagnostic = payload.diagnostic;
  }
}

async function readResponseData(response: Response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json().catch(() => ({}));
  }
  return response.text().catch(() => "");
}

function extractErrorMessage(payload: unknown, fallback: string) {
  if (!payload) return fallback;
  if (typeof payload === "string" && payload.trim()) {
    const text = payload.trim();
    if (/^<!doctype html/i.test(text) || /^<html[\s>]/i.test(text) || /<title>\s*502/i.test(text)) {
      return "服务暂时不可用，请稍后重试。";
    }
    return text;
  }
  if (typeof payload !== "object" || Array.isArray(payload)) return fallback;
  const record = payload as ApiErrorPayload & { detail?: string };
  return record.message || record.error || record.detail || fallback;
}

export async function fetchJson<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    credentials: "same-origin",
    ...options,
    headers: options.headers,
  });
  const payload = await readResponseData(response);
  if (!response.ok) {
    throw new ApiError(extractErrorMessage(payload, "请求失败。"), response.status, (
      typeof payload === "object" && payload !== null && !Array.isArray(payload)
        ? payload as ApiErrorPayload
        : {}
    ));
  }
  return payload as T;
}

let cachedCsrfToken: string | null = null;
let csrfTokenRequest: Promise<string> | null = null;

export async function getCsrfToken() {
  if (cachedCsrfToken) return cachedCsrfToken;
  if (!csrfTokenRequest) {
    csrfTokenRequest = fetchJson<{ ok: true; csrfToken: string }>("/api/auth/csrf")
      .then((data) => {
        cachedCsrfToken = data.csrfToken;
        return data.csrfToken;
      })
      .finally(() => {
        csrfTokenRequest = null;
      });
  }
  return csrfTokenRequest;
}

export async function fetchJsonWithCsrf<T>(url: string, options: RequestInit = {}): Promise<T> {
  const csrfToken = await getCsrfToken();
  const send = (token: string) => {
    const headers = new Headers(options.headers || {});
    headers.set("x-csrf-token", token);
    if (options.body instanceof FormData) {
      headers.delete("content-type");
    } else if (options.body !== undefined && !headers.has("content-type")) {
      headers.set("Content-Type", "application/json");
    }
    return fetchJson<T>(url, {
      ...options,
      headers,
    });
  };
  try {
    return await send(csrfToken);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 403 || error.code !== "AUTH_CSRF_REQUIRED") throw error;
    if (cachedCsrfToken === csrfToken) cachedCsrfToken = null;
    return send(await getCsrfToken());
  }
}

export function resetCsrfTokenForTests() {
  cachedCsrfToken = null;
  csrfTokenRequest = null;
}
