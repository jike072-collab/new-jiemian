#!/usr/bin/env node
import assert from "node:assert/strict";

import {
  canvasDropMediaType,
  collectCanvasFolderDropFiles,
  isSupportedCanvasDropFile,
  MAX_CANVAS_FOLDER_FILES,
} from "../src/lib/canvas/folder-drop.ts";

const file = (name, type = "") => ({ name, type });
const fileEntry = (name, type = "") => ({
  name,
  isFile: true,
  isDirectory: false,
  file: (resolve) => resolve(file(name, type)),
});
const directoryEntry = (name, batches) => ({
  name,
  isFile: false,
  isDirectory: true,
  createReader: () => {
    let index = 0;
    return { readEntries: (resolve) => resolve(batches[index++] || []) };
  },
});
const item = (entry) => ({ kind: "file", webkitGetAsEntry: () => entry });

assert.equal(isSupportedCanvasDropFile(file("shoe.PNG")), true);
assert.equal(isSupportedCanvasDropFile(file("clip", "video/mp4")), true);
assert.equal(canvasDropMediaType(file("sound.mp3")), "audio");
assert.equal(canvasDropMediaType(file("sound", "audio/wav")), "audio");
assert.equal(canvasDropMediaType(file("sound.m4a", "audio/x-m4a")), "audio");
assert.equal(isSupportedCanvasDropFile(file("vector.svg", "image/svg+xml")), false);

const nested = directoryEntry("campaign", [[
  fileEntry("cover.jpg", "image/jpeg"),
  directoryEntry("videos", [[fileEntry("launch.mp4", "video/mp4")], []]),
  directoryEntry("audio", [[fileEntry("voice.wav", "audio/wav")], []]),
  fileEntry("notes.txt", "text/plain"),
  directoryEntry(".cache", [[fileEntry("hidden.webp", "image/webp")], []]),
], []]);
const collected = await collectCanvasFolderDropFiles([item(nested)], []);
assert.deepEqual(collected.files.map((entry) => entry.name), ["voice.wav", "cover.jpg", "launch.mp4"]);
assert.equal(collected.directoryCount, 3);
assert.equal(collected.skippedCount, 2);
assert.equal(collected.truncated, false);

const many = directoryEntry("many", [
  Array.from({ length: MAX_CANVAS_FOLDER_FILES }, (_, index) => fileEntry(`${String(index).padStart(3, "0")}.webp`, "image/webp")),
  [fileEntry("overflow.webp", "image/webp")],
  [],
]);
const limited = await collectCanvasFolderDropFiles([item(many)], []);
assert.equal(limited.files.length, MAX_CANVAS_FOLDER_FILES);
assert.equal(limited.truncated, true);

const fallback = await collectCanvasFolderDropFiles([], [file("a.mov", "video/quicktime"), file("voice.mp3", "audio/mpeg"), file("b.pdf", "application/pdf")]);
assert.deepEqual(fallback.files.map((entry) => entry.name), ["a.mov", "voice.mp3"]);
assert.equal(fallback.skippedCount, 1);

console.log(JSON.stringify({ ok: true, recursive: true, multiBatch: true, maxFiles: MAX_CANVAS_FOLDER_FILES }));
