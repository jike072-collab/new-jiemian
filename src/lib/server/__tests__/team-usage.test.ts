import assert from "node:assert/strict";
import { test } from "node:test";

import { aggregateTeamUsage } from "../team-usage";
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

test("internal canvas host is login-only while the public host keeps registration available", () => {
  assert.equal(isInternalCanvasHostname("aohuang888.cn"), true);
  assert.equal(isInternalCanvasHostname("www.aohuang888.cn:443"), true);
  assert.equal(isRegistrationAllowedForHost("aohuang888.cn"), false);
  assert.equal(isRegistrationAllowedForHost("aohuang888.com"), true);
});
