import assert from "node:assert/strict";
import test from "node:test";

import { volcengineUpscaleInternalsForTests } from "../volcengine-upscale";

test("video output parsing prefers nested output store URI over top-level source vid", () => {
  const result = {
    Status: "Success",
    Vid: "source-vid",
    Output: {
      Data: {
        Task: {
          Enhance: {
            OutputFiles: [
              {
                FileId: "output-file-id",
                StoreUri: "output/path/result.mp4",
                Vid: "output-vid",
                Duration: 15,
                VideoStreamMeta: {
                  Width: 1280,
                  Height: 720,
                },
              },
            ],
          },
        },
      },
    },
  };

  const output = volcengineUpscaleInternalsForTests.findVideoOutputFile(result);
  assert(output);
  assert.equal(output.storeUri, "output/path/result.mp4");
  assert.equal(output.fileId, "output-file-id");
  assert.equal(output.vid, "output-vid");
  assert.equal(output.width, 1280);
  assert.equal(output.height, 720);
});

test("video output parsing prefers direct output URL over source-only metadata", () => {
  const result = {
    Vid: "source-vid",
    Output: {
      Result: {
        File: {
          URL: "http://vod.example.test/final.mp4",
          StoreUri: "ignored/store-uri.mp4",
          Vid: "result-vid",
        },
      },
    },
  };

  const output = volcengineUpscaleInternalsForTests.findVideoOutputFile(result);
  assert(output);
  assert.equal(output.url, "http://vod.example.test/final.mp4");
  assert.equal(output.vid, "result-vid");
});

test("play info lookup falls back to the execution input vid when output vid is absent", () => {
  const result = {
    Input: {
      Vid: "source-vid",
    },
    Output: {
      Template: {
        Enhance: {
          FileId: "output-file-id",
          StoreUri: "output/path/result.mp4",
        },
      },
    },
  };

  const output = volcengineUpscaleInternalsForTests.findVideoOutputFile(result);
  const playInfoVid = volcengineUpscaleInternalsForTests.playInfoLookupVid(result, output?.vid);
  assert.equal(playInfoVid, "source-vid");
});

test("transient provider calls retry network failures and then succeed", async () => {
  const attempts: number[] = [];
  const delays: number[] = [];
  const result = await volcengineUpscaleInternalsForTests.retryTransientProviderCall(
    async (attempt) => {
      attempts.push(attempt);
      if (attempt < 3) throw new TypeError("fetch failed");
      return "done";
    },
    [10, 20],
    async (delayMs) => {
      delays.push(delayMs);
    },
  );

  assert.equal(result, "done");
  assert.deepEqual(attempts, [1, 2, 3]);
  assert.deepEqual(delays, [10, 20]);
});

test("non-transient provider failures are not retried", async () => {
  let attempts = 0;
  await assert.rejects(
    volcengineUpscaleInternalsForTests.retryTransientProviderCall(
      async () => {
        attempts += 1;
        throw new Error("invalid provider response");
      },
      [0, 0],
    ),
    /invalid provider response/,
  );
  assert.equal(attempts, 1);
});

test("image process dispatches are serialized", async () => {
  const events: string[] = [];
  let releaseFirst: () => void;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const first = volcengineUpscaleInternalsForTests.serializeImageProcess(async () => {
    events.push("first:start");
    await firstGate;
    events.push("first:end");
  });
  const second = volcengineUpscaleInternalsForTests.serializeImageProcess(async () => {
    events.push("second:start");
    events.push("second:end");
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["first:start"]);
  releaseFirst!();
  await Promise.all([first, second]);
  assert.deepEqual(events, ["first:start", "first:end", "second:start", "second:end"]);
});
