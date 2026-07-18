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
  assert.match(pageSix, /第 6 张/);
  assert.match(pageSix, /画幅 9:16/);
  assert.match(pageSix, /原始品牌 Logo/);
  assert.match(pageSix, /不得虚构认证/);
  assert.match(ecommerceTenPagePrompt(3, "1:1", 5), /第 3 张/);
  assert.match(pageSix, /OUTSOLE GRIP/);
  assert.match(ecommerceTenPagePrompt(3, "1:1", 10, 1, 4), /主参考第 4 张上传图/);
  assert.match(ecommerceTenPagePrompt(9, "1:1", 10, 1, 4), /必须展示全部 4 款真实配色/);
  assert.ok(ecommerceTenPageBatchStyleCount > 1);
  assert.notEqual(ecommerceTenPagePrompt(1, "1:1", 10, 0), ecommerceTenPagePrompt(1, "1:1", 10, 1));
  assert.match(ecommerceTenPagePrompt(2, "1:1", 10, 1), /统一视觉/);
  assert.match(pageSix, /可按页面需要展示一款或多款/);
  assert.match(pageSix, /中文提示仅是操作指令/);
  assert.ok(pageSix.length < 1300);
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
