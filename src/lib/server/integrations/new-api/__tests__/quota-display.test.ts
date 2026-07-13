import assert from "node:assert/strict";
import { test } from "node:test";

import {
  creditsToNewApiQuota,
  newApiQuotaToCredits,
  type NewApiQuotaDisplayConfig,
} from "../quota-display";

function quotaDisplayConfig(type: NewApiQuotaDisplayConfig["quotaDisplayType"]): NewApiQuotaDisplayConfig {
  return {
    quotaPerUnit: 500_000,
    usdExchangeRate: 7.3,
    quotaDisplayType: type,
    customCurrencySymbol: "¤",
    customCurrencyExchangeRate: 1,
  };
}

test("maps New API quota points to the same frontend credit count", () => {
  const config = quotaDisplayConfig("CNY");
  const rawQuota = 1_369_863;

  assert.equal(newApiQuotaToCredits(rawQuota, config), 273);
  assert.equal(creditsToNewApiQuota(200, config), 1_000_000);
});

test("keeps token-display quota as an identity mapping", () => {
  const config = quotaDisplayConfig("TOKENS");

  assert.equal(newApiQuotaToCredits(320, config), 320);
  assert.equal(creditsToNewApiQuota(320, config), 320);
});
