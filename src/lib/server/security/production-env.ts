import {
  BYTES_PER_MIB,
  imageUploadDefaultMiB,
  uploadHardCapMiB,
  videoUploadDefaultMiB,
} from "../../upload-limits";
import {
  mediaRetentionMaxHours,
  mediaRetentionMinHours,
} from "../../media-retention";
import { resolveStorageThresholds } from "../../storage-capacity-policy";

export type RuntimeEnvironmentTarget = "production" | "local-staging";

export type RuntimeEnvironmentIssue = {
  variable: string;
  reason: string;
};

export type RuntimeEnvironmentReport = {
  ok: boolean;
  target: RuntimeEnvironmentTarget;
  issues: RuntimeEnvironmentIssue[];
};

export type RuntimeEnvironmentOptions = {
  nodeVersion?: string;
};

type RuntimeEnv = Record<string, string | undefined>;

const weakAdminPasswords = new Set([
  "admin",
  "administrator",
  "password",
  "123456",
  "12345678",
  "changeme",
  "change_me",
  "change-me",
  "replace_me",
  "replace-with-strong-admin-password",
]);

const endpointTypes = new Set([
  "images-generations",
  "images-edits",
  "chat-completions",
  "videos-generations",
  "grok-videos",
  "volcengine-imagex-upscale",
  "volcengine-vod-upscale",
]);

const trueValues = new Set(["1", "true", "yes", "on"]);
const falseValues = new Set(["0", "false", "no", "off"]);
const remoteMediaPlaceholderHosts = new Set([
  "required",
  "change_me",
  "change-me",
  "example.com",
  "example.invalid",
  "media.example.invalid",
  "*.media.example.invalid",
  "media.example.test",
  "*.media.example.test",
]);

function value(env: RuntimeEnv, name: string) {
  return String(env[name] || "").trim();
}

function hasValue(env: RuntimeEnv, name: string) {
  return value(env, name).length > 0;
}

function issue(issues: RuntimeEnvironmentIssue[], variable: string, reason: string) {
  issues.push({ variable, reason });
}

function nodeMajor(version: string) {
  const match = /^v?(\d+)\./.exec(version.trim());
  return match ? Number(match[1]) : NaN;
}

function checkNode24(issues: RuntimeEnvironmentIssue[], options: RuntimeEnvironmentOptions) {
  const version = options.nodeVersion || process.versions.node;
  if (nodeMajor(version) !== 24) {
    issue(issues, "NODE_VERSION", "must be Node.js 24.x.");
  }
}

function isLoopbackHost(host: string) {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "127.0.0.1"
    || normalized === "localhost"
    || normalized === "::1"
    || normalized === "::ffff:127.0.0.1";
}

function isLinuxAbsolutePath(path: string) {
  return path.startsWith("/") && !/^[A-Za-z]:/.test(path) && !path.includes("\\");
}

function normalizeLinuxPath(path: string) {
  return path.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
}

function isSameOrInsideLinuxPath(child: string, parent: string) {
  const normalizedChild = normalizeLinuxPath(child);
  const normalizedParent = normalizeLinuxPath(parent);
  return normalizedChild === normalizedParent || normalizedChild.startsWith(`${normalizedParent}/`);
}

function isForbiddenPermanentPath(path: string) {
  const normalized = normalizeLinuxPath(path);
  return normalized === "/tmp"
    || normalized.startsWith("/tmp/")
    || normalized === "/var/tmp"
    || normalized.startsWith("/var/tmp/")
    || normalized.includes("/.next/")
    || normalized.endsWith("/.next")
    || normalized.includes("/node_modules/")
    || normalized.endsWith("/node_modules")
    || normalized.includes("/release-smoke/")
    || normalized.includes("/release-worktrees/")
    || normalized.includes("/.runtime/releases/");
}

