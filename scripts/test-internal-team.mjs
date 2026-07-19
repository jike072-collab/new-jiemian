#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");
const registerRoute = read("src/app/api/auth/register/route.ts");
const verificationRoute = read("src/app/api/auth/verification-code/route.ts");
const teamRoute = read("src/app/api/account/team/route.ts");
const migration = read("db/migrations/018_internal_account_teams.sql");
assert.match(registerRoute, /isRegistrationAllowedForHost/);
assert.match(verificationRoute, /purpose === "register"/);
assert.match(teamRoute, /getOwnerIdForUser/);
assert.match(teamRoute, /requireCsrf/);
assert.match(migration, /account_owner_id uuid references app_users/);
assert.match(migration, /app_users_account_owner_idx/);

const outDir = join(root, "dist", "team-tests");
if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });

const compile = spawnSync("npx", ["tsc", "-p", "tsconfig.team-tests.json"], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (compile.status !== 0) process.exit(compile.status ?? 1);

const run = spawnSync("node", ["--test", "dist/team-tests/src/lib/server/__tests__/team-usage.test.js"], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
});
process.exit(run.status ?? 1);
