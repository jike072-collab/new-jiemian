import assert from "node:assert/strict";
import test from "node:test";

import {
  estimateVideoGenerationEntitlementUnits,
  estimateVideoGenerationQuota,
  generationBillingFingerprint,
  isVideoGenerationPricingPending,
} from "../../../generation-quota.js";

const baseInput = {
  mode: "text-to-video" as const,
  durationSeconds: 8,
  referenceImages: 0,
};

test("Veo 3.1 prices fixed eight-second videos by model and resolution", () => {
  assert.equal(estimateVideoGenerationQuota({ ...baseInput, model: "veo-3.1-pro", resolution: "720p" }), 800);
  assert.equal(estimateVideoGenerationQuota({ ...baseInput, model: "veo-3.1-pro", resolution: "1080p" }), 880);
  assert.equal(estimateVideoGenerationQuota({ ...baseInput, model: "veo-3.1-pro", resolution: "4k" }), 960);
  assert.equal(estimateVideoGenerationQuota({ ...baseInput, model: "veo-3.1-fast", resolution: "720p" }), 640);
  assert.equal(estimateVideoGenerationQuota({ ...baseInput, model: "veo-3.1-fast", resolution: "1080p" }), 710);
  assert.equal(estimateVideoGenerationQuota({ ...baseInput, model: "veo-3.1-fast", resolution: "4k" }), 770);
});

test("4K video generation requires two membership entitlement units", () => {
  assert.equal(estimateVideoGenerationEntitlementUnits({ resolution: "720p" }), 1);
  assert.equal(estimateVideoGenerationEntitlementUnits({ resolution: "1080p" }), 1);
  assert.equal(estimateVideoGenerationEntitlementUnits({ resolution: "4K" }), 2);
});

test("Seedance models remain blocked until product pricing is configured", () => {
  assert.equal(isVideoGenerationPricingPending("Doubao-Seedance-2.0-fast-260128"), true);
  assert.equal(isVideoGenerationPricingPending("veo-3.1-pro"), false);
  assert.equal(isVideoGenerationPricingPending("grok-video-1.5"), false);
});

test("video billing fingerprints include resolution", () => {
  const input = {
    kind: "video" as const,
    providerId: "veo-provider",
    mode: "text-to-video" as const,
    ratio: "16:9",
    durationSeconds: 8,
    referenceImages: 0,
    model: "veo-3.1-pro",
    taskId: "video-task",
    estimatedQuotaUnits: 800,
  };
  const fingerprint720 = generationBillingFingerprint({ ...input, resolution: "720p" });
  const fingerprint1080 = generationBillingFingerprint({ ...input, resolution: "1080p", estimatedQuotaUnits: 880 });
  assert.notEqual(fingerprint720, fingerprint1080);
});