function checkLinuxRuntimePath(issues: RuntimeEnvironmentIssue[], env: RuntimeEnv, name: string) {
  const raw = value(env, name);
  if (!raw) {
    issue(issues, name, "is required for production runtime storage.");
    return;
  }
  if (!isLinuxAbsolutePath(raw)) {
    issue(issues, name, "must be a Linux absolute path.");
    return;
  }
  if (isForbiddenPermanentPath(raw)) {
    issue(issues, name, "must not point inside temporary, build, dependency, or release scratch directories.");
  }
}

function checkNonOverlappingPaths(issues: RuntimeEnvironmentIssue[], env: RuntimeEnv) {
  const dataDir = value(env, "DATA_DIR");
  const uploadsDir = value(env, "UPLOADS_DIR");
  if (!isLinuxAbsolutePath(dataDir) || !isLinuxAbsolutePath(uploadsDir)) return;
  if (isSameOrInsideLinuxPath(dataDir, uploadsDir) || isSameOrInsideLinuxPath(uploadsDir, dataDir)) {
    issue(issues, "DATA_DIR/UPLOADS_DIR", "must not be the same path or nested inside each other.");
  }
}

function checkAdminPassword(issues: RuntimeEnvironmentIssue[], env: RuntimeEnv) {
  const password = value(env, "ADMIN_PASSWORD");
  const normalized = password.toLowerCase();
  if (!password) {
    issue(issues, "ADMIN_PASSWORD", "is required in production.");
    return;
  }
  if (weakAdminPasswords.has(normalized) || normalized.includes("changeme")) {
    issue(issues, "ADMIN_PASSWORD", "must not be a known weak or placeholder password.");
    return;
  }
  if (password.length < 12) {
    issue(issues, "ADMIN_PASSWORD", "must be at least 12 characters.");
    return;
  }
  const classes = [
    /[a-z]/.test(password),
    /[A-Z]/.test(password),
    /\d/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ].filter(Boolean).length;
  if (classes < 3) {
    issue(issues, "ADMIN_PASSWORD", "must mix at least three character classes.");
  }
}

function checkProductionUploadLimit(
  issues: RuntimeEnvironmentIssue[],
  env: RuntimeEnv,
  name: string,
  defaultMiB: number,
) {
  const raw = value(env, name);
  if (!raw) return;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed)) {
    issue(issues, name, "must be a positive integer MiB value.");
    return;
  }
  if (parsed > uploadHardCapMiB || parsed > defaultMiB) {
    issue(issues, name, `must not exceed the production default of ${defaultMiB}MiB.`);
  }
  if (parsed * BYTES_PER_MIB < BYTES_PER_MIB) {
    issue(issues, name, "must be at least 1MiB.");
  }
}

function checkMediaRetention(issues: RuntimeEnvironmentIssue[], env: RuntimeEnv) {
  const raw = value(env, "MEDIA_RETENTION_HOURS");
  if (!raw) return;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < mediaRetentionMinHours || parsed > mediaRetentionMaxHours) {
    issue(issues, "MEDIA_RETENTION_HOURS", `must be an integer between ${mediaRetentionMinHours} and ${mediaRetentionMaxHours}.`);
  }
}

function checkStorageThresholds(issues: RuntimeEnvironmentIssue[], env: RuntimeEnv) {
  const resolution = resolveStorageThresholds(env);
  if (resolution.valid) return;
  const names = [
    "STORAGE_WARNING_PERCENT",
    "STORAGE_CRITICAL_PERCENT",
    "STORAGE_VIDEO_BLOCK_PERCENT",
    "STORAGE_MEDIA_BLOCK_PERCENT",
    "STORAGE_EMERGENCY_PERCENT",
  ];
  for (const name of names.filter((key) => hasValue(env, key))) {
    issue(issues, name, "must be lower than or equal to the default and keep thresholds strictly increasing.");
  }
  if (!names.some((key) => hasValue(env, key))) {
    issue(issues, "STORAGE_*", "threshold defaults must remain strictly increasing.");
  }
}

