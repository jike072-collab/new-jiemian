#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { chromium } from "@playwright/test";

const source = readFileSync("src/app/globals.css", "utf8");
const start = source.indexOf("  .studio-dot-ripple-loader {");
const end = source.indexOf("  .studio-sticky-action {", start);
assert.ok(start >= 0 && end > start, "particle loader CSS must be present");

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.setContent(`
    <style>
      :root { --foreground: #fff; --primary: #ff2b88; }
      .frame { position: relative; width: 1200px; height: 720px; overflow: hidden; }
      ${source.slice(start, end)}
    </style>
    <div class="frame">
      <div class="studio-dot-ripple-loader is-fill is-vector-field is-static-field is-expanded-field"></div>
    </div>
  `);

  const result = await page.locator(".studio-dot-ripple-loader").evaluate((loader) => {
    const animations = loader.getAnimations({ subtree: true });
    const glow = animations.find((animation) => (
      animation instanceof CSSAnimation && animation.animationName === "studio-dot-field-glow-loop"
    ));
    if (!glow) throw new Error("dot field glow did not render");
    const timing = glow.effect?.getComputedTiming();
    glow.pause();
    glow.currentTime = 0;
    const first = getComputedStyle(loader, "::before").transform;
    glow.currentTime = 3_600;
    const middle = getComputedStyle(loader, "::before").transform;
    glow.currentTime = 7_200;
    const last = getComputedStyle(loader, "::before").transform;
    return {
      animationCount: animations.length,
      fieldAnimationName: getComputedStyle(loader).animationName,
      glowAnimationName: getComputedStyle(loader, "::before").animationName,
      glowWillChange: getComputedStyle(loader, "::before").willChange,
      maskImage: getComputedStyle(loader).maskImage,
      dotCount: loader.querySelectorAll("span").length,
      duration: timing?.duration,
      iterations: timing?.iterations,
      easing: getComputedStyle(loader, "::before").animationTimingFunction,
      first,
      middle,
      last,
    };
  });

  assert.equal(result.dotCount, 0);
  assert.equal(result.animationCount, 1);
  assert.equal(result.fieldAnimationName, "none");
  assert.equal(result.glowAnimationName, "studio-dot-field-glow-loop");
  assert.match(result.glowWillChange, /transform/);
  assert.match(result.maskImage, /radial-gradient/);
  assert.equal(result.duration, 7_200);
  assert.equal(result.iterations, Number.POSITIVE_INFINITY);
  assert.equal(result.easing, "linear");
  assert.equal(result.first, result.last);
  assert.notEqual(result.first, result.middle);
  console.log(JSON.stringify({
    ok: true,
    animationCount: result.animationCount,
    glowAnimationName: result.glowAnimationName,
    dotCount: result.dotCount,
    duration: result.duration,
    easing: result.easing,
    seamless: result.first === result.last,
  }));
} finally {
  await browser.close();
}
