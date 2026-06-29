#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

const stagingRoot = process.cwd();
const productionRoot = resolve(stagingRoot, "..", "new-jiemian");
const sourcePath = resolve(process.env.TUNNELTEST_PROVIDER_SOURCE || join(productionRoot, "data", "providers.json"));
const targetPath = resolve(process.env.TUNNELTEST_PROVIDER_TARGET || join(stagingRoot, "data-tunneltest", "providers.json"));

function fail(message) {
  console.error(message);
  process.exit(1);
}

function inside(root, target) {
  const rel = relative(resolve(root), resolve(target));
  return !rel || (!rel.startsWith("..") && !isAbsolute(rel));
}

if (!existsSync(sourcePath)) {
  fail(`3106 provider config was not found: ${sourcePath}`);
}

if (!inside(join(stagingRoot, "data-tunneltest"), targetPath)) {
  fail("Refusing to write provider seed outside data-tunneltest.");
}

await mkdir(dirname(targetPath), { recursive: true });

const providers = JSON.parse(await readFile(sourcePath, "utf8")).map((provider) => {
  if (provider.kind === "image") {
    const keep = provider.id === "image-img2-4k";
    return {
      ...provider,
      enabled: keep && Boolean(provider.enabled),
      model: keep ? "image4k" : provider.model,
      models: keep ? ["image4k"] : provider.models,
      modelDisplayNames: keep ? { image4k: provider.modelDisplayNames?.image4k || provider.displayName || "img2 4K" } : provider.modelDisplayNames,
      enabledModels: keep ? ["image4k"] : [],
    };
  }
  if (provider.kind === "video") {
    const keep = provider.id === "video-grok";
    return {
      ...provider,
      enabled: keep && Boolean(provider.enabled),
      model: keep ? "grok-video-1.5" : provider.model,
      models: keep ? ["grok-video-1.5"] : provider.models,
      modelDisplayNames: keep ? { "grok-video-1.5": provider.modelDisplayNames?.["grok-video-1.5"] || "Grok 视频 1.5" } : provider.modelDisplayNames,
      enabledModels: keep ? ["grok-video-1.5"] : [],
    };
  }
  return provider;
});
await writeFile(targetPath, `${JSON.stringify(providers, null, 2)}\n`);
const summary = providers.map((provider) => ({
  id: provider.id,
  kind: provider.kind,
  endpointType: provider.endpointType,
  enabled: Boolean(provider.enabled),
  configured: Boolean(provider.apiKey && String(provider.apiKey).trim() && String(provider.apiKey).trim() !== "replace_me"),
  models: Array.isArray(provider.models) ? provider.models.length : undefined,
  enabledModels: Array.isArray(provider.enabledModels) ? provider.enabledModels.length : undefined,
}));

console.log(`Seeded tunneltest providers: ${targetPath}`);
console.log(JSON.stringify({
  source: sourcePath,
  tunneltestVisibleModels: {
    image: "image-img2-4k::model::image4k",
    video: "video-grok::model::grok-video-1.5",
  },
  count: providers.length,
  enabled: summary.filter((provider) => provider.enabled).length,
  configured: summary.filter((provider) => provider.configured).length,
  providers: summary,
}, null, 2));
