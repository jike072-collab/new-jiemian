import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const enabled = process.env.LIVE_E2E === "true";
const userA = { account: process.env.E2E_USER_A_ACCOUNT, password: process.env.E2E_USER_A_PASSWORD };
const userB = { account: process.env.E2E_USER_B_ACCOUNT, password: process.env.E2E_USER_B_PASSWORD };

test.skip(!enabled, "Set LIVE_E2E=true to allow authenticated checks against the configured target.");

async function login(page: Page, account: string | undefined, password: string | undefined) {
  if (!account || !password) throw new Error("E2E_USER_A_ACCOUNT/E2E_USER_A_PASSWORD and E2E_USER_B_ACCOUNT/E2E_USER_B_PASSWORD are required.");
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("请输入邮箱或账号").fill(account);
  await page.getByPlaceholder("请输入密码").fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login$/);
}

async function libraryItems(context: BrowserContext) {
  const response = await context.request.get("/api/library");
  expect(response.status()).toBe(200);
  return (await response.json()) as { items: Array<{ output?: { storedName?: string } }> };
}

test("dedicated users have independent sessions and cannot fetch each other's media", async ({ browser, baseURL }) => {
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
