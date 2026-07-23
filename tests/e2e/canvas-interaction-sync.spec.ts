import { expect, test } from "@playwright/test";

const now = new Date().toISOString();
const baseProject = {
  id: "interaction-sync",
  title: "交互同步验收",
  version: 1,
  createdAt: now,
  updatedAt: now,
  document: {
    viewport: { x: 100, y: 80, zoom: 0.9 },
    nodes: [{
      id: "prompt-node",
      type: "canvas",
      position: { x: 120, y: 120 },
      width: 320,
      height: 230,
      data: { kind: "prompt", title: "正在编辑的提示词", prompt: "初始内容" },
    }],
    edges: [],
  },
};
const remoteProject = {
  ...baseProject,
  version: 2,
  updatedAt: new Date(Date.now() + 1_000).toISOString(),
  document: {
    ...baseProject.document,
    nodes: [...baseProject.document.nodes, {
      id: "remote-node",
      type: "canvas",
      position: { x: 560, y: 120 },
      width: 320,
      height: 230,
      data: { kind: "prompt", title: "团队远端新增", prompt: "远端内容" },
    }],
  },
};

test.describe("canvas transient interactions", () => {
  let releaseRemote: () => void;

  test.beforeEach(async ({ page }) => {
    let resolveRemote = () => {};
    const remoteGate = new Promise<void>((resolve) => { resolveRemote = resolve; });
    releaseRemote = resolveRemote;
    await page.addInitScript(() => window.localStorage.setItem("aohuang-canvas-shortcuts-seen", "1"));
    await page.route("**/api/auth/csrf", (route) => route.fulfill({ json: { token: "preview-csrf" } }));
    await page.route("**/api/library**", (route) => route.fulfill({ json: { items: [], total: 0 } }));
    await page.route("**/api/providers/enabled**", (route) => route.fulfill({ json: { providers: { image: [], video: [] } } }));
    await page.route("**/api/canvas/projects/**/presence**", (route) => route.fulfill({ json: { presences: [] } }));
    await page.route("**/api/canvas/projects**", async (route) => {
      const url = route.request().url();
      if (url.includes("/presence")) return route.fulfill({ json: { presences: [] } });
      if (url.includes("/events")) return route.fulfill({ status: 204 });
      if (route.request().method() === "PATCH") {
        await remoteGate;
        const body = route.request().postDataJSON() as { title?: string; document?: typeof baseProject.document };
        return route.fulfill({ json: { project: { ...remoteProject, title: body.title || remoteProject.title, version: 3 }, merged: true, conflictCount: 0 } });
      }
      return route.fulfill({ json: { projects: [baseProject] } });
    });
    await page.goto("/canvas-preview", { waitUntil: "domcontentloaded" });
    await expect(page.locator('[data-canvas-node-id="prompt-node"]')).toBeVisible();
  });

  test("remote updates wait for an open context menu", async ({ page }) => {
    await page.getByRole("textbox", { name: "画布名称" }).fill("等待合并的画布");
    const node = page.locator('[data-canvas-node-id="prompt-node"]');
    await node.locator(".canvas-node__header").click({ button: "right" });
    await expect(page.locator(".canvas-context-menu")).toBeVisible();
    releaseRemote();
    await expect(page.getByText("同步中", { exact: true })).toBeVisible();
    await expect(page.locator(".canvas-context-menu")).toBeVisible();
    await expect(page.locator('[data-canvas-node-id="remote-node"]')).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-canvas-node-id="remote-node"]')).toBeVisible();
  });

  test("remote updates wait until prompt editing finishes", async ({ page }) => {
    const textarea = page.locator('[data-canvas-node-id="prompt-node"] textarea');
    await textarea.fill("还在输入中的提示词");
    releaseRemote();
    await expect(page.getByText("同步中", { exact: true })).toBeVisible();
    await expect(textarea).toHaveValue("还在输入中的提示词");
    expect(await textarea.evaluate((element) => document.activeElement === element)).toBe(true);
    await expect(page.locator('[data-canvas-node-id="remote-node"]')).toHaveCount(0);
    await page.locator(".react-flow__pane").click({ position: { x: 20, y: 20 } });
    await expect(page.locator('[data-canvas-node-id="remote-node"]')).toBeVisible();
    await expect(page.locator('[data-canvas-node-id="prompt-node"] textarea')).toHaveValue("还在输入中的提示词");
  });
});
