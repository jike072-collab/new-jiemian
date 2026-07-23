#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { chromium } from "@playwright/test";

const source = readFileSync("src/app/globals.css", "utf8");
const component = readFileSync("src/components/studio/dot-ripple-loader.tsx", "utf8");
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
      <div class="studio-dot-ripple-loader is-fill is-vector-field is-static-field is-expanded-field">
        <canvas class="studio-dot-ripple-loader__field"></canvas>
      </div>
    </div>
  `);

  const result = await page.locator(".studio-dot-ripple-loader").evaluate((loader) => {
    const canvas = loader.querySelector("canvas");
    const loaderStyle = getComputedStyle(loader);
    const canvasStyle = canvas ? getComputedStyle(canvas) : null;
    return {
      animationCount: loader.getAnimations({ subtree: true }).length,
      fieldAnimationName: loaderStyle.animationName,
      backgroundImage: loaderStyle.backgroundImage,
      dotCount: loader.querySelectorAll("span").length,
      canvasCount: loader.querySelectorAll("canvas").length,
      canvasPosition: canvasStyle?.position,
      canvasWidth: canvasStyle?.width,
      canvasHeight: canvasStyle?.height,
    };
  });

  assert.equal(result.dotCount, 0);
  assert.equal(result.canvasCount, 1);
  assert.equal(result.animationCount, 0);
  assert.equal(result.fieldAnimationName, "none");
  assert.match(result.backgroundImage, /radial-gradient/);
  assert.equal(result.canvasPosition, "absolute");
  assert.ok(Number.parseFloat(result.canvasWidth || "0") > 0);
  assert.ok(Number.parseFloat(result.canvasHeight || "0") > 0);
  assert.match(component, /staticDotFieldDurationMs = 7200/);
  assert.match(component, /expanded \? 26 : 20/);
  assert.match(component, /requestAnimationFrame\(tick\)/);
  assert.match(component, /document\.visibilityState/);
  assert.match(component, /visibilitychange/);
  assert.doesNotMatch(component, /context\.fillStyle = getComputedStyle/);
  console.log(JSON.stringify({
    ok: true,
    animationCount: result.animationCount,
    dotCount: result.dotCount,
    canvasCount: result.canvasCount,
    duration: 7_200,
    seamless: true,
  }));
} finally {
  await browser.close();
}
