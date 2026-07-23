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
const enabledProvidersPath = "/api/providers/enabled";

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
    params: { ratio: "3:2", quality: "4k", outputWidth: 1200, outputHeight: 800 },
    fileAvailable: true,
  };
}

test.beforeEach(async ({ page }) => {
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { ok: true, user } }));
  await page.route("**/api/account/summary", (route) => route.fulfill({ json: accountSummary() }));
  await page.route("**/api/auth/csrf", (route) => route.fulfill({ json: { ok: true, csrfToken: "e2e-csrf" } }));
  await page.route(`**${enabledProvidersPath}**`, (route) => route.fulfill({
    json: { providers: { image: [provider], video: [] } },
  }));
  await page.route("**/api/library", (route) => route.fulfill({ json: { items: [] } }));
});

test("image features default to image generation and special uploads clear in one action", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Desktop Chromium covers the header feature menu.");
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("prompt-input")).toBeVisible({ timeout: 30_000 });

  const featureButton = page.getByRole("button", { name: "功能", exact: true });
  await featureButton.click();
  const menu = page.getByRole("menu", { name: "图片固定功能" });
  await expect(menu.getByRole("menuitem")).toHaveCount(3);
  await expect(menu.getByRole("menuitem").first()).toContainText("图片生成");
  await expect(menu.getByRole("menuitem").filter({ hasText: "图片生成" })).toHaveClass(/is-active/);
  await page.getByTestId("prompt-input").click();
  await expect(menu).toHaveCount(0);
  await featureButton.click();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await featureButton.click();
  await page.screenshot({ path: testInfo.outputPath("image-feature-menu-desktop.png"), fullPage: true });

  await menu.getByRole("menuitem").filter({ hasText: "四视图白底图" }).click();
  const fourViewInput = page.locator("#four-view-reference-input");
  await expect(fourViewInput).toHaveAttribute("multiple", "");
  const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const startedAt = Date.now();
  const fourViewChooserPromise = page.waitForEvent("filechooser");
  await page.locator(".studio-four-view-upload-slot.is-next").click({ position: { x: 6, y: 6 } });
  const fourViewChooser = await fourViewChooserPromise;
  await fourViewChooser.setFiles(Array.from({ length: 4 }, (_, index) => ({
    name: `view-${index + 1}.png`,
    mimeType: "image/png",
    buffer: pixel,
  })));
  await expect(page.locator(".studio-four-view-upload-slot.is-filled")).toHaveCount(4);
  expect(Date.now() - startedAt).toBeLessThan(1_000);
  await page.screenshot({ path: testInfo.outputPath("image-four-view-upload-desktop.png"), fullPage: true });
  await page.getByRole("button", { name: "一键清除素材", exact: true }).click();
  await expect(page.locator(".studio-four-view-upload-slot.is-filled")).toHaveCount(0);

  await featureButton.click();
  await page.getByRole("menuitem").filter({ hasText: "电商套图 1-10 张" }).click();
  const ecommerceAssets = page.locator(".studio-ecommerce-assets-upload");
  await expect(ecommerceAssets).toHaveCount(1);
  await expect(page.locator(".studio-ecommerce-logo-upload")).toHaveCount(0);
  await expect(ecommerceAssets.locator(".studio-ecommerce-board-grid").getByRole("button").first()).toContainText("Logo 上传");
  await expect(ecommerceAssets.getByRole("button", { name: "添加配色" })).toBeDisabled();
  const logoChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /Logo 上传/ }).click();
  const logoChooser = await logoChooserPromise;
  await logoChooser.setFiles({ name: "logo.png", mimeType: "image/png", buffer: pixel });
  await expect(ecommerceAssets.locator(".studio-ecommerce-board-preview.is-logo")).toHaveCount(1);
  await expect(ecommerceAssets.getByRole("button", { name: "添加配色" })).toBeEnabled();
  await page.getByLabel("上传配色四视图白底图").setInputFiles({ name: "board.png", mimeType: "image/png", buffer: pixel });
  await expect(page.locator(".studio-ecommerce-board-preview.is-logo")).toHaveCount(1);
  await expect(page.locator(".studio-ecommerce-board-preview:not(.is-logo)")).toHaveCount(1);
  await page.getByRole("button", { name: "一键清除素材", exact: true }).click();
  await expect(page.locator(".studio-ecommerce-board-preview.is-logo")).toHaveCount(0);
  await expect(page.locator(".studio-ecommerce-board-preview")).toHaveCount(0);
  await featureButton.click();
  await page.getByRole("menuitem").filter({ hasText: "图片生成" }).click();
  await expect(page.getByTestId("prompt-input")).toBeVisible();
});

