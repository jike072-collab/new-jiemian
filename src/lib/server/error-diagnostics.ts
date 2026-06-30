import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import {
  errorDiagnosticMeta,
  type ErrorDiagnostic,
  type ErrorDiagnosticCode,
} from "../error-diagnostic-catalog";

type DiagnosticContext = {
  requestId?: string | null;
  providerId?: string | null;
  model?: string | null;
  tool?: string | null;
  operation?: string | null;
  defaultCode?: ErrorDiagnosticCode;
  status?: number;
  upstreamStatus?: number;
  safeDetails?: Record<string, unknown>;
};

type ResponseContext = DiagnosticContext & {
  fallbackMessage: string;
};

export class GenerationDiagnosticError extends Error {
  readonly code: ErrorDiagnosticCode;
  readonly publicMessage?: string;
  readonly status?: number;
  readonly upstreamStatus?: number;
  readonly providerId?: string;
  readonly model?: string;
  readonly safeDetails: Record<string, unknown>;

  constructor(input: {
    code: ErrorDiagnosticCode;
    message?: string;
    publicMessage?: string;
    status?: number;
    upstreamStatus?: number;
    providerId?: string | null;
    model?: string | null;
    safeDetails?: Record<string, unknown>;
    cause?: unknown;
  }) {
    super(input.message || errorDiagnosticMeta(input.code).message);
    this.name = "GenerationDiagnosticError";
    this.code = input.code;
    this.publicMessage = input.publicMessage;
    this.status = input.status;
    this.upstreamStatus = input.upstreamStatus;
    this.providerId = input.providerId || undefined;
    this.model = input.model || undefined;
    this.safeDetails = input.safeDetails || {};
    if (input.cause !== undefined) {
      this.cause = input.cause;
    }
  }
}

export function createRequestId(value?: string | null) {
  return value?.trim() || randomUUID();
}

