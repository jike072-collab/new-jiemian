import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

const root = process.cwd();
const args = process.argv.slice(2);
const execute = args.includes("--execute");
const dryRun = args.includes("--dry-run") || !execute;
const json = args.includes("--json");

function usage() {
  return [
    "Usage: node scripts/reconcile-billing-sandbox.mjs [--dry-run] [--execute] [--timeout-minutes N] [--json]",
    "",
    "Default mode is --dry-run. Use --execute only in the isolated sandbox after checking New API env config.",
  ].join("\n");
}

function readFlagValue(flag) {
  const index = args.indexOf(flag);
  if (index < 0) return null;
  return args[index + 1] || null;
}

function fail(message, status = 1) {
  console.error(message);
  console.error(usage());
  process.exit(status);
}

if (args.includes("--help")) {
  console.log(usage());
  process.exit(0);
}

if (execute && args.includes("--dry-run")) {
  fail("--execute and --dry-run cannot be used together.");
}

const timeoutValue = readFlagValue("--timeout-minutes");
const timeoutMinutes = timeoutValue === null ? 30 : Number(timeoutValue);
if (!Number.isInteger(timeoutMinutes) || timeoutMinutes <= 0 || timeoutMinutes > 24 * 60) {
  fail("--timeout-minutes must be an integer between 1 and 1440.");
}

function redact(value) {
  return String(value || "")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
    .replace(/Authorization[=:]\s*[^,\s}]+/gi, "Authorization=[REDACTED]")
    .replace(/(token|password|cookie|secret|key|signature)[=:]\s*[^,\s}]+/gi, "$1=[REDACTED]")
    .slice(0, 300);
}

async function readStore() {
  const path = join(root, "data", "billing-store.json");
  if (!existsSync(path)) return { orders: [], audit: [] };
  return JSON.parse(await readFile(path, "utf8"));
}

function dryRunReconcile(store, now = new Date()) {
  const timeoutMs = timeoutMinutes * 60 * 1000;
  const orders = Array.isArray(store.orders) ? store.orders : [];
  const candidates = orders.filter((order) => ["pending", "processing", "review"].includes(order.status));
  const issues = [];

  for (const order of candidates) {
    const updatedAt = Date.parse(order.updated_at || order.created_at || "");
    const ageMs = Number.isFinite(updatedAt) ? now.getTime() - updatedAt : Number.POSITIVE_INFINITY;
    const paidLike = (
      (order.status === "processing" || order.status === "review")
      && order.paid_amount === order.requested_amount
      && !order.quota_credit_applied_at
    );

    if (paidLike) {
      issues.push({
        order_id: order.order_id,
        status: order.status,
        issue: "quota_credit_candidate",
        action: "execute_would_retry_idempotent_credit",
      });
      continue;
    }

    if (ageMs > timeoutMs && (order.status === "pending" || order.status === "processing")) {
      issues.push({
        order_id: order.order_id,
        status: order.status,
        issue: "timeout",
        action: "execute_would_mark_review",
      });
    }
  }

  return { mode: "dry-run", checked: candidates.length, issues };
}

function writeResult(result) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`mode: ${result.mode || "execute"}`);
  console.log(`checked: ${result.checked}`);
  console.log(`issues: ${result.issues.length}`);
  for (const issue of result.issues) {
    console.log(`- ${issue.order_id} ${issue.status} ${issue.issue} ${issue.action}`);
  }
}

if (dryRun) {
  writeResult(dryRunReconcile(await readStore()));
  process.exit(0);
}

const compile = spawnSync("npx", ["tsc", "-p", "tsconfig.billing-sandbox-tests.json"], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (compile.status !== 0) process.exit(compile.status ?? 1);

try {
  const require = createRequire(import.meta.url);
  const { createBillingService } = require(join(
    root,
    "dist",
    "billing-sandbox-tests",
    "src",
    "lib",
    "server",
    "billing",
    "service.js",
  ));
  const result = await createBillingService().reconcile({ timeoutMinutes });
  writeResult({ mode: "execute", ...result });
} catch (error) {
  console.error(redact(error instanceof Error ? error.message : String(error)));
  process.exit(1);
}
