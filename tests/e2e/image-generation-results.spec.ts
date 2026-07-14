import { expect, test } from "@playwright/test";

const user = {
  local_user_id: "e2e-image-results-user",
  email: "image-results-e2e@example.invalid",
  username: "image-results-e2e",
  display_name: "Image Results E2E",
  status: "active",
  role: "user",
};

const provider = {
  id: "image-fixture-provider",
  model: "banana2",
  displayName: "Banana 2",
  capabilities: ["text-to-image"],
  enabled: true,
  endpointType: "gettoken-banana",
};

function accountSummary() {
  return {
    ok: true,
    user,
    quota: null,
    membership: {
      ok: true,
      plans: [],
      membership: {
        active: null,
        queued: null,
        recharge_bonus_basis_points: 0,
        first_purchase_reward_claimed: false,
        entitlements: {
          image_generation: { remaining: 20, granted: 20, used: 0 },
        },
      },
    },
    checkIn: { ok: true, checkIn: { status: "unavailable" }, records: [] },
  };
}

function imageItem(index: number) {
  const now = new Date(Date.UTC(2026, 6, 14, 1, index, 0)).toISOString();
  const imageUrl = `/e2e/generated-image-${index}.svg`;
  return {
    id: `e2e-generated-image-${index}`,
    ownerLocalUserId: user.local_user_id,
    type: "image",
    mode: "text-to-image",
    title: `并发生成结果 ${index}`,
    prompt: "产品摄影，干净背景",
    providerId: provider.id,
    model: provider.model,
    status: "done",
    createdAt: now,
    updatedAt: now,
    completedAt: now,
    output: {
      url: imageUrl,
      mimeType: "image/png",
      storedName: `e2e-generated-image-${index}.png`,
      size: 1024,
    },
    params: { ratio: "1:1", quality: "4k", outputWidth: 4096, outputHeight: 4096 },
    fileAvailable: true,
  };
}

test.beforeEach(async ({ page }) => {
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { ok: true, user } }));
  await page.route("**/api/account/summary", (route) => route.fulfill({ json: accountSummary() }));
  await page.route("**/api/auth/csrf", (route) => route.fulfill({ json: { ok: true, csrfToken: "e2e-csrf" } }));
  await page.route("**/api/providers/enabled", (route) => route.fulfill({
    json: { providers: { image: [provider], video: [] } },
  }));
  await page.route("**/api/library", (route) => route.fulfill({ json: { items: [] } }));
});

