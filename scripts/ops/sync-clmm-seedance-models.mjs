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

function fixedDurationSeconds(model) {
  return Number(model.toLowerCase().match(/(?:^|[-_ ])(\d+)s(?:$|[-_ ])/i)?.[1] || 0);
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

export function extractPricingEntries(payload) {
  const candidates = Array.isArray(payload?.data) ? payload.data : [];
  return candidates.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const model = normalizeModel(item.model_name || item.model || item.id);
    const amount = Number(item.model_price);
    const endpointTypes = Array.isArray(item.supported_endpoint_types) ? item.supported_endpoint_types : [];
    if (!model || !Number.isFinite(amount) || amount <= 0 || !endpointTypes.includes("openai-video")) return [];
    const description = String(item.description || "");
    const unit = fixedDurationSeconds(model) > 0 || description.includes("固定价格")
      ? "request"
      : description.includes("按秒计费") ? "second" : null;
    if (!unit) return [];
    return [{ model, amount, currency: "CNY", unit, humanFace: classifyHumanFaceSupport(description) }];
  });
}

export function classifyHumanFaceSupport(description) {
  const normalized = String(description || "").replace(/\s+/g, "").toLowerCase();
  if (["不卡人脸", "不卡真人", "过真人脸", "过真人", "支持真人"].some((label) => normalized.includes(label))) {
    return "supported";
  }
  if (["卡人脸", "卡真人脸", "卡真人"].some((label) => normalized.includes(label))) return "restricted";
  return "unknown";
}

export function selectClmmModels(upstreamModels, currentModels = [], pricingEntries) {
  const candidates = Array.from(new Set(upstreamModels.map(normalizeModel).filter(Boolean)));
  const targetModels = candidates.filter(isTargetClmmSeedanceModel);
  const upstreamPrices = Array.isArray(pricingEntries)
    ? new Set(pricingEntries.map((entry) => normalizeModel(entry.model).toLowerCase()))
    : null;
  const hasPrice = (model) => upstreamPrices ? upstreamPrices.has(model.toLowerCase()) : Boolean(modelTier(model));
  const unpricedModels = targetModels.filter((model) => !hasPrice(model));
  const pricedModels = targetModels.filter(hasPrice);
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

export function pricingEndpointFor(apiUrl) {
  const parsed = new URL(apiUrl);
  parsed.pathname = "/api/pricing";
  parsed.search = "";
  return parsed.toString();
}

function displayName(model, humanFace = "unknown") {
  const normalized = model.toLowerCase();
  const channel = normalized.match(/^([a-z0-9]+)[-_ ]+seedance/)?.[1];
  const seconds = normalized.match(/(?:^|[-_ ])(\d+)s(?:$|[-_ ])/i)?.[1];
  const fixedLabel = seconds && normalized.includes("gz") ? `${seconds} 秒` : "";
  const base = normalized.includes("933")
    ? "满血 933"
    : normalized.includes("1080") ? (fixedLabel ? `Pro 1080P ${fixedLabel}` : "1080P")
      : normalized.includes("mini") ? "Mini"
        : normalized.includes("fast") ? (fixedLabel ? `Fast ${fixedLabel}` : "Fast")
          : normalized.includes("pro") ? (fixedLabel ? `Pro ${fixedLabel}` : "Pro")
            : fixedLabel ? `720P ${fixedLabel}` : "Seedance 2.0 720P";
  const humanFaceLabel = humanFace === "supported" ? "过真人" : humanFace === "restricted" ? "卡真人" : "真人未知";
  return `${channel ? `${channel} · ` : ""}${base} · ${humanFaceLabel}`;
}

export function syncProviderDocument(document, upstreamModels, pricingEntries) {
  if (!Array.isArray(document)) throw new Error("providers.json must contain an array");
  const index = document.findIndex((provider) => provider?.id === CLMM_PROVIDER_ID);
  if (index < 0) throw new Error(`Provider ${CLMM_PROVIDER_ID} was not found`);
  const provider = document[index];
  const selection = selectClmmModels(upstreamModels, provider.models || [], pricingEntries);
  if (!selection.models.length) throw new Error("No priced Seedance 2.0 720p models were returned");
  const pricesByModel = new Map((pricingEntries || []).map((entry) => [normalizeModel(entry.model).toLowerCase(), entry]));
  const modelDisplayNames = Object.fromEntries(selection.models.map((model) => [
    model,
    displayName(model, pricesByModel.get(model.toLowerCase())?.humanFace),
  ]));
  const modelUpstreamPrices = Object.fromEntries(selection.models.flatMap((model) => {
    const price = pricesByModel.get(model.toLowerCase());
    return price ? [[model, { amount: price.amount, currency: "CNY", unit: price.unit }]] : [];
  }));
  const selectedModel = selection.models.includes(provider.model) ? provider.model : selection.models[0];
  const nextProvider = {
    ...provider,
    model: selectedModel,
    models: selection.models,
    enabledModels: selection.models,
    modelDisplayNames,
    modelUpstreamPrices,
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
  const pricingEndpoint = pricingEndpointFor(provider.apiUrl);
  if (!provider.apiKey || provider.apiKey === "replace_me") throw new Error("CLMM provider key is not configured");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 20_000);
  let response;
  let pricingResponse;
  try {
    [response, pricingResponse] = await Promise.all([endpoint, pricingEndpoint].map((url) => (options.fetchImpl || fetch)(url, {
      headers: { Accept: "application/json", Authorization: `Bearer ${provider.apiKey}` },
      signal: controller.signal,
    })));
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new Error(`Upstream models request failed with HTTP ${response.status}`);
  if (!pricingResponse.ok) throw new Error(`Upstream pricing request failed with HTTP ${pricingResponse.status}`);
  const upstreamModels = extractModelNames(await response.json());
  const pricingEntries = extractPricingEntries(await pricingResponse.json());
  if (!upstreamModels.length) throw new Error("Upstream models response was empty or unsupported");
  if (!pricingEntries.length) throw new Error("Upstream pricing response was empty or unsupported");
  const result = syncProviderDocument(document, upstreamModels, pricingEntries);
  const changed = JSON.stringify(result.document) !== JSON.stringify(document);
  if (options.apply && changed) await writeJsonAtomic(providerPath, result.document);
  return {
    changed,
    applied: Boolean(options.apply && changed),
    endpoint,
    pricingEndpoint,
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
