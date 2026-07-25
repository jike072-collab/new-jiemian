import { spawn } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";

export const MAX_VIDEO_TRIM_SECONDS = 14.9;
export const MIN_VIDEO_TRIM_SECONDS = 0.1;

const PROCESS_TIMEOUT_MS = 3 * 60_000;
const MAX_STDERR_LENGTH = 64 * 1024;

export class VideoTrimError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "VideoTrimError";
    this.status = status;
  }
}

export type VideoTrimRange = {
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
};

export function validateVideoTrimRange(startValue: unknown, endValue: unknown): VideoTrimRange {
  const startSeconds = Number(startValue);
  const endSeconds = Number(endValue);
  if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds)) {
    throw new VideoTrimError("裁剪起止时间无效。");
  }
  if (startSeconds < 0 || endSeconds <= startSeconds) {
    throw new VideoTrimError("结束时间必须晚于开始时间。");
  }
  const durationSeconds = endSeconds - startSeconds;
  if (durationSeconds < MIN_VIDEO_TRIM_SECONDS) {
    throw new VideoTrimError("裁剪片段不能短于 0.1 秒。");
  }
  if (durationSeconds > MAX_VIDEO_TRIM_SECONDS + 0.001) {
    throw new VideoTrimError("单个裁剪片段最长 14.9 秒。");
  }
  return { startSeconds, endSeconds, durationSeconds };
}

async function runFfmpeg(args: string[]) {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn("ffmpeg", args, { shell: false, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      action();
    };
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      finish(() => reject(new VideoTrimError("视频裁剪超时，请稍后重试。", 504)));
    }, PROCESS_TIMEOUT_MS);
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      if (stderr.length < MAX_STDERR_LENGTH) stderr += chunk.slice(0, MAX_STDERR_LENGTH - stderr.length);
    });
    child.once("error", (error: NodeJS.ErrnoException) => {
      finish(() => reject(new VideoTrimError(
        error.code === "ENOENT" ? "服务器尚未安装视频裁剪组件。" : "无法启动视频裁剪组件。",
        503,
      )));
    });
    child.once("close", (code) => {
      finish(() => {
        if (code === 0) resolve(stderr);
        else reject(new VideoTrimError("视频文件无法裁剪，请确认素材仍可播放。", 422));
      });
    });
  });
}

export async function probeVideoDuration(inputPath: string) {
  const chunks: Buffer[] = [];
  const args = ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", inputPath];
  const duration = await new Promise<number>((resolve, reject) => {
    const child = spawn("ffprobe", args, { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      action();
    };
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      finish(() => reject(new VideoTrimError("读取视频时长超时。", 504)));
    }, PROCESS_TIMEOUT_MS);
    child.stdout?.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      if (stderr.length < MAX_STDERR_LENGTH) stderr += chunk.slice(0, MAX_STDERR_LENGTH - stderr.length);
    });
    child.once("error", (error: NodeJS.ErrnoException) => {
      finish(() => reject(new VideoTrimError(
        error.code === "ENOENT" ? "服务器尚未安装视频裁剪组件。" : "无法读取视频信息。",
        503,
      )));
    });
    child.once("close", (code) => {
      finish(() => {
        const value = Number(Buffer.concat(chunks).toString("utf8").trim());
        if (code === 0 && Number.isFinite(value) && value > 0) resolve(value);
        else reject(new VideoTrimError("无法读取该视频的时长。", 422));
      });
    });
  });
  return duration;
}

export async function trimVideoToMp4(inputPath: string, outputPath: string, startValue: unknown, endValue: unknown) {
  const range = validateVideoTrimRange(startValue, endValue);
  const sourceDurationSeconds = await probeVideoDuration(inputPath);
  if (range.startSeconds >= sourceDurationSeconds || range.endSeconds > sourceDurationSeconds + 0.05) {
    throw new VideoTrimError("裁剪范围超出了视频时长。");
  }

  const endSeconds = Math.min(range.endSeconds, sourceDurationSeconds);
  const durationSeconds = endSeconds - range.startSeconds;
  try {
    await runFfmpeg([
      "-nostdin",
      "-hide_banner",
      "-loglevel", "error",
      "-y",
      "-ss", range.startSeconds.toFixed(3),
      "-i", inputPath,
      "-t", durationSeconds.toFixed(3),
      "-map", "0:v:0",
      "-map", "0:a?",
      "-sn",
      "-dn",
      "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "20",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", "192k",
      "-movflags", "+faststart",
      outputPath,
    ]);
    return {
      bytes: await readFile(outputPath),
      startSeconds: range.startSeconds,
      endSeconds,
      durationSeconds,
      sourceDurationSeconds,
    };
  } finally {
    await unlink(outputPath).catch(() => undefined);
  }
}
