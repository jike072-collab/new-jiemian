import { expect, test } from "@playwright/test";

const user = {
  local_user_id: "e2e-library-user",
  email: "library-e2e@example.invalid",
  username: "library-e2e",
  display_name: "Library E2E",
  status: "active",
  role: "user",
};

const item = {
  id: "e2e-library-image",
  ownerLocalUserId: user.local_user_id,
  type: "image",
  mode: "text-to-image",
  title: "作品库交互测试图",
  prompt: "library interaction fixture",
  providerId: "fixture-provider",
  model: "fixture-model",
  status: "done",
  createdAt: "2026-07-14T00:00:00.000Z",
  updatedAt: "2026-07-14T00:00:00.000Z",
  completedAt: "2026-07-14T00:00:00.000Z",
  output: {
    url: "/images/reference/sample-2.png",
    mimeType: "image/png",
    storedName: "e2e-library-image.png",
    size: 1024,
  },
  params: { ratio: "1:1", outputWidth: 1024, outputHeight: 1024 },
  fileAvailable: true,
};

test.beforeEach(async ({ page }) => {
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { ok: true, user } }));
  await page.route("**/api/account/summary", (route) => route.fulfill({
    json: {
      ok: true,
      user,
      quota: null,
      membership: { membership: { active: null, entitlements: null } },
      checkIn: { ok: true, checkIn: { status: "unavailable" }, records: [] },
    },
  }));
  await page.route("**/api/library", (route) => route.fulfill({ json: { items: [item] } }));
  await page.route("**/api/providers/enabled", (route) => route.fulfill({
    json: { providers: { image: [], video: [] } },
  }));
});

test("library detail actions and modal layering remain usable", async ({ page }) => {
  await page.goto("/?tool=library", { waitUntil: "domcontentloaded" });
  const preview = page.getByRole("button", { name: `预览作品 ${item.title}` });
  await expect(preview).toBeVisible({ timeout: 30_000 });
  await expect(preview.getByText("fixture-model", { exact: true })).toBeVisible();
  await preview.click();

  const modal = page.locator(".studio-library-modal");
  await expect(modal).toBeVisible();
  await expect(modal.getByText("fixture-model", { exact: true })).toBeVisible();
  const metrics = await modal.evaluate((element) => {
    const rect = element.querySelector(".studio-library-detail")?.getBoundingClientRect();
    return {
      zIndex: Number.parseInt(getComputedStyle(element).zIndex || "0", 10),
      top: rect?.top ?? -1,
      bottom: rect?.bottom ?? -1,
      viewportHeight: window.innerHeight,
    };
  });
  expect(metrics.zIndex).toBeGreaterThanOrEqual(40);
  expect(metrics.top).toBeGreaterThanOrEqual(0);
  expect(metrics.bottom).toBeLessThanOrEqual(metrics.viewportHeight + 1);

  const actions = modal.getByLabel("作品操作");
  for (const name of ["重新生成", "放大", "生成视频", "图片编辑", "刷新", "删除"]) {
    await expect(actions.getByRole("button", { name, exact: true })).toBeVisible();
  }
  await expect(actions.getByRole("link", { name: "下载", exact: true })).toBeVisible();

  await actions.getByRole("button", { name: "删除", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: /确认删除这个作品/ });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "取消", exact: true }).click();
  await expect(confirm).toBeHidden();
  await expect(modal).toBeVisible();

  await modal.getByRole("button", { name: "关闭预览", exact: true }).click();
  await expect(modal).toBeHidden();
});
