import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const publicRoutes = ["/", "/login", "/register", "/templates"];
const navigationTimeout = process.env.E2E_BASE_URL ? 60_000 : 30_000;

test.setTimeout(process.env.E2E_BASE_URL ? 75_000 : 30_000);

for (const path of publicRoutes) {
  test(`public route ${path} renders without a server error`, async ({ page }) => {
    const response = await page.goto(path, { waitUntil: "domcontentloaded", timeout: navigationTimeout });
    expect(response?.status()).toBeLessThan(500);
    await expect(page.locator("body")).toBeVisible();
  });
}

test("login page has no automatically detectable serious accessibility violations", async ({ page }) => {
  test.slow();
  await page.goto("/login", { waitUntil: "networkidle" });
  const results = await new AxeBuilder({ page })
    .disableRules(["color-contrast"])
    .analyze();
  const serious = results.violations.filter((violation) => ["serious", "critical"].includes(violation.impact || ""));
  expect(serious).toEqual([]);
});

test("login form becomes interactive only after client hydration", async ({ page }) => {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "登录", exact: true })).toBeEnabled({ timeout: navigationTimeout });
  await expect(page.getByPlaceholder("请输入邮箱或账号")).toBeEnabled({ timeout: navigationTimeout });
  await expect(page.getByPlaceholder("请输入密码")).toBeEnabled({ timeout: navigationTimeout });
});
