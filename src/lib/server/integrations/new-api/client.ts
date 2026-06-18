import { randomUUID } from "node:crypto";

import { getNewApiConfig } from "./config";
import { NewApiError } from "./errors";
import { newApiLogger } from "./logger";
import { redactJson } from "./redaction";
import {
  type NewApiAuthContext,
  type NewApiConfig,
  type NewApiRequestOptions,
  type NewApiResponse,
} from "./types";

const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function appendQuery(url: URL, query?: NewApiRequestOptions["query"]) {
  if (!query) return;
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
}

function safePath(path: string) {
  if (!path.startsWith("/")) return `/${path}`;
  return path;
}

function contextHeaders(context: NewApiAuthContext, requestId: string) {
  const headers = new Headers({
    Accept: "application/json",
    "X-Request-Id": requestId,
  });

  if (context.kind === "admin") {
    if (!context.accessToken || !Number.isInteger(context.newApiUserId) || context.newApiUserId <= 0) {
      throw new NewApiError({
        code: "NEW_API_AUTH_FORBIDDEN",
        message: "Valid New API admin credentials are required.",
        status: 403,
        requestId,
        safeDetails: { context: "admin" },
      });
    }
    headers.set("Authorization", `Bearer ${context.accessToken}`);
    headers.set("New-Api-User", String(context.newApiUserId));
    return headers;
  }

  if (context.kind === "user") {
    if (!context.accessToken || !Number.isInteger(context.newApiUserId) || context.newApiUserId <= 0) {
      throw new NewApiError({
        code: "NEW_API_AUTH_FORBIDDEN",
        message: "Valid New API user credentials are required.",
        status: 403,
        requestId,
        safeDetails: { context: "user" },
      });
    }
    headers.set("Authorization", `Bearer ${context.accessToken}`);
    headers.set("New-Api-User", String(context.newApiUserId));
  }

  return headers;
}

async function readLimitedText(response: Response, maxBytes: number, requestId: string) {
  const reader = response.body?.getReader();
  if (!reader) return "";

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new NewApiError({
        code: "NEW_API_RESPONSE_TOO_LARGE",
        message: "New API response exceeded the configured size limit.",
        status: 502,
        retryable: false,
        requestId,
        upstreamStatus: response.status,
        safeDetails: { maxResponseBytes: maxBytes },
      });
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(bytes);
}

function isJsonResponse(response: Response) {
  const contentType = response.headers.get("content-type") || "";
  return contentType.toLowerCase().includes("application/json");
}

function statusRetryable(status: number) {
  return RETRYABLE_STATUSES.has(status);
}

function shouldRetry(method: string, status?: number, error?: unknown) {
  if (method !== "GET") return false;
  if (status !== undefined) return statusRetryable(status);
  return error instanceof TypeError;
}

function mapStatus(status: number) {
  if (status === 401) return 401;
  if (status === 403) return 403;
  if (status === 404) return 404;
  if (status === 429) return 429;
  if (status >= 500) return 502;
  return 502;
}

async function parseJson<T>(response: Response, requestId: string, maxBytes: number) {
  if (!isJsonResponse(response)) {
    throw new NewApiError({
      code: "NEW_API_INVALID_CONTENT_TYPE",
      message: "New API returned a non-JSON response.",
      status: 502,
      retryable: false,
      requestId,
      upstreamStatus: response.status,
      safeDetails: { contentType: response.headers.get("content-type") || "" },
    });
  }

  const text = await readLimitedText(response, maxBytes, requestId);
  try {
    return (text ? JSON.parse(text) : null) as T;
  } catch {
    throw new NewApiError({
      code: "NEW_API_INVALID_JSON",
      message: "New API returned invalid JSON.",
      status: 502,
      retryable: false,
      requestId,
      upstreamStatus: response.status,
    });
  }
}

async function requestOnce<T>(
  config: NewApiConfig,
  options: NewApiRequestOptions,
  requestId: string,
): Promise<NewApiResponse<T>> {
  if (!config.enabled) {
    throw new NewApiError({
      code: "NEW_API_DISABLED",
      message: "New API integration is disabled.",
      status: 503,
      retryable: false,
      requestId,
    });
  }

  const method = options.method || "GET";
  const url = new URL(`${config.baseUrl}${safePath(options.path)}`);
  appendQuery(url, options.query);

  const headers = contextHeaders(options.context, requestId);
  const init: RequestInit = {
    method,
    headers,
    signal: AbortSignal.timeout(options.timeoutMs ?? config.timeoutMs),
  };

  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
    init.body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    if ((error as Error).name === "TimeoutError" || (error as Error).name === "AbortError") {
      throw new NewApiError({
        code: "NEW_API_TIMEOUT",
        message: "New API request timed out.",
        status: 504,
        retryable: method === "GET",
        requestId,
      });
    }
    throw new NewApiError({
      code: "NEW_API_NETWORK",
      message: "New API network request failed.",
      status: 502,
      retryable: method === "GET",
      requestId,
    });
  }

  const payload = await parseJson<unknown>(response, requestId, options.maxResponseBytes ?? config.maxResponseBytes);
  if (!response.ok) {
    const safePayload = redactJson(payload);
    throw new NewApiError({
      code: "NEW_API_UPSTREAM_ERROR",
      message: `New API rejected the request with HTTP ${response.status}.`,
      status: mapStatus(response.status),
      retryable: statusRetryable(response.status),
      requestId,
      upstreamStatus: response.status,
      safeDetails: { upstreamStatus: response.status, body: JSON.stringify(safePayload).slice(0, 500) },
    });
  }

  return {
    data: payload as T,
    requestId,
    upstreamStatus: response.status,
  };
}

export class NewApiHttpClient {
  readonly config: NewApiConfig;

  constructor(config = getNewApiConfig()) {
    this.config = config;
  }

  async request<T>(options: NewApiRequestOptions): Promise<NewApiResponse<T>> {
    const requestId = options.requestId || randomUUID();
    const method = options.method || "GET";
    const retry = options.retry ?? method === "GET";
    const attempts = retry && method === "GET" ? 2 : 1;
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const response = await requestOnce<T>(this.config, options, requestId);
        newApiLogger.info({
          event: "request_ok",
          requestId,
          context: options.context.kind,
          method,
          path: options.path,
          status: response.upstreamStatus,
        });
        return response;
      } catch (error) {
        lastError = error;
        const retryable = error instanceof NewApiError
          ? error.retryable
          : shouldRetry(method, undefined, error);
        newApiLogger.warn({
          event: "request_failed",
          requestId,
          context: options.context.kind,
          method,
          path: options.path,
          retryable,
          details: { attempt },
        });
        if (!retryable || attempt >= attempts) break;
        await delay(250 * attempt);
      }
    }

    throw lastError;
  }
}

export function createNewApiHttpClient(config?: NewApiConfig) {
  return new NewApiHttpClient(config);
}

export function newApiAdminRequestContext(config: NewApiConfig, requestId: string = randomUUID()): NewApiAuthContext {
  if (!config.adminAccessToken || !config.adminUserId) {
    throw new NewApiError({
      code: "NEW_API_CONFIG_MISSING",
      message: "New API admin access token and admin user id are required for admin operations.",
      status: 500,
      requestId,
      safeDetails: { env: "NEW_API_ADMIN_ACCESS_TOKEN,NEW_API_ADMIN_USER_ID" },
    });
  }
  return {
    kind: "admin",
    newApiUserId: config.adminUserId,
    accessToken: config.adminAccessToken,
  };
}
