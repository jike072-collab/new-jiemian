import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const target = process.env.LIGHTHOUSE_URL || "http://127.0.0.1:3000";
const outputDir = join(process.cwd(), "artifacts", "lighthouse");
const outputPath = join(outputDir, "report");
await mkdir(outputDir, { recursive: true });

const cli = join(process.cwd(), "node_modules", "lighthouse", "cli", "index.js");
const result = spawnSync(process.execPath, [cli,
  target,
  "--only-categories=performance,accessibility,best-practices,seo",
  "--output=json",
  `--output-path=${outputPath}`,
  "--chrome-flags=--headless=new --no-sandbox",
], { stdio: "inherit" });

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
