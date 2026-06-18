#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const probeDir = join(root, "src", "app", "database-boundary-probe");
const probePage = join(probeDir, "page.tsx");
const nextDir = join(root, ".next");

async function main() {
  await rm(probeDir, { recursive: true, force: true });
  await mkdir(probeDir, { recursive: true });
  await writeFile(probePage, `"use client";

import { getApplicationDatabaseConfig } from "@/lib/server/database";

export default function DatabaseBoundaryProbe() {
  getApplicationDatabaseConfig();
  return <main>database boundary probe</main>;
}
`, "utf8");

  try {
    const build = spawnSync("npm", ["run", "build"], {
      cwd: root,
      encoding: "utf8",
      shell: process.platform === "win32",
      env: {
        ...process.env,
        APP_DATABASE_URL: "postgresql://boundary:boundary@127.0.0.1:5432/aohuang_app_test",
        APP_DATABASE_EXPECTED_NAME: "aohuang_app_test",
        NEW_API_ENABLED: "false",
      },
    });

    const output = `${build.stdout || ""}\n${build.stderr || ""}`;
    if (build.status === 0) {
      console.error("database module was imported by a Client Component without failing the build");
      process.exit(1);
    }
    if (!/server-only|Client Component|Server Component|cannot be imported/i.test(output)) {
      console.error("database Client Component boundary failed for an unexpected reason");
      console.error(output.slice(-4000));
      process.exit(1);
    }
    if (!/APP_DATABASE_URL|postgresql:\/\/|pg-protocol|pg-pool|node-postgres/.test(output)) {
      console.log("database server-only boundary test passed");
      return;
    }
    console.error("database boundary failure output leaked database internals");
    process.exit(1);
  } finally {
    await rm(probeDir, { recursive: true, force: true });
    await rm(nextDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "database server boundary test failed");
  process.exit(1);
});