export function redactSensitiveText(value: unknown): string {
  const text = String(value ?? "");
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/(Authorization\s*[:=]\s*)[^\s,;}]+/gi, "$1[redacted]")
    .replace(/(Cookie\s*[:=]\s*)[^;\n\r]+/gi, "$1[redacted]")
    .replace(/HMAC-SHA256\s+Credential=[^\s,;}]+/gi, "HMAC-SHA256 Credential=[redacted]")
    .replace(/\b(Signature|SignedHeaders|Credential)\s*=\s*[^,\s;}]+/gi, "$1=[redacted]")
    .replace(/\b(sk|ak|pk|key|token|secret|password)[-_A-Za-z0-9]*\b\s*[:=]\s*["']?[^"',\s;}]+/gi, "$1=[redacted]")
    .replace(/(APP_DATABASE_URL|ADMIN_PASSWORD)\s*[:=]\s*["']?[^"',\s;}]+/gi, "$1=[redacted]")
    .replace(/postgres(?:ql)?:\/\/[^\s"')]+/gi, "postgresql://[redacted]")
    .replace(/([?&](?:token|key|secret|password|api_key)=)[^&\s"')]+/gi, "$1[redacted]")
    .replace(/[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g, "[redacted.jwt]")
    .replace(/[A-Za-z]:[\\/][^\s"',;}]+/g, "[redacted.path]")
    .slice(0, 500);
}

export function redactDiagnosticPayload(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactSensitiveText(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redactDiagnosticPayload(item));
  if (typeof value !== "object") return redactSensitiveText(value);
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (/authorization|cookie|api[-_]?key|secret|password|token|database[-_]?url|signature|credential|path|response/i.test(key)) {
      out[key] = "[redacted]";
      continue;
    }
    out[key] = redactDiagnosticPayload(item);
  }
  return out;
}

export function codeForUpstreamStatus(status: number): ErrorDiagnosticCode {
  if (status === 400) return "PROVIDER_BAD_REQUEST";
  if (status === 401) return "PROVIDER_AUTH_FAILED";
  if (status === 403) return "PROVIDER_FORBIDDEN";
  if (status === 404) return "MODEL_NOT_FOUND";
  if (status === 408 || status === 504) return "PROVIDER_TIMEOUT";
  if (status === 409) return "TASK_FAILED";
  if (status === 429) return "PROVIDER_RATE_LIMITED";
  if (status >= 500) return "PROVIDER_UPSTREAM_5XX";
  if (status >= 400) return "PROVIDER_UPSTREAM_4XX";
  return "PROVIDER_BAD_RESPONSE";
}

export function codeForThrownError(error: unknown, fallback: ErrorDiagnosticCode = "UNKNOWN_ERROR"): ErrorDiagnosticCode {
  if (error instanceof GenerationDiagnosticError) return error.code;
  const message = error instanceof Error ? error.message : String(error || "");
  if (error instanceof DOMException && error.name === "TimeoutError") return "PROVIDER_TIMEOUT";
  if (/abort|timeout|timed out/i.test(message)) return "PROVIDER_TIMEOUT";
  if (/fetch failed|ECONN|ENOTFOUND|EAI_AGAIN|network|socket|TLS|certificate/i.test(message)) return "PROVIDER_NETWORK_ERROR";
  if (/未配置|not configured|no provider/i.test(message)) return "PROVIDER_NOT_CONFIGURED";
  if (/未启用|disabled/i.test(message)) return "PROVIDER_DISABLED";
  if (/api key|apikey|authorization|认证|401/i.test(message)) return "PROVIDER_AUTH_FAILED";
  if (/403|forbidden|权限|拒绝/i.test(message)) return "PROVIDER_FORBIDDEN";
  if (/429|rate limit|too many/i.test(message)) return "PROVIDER_RATE_LIMITED";
  if (/prompt|提示词/i.test(message)) return "INPUT_MISSING_PROMPT";
  if (/超过|too large|\d+(?:\.\d+)?\s*(?:GB|MB|MiB)/i.test(message)) return "INPUT_FILE_TOO_LARGE";
  if (/上传|图片|image|首帧|file/i.test(message)) {
    if (/超过|too large|\d+(?:\.\d+)?\s*(?:GB|MB|MiB)/i.test(message)) return "INPUT_FILE_TOO_LARGE";
    if (/PNG|JPEG|WebP|MP4|WebM|MOV|格式|format/i.test(message)) return "INPUT_UNSUPPORTED_FORMAT";
    if (/读取|read/i.test(message)) return "UPLOAD_READ_FAILED";
    return "INPUT_MISSING_IMAGE";
  }
  if (/参数|scale|duration|ratio|invalid/i.test(message)) return "INPUT_INVALID_PARAMETERS";
  if (/任务不存在|not found/i.test(message)) return "TASK_POLL_FAILED";
  if (/任务.*失败|task.*failed|failed state/i.test(message)) return "TASK_FAILED";
  if (/保存|store|library|下载生成结果|结果文件/i.test(message)) return "LIBRARY_SAVE_FAILED";
  return fallback;
}

export function createErrorDiagnostic(error: unknown, context: DiagnosticContext = {}): ErrorDiagnostic {
  const code = codeForThrownError(error, context.defaultCode);
  const meta = errorDiagnosticMeta(code);
  const diagnosticError = error instanceof GenerationDiagnosticError ? error : null;
  const status = context.status || diagnosticError?.status || meta.status;
  const upstreamStatus = context.upstreamStatus || diagnosticError?.upstreamStatus;
  const technicalMessage = redactSensitiveText(error instanceof Error ? error.message : String(error || meta.message));
  const safeDetails = redactDiagnosticPayload({
    ...(context.tool ? { tool: context.tool } : {}),
    ...(context.operation ? { operation: context.operation } : {}),
    ...(context.safeDetails || {}),
    ...(diagnosticError?.safeDetails || {}),
  }) as Record<string, unknown>;

  return {
    code,
    category: meta.category,
    message: diagnosticError?.publicMessage || meta.message,
    technicalMessage,
    retryable: meta.retryable,
    requestId: createRequestId(context.requestId),
    occurredAt: new Date().toISOString(),
    status,
    ...(upstreamStatus ? { upstreamStatus } : {}),
    ...(context.providerId || diagnosticError?.providerId ? { providerId: String(context.providerId || diagnosticError?.providerId) } : {}),
    ...(context.model || diagnosticError?.model ? { model: String(context.model || diagnosticError?.model) } : {}),
    action: meta.action,
    adminNote: meta.adminNote,
    safeDetails,
  };
}

export function logDiagnosticEvent(diagnostic: ErrorDiagnostic) {
  const event = {
    event: "generation_error_diagnostic",
    requestId: diagnostic.requestId,
    code: diagnostic.code,
    category: diagnostic.category,
    retryable: diagnostic.retryable,
    status: diagnostic.status,
    upstreamStatus: diagnostic.upstreamStatus,
    providerId: diagnostic.providerId,
    model: diagnostic.model,
    safeDetails: diagnostic.safeDetails,
  };
  console.error(JSON.stringify(redactDiagnosticPayload(event)));
}

export function diagnosticErrorResponse(error: unknown, context: ResponseContext) {
  const diagnostic = createErrorDiagnostic(error, context);
  logDiagnosticEvent(diagnostic);
  return NextResponse.json({
    error: diagnostic.message || context.fallbackMessage,
    diagnostic,
  }, { status: diagnostic.status });
}
