#!/usr/bin/env node
import assert from "node:assert/strict";

const {
  CANVAS_IMAGE_REQUEST_MAX_COUNT,
  INTERNAL_CANVAS_IMAGE_MAX_COUNT,
  INTERNAL_CANVAS_IMAGE_REQUEST_CONCURRENCY,
  INTERNAL_CANVAS_IMAGE_REQUEST_MAX_COUNT,
  canvasImageResultGrid,
  planCanvasImageRequests,
} = await import(new URL("../src/lib/canvas/image-batch.ts", import.meta.url));

assert.equal(CANVAS_IMAGE_REQUEST_MAX_COUNT, 4);
assert.equal(INTERNAL_CANVAS_IMAGE_MAX_COUNT, 15);
assert.equal(INTERNAL_CANVAS_IMAGE_REQUEST_MAX_COUNT, 1);
assert.equal(INTERNAL_CANVAS_IMAGE_REQUEST_CONCURRENCY, 15);
assert.deepEqual(planCanvasImageRequests(1, true), [1]);
assert.deepEqual(planCanvasImageRequests(4, true), [1, 1, 1, 1]);
assert.deepEqual(planCanvasImageRequests(5, true), [1, 1, 1, 1, 1]);
assert.equal(planCanvasImageRequests(15, true).length, 15);
assert.ok(planCanvasImageRequests(15, true).every((count) => count === 1));
assert.equal(planCanvasImageRequests(99, true).length, 15);
assert.deepEqual(planCanvasImageRequests(15, false), [4]);
assert.deepEqual(planCanvasImageRequests(Number.NaN, true), [1]);
assert.deepEqual(canvasImageResultGrid(0, 1), { column: 0, row: 0, rowCount: 1 });
assert.deepEqual(canvasImageResultGrid(4, 5), { column: 1, row: 1, rowCount: 2 });
assert.deepEqual(canvasImageResultGrid(14, 15), { column: 2, row: 3, rowCount: 4 });

console.log("canvas image batching contracts passed without generation");
