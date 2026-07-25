#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { test } from "node:test";

import {
  MAX_VIDEO_TRIM_SECONDS,
  probeVideoDuration,
  trimAudioToM4a,
  trimVideoToMp4,
  validateVideoTrimRange,
  VideoTrimError,
} from "../src/lib/server/video-trim.ts";

const argumentsByName = new Map(process.argv.slice(2).flatMap((argument) => {
  const match = /^--(ffmpeg|ffprobe)=(.+)$/.exec(argument);
  return match ? [[match[1], match[2]]] : [];
}));
const ffmpeg = argumentsByName.get("ffmpeg") || process.env.FFMPEG_PATH?.trim() || "ffmpeg";
const ffprobe = argumentsByName.get("ffprobe") || process.env.FFPROBE_PATH?.trim() || "ffprobe";
if (argumentsByName.has("ffmpeg")) {
  process.env.PATH = `${dirname(ffmpeg)}${delimiter}${process.env.PATH || ""}`;
}
const toolsAvailable = spawnSync(ffmpeg, ["-version"], { stdio: "ignore", windowsHide: true }).status === 0
  && spawnSync(ffprobe, ["-version"], { stdio: "ignore", windowsHide: true }).status === 0;

test("video trim range accepts valid clips and rejects invalid or oversized clips", () => {
  assert.deepEqual(validateVideoTrimRange(2.5, 10), {
    startSeconds: 2.5,
    endSeconds: 10,
    durationSeconds: 7.5,
  });
  assert.equal(validateVideoTrimRange(0, MAX_VIDEO_TRIM_SECONDS).durationSeconds, MAX_VIDEO_TRIM_SECONDS);
  assert.throws(() => validateVideoTrimRange(-1, 2), VideoTrimError);
  assert.throws(() => validateVideoTrimRange(2, 2), VideoTrimError);
  assert.throws(() => validateVideoTrimRange(0, 14.91), /最长 14.9 秒/);
  assert.throws(() => validateVideoTrimRange("bad", 3), VideoTrimError);
});

test("ffmpeg creates a real playable clip with the requested duration", { skip: !toolsAvailable }, async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "aohuang-video-trim-test-"));
  const inputPath = join(fixtureRoot, "source.mp4");
  const temporaryOutputPath = join(fixtureRoot, "temporary-output.mp4");
  const outputPath = join(fixtureRoot, "trimmed.mp4");
  try {
    const generated = spawnSync(ffmpeg, [
      "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=12:duration=16",
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
      inputPath,
    ], { stdio: "inherit", windowsHide: true });
    assert.equal(generated.status, 0, "synthetic video fixture should be created");

    const result = await trimVideoToMp4(inputPath, temporaryOutputPath, 4.5, 9.5);
    assert(result.bytes.length > 1_000);
    assert.equal(result.durationSeconds, 5);
    await writeFile(outputPath, result.bytes);
    const outputDuration = await probeVideoDuration(outputPath);
    assert(Math.abs(outputDuration - 5) < 0.2, `expected about 5 seconds, received ${outputDuration}`);
  } finally {
    await unlink(outputPath).catch(() => undefined);
    await unlink(temporaryOutputPath).catch(() => undefined);
    await unlink(inputPath).catch(() => undefined);
    await rmdir(fixtureRoot).catch(() => undefined);
  }
});

test("ffmpeg trims audio to a playable M4A clip", { skip: !toolsAvailable }, async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "aohuang-audio-trim-test-"));
  const inputPath = join(fixtureRoot, "source.wav");
  const temporaryOutputPath = join(fixtureRoot, "temporary-output.m4a");
  const outputPath = join(fixtureRoot, "trimmed.m4a");
  try {
    const generated = spawnSync(ffmpeg, [
      "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=16",
      "-c:a", "pcm_s16le",
      inputPath,
    ], { stdio: "inherit", windowsHide: true });
    assert.equal(generated.status, 0, "synthetic audio fixture should be created");

    const result = await trimAudioToM4a(inputPath, temporaryOutputPath, 0, MAX_VIDEO_TRIM_SECONDS);
    assert(result.bytes.length > 1_000);
    assert.equal(result.durationSeconds, MAX_VIDEO_TRIM_SECONDS);
    await writeFile(outputPath, result.bytes);
    const outputDuration = await probeVideoDuration(outputPath);
    assert(Math.abs(outputDuration - MAX_VIDEO_TRIM_SECONDS) < 0.2, `expected about ${MAX_VIDEO_TRIM_SECONDS} seconds, received ${outputDuration}`);
  } finally {
    await unlink(outputPath).catch(() => undefined);
    await unlink(temporaryOutputPath).catch(() => undefined);
    await unlink(inputPath).catch(() => undefined);
    await rmdir(fixtureRoot).catch(() => undefined);
  }
});

test.after(() => {
  console.log(toolsAvailable
    ? "video trim tests passed with real ffmpeg output"
    : "video trim validation passed; real ffmpeg test skipped because binaries are unavailable");
});
