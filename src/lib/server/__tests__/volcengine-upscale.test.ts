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
