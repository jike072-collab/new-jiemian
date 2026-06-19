#!/usr/bin/env node
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const staticDir = join(root, ".next", "static");
const patterns = [
  "APP_DATABASE_URL",
  "DATABASE_URL",
  "postgres://",
  "postgresql://",
  "PGPASSWORD",
  "PAYMENT_SANDBOX_WEBHOOK_SECRET",
  "PAYMENT_PRODUCTION_ENABLED",
  "PAYMENT_PRODUCTION_WEBHOOK_SECRET",
];

async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await files(full));
    if (entry.isFile()) result.push(full);
  }
  return result;
}

async function main() {
  await stat(staticDir);
  const matches = [];
  for (const file of await files(staticDir)) {
    const content = await readFile(file, "utf8").catch(() => "");
    for (const pattern of patterns) {
      if (content.includes(pattern)) matches.push(`${file}: ${pattern}`);
    }
  }
  if (matches.length) {
    console.error(matches.join("\n"));
    process.exit(1);
  }
  console.log("database bundle scan passed");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "database bundle scan failed");
  process.exit(1);
});
