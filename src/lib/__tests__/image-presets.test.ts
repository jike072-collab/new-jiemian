import assert from "node:assert/strict";
import test from "node:test";

import {
  isWhiteBackgroundFourViewPreset,
  whiteBackgroundFourViewCount,
  whiteBackgroundFourViewPresetId,
  whiteBackgroundFourViewPrompt,
  whiteBackgroundFourViewQuality,
  whiteBackgroundFourViewRatio,
  whiteBackgroundFourViewReferenceCount,
} from "../image-presets";

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
  assert.match(whiteBackgroundFourViewPrompt, /纯白背景 #FFFFFF/);
});
