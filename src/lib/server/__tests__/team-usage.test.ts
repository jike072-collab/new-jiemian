import assert from "node:assert/strict";
import { test } from "node:test";

import { aggregateSeedanceCanvasSuccess, aggregateTeamUsage } from "../team-usage";
import type { UsageLogEntry } from "../quota/types";
import { isInternalCanvasHostname, isRegistrationAllowedForHost } from "../auth/registration-policy";

function usage(input: Partial<UsageLogEntry>): UsageLogEntry {
  return {
    id: input.id || "usage",
    local_user_id: input.local_user_id || "user-a",
    new_api_user_id: null,
    task_id: input.task_id || input.id || "task",
    operation: input.operation || "cloud_image_generation",
    status: input.status || "succeeded",
    estimated_quota_units: input.estimated_quota_units ?? 0,
    actual_quota_units: input.actual_quota_units === undefined ? null : input.actual_quota_units,
    upstream_log_id: null,
    upstream_request_id: null,
    upstream_model: null,
    upstream_created_at: null,
    created_at: "2026-07-19T00:00:00.000Z",
    updated_at: "2026-07-19T00:00:00.000Z",
    idempotency_key: input.idempotency_key || input.id || "key",
    error_code: null,
    error_message: null,
  };
}

test("team usage counts billable image and video work using actual units when available", () => {
  const summary = aggregateTeamUsage([
    usage({ id: "image", estimated_quota_units: 10, actual_quota_units: 8 }),
    usage({ id: "video", operation: "cloud_video_generation", status: "accepted", estimated_quota_units: 12 }),
    usage({ id: "edit", operation: "cloud_image_edit", estimated_quota_units: 4 }),
    usage({ id: "failed", status: "failed", estimated_quota_units: 99 }),
    usage({ id: "cancelled", status: "cancelled", operation: "cloud_video_generation", estimated_quota_units: 99 }),
  ]);

  assert.deepEqual(summary, { creditUnits: 24, imageTasks: 2, videoTasks: 1 });
});

test("Seedance canvas success groups models and separately counts reference-video generations", () => {
  const entry = (input: Record<string, unknown> = {}) => ({
    ownerLocalUserId: "user-a",
    type: "video",
    status: "done",
    providerId: "video-seedance-new::model::fast",
    model: "seedance2.0 720p-fast-gz-15s",
    createdAt: "2026-07-20T00:00:00.000Z",
    params: { canvasRequestedAt: "2026-07-20T00:00:00.000Z", referenceVideos: 1 },
    ...input,
  });
  const summary = aggregateSeedanceCanvasSuccess([
    entry(),
    entry({ params: { canvasRequestedAt: "2026-07-21T00:00:00.000Z", referenceVideos: 0 } }),
    entry({ providerId: "video-main", model: "Doubao-Seedance-2.0-fast-260128-grid", params: { billingTaskId: "canvas-video-old", referenceVideos: 2 } }),
    entry({ status: "failed" }),
    entry({ params: { referenceVideos: 1, billingTaskId: "studio-video-1" } }),
    entry({ ownerLocalUserId: "user-b" }),
    entry({ providerId: "video-veo", model: "veo-3.1-pro" }),
    entry({ params: { canvasRequestedAt: "2026-06-01T00:00:00.000Z", referenceVideos: 1 } }),
  ], {
    ownerIds: ["user-a"],
    from: "2026-07-01T00:00:00.000Z",
    to: "2026-08-01T00:00:00.000Z",
  });

  assert.deepEqual(summary, {
    successfulCount: 3,
    referenceVideoSuccessfulCount: 2,
    models: [
      { model: "seedance2.0 720p-fast-gz-15s", successfulCount: 2, referenceVideoSuccessfulCount: 1 },
      { model: "Doubao-Seedance-2.0-fast-260128-grid", successfulCount: 1, referenceVideoSuccessfulCount: 1 },
    ],
  });
});

test("internal canvas host is login-only while the public host keeps registration available", () => {
  assert.equal(isInternalCanvasHostname("aohuang888.cn"), true);
  assert.equal(isInternalCanvasHostname("www.aohuang888.cn:443"), true);
  assert.equal(isRegistrationAllowedForHost("aohuang888.cn"), false);
  assert.equal(isRegistrationAllowedForHost("aohuang888.com"), true);
});
