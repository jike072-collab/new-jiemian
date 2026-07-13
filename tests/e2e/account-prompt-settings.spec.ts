import { expect, test } from "@playwright/test";

const user = {
  local_user_id: "e2e-account-user",
  email: "account-e2e@example.invalid",
  username: "account-e2e",
  display_name: "Account E2E",
  status: "active",
  role: "user",
};

const entitlements = {
  prompt_optimize: { remaining: 9, granted: 10, used: 1 },
  image_generation: { remaining: 147, granted: 150, used: 3 },
  video_generation: { remaining: 8, granted: 8, used: 0 },
  image_edit: { remaining: 0, granted: 0, used: 0 },
  image_upscale: { remaining: 150, granted: 150, used: 0 },
  video_upscale: { remaining: 8, granted: 8, used: 0 },
};

function accountSummary() {
  return {
    ok: true,
    user,
    quota: {
      local_user_id: user.local_user_id,
      new_api_user_id: "e2e-new-api-user",
      quota_units: 1000,
      used_quota_units: 0,
      available_quota_units: 1000,
      display_unit: "credits",
      source: "new_api",
      fetched_at: "2026-07-14T01:00:00.000Z",
      cached: false,
      cache_expires_at: "2026-07-14T01:01:00.000Z",
    },
    membership: {
      ok: true,
      plans: [],
      membership: { active: null, queued: null, recharge_bonus_basis_points: 0, entitlements },
    },
    checkIn: { ok: true, checkIn: { status: "unavailable" }, records: [] },
  };
}

test.beforeEach(async ({ page }) => {
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { ok: true, user } }));
  await page.route("**/api/account/summary", (route) => route.fulfill({ json: accountSummary() }));
  await page.route("**/api/auth/csrf", (route) => route.fulfill({ json: { ok: true, csrfToken: "e2e-csrf" } }));
  await page.route("**/api/providers/enabled", (route) => route.fulfill({
    json: { providers: { image: [], video: [] } },
  }));
  await page.route("**/api/library", (route) => route.fulfill({ json: { items: [] } }));
});

test("account ledger includes admin grants and separates entitlement balance", async ({ page }) => {
  await page.route("**/api/usage?**", async (route) => {
    expect(new URL(route.request().url()).searchParams.get("pageSize")).toBe("100");
    await route.fulfill({
      json: {
        ok: true,
        usage: {
          page: 1,
          pageSize: 100,
          total: 1,
          entries: [{
            id: "usage-entitlement",
            local_user_id: user.local_user_id,
            new_api_user_id: "e2e-new-api-user",
            task_id: "task-entitlement",
            operation: "cloud_image_generation",
            status: "succeeded",
            estimated_quota_units: 0,
            actual_quota_units: 0,
            membership_entitlement_units: 3,
            upstream_log_id: null,
            upstream_request_id: null,
            upstream_model: null,
            upstream_created_at: null,
            balance_after_quota_units: 1000,
            created_at: "2026-07-14T01:02:00.000Z",
            updated_at: "2026-07-14T01:02:00.000Z",
            idempotency_key: "usage-entitlement",
            error_code: null,
            error_message: null,
          }],
        },
      },
    });
  });
  await page.route("**/api/billing/orders?**", async (route) => {
    expect(new URL(route.request().url()).searchParams.get("pageSize")).toBe("100");
    await route.fulfill({
      json: {
        ok: true,
        page: 1,
        page_size: 100,
        total: 1,
        has_more: false,
        orders: [{
          order_id: "admin-grant-order",
          local_user_id: user.local_user_id,
          new_api_user_id: "e2e-new-api-user",
          channel: "admin_grant",
          currency: "CNY",
          requested_amount: 0,
          paid_amount: 0,
          credited_quota: 10,
          product_type: "credits",
          product_plan_id: null,
          product_cycle: null,
          status: "paid",
          idempotency_key: "admin-grant-e2e",
          provider_order_id: "admin-grant:e2e",
          created_at: "2026-07-14T01:01:00.000Z",
          updated_at: "2026-07-14T01:01:00.000Z",
          paid_at: "2026-07-14T01:01:00.000Z",
          last_error: null,
          version: 1,
          quota_credit_applied_at: "2026-07-14T01:01:00.000Z",
          refunded_at: null,
          webhook_event_ids: [],
        }],
      },
    });
  });

  await page.goto("/?account=usage", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "积分明细", exact: true })).toBeVisible();
  const ledger = page.locator(".account-records");
  await expect(ledger.getByText("剩余权益", { exact: true })).toHaveCount(1);
  await expect(ledger.getByText("手动充值", { exact: true })).toBeVisible();
  await expect(ledger.getByText("+10 分", { exact: true })).toBeVisible();
  await expect(ledger.getByText("剩 147 张 · 抵扣 3 张", { exact: true })).toBeVisible();
  await expect(ledger.getByText("0 分", { exact: true })).toBeVisible();
});