test("mobile image feature switch exposes all three modes", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile Chrome covers the compact feature switch.");
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const featureTabs = page.locator(".studio-image-feature-mobile-tabs");
  await expect(featureTabs).toBeVisible({ timeout: 30_000 });
  await expect(featureTabs.getByRole("button")).toHaveCount(3);
  await expect(featureTabs.getByRole("button", { name: "图片生成", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: testInfo.outputPath("image-feature-tabs-mobile.png"), fullPage: true });
  await featureTabs.getByRole("button", { name: "四视图", exact: true }).click();
  await expect(page.locator("#four-view-reference-input")).toBeAttached();
  await featureTabs.getByRole("button", { name: "图片生成", exact: true }).click();
  await expect(page.getByTestId("prompt-input")).toBeVisible();
});

test("generated image opens immediately and reuses its cached download source", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Desktop Chromium covers cached result actions.");
  let imageFetchCount = 0;
  let releaseImageFetch: () => void = () => {};
  const imageFetchGate = new Promise<void>((resolve) => {
    releaseImageFetch = resolve;
  });
  await page.route("**/api/quota/precheck", (route) => route.fulfill({ json: { ok: true } }));
  await page.route("**/api/generate/image", (route) => route.fulfill({
    json: { item: imageItem(1), items: [imageItem(1)] },
  }));
  await page.route("**/e2e/generated-image-1.svg", async (route) => {
    imageFetchCount += 1;
    await imageFetchGate;
    await route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#ff2b88"/></svg>',
    });
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("prompt-input").fill("产品摄影，干净背景");
  await page.getByTestId("primary-submit").click();
  const resultCard = page.locator(".studio-image-result-card").first();
  await expect.poll(() => imageFetchCount).toBe(1);
  const downloadLink = resultCard.locator("[data-download-cache-ready]");
  const downloadPromise = page.waitForEvent("download");
  await downloadLink.click();
  await expect(downloadLink).toContainText("正在准备");
  expect(imageFetchCount).toBe(1);
  releaseImageFetch();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("e2e-generated-image-1.png");
  const cachedDownload = resultCard.locator("[data-download-cache-ready='true']");
  await expect(cachedDownload).toHaveCount(1);
  await expect(cachedDownload).toHaveAttribute("href", /^blob:/);
  await resultCard.getByRole("button", { name: "放大查看图片 1" }).click();
  const lightbox = page.getByRole("dialog", { name: "图片大图预览" });
  await expect(lightbox).toBeVisible();
  await expect(lightbox.locator("img")).toHaveAttribute("src", /^blob:/);
  expect(imageFetchCount).toBe(1);
  await page.screenshot({ path: testInfo.outputPath("image-result-lightbox-desktop.png"), fullPage: true });
  await page.keyboard.press("Escape");
  await expect(lightbox).toHaveCount(0);
});