function checkPostgresUrl(issues: RuntimeEnvironmentIssue[], env: RuntimeEnv) {
  if (!hasValue(env, "APP_DATABASE_URL")) {
    issue(issues, "APP_DATABASE_URL", "is required when production persistence uses PostgreSQL.");
  } else if (!/^postgres(?:ql)?:\/\//i.test(value(env, "APP_DATABASE_URL"))) {
    issue(issues, "APP_DATABASE_URL", "must be a PostgreSQL connection string.");
  }
  if (!hasValue(env, "APP_DATABASE_EXPECTED_NAME")) {
    issue(issues, "APP_DATABASE_EXPECTED_NAME", "is required for database identity checks.");
  } else if (!/^[a-zA-Z0-9_][a-zA-Z0-9_-]{0,62}$/.test(value(env, "APP_DATABASE_EXPECTED_NAME"))) {
    issue(issues, "APP_DATABASE_EXPECTED_NAME", "must be an explicit database name.");
  }
}

function checkPersistenceModes(issues: RuntimeEnvironmentIssue[], env: RuntimeEnv) {
  const names = [
    "APP_AUTH_PERSISTENCE_MODE",
    "APP_BILLING_PERSISTENCE_MODE",
    "APP_TASK_BILLING_PERSISTENCE_MODE",
  ];
  for (const name of names) {
    if (value(env, name).toLowerCase() !== "postgres") {
      issue(issues, name, "must be postgres in production.");
    }
  }
  checkPostgresUrl(issues, env);
}

function checkDatabaseFeatureFlags(issues: RuntimeEnvironmentIssue[], env: RuntimeEnv) {
  const libraryBackend = value(env, "LIBRARY_STORAGE_BACKEND").toLowerCase();
  const jobsBackend = value(env, "GENERATION_JOBS_BACKEND").toLowerCase();
  if (libraryBackend && !["json", "database"].includes(libraryBackend)) {
    issue(issues, "LIBRARY_STORAGE_BACKEND", "must be json or database.");
  }
  if (jobsBackend && !["existing", "database"].includes(jobsBackend)) {
    issue(issues, "GENERATION_JOBS_BACKEND", "must be existing or database.");
  }
  for (const name of ["DATABASE_LIBRARY_DUAL_WRITE", "DATABASE_LIBRARY_READ_ENABLED", "DATABASE_JOBS_WRITE_ENABLED"]) {
    const raw = value(env, name).toLowerCase();
    if (raw && !trueValues.has(raw) && !falseValues.has(raw)) {
      issue(issues, name, "must be true or false.");
    }
  }
  if (value(env, "DATABASE_IMPORT_DRY_RUN_ONLY").toLowerCase() === "false") {
    issue(issues, "DATABASE_IMPORT_DRY_RUN_ONLY", "must remain true unless a separate production import is approved.");
  }
  if (trueValues.has(value(env, "DATABASE_LIBRARY_READ_ENABLED").toLowerCase())) {
    issue(issues, "DATABASE_LIBRARY_READ_ENABLED", "database library reads are not production-ready because user ownership mapping is incomplete.");
  }
  if (libraryBackend === "database" || jobsBackend === "database") {
    checkPostgresUrl(issues, env);
  }
}

function checkUrlIfConfigured(issues: RuntimeEnvironmentIssue[], env: RuntimeEnv, name: string) {
  const raw = value(env, name);
  if (!raw) return;
  try {
    const parsed = new URL(raw);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("invalid protocol");
  } catch {
    issue(issues, name, "must be a valid http or https URL.");
  }
}

function checkEndpointTypeIfConfigured(issues: RuntimeEnvironmentIssue[], env: RuntimeEnv, name: string) {
  const raw = value(env, name);
  if (raw && !endpointTypes.has(raw)) {
    issue(issues, name, "must be a supported provider endpoint type.");
  }
}

