import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    return [path];
  }));
  return nested.flat();
}

test("client components do not import the New API server integration", async () => {
  const files = await walk(join(process.cwd(), "src"));
  const clientFiles: string[] = [];

  for (const file of files) {
    if (!/\.(ts|tsx)$/.test(file)) continue;
    const content = await readFile(file, "utf8");
    if (content.startsWith("\"use client\"") || content.startsWith("'use client'")) {
      clientFiles.push(file);
      assert.equal(content.includes("integrations/new-api"), false, `${file} imports New API server code`);
      assert.equal(content.includes("@/lib/server/integrations/new-api"), false, `${file} imports New API server code`);
    }
  }

  assert(clientFiles.length > 0);

  const integrationDir = join(process.cwd(), "src", "lib", "server", "integrations", "new-api");
  const info = await stat(integrationDir);
  assert.equal(info.isDirectory(), true);
});