test("prompt gear stores per-tool presets and sends selected preferences", async ({ page }) => {
  let optimizePayload: Record<string, unknown> | null = null;
  await page.route("**/api/prompts/optimize", async (route) => {
    optimizePayload = JSON.parse(route.request().postData() || "{}");
    await route.fulfill({ json: { ok: true, optimizedPrompt: "一只小猫在雨后窗边观察水滴，写实摄影，柔和自然光。" } });
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "提示词优化设置" }).click();
  const dialog = page.getByRole("dialog", { name: "提示词优化设置" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("图片生成", { exact: true })).toBeVisible();
  await expect(dialog.getByText("图片编辑", { exact: true })).toBeVisible();
  await expect(dialog.getByText("视频生成", { exact: true })).toBeVisible();

  const presetSelect = dialog.getByLabel("快捷方案");
  await expect(presetSelect).toHaveValue("image-free");
  await expect(dialog.getByRole("option", { name: "电商商品主图" })).toHaveCount(2);
  await dialog.getByRole("tab", { name: "图片编辑" }).click();
  await expect(presetSelect).toHaveValue("edit-precise");
  await expect(dialog.getByRole("option", { name: "抠图透明背景" })).toHaveCount(2);
  await expect(dialog.getByRole("option", { name: "商品纯白底" })).toHaveCount(2);
  await expect(dialog.getByRole("option", { name: "图片文字翻译" })).toHaveCount(2);
  await dialog.getByRole("tab", { name: "视频生成" }).click();
  await expect(presetSelect).toHaveValue("video-free");
  await expect(dialog.getByRole("option", { name: "教程步骤" })).toHaveCount(2);
  await expect(dialog.getByRole("option", { name: "前后对比" })).toHaveCount(2);
  await dialog.getByRole("tab", { name: "图片生成" }).click();

  await presetSelect.selectOption({ label: "写实摄影" });
  await dialog.getByLabel("方案名称").fill("我的写实方案");
  await dialog.getByRole("button", { name: "保存方案" }).click();
  await expect(dialog.getByLabel("快捷方案")).toHaveValue(/custom-/);

  await dialog.getByRole("tab", { name: "视频生成" }).click();
  await expect(dialog.getByLabel("视频类型")).toBeVisible();
  await expect(dialog.getByLabel("镜头运动")).toBeVisible();
  await expect(dialog.getByLabel("编辑任务")).toHaveCount(0);
  await dialog.getByRole("tab", { name: "图片生成" }).click();
  await dialog.getByRole("button", { name: "应用设置" }).click();
  await expect(dialog).toBeHidden();

  await page.getByTestId("prompt-input").fill("一只小猫看窗外的雨");
  await page.getByRole("button", { name: /优化提示词/ }).click();
  await expect(page.getByTestId("prompt-input")).toHaveValue(/雨后窗边/);
  const payload = optimizePayload as Record<string, unknown> | null;
  expect(payload).not.toBeNull();
  expect(payload).not.toHaveProperty("targetPlatform");
  expect((payload as Record<string, unknown>).preferences).toMatchObject({
    purpose: "free-create",
    style: "photoreal",
    lighting: "natural",
    palette: "natural",
    platform: "none",
  });

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "提示词优化设置" }).click();
  const persistedDialog = page.getByRole("dialog", { name: "提示词优化设置" });
  await expect(persistedDialog.getByRole("option", { name: "我的写实方案" })).toHaveCount(1);
});
