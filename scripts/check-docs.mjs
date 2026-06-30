import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname, resolve, sep } from "node:path";

const root = process.cwd();
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const packageScripts = new Set(Object.keys(packageJson.scripts || {}));
const failures = [];

const markdownFiles = [
  "README.md",
  "AGENTS.md",
  ".env.example",
  ".env.production.example",
  ...walk("docs", (file) => file.endsWith(".md")),
  ...walk("deploy", (file) => file.endsWith(".md")),
];

const historicalPrefixes = [
  `docs${sep}archive${sep}`,
  `docs${sep}architecture${sep}auth-newapi${sep}`,
  `docs${sep}design-references${sep}`,
  `docs${sep}research${sep}`,
  `docs${sep}ui${sep}`,
];

const historicalFiles = new Set([
  "docs/CLEANUP_AUDIT.md",
  "docs/RELEASE_READINESS_AUDIT_2026-06-29.md",
  "docs/STAGE9D_RELEASE_GATES.md",
  "docs/STAGE9E_BATCH_B_EXECUTION_PLAN.md",
  "docs/STAGE9E_BATCH_C_DUAL_WRITE_CANARY_ROLLBACK_PLAN.md",
  "docs/STAGE9E_BATCH_C_IMPLEMENTATION_PREFLIGHT.md",
  "docs/STAGE9F_P0_SECURITY_BASELINE_AUDIT.md",
].map(normalizePath));

const retiredUpscaleTerms = [
  "Ups" + "cayl",
  "Video" + "2X",
  "ups" + "cayl" + "-cli",
  "video" + "2x" + "-cli",
  "local" + "-upscale",
  "UPS" + "CAYL" + "_",
  "VIDEO" + "2X" + "_",
];
const oldUpscalePattern = new RegExp(retiredUpscaleTerms.join("|"), "i");
const windowsPathPattern = /\b[A-Z]:\\/;
const secretPatterns = [
  /postgres(?:ql)?:\/\/[^`\s)]+:[^`\s)]+@/i,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b/,
  /AKIA[A-Z0-9]{16}/,
  /Authorization:\s*Bearer\s+[A-Za-z0-9._-]+/i,
  new RegExp("Cookie" + ":" + "\\s*[^`\\n]+", "i"),
];

for (const file of markdownFiles) {
  const text = readFileSync(join(root, file), "utf8");
  checkMarkdownLinks(file, text);
  checkPackageScripts(file, text);
  checkRepositoryPaths(file, text);
  checkSensitiveText(file, text);
}

if (failures.length > 0) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  checkedFiles: markdownFiles.length,
  checkedPackageScripts: packageScripts.size,
  externalLinksChecked: false,
}, null, 2));

function walk(dir, predicate, out = []) {
  const fullDir = join(root, dir);
  if (!existsSync(fullDir)) return out;
  for (const entry of readdirSync(fullDir, { withFileTypes: true })) {
    const relative = join(dir, entry.name);
    if (entry.isDirectory()) walk(relative, predicate, out);
    else if (predicate(relative)) out.push(relative);
  }
  return out;
}

function checkMarkdownLinks(file, text) {
  const linkPattern = /!?\[[^\]]*]\(([^)]+)\)/g;
  for (const match of text.matchAll(linkPattern)) {
    const rawTarget = match[1].trim();
    const target = rawTarget.split(/\s+/)[0].replace(/^<|>$/g, "");
    if (!target || target.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
    const withoutAnchor = target.split("#")[0];
    if (!withoutAnchor) continue;
    const resolved = resolve(dirname(join(root, file)), decodeURIComponent(withoutAnchor));
    if (!resolved.startsWith(root + sep) && resolved !== root) {
      failures.push(`${file} link escapes repository: ${rawTarget}`);
      continue;
    }
    if (!existsSync(resolved)) failures.push(`${file} broken markdown link: ${rawTarget}`);
  }
}

function checkPackageScripts(file, text) {
  if (isHistorical(file)) return;
  const scriptPattern = /npm\s+run\s+([A-Za-z0-9:_-]+)/g;
  for (const match of text.matchAll(scriptPattern)) {
    const script = match[1];
    if (!packageScripts.has(script)) failures.push(`${file} references missing package script: ${script}`);
  }
}

function checkRepositoryPaths(file, text) {
  if (isHistorical(file)) return;
  const pathPattern = /`((?:docs|scripts|deploy|src|db|infra|\.github)\/[^`<>\s,)]+)`/g;
  for (const match of text.matchAll(pathPattern)) {
    const candidate = match[1].replace(/[.;:]+$/, "");
    if (candidate.includes("*")) continue;
    if (!existsSync(join(root, candidate))) failures.push(`${file} references missing path: ${candidate}`);
  }
}

function checkSensitiveText(file, text) {
  if (!isHistorical(file)) {
    if (oldUpscalePattern.test(text)) failures.push(`${file} contains retired local executable upscale wording`);
    if (windowsPathPattern.test(text)) failures.push(`${file} contains a local absolute Windows path`);
  }
  for (const pattern of secretPatterns) {
    if (pattern.test(text)) failures.push(`${file} contains a forbidden secret-shaped value`);
  }
}

function isHistorical(file) {
  const normalized = normalizePath(file);
  if (historicalFiles.has(normalized)) return true;
  return historicalPrefixes.some((prefix) => normalized.startsWith(prefix));
}

function normalizePath(file) {
  return file.split(/[\\/]+/).join(sep);
}
