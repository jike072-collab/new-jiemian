import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

export const redactedValue = "[REDACTED]";

const maxDefaultStringLength = 500;
const maxDefaultDepth = 6;
const maxDefaultArrayLength = 50;
const maxDefaultStackLines = 5;

const sensitiveNormalizedNames = new Set([
  "authorization",
  "cookie",
  "setcookie",
  "apikey",
  "token",
  "accesstoken",
  "refreshtoken",
  "secret",
  "password",
  "adminpassword",
  "databaseurl",
  "appdatabaseurl",
  "newapi",
  "dsn",
  "sqldsn",
  "session",
  "webhooksecret",
  "accesskey",
  "secretaccesskey",
]);

const sensitiveTextPatterns = [
  /\b(Authorization|Cookie|Set-Cookie|X-Admin-Password|X-Api-Key)\s*[:=]\s*("[^"\r\n]*"|'[^'\r\n]*'|[^\r\n]+)/gi,
  /("[^"]*(?:password|secret|token|api[-_]?key|apikey|database[-_]?url|app[-_]?database[-_]?url|new[-_]?api|newapi|dsn|session)[^"]*"\s*:\s*)"[^"\r\n]*"/gi,
  /('[^']*(?:password|secret|token|api[-_]?key|apikey|database[-_]?url|app[-_]?database[-_]?url|new[-_]?api|newapi|dsn|session)[^']*'\s*:\s*)'[^'\r\n]*'/gi,
  /\b([A-Za-z0-9_.-]*(?:password|secret|token|api[-_]?key|apikey|database[-_]?url|app[-_]?database[-_]?url|new[-_]?api|newapi|dsn|session)[A-Za-z0-9_.-]*)\s*[:=]\s*("[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}\]\r\n]+)/gi,
  /([?&](?:password|secret|token|api[-_]?key|apikey|access_token|refresh_token|database_url|app_database_url|session|key)=)[^&\s"'()]+/gi,
  /postgres(?:ql)?:\/\/[^\s"')]+/gi,
  /\b([A-Za-z][A-Za-z0-9+.-]*:\/\/)[^:\s"'/]+:[^@\s"']+@([^\s"')]+)/gi,
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\bghp_[A-Za-z0-9_]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
];

export function isSensitiveLogKey(key) {
  const raw = String(key || "");
  const normalized = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!normalized) return false;
  if (sensitiveNormalizedNames.has(normalized)) return true;
  if (/(password|secret|token|authorization|cookie|apikey|databaseurl|appdatabaseurl|newapi|dsn|session)/.test(normalized)) {
    return true;
  }
  return /(^|[^a-z0-9])key([^a-z0-9]|$)/i.test(raw) || normalized === "key";
}

export function redactSensitiveText(value, options = {}) {
  const maxStringLength = Number(options.maxStringLength || maxDefaultStringLength);
  const text = String(value ?? "");
  if (isLargeEncodedPayload(text, options)) return redactedValue;
  let output = text;
  output = output.replace(sensitiveTextPatterns[0], "$1: [REDACTED]");
  output = output.replace(sensitiveTextPatterns[1], "$1\"[REDACTED]\"");
  output = output.replace(sensitiveTextPatterns[2], "$1'[REDACTED]'");
  output = output.replace(sensitiveTextPatterns[3], "$1=[REDACTED]");
  output = output.replace(sensitiveTextPatterns[4], "$1[REDACTED]");
  output = output.replace(sensitiveTextPatterns[5], "postgresql://[REDACTED]");
  output = output.replace(sensitiveTextPatterns[6], "$1[REDACTED]@$2");
  output = output.replace(sensitiveTextPatterns[7], "Bearer [REDACTED]");
  output = output.replace(sensitiveTextPatterns[8], redactedValue);
  output = output.replace(sensitiveTextPatterns[9], redactedValue);
  output = output.replace(sensitiveTextPatterns[10], redactedValue);
  if (output.length > maxStringLength) return `${output.slice(0, maxStringLength)}...[truncated]`;
  return output;
}