test("image results reveal independently with unified waiting visuals", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  if (testInfo.project.name === "chromium") {
    await page.setViewportSize({ width: 1536, height: 1194 });
  }
  const releases: Array<() => void> = [];
  const imageReleases: Array<() => void> = [];
  const precheckPayloads: Array<Record<string, unknown>> = [];
  let requestIndex = 0;
  await page.route("**/api/quota/precheck", (route) => {
    precheckPayloads.push(JSON.parse(route.request().postData() || "{}") as Record<string, unknown>);
    return route.fulfill({ json: { ok: true } });
  });
  await page.route("**/e2e/generated-image-*.svg", async (route) => {
    await new Promise<void>((resolve) => imageReleases.push(resolve));
    const index = route.request().url().match(/generated-image-(\d+)/)?.[1] || "1";
    await route.fulfill({
      contentType: "image/svg+xml",
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200"><rect width="1200" height="1200" fill="#15151b"/><circle cx="600" cy="600" r="320" fill="#ff2b88"/><text x="600" y="640" fill="white" font-size="120" text-anchor="middle">${index}</text></svg>`,
    });
  });
  await page.route("**/api/generate/image", async (route) => {
    const index = ++requestIndex;
    await new Promise<void>((resolve) => releases.push(resolve));
    await route.fulfill({ json: { item: imageItem(index), items: [imageItem(index)] } });
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("prompt-input").fill("产品摄影，干净背景");
  await page.getByRole("button", { name: "清晰度", exact: true }).click();
  await page.getByRole("option", { name: "4K（大图输出）", exact: true }).click();
  await page.getByRole("button", { name: "数量", exact: true }).click();
  await page.getByRole("option", { name: "4张", exact: true }).click();
  await expect(page.getByTestId("primary-submit")).toContainText("抵扣 8 张 · 剩余 20 张");
  if (testInfo.project.name.startsWith("mobile")) {
    await page.locator(".studio-mobile-action__button").click();
  } else {
    await page.getByTestId("primary-submit").click();
  }

  await expect.poll(() => releases.length).toBe(4);
  expect(precheckPayloads).toHaveLength(4);
  expect(precheckPayloads.every((payload) => payload.membershipEntitlementAmount === 2)).toBe(true);
  await expect(page.locator(".studio-image-result-card--pending")).toHaveCount(4);
  await expect(page.locator(".studio-dot-ripple-loader")).toHaveCount(4);
  await expect(page.locator(".studio-image-result-card--pending .studio-dot-ripple-loader span")).toHaveCount(18 * 18 * 4);
  const waitingCoverage = await page.locator(".studio-image-result-card--pending").evaluateAll((cards) => cards.map((card) => {
    const dots = card.querySelector<HTMLElement>(".studio-dot-ripple-loader");
    const dot = dots?.querySelector<HTMLElement>("span");
    const cardRect = card.getBoundingClientRect();
    const dotsRect = dots?.getBoundingClientRect();
    return {
      width: dotsRect ? dotsRect.width / cardRect.width : 0,
      height: dotsRect ? dotsRect.height / cardRect.height : 0,
      baseOpacity: dot ? Number.parseFloat(getComputedStyle(dot).opacity) : 0,
    };
  }));
  for (const coverage of waitingCoverage) {
    expect(coverage.width).toBeGreaterThanOrEqual(0.85);
    expect(coverage.height).toBeGreaterThanOrEqual(0.85);
    expect(coverage.baseOpacity).toBeGreaterThanOrEqual(0.18);
  }
  await page.waitForTimeout(850);
  const waitingPulse = await page.locator(".studio-image-result-card--pending").evaluateAll((cards) => cards.map((card) => {
    const opacities = Array.from(card.querySelectorAll<HTMLElement>(".studio-dot-ripple-loader span"), (dot) => Number.parseFloat(getComputedStyle(dot).opacity));
    return { minimum: Math.min(...opacities), maximum: Math.max(...opacities) };
  }));
  for (const pulse of waitingPulse) {
    expect(pulse.minimum).toBeLessThan(0.55);
    expect(pulse.maximum).toBeGreaterThan(0.75);
    expect(pulse.maximum - pulse.minimum).toBeGreaterThan(0.25);
  }
  await page.screenshot({
    path: testInfo.outputPath(`image-waiting-${testInfo.project.name}.png`),
    fullPage: true,
  });

  releases[0]();
  await expect(page.locator(".studio-image-result-card__media")).toHaveCount(1);
  await expect(page.locator(".studio-image-result-card--pending")).toHaveCount(3);
  await expect.poll(() => imageReleases.length).toBe(1);
  const firstFrame = page.locator(".studio-image-result-card").first().locator(".studio-media-card__frame");
  const firstImage = firstFrame.locator("img");
  const firstRevealOverlay = firstFrame.locator(".studio-media-card__image-reveal-overlay");
  await expect(firstFrame).toHaveAttribute("data-image-reveal-state", "loading");
  await expect(firstImage).toHaveCSS("opacity", "0");
  await expect(firstRevealOverlay).toHaveCSS("opacity", "1");
  const revealTiming = await firstFrame.evaluate((frame) => {
    const image = frame.querySelector("img");
    const overlay = frame.querySelector<HTMLElement>(".studio-media-card__image-reveal-overlay");
    return {
      imageDuration: image ? Number.parseFloat(getComputedStyle(image).transitionDuration) * 1000 : 0,
      overlayDuration: overlay ? Number.parseFloat(getComputedStyle(overlay).transitionDuration) * 1000 : 0,
    };
  });
  expect(revealTiming.imageDuration).toBeGreaterThanOrEqual(500);
  expect(revealTiming.overlayDuration).toBeGreaterThanOrEqual(700);

  imageReleases[0]();
  await expect(firstFrame).toHaveAttribute("data-image-reveal-state", "ready");
  await page.waitForTimeout(160);
  const revealProgress = await firstFrame.evaluate((frame) => {
    const image = frame.querySelector("img");
    const overlay = frame.querySelector<HTMLElement>(".studio-media-card__image-reveal-overlay");
    return {
      imageOpacity: image ? Number.parseFloat(getComputedStyle(image).opacity) : 1,
      overlayOpacity: overlay ? Number.parseFloat(getComputedStyle(overlay).opacity) : 0,
    };
  });
  expect(revealProgress.imageOpacity).toBeGreaterThan(0);
  expect(revealProgress.imageOpacity).toBeLessThan(1);
  expect(revealProgress.overlayOpacity).toBeGreaterThan(0);
  expect(revealProgress.overlayOpacity).toBeLessThan(1);
  await page.screenshot({
    path: testInfo.outputPath(`image-reveal-${testInfo.project.name}.png`),
    fullPage: true,
  });
  await expect(firstImage).toHaveCSS("opacity", "1");
  await expect(firstRevealOverlay).toHaveCSS("visibility", "hidden");
  const firstOverlay = page.locator(".studio-image-result-card__overlay");
  await expect(firstOverlay.getByText("Banana2 · 图片 1", { exact: true })).toBeVisible();
  await expect(firstOverlay.getByText("1:1", { exact: true })).toBeVisible();
  await expect(firstOverlay.getByText("4K", { exact: true })).toBeVisible();

  releases.slice(1).forEach((release) => release());
  await expect(page.locator(".studio-image-result-card__media")).toHaveCount(4);
  await expect(page.locator(".studio-image-result-card--pending")).toHaveCount(0);
  await expect.poll(() => imageReleases.length).toBe(4);
  imageReleases.slice(1).forEach((release) => release());
  await expect(page.locator('[data-image-reveal-state="ready"]')).toHaveCount(4);

  const cardMetrics = await page.locator(".studio-image-result-card").evaluateAll((cards) => cards.map((card) => {
    const frame = card.querySelector<HTMLElement>(".studio-media-card__frame");
    const overlay = card.querySelector<HTMLElement>(".studio-image-result-card__overlay");
    const close = card.querySelector<HTMLElement>(".studio-image-result-card__close");
    const frameRect = frame?.getBoundingClientRect();
    const overlayRect = overlay?.getBoundingClientRect();
    const closeRect = close?.getBoundingClientRect();
    return {
      frameHeight: frameRect?.height || 0,
      overlayInside: Boolean(frameRect && overlayRect && overlayRect.top >= frameRect.top && overlayRect.bottom <= frameRect.bottom),
      closeInside: Boolean(frameRect && closeRect && closeRect.top >= frameRect.top && closeRect.right <= frameRect.right),
      overflowX: card.scrollWidth - card.clientWidth,
    };
  }));
  for (const metrics of cardMetrics) {
    expect(metrics.frameHeight).toBeGreaterThanOrEqual(testInfo.project.name.startsWith("mobile") ? 280 : 300);
    expect(metrics.overlayInside).toBe(true);
    expect(metrics.closeInside).toBe(true);
    expect(metrics.overflowX).toBeLessThanOrEqual(1);
  }

  await page.getByRole("button", { name: "关闭图片 4" }).click();
  await page.getByRole("button", { name: "关闭图片 3" }).click();
  await expect(page.locator(".studio-image-results.is-count-2")).toBeVisible();
  const twoResultMetrics = await page.locator(".studio-image-result-card").evaluateAll((cards) => cards.map((card) => {
    const frame = card.querySelector<HTMLElement>(".studio-media-card__frame");
    const action = card.querySelector<HTMLElement>(".studio-image-result-card__actions .studio-secondary-button");
    const cardRect = card.getBoundingClientRect();
    const frameRect = frame?.getBoundingClientRect();
    const actionRect = action?.getBoundingClientRect();
    return {
      extraHeight: frameRect ? cardRect.height - frameRect.height : Number.POSITIVE_INFINITY,
      actionHeight: actionRect?.height || 0,
    };
  }));
  for (const metrics of twoResultMetrics) {
    expect(metrics.extraHeight).toBeLessThanOrEqual(testInfo.project.name.startsWith("mobile") ? 270 : 84);
    expect(metrics.actionHeight).toBeLessThanOrEqual(44);
  }

  await page.screenshot({
    path: testInfo.outputPath(`image-results-two-${testInfo.project.name}.png`),
    fullPage: true,
  });
});
