#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { chmod, chown, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const CLMM_PROVIDER_ID = "video-seedance-new";
export const PROTECTED_MODELS = [];

function normalizeModel(value) {
  try {
    return decodeURIComponent(String(value || "")).trim();
  } catch {
    return String(value || "").trim();
  }
}

function modelTier(model) {
  const normalized = model.toLowerCase();
  if (normalized.includes("933")) return "933";
  if (/(?:^|[-_ ])mini(?:$|[-_ ])/i.test(normalized)) return "mini";
  if (/(?:^|[-_ ])fast(?:$|[-_ ])/i.test(normalized)) return "fast";
  if (/(?:^|[-_ ])pro(?:$|[-_ ])/i.test(normalized)) return "pro";
  return null;
}

export function isTargetClmmSeedanceModel(value) {
  const model = normalizeModel(value);
  const normalized = model.toLowerCase();
  return /seedance[-_ ]*2(?:\.0)?/.test(normalized)
    && /(?:720|1080)\s*p/.test(normalized)
    && !/480\s*p|dark|black|暗黑/.test(normalized);
}

export function extractModelNames(payload) {
  const candidates = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.models)
        ? payload.models
        : [];
  return Array.from(new Set(candidates.map((item) => {
    if (typeof item === "string") return normalizeModel(item);
    if (!item || typeof item !== "object") return "";
    return normalizeModel(item.id || item.model || item.name);
  }).filter(Boolean)));
}

export function selectClmmModels(upstreamModels, currentModels = []) {
  const candidates = Array.from(new Set(upstreamModels.map(normalizeModel).filter(Boolean)));
  const targetModels = candidates.filter(isTargetClmmSeedanceModel);
  const unpricedModels = targetModels.filter((model) => !modelTier(model));
  const pricedModels = targetModels.filter((model) => modelTier(model));
  const protectedModels = PROTECTED_MODELS.filter((model) => !pricedModels.some((candidate) => candidate.toLowerCase() === model.toLowerCase()));
  const models = Array.from(new Set([...pricedModels, ...protectedModels]));
  const current = currentModels.map(normalizeModel).filter(Boolean);
  return {
    models,
    added: models.filter((model) => !current.includes(model)),
    removed: current.filter((model) => !models.includes(model)),
    rejected: candidates.filter((model) => !isTargetClmmSeedanceModel(model)),
    unpricedModels,
  };
}

export function modelsEndpointFor(apiUrl) {
  const parsed = new URL(apiUrl);
  const pathname = parsed.pathname.replace(/\/+$/, "");
  if (/\/models$/i.test(pathname)) parsed.pathname = pathname;
  else if (/\/v1(?:\/.*)?$/i.test(pathname)) parsed.pathname = pathname.replace(/\/v1(?:\/.*)?$/i, "/v1/models");
  else if (/\/(?:chat\/completions|videos|images\/generations|images\/edits)$/i.test(pathname)) {
    parsed.pathname = pathname.replace(/\/(?:chat\/completions|videos|images\/generations|images\/edits)$/i, "/models");
  } else parsed.pathname = `${pathname}/models`;
  parsed.search = "";
  return parsed.toString();
}

function displayName(model) {
  const normalized = model.toLowerCase();
  const seconds = normalized.match(/(?:^|[-_ ])(\d+)s(?:$|[-_ ])/i)?.[1];
  const fixedLabel = seconds && normalized.includes("gz") ? `${seconds} 秒 不卡真人` : "";
  if (normalized.includes("933")) return "满血 933 不卡真人";
  if (normalized.includes("1080")) return fixedLabel ? `Pro 1080P ${fixedLabel}` : "Pro 1080P";
  if (normalized.includes("mini")) return "Mini";
  if (normalized.includes("fast")) return fixedLabel ? `Fast ${fixedLabel}` : "Fast";
  if (normalized.includes("pro")) return fixedLabel ? `Pro ${fixedLabel}` : "Pro";
  return "Seedance 2.0 720P";
}

export function syncProviderDocument(document, upstreamModels) {
  if (!Array.isArray(document)) throw new Error("providers.json must contain an array");
  const index = document.findIndex((provider) => provider?.id === CLMM_PROVIDER_ID);
  if (index < 0) throw new Error(`Provider ${CLMM_PROVIDER_ID} was not found`);
  const provider = document[index];
  const selection = selectClmmModels(upstreamModels, provider.models || []);
  if (!selection.models.length) throw new Error("No priced Seedance 2.0 720p models were returned");
  const modelDisplayNames = Object.fromEntries(selection.models.map((model) => [model, displayName(model)]));
  const selectedModel = selection.models.includes(provider.model) ? provider.model : selection.models[0];
  const nextProvider = {
    ...provider,
    model: selectedModel,
    models: selection.models,
    enabledModels: selection.models,
    modelDisplayNames,
    displayName: modelDisplayNames[selectedModel],
  };
  const next = document.slice();
  next[index] = nextProvider;
  return { document: next, selection };
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function writeJsonAtomic(filePath, value) {
  await mkdir(dirname(filePath), { recursive: true });
  const metadata = await stat(filePath);
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: metadata.mode & 0o777 });
  await chmod(temporary, metadata.mode & 0o777);
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    await chown(temporary, metadata.uid, metadata.gid);
  }
  await rename(temporary, filePath);
}

function parseArgs(argv) {
  const args = new Set(argv);
  const dataDirIndex = argv.indexOf("--data-dir");
  return {
    apply: args.has("--apply"),
    dataDir: dataDirIndex >= 0 ? argv[dataDirIndex + 1] : process.env.DATA_DIR,
    timeoutMs: Number(process.env.CLMM_MODELS_TIMEOUT_MS || 20_000),
  };
}

export function isMainModule(moduleUrl, argvPath) {
  if (!argvPath) return false;
  try {
    return realpathSync(argvPath) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

export async function runSync(options = {}) {
  const dataDir = resolve(options.dataDir || process.env.DATA_DIR || "data");
  const providerPath = options.providerPath || resolve(dataDir, "providers.json");
  const document = await readJson(providerPath);
  const provider = document.find((item) => item?.id === CLMM_PROVIDER_ID);
  if (!provider) throw new Error(`Provider ${CLMM_PROVIDER_ID} was not found`);
  const endpoint = modelsEndpointFor(provider.apiUrl);
  if (!provider.apiKey || provider.apiKey === "replace_me") throw new Error("CLMM provider key is not configured");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 20_000);
  let response;
  try {
    response = await (options.fetchImpl || fetch)(endpoint, {
      headers: { Accept: "application/json", Authorization: `Bearer ${provider.apiKey}` },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new Error(`Upstream models request failed with HTTP ${response.status}`);
  const upstreamModels = extractModelNames(await response.json());
  if (!upstreamModels.length) throw new Error("Upstream models response was empty or unsupported");
  const result = syncProviderDocument(document, upstreamModels);
  const changed = JSON.stringify(result.document) !== JSON.stringify(document);
  if (options.apply && changed) await writeJsonAtomic(providerPath, result.document);
  return {
    changed,
    applied: Boolean(options.apply && changed),
    endpoint,
    providerPath,
    ...result.selection,
  };
}

if (isMainModule(import.meta.url, process.argv[1])) {
  const options = parseArgs(process.argv.slice(2));
  try {
    const report = await runSync(options);
    console.log(JSON.stringify({ ...report, mode: options.apply ? "apply" : "dry-run" }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "sync failed" }));
    process.exitCode = 1;
  }
}
