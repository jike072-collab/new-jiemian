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

test("Seedance pricing follows model cost and duration tiers", () => {
  assert.equal(estimateVideoGenerationQuota({ ...baseInput, model: "quanneng2.0-9tu", resolution: "720p", durationSeconds: 15 }), 300);
  assert.equal(estimateVideoGenerationQuota({ ...baseInput, model: "video-2.0-fast-720P", resolution: "720p", durationSeconds: 10 }), 550);
  assert.equal(estimateVideoGenerationQuota({ ...baseInput, model: "video-2.0-fast-720P", resolution: "720p", durationSeconds: 15 }), 650);
  assert.equal(estimateVideoGenerationQuota({ ...baseInput, model: "B-quannengship2.0", resolution: "720p", durationSeconds: 5 }), 650);
  assert.equal(estimateVideoGenerationQuota({ ...baseInput, model: "B-quannengship2.0", resolution: "720p", durationSeconds: 10 }), 750);
  assert.equal(estimateVideoGenerationQuota({ ...baseInput, model: "B-quannengship2.0", resolution: "720p", durationSeconds: 15 }), 850);
  assert.equal(estimateVideoGenerationQuota({ ...baseInput, model: "quanneng2.0", resolution: "720p", durationSeconds: 10 }), 800);
  assert.equal(estimateVideoGenerationQuota({ ...baseInput, model: "quanneng2.0", resolution: "720p", durationSeconds: 15 }), 900);
  assert.equal(estimateVideoGenerationQuota({ ...baseInput, model: "Doubao-Seedance-2.0-fast-260128-grid", resolution: "720p", durationSeconds: 15 }), 1200);
  assert.equal(estimateVideoGenerationQuota({ ...baseInput, model: "Doubao-Seedance-2-0-260128-grid", resolution: "720p", durationSeconds: 15 }), 1400);
  const proQuotaByDuration = [400, 500, 600, 700, 800, 900, 1000, 1100, 1200, 1300, 1400, 1500];
  for (const [index, quota] of proQuotaByDuration.entries()) {
    assert.equal(estimateVideoGenerationQuota({ ...baseInput, model: "sdquan-2-miao", resolution: "720p", durationSeconds: index + 4 }), quota);
  }
});

test("CLMM Seedance pricing follows the new model tiers", () => {
  assert.equal(estimateVideoGenerationQuota({ ...baseInput, model: "mg-seedance2.0 -720p mini", resolution: "720p", durationSeconds: 5 }), 300);
  assert.equal(estimateVideoGenerationQuota({ ...baseInput, model: "mg-seedance2.0 -720p fast", resolution: "720p", durationSeconds: 10 }), 800);
  assert.equal(estimateVideoGenerationQuota({ ...baseInput, model: "mg-seedance2.0 -720p pro", resolution: "720p", durationSeconds: 15 }), 1500);
  assert.equal(estimateVideoGenerationQuota({ ...baseInput, model: "seedance2.0 720p-fast-gz-15s", resolution: "720p", durationSeconds: 15 }), 1200);
  assert.equal(estimateVideoGenerationQuota({ ...baseInput, model: "seedance2.0 720p-pro-gz-15s", resolution: "720p", durationSeconds: 15 }), 1400);
  assert.equal(estimateVideoGenerationQuota({ ...baseInput, model: "seedance2.0 720p-933-pro-gz-15s", resolution: "720p", durationSeconds: 15 }), 1500);
  assert.equal(estimateVideoGenerationQuota({ ...baseInput, model: "oe-seedance-2.0-pro-720p-14s", resolution: "720p", durationSeconds: 15 }), 1400);
  assert.equal(estimateVideoGenerationQuota({ ...baseInput, model: "bb-seedance2.0 1080p-pro-gz-15s", resolution: "1080p", durationSeconds: 15 }), 1500);
  assert.equal(estimateVideoGenerationEntitlementUnits({ resolution: "720p", model: "mg-seedance2.0 -720p fast", durationSeconds: 10 }), 1);
  assert.equal(estimateVideoGenerationEntitlementUnits({ resolution: "720p", model: "mg-seedance2.0 -720p fast", durationSeconds: 15 }), 2);
  assert.equal(estimateVideoGenerationEntitlementUnits({ resolution: "720p", model: "seedance2.0 720p-933-pro-gz-15s", durationSeconds: 15 }), 3);
  assert.equal(estimateVideoGenerationEntitlementUnits({ resolution: "720p", model: "oe-seedance-2.0-pro-720p-14s", durationSeconds: 15 }), 2);
  assert.equal(estimateVideoGenerationEntitlementUnits({ resolution: "1080p", model: "bb-seedance2.0 1080p-pro-gz-15s", durationSeconds: 15 }), 3);
});

test("Seedance premium models consume multiple membership video entitlements", () => {
  assert.equal(estimateVideoGenerationEntitlementUnits({ resolution: "720p", model: "quanneng2.0-9tu" }), 1);
  assert.equal(estimateVideoGenerationEntitlementUnits({ resolution: "720p", model: "video-2.0-fast-720P" }), 1);
  assert.equal(estimateVideoGenerationEntitlementUnits({ resolution: "720p", model: "B-quannengship2.0" }), 2);
  assert.equal(estimateVideoGenerationEntitlementUnits({ resolution: "720p", model: "quanneng2.0", durationSeconds: 10 }), 1);
  assert.equal(estimateVideoGenerationEntitlementUnits({ resolution: "720p", model: "quanneng2.0", durationSeconds: 15 }), 2);
  assert.equal(estimateVideoGenerationEntitlementUnits({ resolution: "720p", model: "Doubao-Seedance-2.0-fast-260128-grid" }), 3);
  assert.equal(estimateVideoGenerationEntitlementUnits({ resolution: "720p", model: "Doubao-Seedance-2-0-260128-grid", durationSeconds: 9 }), 1);
  assert.equal(estimateVideoGenerationEntitlementUnits({ resolution: "720p", model: "Doubao-Seedance-2-0-260128-grid", durationSeconds: 10 }), 2);
  assert.equal(estimateVideoGenerationEntitlementUnits({ resolution: "720p", model: "sdquan-2-miao", durationSeconds: 4 }), 1);
  assert.equal(estimateVideoGenerationEntitlementUnits({ resolution: "720p", model: "sdquan-2-miao", durationSeconds: 9 }), 1);
  assert.equal(estimateVideoGenerationEntitlementUnits({ resolution: "720p", model: "sdquan-2-miao", durationSeconds: 10 }), 2);
  assert.equal(estimateVideoGenerationEntitlementUnits({ resolution: "720p", model: "sdquan-2-miao", durationSeconds: 11 }), 2);
  assert.equal(estimateVideoGenerationEntitlementUnits({ resolution: "720p", model: "sdquan-2-miao", durationSeconds: 15 }), 2);
});

test("only unpriced legacy Seedance models remain blocked", () => {
  assert.equal(isVideoGenerationPricingPending("Doubao-Seedance-2.0-fast-260128"), true);
  assert.equal(isVideoGenerationPricingPending("sdquan-2-miao_fast"), true);
  assert.equal(isVideoGenerationPricingPending("quanneng2.0-9tu"), false);
  assert.equal(isVideoGenerationPricingPending("sdquan-2-miao"), false);
  assert.equal(isVideoGenerationPricingPending("Doubao-Seedance-2-0-260128-grid"), false);
  assert.equal(isVideoGenerationPricingPending("mg-seedance2.0 -720p fast"), false);
  assert.equal(isVideoGenerationPricingPending("seedance2.0 720p-933-pro-gz-15s"), false);
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