function checkRemoteMediaAllowedHosts(issues: RuntimeEnvironmentIssue[], env: RuntimeEnv) {
  const raw = value(env, "REMOTE_MEDIA_ALLOWED_HOSTS");
  if (!raw) {
    issue(issues, "REMOTE_MEDIA_ALLOWED_HOSTS", "must list explicit production remote media hosts.");
    return;
  }
  const entries = raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (entries.length === 0) {
    issue(issues, "REMOTE_MEDIA_ALLOWED_HOSTS", "must list explicit production remote media hosts.");
    return;
  }
  for (const entry of entries) {
    if (entry === "*" || entry === "*.*" || entry.endsWith(".*")) {
      issue(issues, "REMOTE_MEDIA_ALLOWED_HOSTS", "must not use broad wildcard hosts.");
      return;
    }
    if (remoteMediaPlaceholderHosts.has(entry) || entry.endsWith(".invalid")) {
      issue(issues, "REMOTE_MEDIA_ALLOWED_HOSTS", "must not use placeholder hosts in production.");
      return;
    }
    const host = entry.startsWith("*.") ? entry.slice(2) : entry;
    if (!host || !host.includes(".")) {
      issue(issues, "REMOTE_MEDIA_ALLOWED_HOSTS", "must use exact hosts or explicit subdomain rules.");
      return;
    }
    if (/^(localhost|127\.|0\.0\.0\.0|169\.254\.169\.254|10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.|::1|fc|fd|fe80:)/i.test(host)) {
      issue(issues, "REMOTE_MEDIA_ALLOWED_HOSTS", "must not include localhost, metadata, or private-network targets.");
      return;
    }
  }
}

function checkProviderIfKeyConfigured(
  issues: RuntimeEnvironmentIssue[],
  env: RuntimeEnv,
  input: {
    keyName: string;
    urlName: string;
    modelName: string;
    endpointName: string;
  },
) {
  if (!hasValue(env, input.keyName)) return;
  checkUrlIfConfigured(issues, env, input.urlName);
  if (!hasValue(env, input.urlName)) issue(issues, input.urlName, "is required when the provider key is configured.");
  if (!hasValue(env, input.modelName)) issue(issues, input.modelName, "is required when the provider key is configured.");
  checkEndpointTypeIfConfigured(issues, env, input.endpointName);
}

function hasVolcengineIntent(env: RuntimeEnv) {
  return [
    "VOLCENGINE_ACCESS_KEY_PAIR",
    "VOLCENGINE_ACCESS_KEY_ID",
    "VOLCENGINE_SECRET_ACCESS_KEY",
    "VOLCENGINE_IMAGEX_SERVICE_ID",
    "VOLCENGINE_IMAGEX_OUTPUT_DOMAIN",
    "VOLCENGINE_VOD_SPACE_NAME",
    "VOLCENGINE_VOD_OUTPUT_DOMAIN",
  ].some((name) => hasValue(env, name));
}

function hasVolcengineCredentials(env: RuntimeEnv) {
  return hasValue(env, "VOLCENGINE_ACCESS_KEY_PAIR")
    || (hasValue(env, "VOLCENGINE_ACCESS_KEY_ID") && hasValue(env, "VOLCENGINE_SECRET_ACCESS_KEY"));
}

