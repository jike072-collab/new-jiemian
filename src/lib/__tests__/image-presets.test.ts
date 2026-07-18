import assert from "node:assert/strict";
import test from "node:test";

import {
  ecommerceTenPageBatchStyleCount,
  ecommerceTenPageCount,
  ecommerceTenPageDefaultQuality,
  ecommerceTenPageDefaultRatio,
  ecommerceTenPageMaxReferenceCount,
  ecommerceTenPageMinReferenceCount,
  ecommerceTenPagePresetId,
  ecommerceTenPagePrompt,
  ecommerceTenPageTitles,
  isEcommerceTenPagePreset,
  isWhiteBackgroundFourViewPreset,
  whiteBackgroundFourViewCount,
  whiteBackgroundFourViewPresetId,
  whiteBackgroundFourViewPrompt,
  whiteBackgroundFourViewQuality,
  whiteBackgroundFourViewRatio,
  whiteBackgroundFourViewReferenceCount,
} from "../image-presets";

test("e-commerce ten-page preset defines one page prompt per task", () => {
  assert.equal(ecommerceTenPageCount, 10);
  assert.equal(ecommerceTenPageDefaultRatio, "1:1");
  assert.equal(ecommerceTenPageDefaultQuality, "1k");
  assert.equal(ecommerceTenPageMinReferenceCount, 2);
  assert.equal(ecommerceTenPageMaxReferenceCount, 10);
  assert.equal(ecommerceTenPageTitles.length, ecommerceTenPageCount);
  assert.equal(new Set(Array.from({ length: ecommerceTenPageCount }, (_, index) => ecommerceTenPagePrompt(index + 1, "1:1"))).size, ecommerceTenPageCount);
  assert.equal(isEcommerceTenPagePreset(ecommerceTenPagePresetId), true);
  assert.equal(isEcommerceTenPagePreset("other"), false);
  const pageSix = ecommerceTenPagePrompt(6, "9:16");
  assert.match(pageSix, /Page 6 of a 10-page/);
  assert.match(pageSix, /Canvas ratio: 9:16/);
  assert.match(pageSix, /original brand logo/);
  assert.match(pageSix, /Negative prompt/);
  assert.match(ecommerceTenPagePrompt(3, "1:1", 5), /page 3 of a 5-image/);
  assert.match(pageSix, /OUTSOLE GRIP/);
  assert.match(ecommerceTenPagePrompt(3, "1:1", 10, 1), /Suggested primary colorway: Colorway 3/);
  assert.ok(ecommerceTenPageBatchStyleCount > 1);
  assert.notEqual(ecommerceTenPagePrompt(1, "1:1", 10, 0), ecommerceTenPagePrompt(1, "1:1", 10, 1));
  assert.match(ecommerceTenPagePrompt(2, "1:1", 10, 1), /Unified style:/);
  assert.match(pageSix, /Vary colorway density by page/);
  assert.ok(pageSix.length < 1400);
});

test("white background four-view preset fixes the documented shoe view order", () => {
  assert.equal(whiteBackgroundFourViewReferenceCount, 4);
  assert.equal(whiteBackgroundFourViewRatio, "1:1");
  assert.equal(whiteBackgroundFourViewQuality, "1k");
  assert.equal(whiteBackgroundFourViewCount, 1);
  assert.equal(isWhiteBackgroundFourViewPreset(whiteBackgroundFourViewPresetId), true);
  assert.equal(isWhiteBackgroundFourViewPreset("other"), false);
  assert.match(whiteBackgroundFourViewPrompt, /前两张图片分别是同一双鞋的外侧视图和内侧视图/);
  assert.match(whiteBackgroundFourViewPrompt, /不得把第一张默认当作外侧/);
  assert.match(whiteBackgroundFourViewPrompt, /同一只实际鞋子/);
  assert.match(whiteBackgroundFourViewPrompt, /每个格子只放一只鞋/);
  assert.match(whiteBackgroundFourViewPrompt, /不得把外侧花纹复制到内侧/);
  assert.match(whiteBackgroundFourViewPrompt, /保持对应参考图的原始朝向/);
  assert.match(whiteBackgroundFourViewPrompt, /不是重新设计鞋子/);
  assert.match(whiteBackgroundFourViewPrompt, /纯白背景 #FFFFFF/);
});
