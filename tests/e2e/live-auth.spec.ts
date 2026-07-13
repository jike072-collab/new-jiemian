import { expect, test, type BrowserContext, type Page, type TestInfo } from "@playwright/test";

const enabled = process.env.LIVE_E2E === "true";
const userA = { account: process.env.E2E_USER_A_ACCOUNT, password: process.env.E2E_USER_A_PASSWORD };
const userB = { account: process.env.E2E_USER_B_ACCOUNT, password: process.env.E2E_USER_B_PASSWORD };

test.skip(!enabled, "Set LIVE_E2E=true to allow authenticated checks against the configured target.");

async function login(page: Page, account: string | undefined, password: string | undefined) {
  if (!account || !password) throw new Error("E2E_USER_A_ACCOUNT/E2E_USER_A_PASSWORD and E2E_USER_B_ACCOUNT/E2E_USER_B_PASSWORD are required.");
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  const accountInput = page.getByPlaceholder("请输入邮箱或账号");
  const passwordInput = page.getByPlaceholder("请输入密码");
  const loginButton = page.getByRole("button", { name: "登录", exact: true });
  await expect(loginButton).toBeEnabled();
  await accountInput.fill(account);
  await passwordInput.fill(password);
  await expect(accountInput).toHaveValue(account);
  await expect(passwordInput).toHaveValue(password);
  await loginButton.click();
  await expect(page).not.toHaveURL(/\/login$/);
}

async function libraryItems(context: BrowserContext) {
  const response = await context.request.get("/api/library");
  expect(response.status()).toBe(200);
  return (await response.json()) as { items: Array<{ output?: { storedName?: string } }> };
}

test("dedicated users have independent sessions and cannot fetch each other's media", async ({ browser, baseURL }, testInfo: TestInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Authenticated production checks run once to avoid account rate-limit noise.");
  const contextA = await browser.newContext({ baseURL });
  const contextB = await browser.newContext({ baseURL });
  try {
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    await login(pageA, userA.account, userA.password);
    await login(pageB, userB.account, userB.password);

    const a = await libraryItems(contextA);
    await libraryItems(contextB);
    const storedName = a.items.find((item) => item.output?.storedName)?.output?.storedName;
    test.skip(!storedName, "User A has no existing dedicated test media to verify cross-user isolation.");

    const foreignResponse = await contextB.request.get(`/api/files/${encodeURIComponent(storedName!)}`);
    expect(foreignResponse.status()).toBe(404);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

test("account entitlements and library actions remain visible without mutating production data", async ({ page }, testInfo: TestInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Authenticated production checks run once to avoid account rate-limit noise.");
  await login(page, userA.account, userA.password);

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "提示词优化设置" }).click();
  const promptDialog = page.getByRole("dialog", { name: "提示词优化设置" });
  await expect(promptDialog.getByLabel("快捷方案")).toHaveValue("image-free");
  await promptDialog.getByRole("tab", { name: "图片编辑" }).click();
  await expect(promptDialog.getByLabel("快捷方案")).toHaveValue("edit-precise");
  await expect(promptDialog.getByRole("option", { name: "抠图透明背景" })).toHaveCount(2);
  await expect(promptDialog.getByRole("option", { name: "商品纯白底" })).toHaveCount(2);
  await expect(promptDialog.getByRole("option", { name: "图片文字翻译" })).toHaveCount(2);
  await promptDialog.getByRole("tab", { name: "视频生成" }).click();
  await expect(promptDialog.getByLabel("快捷方案")).toHaveValue("video-free");
  await expect(promptDialog.getByRole("option", { name: "教程步骤" })).toHaveCount(2);
  await promptDialog.getByRole("button", { name: "取消" }).click();

  await page.goto("/?account=usage", { waitUntil: "domcontentloaded" });
  const ledger = page.locator(".account-records");
  await expect(ledger.getByText("剩余权益", { exact: true })).toHaveCount(1);
  await expect(ledger.getByText("后台手动充值积分 +1", { exact: true })).toBeVisible();

  const membershipResponse = await page.request.get("/api/membership/status");
  expect(membershipResponse.status()).toBe(200);
  const membership = await membershipResponse.json() as { membership?: { active?: unknown } };

  if (membership.membership?.active) {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.locator("button.shell-nav-account__main--button").click();
    const entitlements = page.locator(".shell-nav-account__popover").getByLabel("会员剩余额度");
    await expect(entitlements).toBeVisible();
    await expect(entitlements).toContainText("图片放大");
    await expect(entitlements).toContainText("视频放大");
  }

  await page.goto("/?tool=library", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "作品库", exact: true })).toBeVisible();
  const previewButtons = page.getByRole("button", { name: /^预览作品 / });
  const previewCount = await previewButtons.count();
  if (previewCount === 0) {
    testInfo.annotations.push({ type: "library", description: "The dedicated account has no library item to validate detail actions." });
    return;
  }
  await previewButtons.first().click();

  const modal = page.locator(".studio-library-modal");
  await expect(modal).toBeVisible();
  const modalMetrics = await modal.evaluate((element) => {
    const panel = element.querySelector(".studio-library-detail");
    const rect = panel?.getBoundingClientRect();
    return {
      zIndex: Number.parseInt(getComputedStyle(element).zIndex || "0", 10),
      top: rect?.top ?? -1,
      bottom: rect?.bottom ?? -1,
      viewportHeight: window.innerHeight,
    };
  });
  expect(modalMetrics.zIndex).toBeGreaterThanOrEqual(40);
  expect(modalMetrics.top).toBeGreaterThanOrEqual(0);
  expect(modalMetrics.bottom).toBeLessThanOrEqual(modalMetrics.viewportHeight + 1);

  const actions = modal.getByLabel("作品操作");
  await expect(actions.getByRole("button", { name: "重新生成", exact: true })).toBeVisible();
  await expect(actions.getByRole("button", { name: /放大/ })).toBeVisible();
  await expect(actions.getByRole("button", { name: "刷新", exact: true })).toBeVisible();
  await expect(actions.getByRole("button", { name: "删除", exact: true })).toBeVisible();
  await actions.getByRole("button", { name: "删除", exact: true }).click();
  const deleteConfirm = page.getByRole("dialog", { name: /确认删除这个作品/ });
  await expect(deleteConfirm).toBeVisible();
  await deleteConfirm.getByRole("button", { name: "取消", exact: true }).click();
  await expect(deleteConfirm).toBeHidden();

  await modal.getByRole("button", { name: "关闭预览", exact: true }).click();
  await expect(modal).toBeHidden();

});