function checkVolcengine(issues: RuntimeEnvironmentIssue[], env: RuntimeEnv) {
  if (hasValue(env, "VOLC_ACCESSKEY")) {
    issue(issues, "VOLC_ACCESSKEY", "is a legacy alias and must not be used in production.");
  }
  if (hasValue(env, "VOLC_SECRETKEY")) {
    issue(issues, "VOLC_SECRETKEY", "is a legacy alias and must not be used in production.");
  }
  if (!hasVolcengineIntent(env)) return;

  if (!hasVolcengineCredentials(env)) {
    issue(issues, "VOLCENGINE_ACCESS_KEY_PAIR", "or VOLCENGINE_ACCESS_KEY_ID plus VOLCENGINE_SECRET_ACCESS_KEY is required when Volcengine upscale is configured.");
  }
  if (hasValue(env, "VOLCENGINE_ACCESS_KEY_ID") !== hasValue(env, "VOLCENGINE_SECRET_ACCESS_KEY")
    && !hasValue(env, "VOLCENGINE_ACCESS_KEY_PAIR")) {
    issue(issues, "VOLCENGINE_ACCESS_KEY_ID/VOLCENGINE_SECRET_ACCESS_KEY", "must be configured together.");
  }
  checkUrlIfConfigured(issues, env, "VOLCENGINE_IMAGEX_ENDPOINT");
  checkUrlIfConfigured(issues, env, "VOLCENGINE_VOD_ENDPOINT");
  for (const name of [
    "VOLCENGINE_IMAGEX_SERVICE_ID",
    "VOLCENGINE_IMAGEX_OUTPUT_DOMAIN",
    "VOLCENGINE_VOD_SPACE_NAME",
    "VOLCENGINE_VOD_OUTPUT_DOMAIN",
    "VOLCENGINE_VOD_TEMPLATE_1K",
    "VOLCENGINE_VOD_TEMPLATE_2K",
    "VOLCENGINE_VOD_TEMPLATE_4K",
  ]) {
    if (!hasValue(env, name)) {
      issue(issues, name, "is required when Volcengine upscale is configured.");
    }
  }
}

function checkProviders(issues: RuntimeEnvironmentIssue[], env: RuntimeEnv) {
  checkProviderIfKeyConfigured(issues, env, {
    keyName: "IMAGE_MODEL_API_KEY",
    urlName: "IMAGE_API_URL",
    modelName: "IMAGE_MODEL",
    endpointName: "IMAGE_ENDPOINT_TYPE",
  });
  checkProviderIfKeyConfigured(issues, env, {
    keyName: "IMG2_IMAGE_API_KEY",
    urlName: "IMG2_IMAGE_API_URL",
    modelName: "IMG2_IMAGE_MODEL",
    endpointName: "IMG2_IMAGE_ENDPOINT_TYPE",
  });
  checkProviderIfKeyConfigured(issues, env, {
    keyName: "VIDEO_MODEL_API_KEY",
    urlName: "VIDEO_API_URL",
    modelName: "VIDEO_MODEL",
    endpointName: "VIDEO_ENDPOINT_TYPE",
  });
  checkProviderIfKeyConfigured(issues, env, {
    keyName: "GROK_VIDEO_API_KEY",
    urlName: "GROK_VIDEO_API_URL",
    modelName: "GROK_VIDEO_MODEL",
    endpointName: "GROK_VIDEO_ENDPOINT_TYPE",
  });
  if (hasValue(env, "PROMPT_OPTIMIZER_API_KEY") || hasValue(env, "DEEPSEEK_API_KEY")) {
    checkUrlIfConfigured(issues, env, "PROMPT_OPTIMIZER_API_URL");
    if (!hasValue(env, "PROMPT_OPTIMIZER_MODEL")) {
      issue(issues, "PROMPT_OPTIMIZER_MODEL", "is required when prompt optimizer keys are configured.");
    }
  }
  checkVolcengine(issues, env);
}

function checkProductionBasics(issues: RuntimeEnvironmentIssue[], env: RuntimeEnv, options: RuntimeEnvironmentOptions) {
  checkNode24(issues, options);
  if (value(env, "NODE_ENV") !== "production") {
    issue(issues, "NODE_ENV", "must be production.");
  }
  if (value(env, "PORT") !== "3106") {
    issue(issues, "PORT", "must be 3106 for the production server.");
  }
  const bindHost = value(env, "APP_BIND_HOST") || "127.0.0.1";
  if (!isLoopbackHost(bindHost)) {
    issue(issues, "APP_BIND_HOST", "must be a loopback address and must not be 0.0.0.0.");
  }
  for (const name of ["HOST", "BIND_HOST"]) {
    const configured = value(env, name);
    if (configured && !isLoopbackHost(configured)) {
      issue(issues, name, "must not override production listening to a public address.");
    }
  }
  checkAdminPassword(issues, env);
  checkRemoteMediaAllowedHosts(issues, env);
}

