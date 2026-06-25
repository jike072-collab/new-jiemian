#!/usr/bin/env node
import {
  ensureDataDir,
  ensureUploadsDir,
  validateRuntimeStorageIsolation,
} from "../src/lib/server/runtime-paths.ts";

try {
  const report = validateRuntimeStorageIsolation();
  if (report.strict) {
    await ensureDataDir();
    await ensureUploadsDir();
  }
  console.log(`Runtime storage preflight passed: PORT=${report.port || "(unset)"}`);
  console.log(`DATA_DIR=${report.dataDir}`);
  console.log(`UPLOADS_DIR=${report.uploadsDir}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Runtime storage preflight failed.");
  process.exit(1);
}