export function redactLogValue(value, options = {}) {
  return redactNestedValue(value, {
    maxDepth: Number(options.maxDepth || maxDefaultDepth),
    maxStringLength: Number(options.maxStringLength || maxDefaultStringLength),
    maxArrayLength: Number(options.maxArrayLength || maxDefaultArrayLength),
    maxStackLines: Number(options.maxStackLines || maxDefaultStackLines),
    seen: new WeakSet(),
  }, 0);
}

export function safeLogJson(value, options = {}) {
  return JSON.stringify(redactLogValue(value, options));
}

export function hasSecretValuePattern(value) {
  const text = String(value || "");
  return [
    /Authorization\s*[:=]\s*Bearer\s+[A-Za-z0-9._~+/=-]+/i,
    /Cookie\s*[:=]\s*[^;\s=]+=[^;\s]+/i,
    /Set-Cookie\s*[:=]\s*[^;\s=]+=[^;\s]+/i,
    /postgres(?:ql)?:\/\/[^:\s"']+:[^@\s"']+@/i,
    /\b(?:api[-_]?key|apikey|access_token|refresh_token|token|secret|password|admin_password)\s*[:=]\s*["']?(?!\[REDACTED\]|masked|configured|missing|true|false|null\b)[^"',\s;}]{6,}/i,
    /sk-[A-Za-z0-9_-]{20,}/,
    /ghp_[A-Za-z0-9_]{20,}/,
    /AKIA[0-9A-Z]{16}/,
  ].some((pattern) => pattern.test(text));
}

export function ensureDirectory(path) {
  mkdirSync(path, { recursive: true });
}

export function rotateLogFile(logFile, options = {}) {
  const maxBytes = options.maxBytes || 5 * 1024 * 1024;
  const keep = options.keep || 8;
  ensureDirectory(dirname(logFile));
  if (existsSync(logFile) && statSync(logFile).size >= maxBytes) {
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
    renameSync(logFile, `${logFile}.${stamp}`);
  }
  const dir = dirname(logFile);
  const base = logFile.slice(dir.length + 1);
  const rotated = readdirSync(dir)
    .filter((name) => name.startsWith(`${base}.`))
    .sort()
    .map((name) => join(dir, name));
  for (const oldFile of rotated.slice(0, Math.max(0, rotated.length - keep))) {
    rmSync(oldFile, { force: true });
  }
  return { logFile, rotatedPrefix: `${logFile}.`, maxBytes, keep };
}

function redactNestedValue(value, options, depth) {
  if (typeof value === "string") return redactSensitiveText(value, options);
  if (typeof value === "number" || typeof value === "boolean" || value == null) return value;
  if (typeof value === "bigint") return String(value);
  if (typeof value === "symbol" || typeof value === "function") return `[${typeof value}]`;
  if (depth >= options.maxDepth) return "[MaxDepth]";

  if (value instanceof Error) {
    return redactError(value, options);
  }

  if (typeof value === "object") {
    if (options.seen.has(value)) return "[Circular]";
    options.seen.add(value);
    if (Array.isArray(value)) {
      const items = value
        .slice(0, options.maxArrayLength)
        .map((item) => redactNestedValue(item, options, depth + 1));
      if (value.length > options.maxArrayLength) items.push(`[${value.length - options.maxArrayLength} more items]`);
      return items;
    }

    const output = {};
    for (const [key, nested] of Object.entries(value)) {
      if (isSensitiveLogKey(key)) {
        output[key] = redactedValue;
      } else {
        output[key] = redactNestedValue(nested, options, depth + 1);
      }
    }
    return output;
  }

  return String(value);
}

function redactError(error, options) {
  const stack = error.stack
    ? redactSensitiveText(error.stack, options).split(/\r?\n/).slice(0, options.maxStackLines).join("\n")
    : null;
  return {
    name: error.name || "Error",
    message: redactSensitiveText(error.message || "", options),
    stack,
  };
}

function isLargeEncodedPayload(value, options) {
  const maxStringLength = Number(options.maxStringLength || maxDefaultStringLength);
  const trimmed = String(value || "").trim();
  if (/^data:(image|video)\//i.test(trimmed)) return true;
  if (trimmed.length < Math.max(128, maxStringLength)) return false;
  if (/^[A-Za-z0-9+/=\r\n]+$/.test(trimmed) && trimmed.replace(/\s/g, "").length >= Math.max(128, maxStringLength)) {
    return true;
  }
  return false;
}