export function validateProductionRuntimeEnv(
  env: RuntimeEnv = process.env,
  options: RuntimeEnvironmentOptions = {},
): RuntimeEnvironmentReport {
  const issues: RuntimeEnvironmentIssue[] = [];
  checkProductionBasics(issues, env, options);
  for (const name of ["DATA_DIR", "UPLOADS_DIR", "RUNTIME_DIR"]) {
    checkLinuxRuntimePath(issues, env, name);
  }
  checkNonOverlappingPaths(issues, env);
  checkProductionUploadLimit(issues, env, "MEDIA_IMAGE_UPLOAD_LIMIT_MIB", imageUploadDefaultMiB);
  checkProductionUploadLimit(issues, env, "MEDIA_VIDEO_UPLOAD_LIMIT_MIB", videoUploadDefaultMiB);
  checkMediaRetention(issues, env);
  checkStorageThresholds(issues, env);
  checkPersistenceModes(issues, env);
  checkDatabaseFeatureFlags(issues, env);
  checkProviders(issues, env);
  return { ok: issues.length === 0, target: "production", issues };
}

function checkStagingPath(issues: RuntimeEnvironmentIssue[], env: RuntimeEnv, name: "DATA_DIR" | "UPLOADS_DIR") {
  const raw = value(env, name);
  if (!raw) {
    issue(issues, name, "is required for local 3107 staging.");
    return;
  }
  const normalized = raw.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "").toLowerCase();
  const forbidden = name === "DATA_DIR" ? "data" : "uploads";
  if (normalized === forbidden) {
    issue(issues, name, "must not point at the default production data/uploads directory for local 3107 staging.");
  }
}

export function validateLocalStagingRuntimeEnv(
  env: RuntimeEnv = process.env,
  options: RuntimeEnvironmentOptions = {},
): RuntimeEnvironmentReport {
  const issues: RuntimeEnvironmentIssue[] = [];
  checkNode24(issues, options);
  if (value(env, "PORT") !== "3107") {
    issue(issues, "PORT", "must be 3107 for local staging.");
  }
  checkStagingPath(issues, env, "DATA_DIR");
  checkStagingPath(issues, env, "UPLOADS_DIR");
  const dataDir = value(env, "DATA_DIR").replace(/\\/g, "/").toLowerCase();
  const uploadsDir = value(env, "UPLOADS_DIR").replace(/\\/g, "/").toLowerCase();
  if (dataDir && uploadsDir && (dataDir === uploadsDir || dataDir.startsWith(`${uploadsDir}/`) || uploadsDir.startsWith(`${dataDir}/`))) {
    issue(issues, "DATA_DIR/UPLOADS_DIR", "must be isolated for local 3107 staging.");
  }
  return { ok: issues.length === 0, target: "local-staging", issues };
}

export function releaseRuntimeTarget(env: RuntimeEnv = process.env): RuntimeEnvironmentTarget {
  return value(env, "PORT") === "3107" ? "local-staging" : "production";
}

export function validateReleaseRuntimeEnv(
  env: RuntimeEnv = process.env,
  options: RuntimeEnvironmentOptions = {},
) {
  return releaseRuntimeTarget(env) === "local-staging"
    ? validateLocalStagingRuntimeEnv(env, options)
    : validateProductionRuntimeEnv(env, options);
}

export function formatRuntimeEnvironmentReport(report: RuntimeEnvironmentReport) {
  if (report.ok) return `${report.target} environment check passed.`;
  return report.issues
    .map((entry) => `${entry.variable}: ${entry.reason}`)
    .join("\n");
}