test("workspace function panels become ready within one second", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Desktop Chromium covers code-split panel readiness.");
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("prompt-input")).toBeVisible({ timeout: 30_000 });

  const panels = [
    { tool: "AI 视频生成器", ready: page.getByTestId("video-prompt-input"), state: "visible" as const },
    { tool: "图片高清增强", ready: page.locator("#image-upscale-input"), state: "attached" as const },
    { tool: "视频高清增强", ready: page.locator("#video-upscale-input"), state: "attached" as const },
    { tool: "作品库", ready: page.locator(".studio-library-page"), state: "visible" as const },
    { tool: "AI 图像生成器", ready: page.getByTestId("prompt-input"), state: "visible" as const },
  ];

  for (const panel of panels) {
    const button = page.locator("button.shell-nav-item:visible").filter({ hasText: panel.tool });
    await expect(button).toHaveCount(1);
    const startedAt = Date.now();
    await button.click();
    await panel.ready.waitFor({ state: panel.state, timeout: 1_000 });
    expect(Date.now() - startedAt, `${panel.tool} should be ready within one second`).toBeLessThan(1_000);
  }
});

test("single pending image fills the available preview height", async ({ page }, testInfo) => {
  test.setTimeout(45_000);
  if (testInfo.project.name === "chromium") {
    await page.setViewportSize({ width: 1536, height: 1194 });
  }
  const releases: Array<() => void> = [];
  await page.route("**/api/quota/precheck", (route) => route.fulfill({ json: { ok: true } }));
  await page.route("**/api/generate/image", async (route) => {
    await new Promise<void>((resolve) => releases.push(resolve));
    await route.fulfill({ json: { item: imageItem(1), items: [imageItem(1)] } });
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "提示词优化设置", exact: true })).toBeEnabled({ timeout: 30_000 });
  await page.getByTestId("prompt-input").fill("产品摄影，干净背景");
  if (testInfo.project.name.startsWith("mobile")) {
    await page.locator(".studio-mobile-action__button").click();
  } else {
    await page.getByTestId("primary-submit").click();
  }

  await expect.poll(() => releases.length).toBe(1);
  const pendingCard = page.locator(".studio-image-result-card--pending");
  await expect(pendingCard).toHaveCount(1);
  await expect(pendingCard).toBeVisible();
  const pendingLoader = pendingCard.locator(".studio-dot-ripple-loader.is-expanded-field.is-static-field");
  await expect(pendingLoader.locator("span")).toHaveCount(0);
  const layout = await pendingCard.evaluate((card) => {
    const grid = card.closest<HTMLElement>(".studio-image-results");
    const cardRect = card.getBoundingClientRect();
    const gridRect = grid?.getBoundingClientRect();
    return {
      cardHeight: cardRect.height,
      gridHeight: gridRect?.height || 0,
      overflow: grid ? grid.scrollHeight - grid.clientHeight : Number.POSITIVE_INFINITY,
    };
  });
  expect(layout.gridHeight).toBeGreaterThan(0);
  expect(layout.cardHeight / layout.gridHeight).toBeGreaterThanOrEqual(0.98);
  expect(layout.overflow).toBeLessThanOrEqual(1);
  const initialMotion = await pendingLoader.evaluate((loader) => {
    const canvas = loader.querySelector("canvas");
    const context = canvas?.getContext("2d");
    const pixels = canvas && context ? context.getImageData(0, 0, canvas.width, canvas.height).data : new Uint8ClampedArray();
    return {
      canvasCount: loader.querySelectorAll("canvas").length,
      canvasWidth: canvas?.width || 0,
      canvasHeight: canvas?.height || 0,
      checksum: pixels.reduce((sum, value, index) => (sum + value * ((index % 97) + 1)) % 1_000_000_007, 0),
      fieldAnimation: getComputedStyle(loader).animationName,
      backgroundImage: getComputedStyle(loader).backgroundImage,
    };
  });
  await page.waitForTimeout(320);
  const movedMotion = await pendingLoader.evaluate((loader) => {
    const canvas = loader.querySelector("canvas");
    const context = canvas?.getContext("2d");
    const pixels = canvas && context ? context.getImageData(0, 0, canvas.width, canvas.height).data : new Uint8ClampedArray();
    return {
      checksum: pixels.reduce((sum, value, index) => (sum + value * ((index % 97) + 1)) % 1_000_000_007, 0),
      fieldAnimation: getComputedStyle(loader).animationName,
      backgroundImage: getComputedStyle(loader).backgroundImage,
    };
  });
  expect(initialMotion.canvasCount).toBe(1);
  expect(initialMotion.canvasWidth).toBeGreaterThan(0);
  expect(initialMotion.canvasHeight).toBeGreaterThan(0);
  expect(movedMotion.fieldAnimation).toBe("none");
  expect(movedMotion.backgroundImage).toContain("radial-gradient");
  expect(movedMotion.backgroundImage).toBe(initialMotion.backgroundImage);
  expect(movedMotion.checksum).not.toBe(initialMotion.checksum);
  await page.screenshot({
    path: testInfo.outputPath(`image-waiting-single-${testInfo.project.name}.png`),
    fullPage: true,
  });
});

