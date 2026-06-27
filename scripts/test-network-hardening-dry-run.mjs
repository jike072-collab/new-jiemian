#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const files = {
  snapshot: "scripts/ops/network-exposure-snapshot.ps1",
  plan: "scripts/ops/network-hardening-plan.ps1",
  rollback: "scripts/ops/network-hardening-rollback.ps1",
  wrapper: "scripts/run-network-hardening-script.mjs",
  exposureDoc: "docs/NETWORK_EXPOSURE_AUDIT.md",
  hardeningDoc: "docs/NETWORK_HARDENING_PLAN.md",
  rollbackDoc: "docs/FIREWALL_ROLLBACK_RUNBOOK.md",
  bindingDoc: "docs/NEWAPI_POSTGRES_BINDING_RUNBOOK.md",
  packageJson: "package.json",
  ci: ".github/workflows/ci.yml",
};

const mutatingCommandPattern = /^\s*(Set-NetFirewallProfile|New-NetFirewallRule|Set-NetFirewallRule|Remove-NetFirewallRule|Enable-NetFirewallRule|Disable-NetFirewallRule|Restart-Service|Stop-Service|Start-Service|Set-Service|Set-Content|Add-Content|Out-File|Copy-Item|Move-Item|Remove-Item|netsh|sc\.exe)\b/i;
const hiddenUnicodePattern = /[\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C\u200B\u200C\u200D\u2060]/u;

for (const [label, file] of Object.entries(files)) {
  const source = read(file);
  assert(source.length > 0, `${label} must not be empty`);
  assert(!hiddenUnicodePattern.test(source), `${file} contains hidden/bidi Unicode controls`);
  assert(!hasNonInitialBom(source), `${file} contains a non-initial BOM`);
}

for (const file of [files.snapshot, files.plan, files.rollback]) {
  const source = read(file);
  assert(source.includes("mutatingCommandsExecuted") || source.includes("Mutating commands executed"), `${file} must report mutating command state`);
  assert(source.includes("read-only") || source.includes("dry-run"), `${file} must identify read-only/dry-run mode`);
  for (const [index, line] of source.split(/\r?\n/).entries()) {
    assert(!mutatingCommandPattern.test(line), `${file}:${index + 1} has an executable mutating command`);
  }
}

for (const file of [files.plan, files.rollback]) {
  const source = read(file);
  assert(source.includes("[switch]$Apply"), `${file} must define an explicit Apply switch`);
  assert(source.includes("[switch]$IUnderstandNetworkLockoutRisk"), `${file} must define the lockout-risk guard`);
  assert(source.includes("Stage 7.2b refuses to apply"), `${file} must fail closed when apply is requested`);
  assert(source.includes("authorization"), `${file} must require future authorization`);
}

assertIncludes(files.packageJson, "\"security:network-snapshot\"");
assertIncludes(files.packageJson, "\"security:network-hardening-plan\"");
assertIncludes(files.packageJson, "\"security:network-hardening-rollback\"");
assertIncludes(files.packageJson, "\"test:network-hardening-dry-run\"");
assertIncludes(files.packageJson, "npm run test:network-hardening-dry-run");
assertIncludes(files.ci, "Network hardening dry-run");
assertIncludes(files.ci, "npm run test:network-hardening-dry-run");

assertDocSections(files.exposureDoc, [
  "Current Findings",
  "Port Inventory",
  "Risk Ratings",
  "Masked Information",
  "Why No Configuration Change Was Executed",
]);
assertDocSections(files.hardeningDoc, [
  "Target Architecture",
  "Firewall Plan",
  "Pre-Change Checks",
  "Post-Change Validation",
  "Rollback Conditions",
]);
assertDocSections(files.rollbackDoc, [
  "Required Backups",
  "Export Current Policy",
  "Preserve Remote Management",
  "Immediate Recovery",
  "Authorization Points",
]);
assertDocSections(files.bindingDoc, [
  "NewAPI Local Binding",
  "PostgreSQL Local Binding",
  "Validation",
  "Rollback",
  "Restart And Authorization",
]);

if (process.platform === "win32") {
  runWrapper(["plan", "-Json"]);
  runWrapper(["rollback", "-Json"]);
  runWrapper(["snapshot", "-Help"]);
  const selfTest = runWrapper(["snapshot", "-SelfTest"], { parseJson: true });
  assert.equal(selfTest.ok, true);
  assert.equal(selfTest.mutatingCommandsExecuted, false);
  const snapshot = runWrapper(["snapshot", "-Json"], { parseJson: true });
  assert.equal(snapshot.mode, "read-only");
  assert.equal(snapshot.mutatingCommandsExecuted, false);
  assert(Array.isArray(snapshot.tcpListeners), "snapshot tcpListeners must be an array");
  assert(snapshot.tcpListeners.length > 0, "snapshot must report at least one TCP listener on Windows");
  assert(Array.isArray(snapshot.keyPortListeners), "snapshot keyPortListeners must be an array");
  assert.equal(typeof snapshot.riskSummary?.firewallProfilesDisabled, "number");
}

console.log(JSON.stringify({
  ok: true,
  scripts: 4,
  docs: 4,
  defaultMode: "read-only",
  applySupported: false,
  generationEndpointsCalled: false,
  newApiCalled: false,
  mutatingCommandsExecuted: false,
}, null, 2));

function read(file) {
  return readFileSync(join(root, file), "utf8");
}

function assertIncludes(file, token) {
  assert(read(file).includes(token), `${file} must include ${token}`);
}

function assertDocSections(file, headings) {
  const source = read(file);
  for (const heading of headings) {
    assert(source.includes(`## ${heading}`), `${file} must include ${heading}`);
  }
}

function runWrapper(args, options = {}) {
  const result = spawnSync(process.execPath, [join(root, files.wrapper), ...args], {
    cwd: root,
    encoding: "utf8",
    shell: false,
  });
  assert.equal(result.status, 0, `${args.join(" ")} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  const output = `${result.stdout}\n${result.stderr}`;
  assert(!/Stage 7\.2b refuses to apply/.test(output), `${args.join(" ")} unexpectedly attempted apply`);
  assert(!/Set-NetFirewallProfile\s*:|New-NetFirewallRule\s*:|Set-NetFirewallRule\s*:/.test(output), `${args.join(" ")} appears to execute firewall mutation`);
  if (options.parseJson) return JSON.parse(result.stdout);
  return output;
}

function hasNonInitialBom(source) {
  const first = source.charCodeAt(0) === 0xFEFF ? source.slice(1) : source;
  return first.includes("\uFEFF");
}
