#!/usr/bin/env node
import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const root = process.cwd();
const staticDir = join(root, ".next", "static");
const chunkDir = join(staticDir, "chunks");
const maxListedAssets = 12;
const hashLikePattern = /(?:^|[._-])[a-z0-9_-]{8,}(?:\.[cm]?js|\.css)$/i;

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await walk(full));
    else if (entry.isFile()) result.push(full);
  }
  return result;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function isMinified(source) {
  const lines = source.split(/\r?\n/);
  if (lines.length <= 3) return true;
  const nonEmpty = lines.filter((line) => line.trim()).length;
  const longLines = lines.filter((line) => line.length > 500).length;
  return longLines >= Math.max(1, Math.floor(nonEmpty * 0.25));
}

async function assetSummary(file) {
  const stats = await stat(file);
  return {
    file,
    name: relative(root, file).replace(/\\/g, "/"),
    bytes: stats.size,
    ext: extname(file).toLowerCase(),
  };
}

function hasHashLikeName(name) {
  const base = name.split("/").pop() || name;
  if (hashLikePattern.test(base)) return true;
  const withoutExt = base.replace(/\.(?:css|[cm]?js)$/i, "");
  return /^[a-z0-9_-]{8,}$/i.test(withoutExt);
}

async function main() {
  if (!existsSync(staticDir)) {
    fail(".next/static is missing. Run npm run build before auditing production assets.");
  }
  if (!existsSync(chunkDir)) {
    fail(".next/static/chunks is missing. Next static chunks were not found.");
  }

  const files = await walk(staticDir);
  const publicMaps = files.filter((file) => file.endsWith(".map"));
  if (publicMaps.length) {
    fail(`Public source maps found in .next/static:\n${publicMaps.map((file) => relative(root, file)).join("\n")}`);
  }

  const assets = (await Promise.all(files.map(assetSummary)))
    .filter((asset) => asset.ext === ".js" || asset.ext === ".css");
  const chunks = assets.filter((asset) => asset.name.startsWith(".next/static/chunks/"));
  if (!chunks.some((asset) => asset.ext === ".js")) fail("No production JS chunks were found.");
  if (!chunks.some((asset) => asset.ext === ".css")) fail("No production CSS chunks were found.");

  const unhashed = chunks.filter((asset) => !hasHashLikeName(asset.name));
  if (unhashed.length) {
    fail(`Static chunk filenames must include a hash-like segment:\n${unhashed.map((asset) => asset.name).join("\n")}`);
  }

  const sampledJs = chunks
    .filter((asset) => asset.ext === ".js")
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 6);
  for (const asset of sampledJs) {
    const source = await readFile(asset.file, "utf8");
    if (!isMinified(source)) fail(`JS chunk does not look minified: ${asset.name}`);
  }

  const largest = assets
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, maxListedAssets)
    .map(({ name, bytes }) => ({ name, bytes }));

  console.log(JSON.stringify({
    ok: true,
    framework: "Next.js",
    staticDir: ".next/static",
    publicSourceMaps: 0,
    chunkCount: chunks.length,
    jsChunks: chunks.filter((asset) => asset.ext === ".js").length,
    cssChunks: chunks.filter((asset) => asset.ext === ".css").length,
    largest,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Next build audit failed.");
  process.exit(1);
});