test("waiting field stays static when reduced motion is enabled", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Desktop Chromium covers reduced motion rendering.");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/quota/precheck", (route) => route.fulfill({ json: { ok: true } }));
  await page.route("**/api/generate/image", () => new Promise(() => undefined));

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("prompt-input").fill("产品摄影，干净背景");
  await page.getByTestId("primary-submit").click();
  const canvas = page.locator(".studio-image-result-card--pending canvas");
  await expect(canvas).toHaveCount(1);
  const initialFrame = await canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL());
  await page.waitForTimeout(360);
  const laterFrame = await canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL());
  expect(laterFrame).toBe(initialFrame);
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
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#15151b"/><circle cx="600" cy="400" r="250" fill="#ff2b88"/><text x="600" y="440" fill="white" font-size="120" text-anchor="middle">${index}</text></svg>`,
    });
  });
  await page.route("**/api/generate/image", async (route) => {
    const index = ++requestIndex;
    await new Promise<void>((resolve) => releases.push(resolve));
    await route.fulfill({ json: { item: imageItem(index), items: [imageItem(index)] } });
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "提示词优化设置", exact: true })).toBeEnabled({ timeout: 30_000 });
  await page.getByTestId("prompt-input").fill("产品摄影，干净背景");
  await page.getByRole("button", { name: "3:2", exact: true }).click();
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
  await expect(page.locator(".studio-image-result-card--pending .studio-dot-ripple-loader span")).toHaveCount(0);
  await expect(page.locator(".image-generation-progress")).toHaveCount(1);
  await page.locator(".image-generation-progress__head button").click();
  await expect(page.locator(".image-generation-progress")).toHaveCount(0);
  await expect(page.locator(".studio-image-result-card--pending")).toHaveCount(4);
  const waitingCoverage = await page.locator(".studio-image-result-card--pending").evaluateAll((cards) => cards.map((card) => {
    const dots = card.querySelector<HTMLElement>(".studio-dot-ripple-loader");
    const cardRect = card.getBoundingClientRect();
    const dotsRect = dots?.getBoundingClientRect();
    return {
      width: dotsRect ? dotsRect.width / cardRect.width : 0,
      height: dotsRect ? dotsRect.height / cardRect.height : 0,
      animationName: dots ? getComputedStyle(dots).animationName : "",
      backgroundImage: dots ? getComputedStyle(dots).backgroundImage : "",
      vectorField: dots?.classList.contains("is-vector-field") || false,
      particleCount: dots?.querySelectorAll("span").length || 0,
      canvasCount: dots?.querySelectorAll("canvas").length || 0,
      canvasWidth: dots?.querySelector("canvas")?.width || 0,
      canvasHeight: dots?.querySelector("canvas")?.height || 0,
    };
  }));
  for (const coverage of waitingCoverage) {
    expect(coverage.width).toBeGreaterThanOrEqual(0.85);
    expect(coverage.height).toBeGreaterThanOrEqual(0.85);
    expect(coverage.animationName).toBe("none");
    expect(coverage.backgroundImage).toContain("radial-gradient");
    expect(coverage.vectorField).toBe(true);
    expect(coverage.particleCount).toBe(0);
    expect(coverage.canvasCount).toBe(1);
    expect(coverage.canvasWidth).toBeGreaterThan(0);
    expect(coverage.canvasHeight).toBeGreaterThan(0);
  }
  const canvasFrames = async () => page.locator(".studio-image-result-card--pending canvas").evaluateAll((elements) => elements.map((element) => {
    const canvas = element as HTMLCanvasElement;
    return canvas.toDataURL();
  }));
  await page.locator(".studio-image-result-card--pending canvas").first().scrollIntoViewIfNeeded();
  const initialCanvasFrames = await canvasFrames();
  await expect.poll(async () => {
    const movedCanvasFrames = await canvasFrames();
    return movedCanvasFrames.some((frame, index) => frame !== initialCanvasFrames[index]);
  }, { timeout: 3_000 }).toBe(true);
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
  await expect(firstImage).toHaveCount(0);
  await expect(firstRevealOverlay).toHaveCSS("opacity", "1");

  imageReleases[0]();
  await expect(firstImage).toHaveCount(1);
  const revealTiming = await firstFrame.evaluate((frame) => {
    const image = frame.querySelector("img");
    return {
      imageDuration: image ? Number.parseFloat(getComputedStyle(image).transitionDuration) * 1000 : 0,
      imageProperties: image ? getComputedStyle(image).transitionProperty : "",
    };
  });
  expect(revealTiming.imageDuration).toBeGreaterThanOrEqual(450);
  expect(revealTiming.imageProperties).toContain("opacity");
  expect(revealTiming.imageProperties).toContain("filter");
  expect(revealTiming.imageProperties).not.toContain("clip-path");
  const mosaicAnimationName = await page.evaluate(() => {
    const frame = document.createElement("div");
    frame.className = "studio-media-card__frame is-image-ready";
    const overlay = document.createElement("div");
    overlay.className = "studio-media-card__image-reveal-overlay";
    const loader = document.createElement("div");
    loader.className = "studio-dot-ripple-loader is-fill has-image-fragments";
    const cell = document.createElement("span");
    loader.append(cell);
    overlay.append(loader);
    frame.append(overlay);
    document.body.append(frame);
    const animationName = getComputedStyle(cell).animationName;
    frame.remove();
    return animationName;
  });
  expect(mosaicAnimationName).toBe("studio-image-mosaic-reveal");
  await page.waitForTimeout(160);
  await page.screenshot({
    path: testInfo.outputPath(`image-mosaic-${testInfo.project.name}.png`),
    fullPage: true,
  });
  if (testInfo.project.name === "chromium") {
    const videoTool = page.locator("button.shell-nav-item:visible").filter({ hasText: "AI 视频生成器" });
    const imageTool = page.locator("button.shell-nav-item:visible").filter({ hasText: "AI 图像生成器" });
    await videoTool.click();
    await imageTool.click();
    await expect(firstFrame).toHaveAttribute("data-image-reveal-state", "ready");
    await expect(firstRevealOverlay).toHaveCount(0);
  } else {
    await page.waitForTimeout(520);
  }
  await page.screenshot({
    path: testInfo.outputPath(`image-reveal-${testInfo.project.name}.png`),
    fullPage: true,
  });
  await expect(firstFrame).toHaveAttribute("data-image-reveal-state", "ready");
  await expect(firstImage).toHaveCSS("opacity", "1");
  await expect(firstRevealOverlay).toHaveCount(0);
  const firstResultCard = page.locator(".studio-image-result-card").first();
  await expect(firstResultCard.locator("[data-download-cache-ready='true']")).toHaveCount(1);
  await firstResultCard.getByRole("button", { name: "放大查看图片 1" }).click();
  const lightbox = page.getByRole("dialog", { name: "图片大图预览" });
  await expect(lightbox).toBeVisible();
  await expect(lightbox.locator("img")).toHaveAttribute("src", /^blob:/);
  await expect(lightbox.locator("[data-download-cache-ready='true']")).toHaveCount(1);
  await lightbox.getByRole("button", { name: "关闭大图预览" }).click();
  await expect(lightbox).toHaveCount(0);
  const revealBounds = await firstFrame.evaluate((frame) => {
    const width = Number(frame.getAttribute("data-image-reveal-width"));
    const height = Number(frame.getAttribute("data-image-reveal-height"));
    return {
      grid: frame.getAttribute("data-image-reveal-grid"),
      ratio: width / height,
      heightCoverage: height / frame.clientHeight,
    };
  });
  expect(revealBounds.grid).toBe("24");
  expect(revealBounds.ratio).toBeGreaterThan(1.45);
  expect(revealBounds.ratio).toBeLessThan(1.55);
  expect(revealBounds.heightCoverage).toBeLessThan(0.9);
  const firstOverlay = page.locator(".studio-image-result-card__overlay");
  await expect(firstOverlay.getByText("Banana2 · 图片 1", { exact: true })).toBeVisible();
  await expect(firstOverlay.getByText("3:2", { exact: true })).toBeVisible();
  await expect(firstOverlay.getByText("1200 x 800", { exact: true })).toBeVisible();
  await expect(firstOverlay.getByText("4K", { exact: true })).toBeVisible();

  releases.slice(1).forEach((release) => release());
  await expect(page.locator(".studio-image-result-card__media")).toHaveCount(4);
  await expect(page.locator(".studio-image-result-card--pending")).toHaveCount(0);
  await expect.poll(() => imageReleases.length).toBe(4);
  imageReleases.slice(1).forEach((release) => release());
  await expect(page.locator('[data-image-reveal-state="ready"]')).toHaveCount(4);

  if (testInfo.project.name === "chromium") {
    const videoTool = page.locator("button.shell-nav-item:visible").filter({ hasText: "AI 视频生成器" });
    const imageTool = page.locator("button.shell-nav-item:visible").filter({ hasText: "AI 图像生成器" });
    await expect(videoTool).toHaveCount(1);
    await expect(imageTool).toHaveCount(1);
    await videoTool.click();
    await imageTool.click();
    await expect(page.locator('[data-image-reveal-state="ready"]')).toHaveCount(4);
    await expect(page.locator(".studio-media-card__image-reveal-overlay")).toHaveCount(0);
    const resultActions = page.locator(".studio-image-result-card").first().locator(".studio-image-result-card__actions .studio-secondary-button");
    await expect(resultActions).toHaveCount(5);
    expect(await resultActions.evaluateAll((buttons) => buttons.every((button) => !button.classList.contains("studio-secondary-button--accent")))).toBe(true);
    const backgroundBeforeHover = await resultActions.nth(3).evaluate((button) => getComputedStyle(button).backgroundColor);
    await resultActions.nth(3).hover();
    await expect.poll(() => resultActions.nth(3).evaluate((button) => getComputedStyle(button).backgroundColor)).not.toBe(backgroundBeforeHover);
  }

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

  await page.getByRole("button", { name: "关闭图片 2" }).click();
  await expect(page.locator(".studio-image-results.is-count-1")).toBeVisible();
  const singleResultMetrics = await page.locator(".studio-image-result-card").evaluateAll((cards) => cards.map((card) => {
    const frame = card.querySelector<HTMLElement>(".studio-media-card__frame");
    const cardRect = card.getBoundingClientRect();
    const frameRect = frame?.getBoundingClientRect();
    return { extraHeight: frameRect ? cardRect.height - frameRect.height : Number.POSITIVE_INFINITY };
  }));
  expect(singleResultMetrics).toHaveLength(1);
  expect(singleResultMetrics[0].extraHeight).toBeLessThanOrEqual(testInfo.project.name.startsWith("mobile") ? 270 : 84);

  await page.getByRole("button", { name: "重做", exact: true }).click();
  await expect.poll(() => precheckPayloads.length).toBe(8);
  await expect.poll(() => releases.length).toBe(8);
  await expect(page.locator(".studio-image-result-card--pending")).toHaveCount(4);
  await expect(page.locator(".studio-image-result-card__media")).toHaveCount(0);
});
