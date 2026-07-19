#!/usr/bin/env node
import assert from "node:assert/strict";

const { mergeCanvasWorkspace } = await import(new URL("../src/lib/canvas/merge.ts", import.meta.url));

const node = (id, title, x = 0, y = 0) => ({
  id,
  type: "canvas",
  position: { x, y },
  data: { kind: "prompt", title, prompt: title },
});
const state = (title, nodes, edges = []) => ({
  title,
  document: { nodes, edges, viewport: { x: 0, y: 0, zoom: 1 } },
});

const base = state("共享画布", [node("node-a", "A"), node("node-b", "B")]);
const nonOverlapping = mergeCanvasWorkspace(
  base,
  state("共享画布", [node("node-a", "A-local", 20), node("node-b", "B")]),
  state("共享画布", [node("node-a", "A"), node("node-b", "B-remote", 0, 30)]),
);
assert.equal(nonOverlapping.document.nodes.find((item) => item.id === "node-a").data.title, "A-local");
assert.equal(nonOverlapping.document.nodes.find((item) => item.id === "node-b").data.title, "B-remote");
assert.equal(nonOverlapping.conflictCount, 0);

const fieldLevel = mergeCanvasWorkspace(
  state("共享画布", [node("node-a", "A", 0, 0)]),
  state("共享画布", [node("node-a", "A", 40, 0)]),
  state("共享画布", [node("node-a", "A", 0, 60)]),
);
assert.deepEqual(fieldLevel.document.nodes[0].position, { x: 40, y: 60 });
assert.equal(fieldLevel.conflictCount, 0);

const sameField = mergeCanvasWorkspace(
  base,
  state("本地后保存", [node("node-a", "A-local"), node("node-b", "B")]),
  state("远端先保存", [node("node-a", "A-remote"), node("node-b", "B")]),
);
assert.equal(sameField.title, "本地后保存");
assert.equal(sameField.document.nodes[0].data.title, "A-local");
assert.ok(sameField.conflictCount >= 2);

const deletion = mergeCanvasWorkspace(
  state("共享画布", [node("node-a", "A"), node("node-b", "B")], [{ id: "edge-a-b", source: "node-a", target: "node-b" }]),
  state("共享画布", [node("node-a", "A")]),
  state("共享画布", [node("node-a", "A"), node("node-b", "B-remote")], [{ id: "edge-a-b", source: "node-a", target: "node-b" }]),
);
assert.deepEqual(deletion.document.nodes.map((item) => item.id), ["node-a"]);
assert.deepEqual(deletion.document.edges, []);

const remoteTitle = mergeCanvasWorkspace(base, base, state("远端标题", base.document.nodes));
assert.equal(remoteTitle.title, "远端标题");

console.log(JSON.stringify({
  ok: true,
  checks: 11,
  generationSubmitted: false,
  databaseWritten: false,
}));
