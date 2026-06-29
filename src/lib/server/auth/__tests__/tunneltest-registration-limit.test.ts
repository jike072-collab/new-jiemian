import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "tunneltest-registration-data-"));
process.env.UPLOADS_DIR = mkdtempSync(join(tmpdir(), "tunneltest-registration-uploads-"));
process.env.PORT = "3107";
process.env.RUNTIME_STORAGE_ISOLATION = "strict";

const limitModule = import("../tunneltest-registration-limit.js");

after(async () => {
  await Promise.all([
    rm(process.env.DATA_DIR!, { recursive: true, force: true }),
    rm(process.env.UPLOADS_DIR!, { recursive: true, force: true }),
  ]);
});

test("tunneltest registration limit allows 8 additional users after baseline", async () => {
  await writeFile(join(process.env.DATA_DIR!, "auth-store.json"), JSON.stringify({
    users: [
      { local_user_id: "existing-a" },
      { local_user_id: "existing-b" },
      { local_user_id: "existing-c" },
      { local_user_id: "existing-d" },
    ],
  }));

  const { tunneltestRegistrationLimitSummary, tunneltestRegistrationMaxUsers } = await limitModule;
  const summary = await tunneltestRegistrationLimitSummary();

  assert.equal(summary?.existingUsers, 4);
  assert.equal(summary?.additionalUserLimit, 8);
  assert.equal(summary?.maxUsers, 12);
  assert.equal(await tunneltestRegistrationMaxUsers(), 12);
});
