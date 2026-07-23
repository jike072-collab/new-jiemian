import { expect, test } from "@playwright/test";

const now = new Date().toISOString();
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const videoItem = {
  id: "library-video",
  type: "video",
  mode: "text-to-video",
  title: "素材库视频",
  prompt: "",
  providerId: "video",
  model: "video-model",
  status: "done",
  createdAt: now,
  updatedAt: now,
  params: {},
  output: { url: "/api/files/library-video.mp4", mimeType: "video/mp4", storedName: "library-video.mp4" },
};

const project = {
  id: "canvas-media-ux",
  title: "媒体体验验收",
  version: 1,
  createdAt: now,
  updatedAt: now,
  document: {
    viewport: { x: 0, y: 0, zoom: 0.9 },
    nodes: [{
      id: "far-video",
      type: "canvas",
      position: { x: 5_000, y: 5_000 },
      width: 320,
      height: 340,
      data: { kind: "media", title: "远处视频", mediaType: "video", libraryItemId: videoItem.id, status: "done" },
    }],
    edges: [],
  },
};

test("uploads appear immediately and video previews stay mounted", async ({ page }) => {
  let uploadCount = 0;
  let releaseUploads = () => {};
  const uploadGate = new Promise<void>((resolve) => { releaseUploads = resolve; });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => window.localStorage.setItem("aohuang-canvas-shortcuts-seen", "1"));
  await page.route("**/api/auth/csrf", (route) => route.fulfill({ json: { token: "preview-csrf" } }));
  await page.route("**/api/providers/enabled", (route) => route.fulfill({ json: { providers: { image: [], video: [] } } }));
  await page.route("**/api/library**", (route) => route.fulfill({ json: { items: [videoItem], total: 1 } }));
  await page.route("**/api/files/**", (route) => route.fulfill({ status: 200, contentType: route.request().url().endsWith(".mp4") ? "video/mp4" : "image/png", body: png }));
  await page.route("**/api/canvas/projects/**/events**", (route) => route.fulfill({ status: 204 }));
  await page.route("**/api/canvas/projects/**/presence**", (route) => route.fulfill({ json: { presences: [] } }));
  await page.route("**/api/canvas/projects**", (route) => {
    const url = route.request().url();
    if (url.includes("/events")) return route.fulfill({ status: 204 });
    if (url.includes("/presence")) return route.fulfill({ json: { presences: [] } });
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON() as { title?: string; document?: typeof project.document };
      return route.fulfill({ json: { project: { ...project, title: body.title || project.title, document: body.document || project.document, version: 2 } } });
    }
    return route.fulfill({ json: { projects: [project] } });
  });
  await page.route("**/api/generate/**", (route) => route.abort("blockedbyclient"));
  await page.route("**/api/canvas/media", async (route) => {
    uploadCount += 1;
    const index = uploadCount;
    await uploadGate;
    const item = {
      ...videoItem,
      id: `uploaded-${index}`,
      type: "image",
      mode: "canvas-upload",
      title: `upload-${index}.png`,
      status: "done",
      output: { url: `/api/files/upload-${index}.png`, mimeType: "image/png", storedName: `upload-${index}.png`, size: png.length },
    };
    await route.fulfill({ json: { item } });
  });

  await page.goto("/canvas-preview", { waitUntil: "networkidle" });
  await expect(page.locator('[data-canvas-node-id="far-video"]')).toHaveCount(1);

  const mediaInput = page.locator('input[accept*="video/mp4"][multiple]');
  await mediaInput.setInputFiles([
    { name: "upload-1.png", mimeType: "image/png", buffer: png },
    { name: "upload-2.png", mimeType: "image/png", buffer: png },
  ]);
  await expect.poll(() => uploadCount).toBe(2);

  const firstUpload = page.locator(".canvas-node--media", { hasText: "upload-1.png" });
  const secondUpload = page.locator(".canvas-node--media", { hasText: "upload-2.png" });
  await expect(firstUpload.locator('img[src^="blob:"]')).toBeVisible();
  await expect(secondUpload.locator('img[src^="blob:"]')).toBeVisible();
  const uploadPositions = await Promise.all([firstUpload, secondUpload].map((node) => node.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y };
  })));
  expect(uploadPositions[0]).not.toEqual(uploadPositions[1]);

  releaseUploads();
  await expect(firstUpload.locator('img[src="/api/files/upload-1.png"]')).toBeVisible();
  await expect(secondUpload.locator('img[src="/api/files/upload-2.png"]')).toBeVisible();

  await page.locator(".canvas-v2-topbar").getByRole("button", { name: "打开素材库" }).click();
  const libraryVideo = page.locator(".canvas-library-item", { hasText: "素材库视频" });
  await expect(libraryVideo.locator(".canvas-video-preview video")).toHaveCount(1);
  await expect(libraryVideo.locator(".canvas-video-preview video")).toHaveAttribute("src", "/api/files/library-video.mp4");
  await page.screenshot({ path: ".codex-canvas-media-ux.png", fullPage: true });
});
