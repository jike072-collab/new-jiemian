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
  assert.match(whiteBackgroundFourViewPrompt, /第 1 张为外侧视图/);
  assert.match(whiteBackgroundFourViewPrompt, /第 2 张为内侧视图/);
  assert.match(whiteBackgroundFourViewPrompt, /纯白背景 #FFFFFF/);
});
