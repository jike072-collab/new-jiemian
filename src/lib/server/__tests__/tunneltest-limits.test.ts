import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "tunneltest-limits-data-"));
process.env.UPLOADS_DIR = mkdtempSync(join(tmpdir(), "tunneltest-limits-uploads-"));
process.env.PORT = "3107";
process.env.RUNTIME_STORAGE_ISOLATION = "strict";

const limitsModule = import("../tunneltest-limits.js");

after(async () => {
  await Promise.all([
    rm(process.env.DATA_DIR!, { recursive: true, force: true }),
    rm(process.env.UPLOADS_DIR!, { recursive: true, force: true }),
  ]);
});

test("tunneltest limits count per user and per operation", async () => {
  const { claimTunneltestLimit, getTunneltestQuotaSnapshot } = await limitsModule;
  const now = new Date("2026-06-29T00:00:00.000Z");

  for (let index = 0; index < 5; index += 1) {
    const result = await claimTunneltestLimit({
      localUserId: "user-a",
      operation: "cloud_image_generation",
      taskId: `image-${index}`,
      idempotencyKey: `image-${index}`,
      now: new Date(now.getTime() + index * 11 * 60_000),
    });
    assert.equal(result?.ok, true);
  }

  const exhausted = await claimTunneltestLimit({
    localUserId: "user-a",
    operation: "cloud_image_generation",
    taskId: "image-6",
    idempotencyKey: "image-6",
    now: new Date(now.getTime() + 55 * 60_000),
  });
  assert.equal(exhausted?.ok, false);
  assert.equal(exhausted?.status, 403);
  assert.match(exhausted?.message || "", /图片生成/);

  const otherUser = await claimTunneltestLimit({
    localUserId: "user-b",
    operation: "cloud_image_generation",
    taskId: "image-b",
    idempotencyKey: "image-b",
  });
  assert.equal(otherUser?.ok, true);

  const snapshot = await getTunneltestQuotaSnapshot("user-a");
  assert.equal(snapshot.used_quota_units, 5);
  assert.equal(snapshot.available_quota_units, 3);
});

test("tunneltest limits rate-limit by operation window", async () => {
  const { claimTunneltestLimit } = await limitsModule;
  const now = new Date("2026-06-29T00:00:00.000Z");

  await claimTunneltestLimit({
    localUserId: "video-user",
    operation: "cloud_video_generation",
    taskId: "video-1",
    idempotencyKey: "video-1",
    now,
  });
  const limited = await claimTunneltestLimit({
    localUserId: "video-user",
    operation: "cloud_video_generation",
    taskId: "video-2",
    idempotencyKey: "video-2",
    now: new Date(now.getTime() + 2 * 60_000),
  });

  assert.equal(limited?.ok, false);
  assert.equal(limited?.status, 429);
  assert.match(limited?.message || "", /视频生成/);
});
