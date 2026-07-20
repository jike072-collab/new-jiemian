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
      <div class="studio-dot-ripple-loader is-fill is-vector-field is-static-field is-expanded-field">
        ${Array.from({ length: 676 }, (_, index) => `<span style="--dot-field-size:${2 + index % 5}px;--dot-field-opacity:${0.2 + (index % 4) * 0.1}"></span>`).join("")}
      </div>
    </div>
  `);

  const result = await page.locator(".studio-dot-ripple-loader").evaluate((loader) => {
    const field = loader.getAnimations()[0];
    const dot = loader.querySelector("span");
    if (!field || !dot) throw new Error("particle field did not render");
    const timing = field.effect?.getComputedTiming();
    field.pause();
    field.currentTime = 0;
    const first = getComputedStyle(loader).transform;
    field.currentTime = 6_400;
    const middle = getComputedStyle(loader).transform;
    field.currentTime = 12_800;
    const last = getComputedStyle(loader).transform;
    return {
      animationCount: loader.getAnimations({ subtree: true }).length,
      dotAnimationName: getComputedStyle(dot).animationName,
      dotCount: loader.querySelectorAll("span").length,
      duration: timing?.duration,
      iterations: timing?.iterations,
      easing: getComputedStyle(loader).animationTimingFunction,
      first,
      middle,
      last,
    };
  });

  assert.equal(result.dotCount, 676);
  assert.equal(result.animationCount, 1);
  assert.equal(result.dotAnimationName, "none");
  assert.equal(result.duration, 12_800);
  assert.equal(result.iterations, Number.POSITIVE_INFINITY);
  assert.equal(result.easing, "linear");
  assert.equal(result.first, result.last);
  assert.notEqual(result.first, result.middle);
  console.log(JSON.stringify({
    ok: true,
    animationCount: result.animationCount,
    dotAnimationName: result.dotAnimationName,
    dotCount: result.dotCount,
    duration: result.duration,
    easing: result.easing,
    seamless: result.first === result.last,
  }));
} finally {
  await browser.close();
}
