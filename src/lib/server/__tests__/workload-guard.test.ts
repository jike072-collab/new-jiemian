import assert from "node:assert/strict";
import { test } from "node:test";

import { InMemoryConcurrencyLimiter, withWorkloadSlots, WorkloadLimitError } from "../workload-guard";
import { defaultWorkloadLimits, getWorkloadLimits } from "../workload-limits";

test("allows two image tasks per user and rejects the third", () => {
  const limiter = new InMemoryConcurrencyLimiter(() => new Date("2026-07-01T00:00:00.000Z"));
  const first = limiter.tryAcquire("user:u1:image-task", 2, 60_000);
  const second = limiter.tryAcquire("user:u1:image-task", 2, 60_000);
  const third = limiter.tryAcquire("user:u1:image-task", 2, 60_000);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(third.ok, false);
  if (third.ok) return;
  assert.equal(third.retryAfterSeconds, 60);
});

test("enforces one video task and one large upload per user", () => {
  const limiter = new InMemoryConcurrencyLimiter(() => new Date("2026-07-01T00:00:00.000Z"));
  const videoOne = limiter.tryAcquire("user:u1:video-task", 1, 60_000);
  const videoTwo = limiter.tryAcquire("user:u1:video-task", 1, 60_000);
  const uploadOne = limiter.tryAcquire("user:u1:large-upload", 1, 60_000);
  const uploadTwo = limiter.tryAcquire("user:u1:large-upload", 1, 60_000);

  assert.equal(videoOne.ok, true);
  assert.equal(videoTwo.ok, false);
  assert.equal(uploadOne.ok, true);
  assert.equal(uploadTwo.ok, false);
});

test("enforces process and site-wide video upload limits", () => {
  const limiter = new InMemoryConcurrencyLimiter(() => new Date("2026-07-01T00:00:00.000Z"));
  assert.equal(limiter.tryAcquire("process:large-video-io", 1, 60_000).ok, true);
  assert.equal(limiter.tryAcquire("process:large-video-io", 1, 60_000).ok, false);
  assert.equal(limiter.tryAcquire("site:video-upload-phase", 2, 60_000).ok, true);
  assert.equal(limiter.tryAcquire("site:video-upload-phase", 2, 60_000).ok, true);
  assert.equal(limiter.tryAcquire("site:video-upload-phase", 2, 60_000).ok, false);
});

test("releases slots on success and thrown errors", async () => {
  const limiter = new InMemoryConcurrencyLimiter(() => new Date("2026-07-01T00:00:00.000Z"));
  const slots = [{ key: "user:u1:video-task", limit: 1, message: "busy", ttlMs: 60_000 }];

  await withWorkloadSlots(slots, async () => "ok", limiter);
  assert.equal(limiter.activeCount("user:u1:video-task"), 0);

  await assert.rejects(
    withWorkloadSlots(slots, async () => {
      throw new Error("boom");
    }, limiter),
    /boom/,
  );
  assert.equal(limiter.activeCount("user:u1:video-task"), 0);
});

test("returns 429-style error with retry-after when a slot is busy", async () => {
  const limiter = new InMemoryConcurrencyLimiter(() => new Date("2026-07-01T00:00:00.000Z"));
  const slots = [{ key: "user:u1:video-task", limit: 1, message: "busy", ttlMs: 60_000 }];
  const first = limiter.tryAcquire("user:u1:video-task", 1, 60_000);
  assert.equal(first.ok, true);

  await assert.rejects(
    withWorkloadSlots(slots, async () => "blocked", limiter),
    (error) => error instanceof WorkloadLimitError
      && error.status === 429
      && error.retryAfterSeconds === 60,
  );
});

test("expires leaked slots with a controllable clock", () => {
  let now = new Date("2026-07-01T00:00:00.000Z");
  const limiter = new InMemoryConcurrencyLimiter(() => now);
  assert.equal(limiter.tryAcquire("user:u1:video-task", 1, 60_000).ok, true);
  assert.equal(limiter.tryAcquire("user:u1:video-task", 1, 60_000).ok, false);

  now = new Date("2026-07-01T00:01:01.000Z");
  assert.equal(limiter.tryAcquire("user:u1:video-task", 1, 60_000).ok, true);
});

test("environment configuration can lower but not raise safe defaults", () => {
  const loweredEnv: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    WORKLOAD_USER_IMAGE_TASKS: "1",
    WORKLOAD_SITE_VIDEO_UPLOAD_PHASE: "1",
    AUTH_LOGIN_FAILED_PER_IP_PER_MINUTE: "4",
    AUTH_REGISTER_PER_IP_PER_HOUR: "2",
  };
  const lowered = getWorkloadLimits(loweredEnv);
  assert.equal(lowered.userImageTasks, 1);
  assert.equal(lowered.siteVideoUploadPhase, 1);
  assert.equal(lowered.failedLoginPerIp, 4);
  assert.equal(lowered.registerPerIp, 2);

  const raisedEnv: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    WORKLOAD_USER_VIDEO_TASKS: "2",
    WORKLOAD_PROCESS_LARGE_VIDEO_IO: "5",
    AUTH_LOGIN_FAILED_PER_IP_PER_MINUTE: "50",
    AUTH_REGISTER_PER_IP_PER_HOUR: "30",
  };
  const raised = getWorkloadLimits(raisedEnv);
  assert.equal(raised.userVideoTasks, defaultWorkloadLimits.userVideoTasks);
  assert.equal(raised.processLargeVideoIo, defaultWorkloadLimits.processLargeVideoIo);
  assert.equal(raised.failedLoginPerIp, defaultWorkloadLimits.failedLoginPerIp);
  assert.equal(raised.registerPerIp, defaultWorkloadLimits.registerPerIp);
});
