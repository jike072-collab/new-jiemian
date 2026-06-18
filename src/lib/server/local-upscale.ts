import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { promisify } from "node:util";

import {
  addJob,
  addLibraryItem,
  readLibrary,
  updateJob,
  updateLibraryItem,
} from "./library";
import {
  dataRoot,
  ensureRuntimeDirs,
  runtimeFileUrl,
  safeStoredName,
  uploadsRoot,
} from "./paths";
import { providerById } from "./providers";

type LocalToolStatus = {
  ready: boolean;
  detail: string;
  executable?: string;
  ffprobeExecutable?: string;
};

type UploadedFile = {
  bytes: Buffer;
  mimeType: string;
  fileName: string;
};

type ImageDimensions = {
  width: number;
  height: number;
};

type VideoDimensions = {
  width: number;
  height: number;
};

const workRoot = join(dataRoot, "work");
const execFileAsync = promisify(execFile);

function executableCandidates(kind: "image" | "video", configuredPath: string) {
  const localAppData = process.env.LOCALAPPDATA || "";
  const programFiles = process.env.ProgramFiles || "C:\\Program Files";
  const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  if (kind === "image") {
    return [
      configuredPath,
      process.env.UPSCAYL_BIN || "",
      join(localAppData, "Programs", "Upscayl", "resources", "bin", "upscayl-bin.exe"),
      join(localAppData, "Programs", "upscayl", "resources", "bin", "upscayl-bin.exe"),
      join(programFiles, "Upscayl", "resources", "bin", "upscayl-bin.exe"),
      join(programFilesX86, "Upscayl", "resources", "bin", "upscayl-bin.exe"),
    ].filter(Boolean);
  }
  return [
    configuredPath,
    process.env.VIDEO2X_BIN || "",
    join(localAppData, "Programs", "video2x", "video2x.exe"),
    join(programFiles, "Video2X", "video2x.exe"),
    join(programFilesX86, "Video2X", "video2x.exe"),
  ].filter(Boolean);
}

async function firstExisting(paths: string[]) {
  for (const path of paths) {
    try {
      await access(path);
      return path;
    } catch {
      // Keep checking known installation paths.
    }
  }
  return "";
}

async function upscaylModelReady(modelsPath: string, model: string) {
  const names = model === "realesr-animevideov3"
    ? ["realesr-animevideov3-x2", "realesr-animevideov3-x3", "realesr-animevideov3-x4"]
    : [model];
  for (const name of names) {
    const pair = await Promise.all([
      firstExisting([join(modelsPath, `${name}.param`)]),
      firstExisting([join(modelsPath, `${name}.bin`)]),
    ]);
    if (pair.every(Boolean)) return true;
  }
  return false;
}

async function findOnPath(commands: string[]) {
  const locator = process.platform === "win32" ? "where.exe" : "which";
  for (const command of commands) {
    try {
      const { stdout } = await execFileAsync(locator, [command], {
        windowsHide: true,
        timeout: 5000,
      });
      const match = stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
      if (match) return match;
    } catch {
      // The command is not available on PATH.
    }
  }
  return "";
}

async function executableReady(executable: string, args: string[]) {
  try {
    await execFileAsync(executable, args, {
      cwd: dirname(executable),
      windowsHide: true,
      timeout: 10000,
    });
    return true;
  } catch {
    return false;
  }
}

async function video2xFfmpegRuntimeReady(executable: string) {
  const directory = dirname(executable);
  const requiredDlls = [
    "avcodec-61.dll",
    "avformat-61.dll",
    "avfilter-10.dll",
    "avutil-59.dll",
    "swscale-8.dll",
    "swresample-5.dll",
  ];
  const bundledRuntime = await Promise.all(requiredDlls.map((name) => firstExisting([join(directory, name)])));
  if (bundledRuntime.every(Boolean)) return true;
  return Boolean(await findOnPath(["ffmpeg.exe", "ffmpeg"]));
}

async function ffprobeExecutable(video2xExecutable: string) {
  return await firstExisting([
    process.env.FFPROBE_BIN || "",
    join(dirname(video2xExecutable), "ffprobe.exe"),
  ].filter(Boolean)) || await findOnPath(["ffprobe.exe", "ffprobe"]);
}

function sanitizeProcessDetail(value: string) {
  return value
    .replace(/[A-Z]:[\\/][^\r\n"'`]+/gi, "[local path]")
    .replace(/(?:\/[^\s"'`]+){2,}/g, "[local path]")
    .slice(0, 1200);
}

async function upscaylModelsPath(executable: string) {
  const candidates = [
    process.env.UPSCAYL_MODELS_DIR || "",
    join(dirname(executable), "models"),
    join(dirname(executable), "..", "models"),
  ].filter(Boolean);
  return await firstExisting(candidates) || candidates[0] || join(dirname(executable), "models");
}

function upscaylNativeScale(model: string) {
  const match = model.match(/(?:^|[-_])x([234])(?:$|[-_])/i)
    || model.match(/(?:^|[-_])([234])x(?:$|[-_])/i);
  return Number(match?.[1] || 4);
}

export async function readUpscaleStatus() {
  const [imageProvider, videoProvider] = await Promise.all([
    providerById("image-upscale"),
    providerById("video-upscale"),
  ]);
  const [imageExecutable, videoExecutable] = await Promise.all([
    firstExisting(executableCandidates("image", imageProvider?.apiUrl || ""))
      .then((path) => path || findOnPath(["upscayl-bin.exe", "upscayl-bin"])),
    firstExisting(executableCandidates("video", videoProvider?.apiUrl || ""))
      .then((path) => path || findOnPath(["video2x.exe", "video2x"])),
  ]);

  let image: LocalToolStatus;
  if (!imageProvider?.enabled) {
    image = { ready: false, detail: "图片高清已在供应商后台停用。" };
  } else if (!imageExecutable) {
    image = {
      ready: false,
      detail: "未检测到 Upscayl。安装后可在供应商后台填写 upscayl-bin.exe 路径。",
    };
  } else {
    const modelsPath = await upscaylModelsPath(imageExecutable);
    const model = imageProvider?.model || "upscayl-standard-4x";
    const modelsReady = await upscaylModelReady(modelsPath, model);
    image = modelsReady
      ? { ready: true, detail: "已检测到 Upscayl，本机图片高清工具可用。", executable: imageExecutable }
      : { ready: false, detail: `已找到 Upscayl，但模型 ${model} 不完整。` };
  }

  let video: LocalToolStatus;
  if (!videoProvider?.enabled) {
    video = { ready: false, detail: "视频高清已在供应商后台停用。" };
  } else if (!videoExecutable) {
    video = {
      ready: false,
      detail: "未检测到 Video2X。安装 CLI 发行版后可在供应商后台填写 video2x.exe 路径。",
    };
  } else if (!await executableReady(videoExecutable, ["--version"])) {
    video = {
      ready: false,
      detail: "已找到 Video2X，但命令行程序无法启动。请确认安装完整后重新检测。",
    };
  } else if (!await video2xFfmpegRuntimeReady(videoExecutable)) {
    video = {
      ready: false,
      detail: "已找到 Video2X，但未检测到 FFmpeg 运行库。请使用完整的 Video2X Windows 发行包或配置 FFmpeg。",
    };
  } else {
    const probe = await ffprobeExecutable(videoExecutable);
    video = {
      ready: true,
      detail: probe
        ? "已检测到 Video2X、FFmpeg 运行库和 FFprobe，视频高清工具可用。"
        : "已检测到 Video2X 和 FFmpeg 运行库，视频高清工具可用。未单独检测到 FFprobe，分辨率会使用本地文件头读取。",
      executable: videoExecutable,
      ffprobeExecutable: probe || undefined,
    };
  }
  return { image, video };
}

function runProcess(executable: string, args: string[], timeoutMs: number) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(executable, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const append = (chunk: Buffer) => {
      output = `${output}${chunk.toString("utf8")}`.slice(-16000);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("本机高清任务运行超时。"));
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve(output);
      else reject(new Error(output.trim() || `本机高清工具退出，代码 ${code ?? "unknown"}。`));
    });
  });
}

async function writeInput(file: UploadedFile, prefix: string) {
  await Promise.all([ensureRuntimeDirs(), mkdir(workRoot, { recursive: true })]);
  const extension = extensionForUpload(file.mimeType) || extname(file.fileName);
  const path = join(workRoot, `${prefix}-${randomUUID()}${extension}`);
  await writeFile(path, file.bytes);
  return path;
}

function extensionForUpload(mimeType: string) {
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/webp") return ".webp";
  if (mimeType === "video/webm") return ".webm";
  if (mimeType === "video/quicktime") return ".mov";
  if (mimeType === "video/mp4") return ".mp4";
  return ".jpg";
}

async function storedOutput(storedName: string, mimeType: string) {
  const fileStat = await stat(join(uploadsRoot, storedName));
  return {
    storedName,
    url: runtimeFileUrl(storedName),
    mimeType,
    size: fileStat.size,
  };
}

function readPngDimensions(bytes: Buffer): ImageDimensions | null {
  if (bytes.length < 24 || bytes.toString("ascii", 1, 4) !== "PNG") return null;
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

function readJpegDimensions(bytes: Buffer): ImageDimensions | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2) return null;
    if (
      marker >= 0xc0
      && marker <= 0xcf
      && ![0xc4, 0xc8, 0xcc].includes(marker)
      && offset + 8 < bytes.length
    ) {
      return {
        width: bytes.readUInt16BE(offset + 7),
        height: bytes.readUInt16BE(offset + 5),
      };
    }
    offset += 2 + length;
  }
  return null;
}

function readWebpDimensions(bytes: Buffer): ImageDimensions | null {
  if (bytes.length < 30 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP") {
    return null;
  }
  const chunk = bytes.toString("ascii", 12, 16);
  if (chunk === "VP8X") {
    return {
      width: 1 + bytes.readUIntLE(24, 3),
      height: 1 + bytes.readUIntLE(27, 3),
    };
  }
  if (chunk === "VP8L") {
    const value = bytes.readUInt32LE(21);
    return {
      width: 1 + (value & 0x3fff),
      height: 1 + ((value >> 14) & 0x3fff),
    };
  }
  if (chunk === "VP8 " && bytes.length >= 30) {
    return {
      width: bytes.readUInt16LE(26) & 0x3fff,
      height: bytes.readUInt16LE(28) & 0x3fff,
    };
  }
  return null;
}

function readImageDimensions(bytes: Buffer): ImageDimensions | null {
  return readPngDimensions(bytes) || readJpegDimensions(bytes) || readWebpDimensions(bytes);
}

async function readVideoDimensionsWithFfprobe(path: string, executable?: string) {
  if (!executable) return null;
  try {
    const { stdout } = await execFileAsync(executable, [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height",
      "-of", "csv=s=x:p=0",
      path,
    ], {
      windowsHide: true,
      timeout: 10000,
    });
    const match = stdout.trim().match(/^(\d+)x(\d+)$/);
    if (!match) return null;
    return {
      width: Number(match[1]),
      height: Number(match[2]),
    };
  } catch {
    return null;
  }
}

function readMp4Dimensions(bytes: Buffer): VideoDimensions | null {
  const scan = (start: number, end: number): VideoDimensions | null => {
    let offset = start;
    while (offset + 8 <= end) {
      let size = bytes.readUInt32BE(offset);
      const type = bytes.toString("ascii", offset + 4, offset + 8);
      let headerSize = 8;
      if (size === 1 && offset + 16 <= end) {
        const largeSize = bytes.readBigUInt64BE(offset + 8);
        if (largeSize > BigInt(Number.MAX_SAFE_INTEGER)) return null;
        size = Number(largeSize);
        headerSize = 16;
      } else if (size === 0) {
        size = end - offset;
      }
      if (size < headerSize || offset + size > end) return null;
      const contentStart = offset + headerSize;
      const contentEnd = offset + size;
      if (type === "tkhd") {
        const version = bytes[contentStart];
        const dimensionOffset = contentStart + (version === 1 ? 88 : 76);
        if (dimensionOffset + 8 <= contentEnd) {
          const width = bytes.readUInt32BE(dimensionOffset) / 65536;
          const height = bytes.readUInt32BE(dimensionOffset + 4) / 65536;
          if (width > 0 && height > 0) {
            return {
              width: Math.round(width),
              height: Math.round(height),
            };
          }
        }
      }
      if (["moov", "trak", "mdia", "minf", "stbl"].includes(type)) {
        const nested = scan(contentStart, contentEnd);
        if (nested) return nested;
      }
      offset += size;
    }
    return null;
  };
  return scan(0, bytes.length);
}

async function readVideoDimensions(path: string, probe?: string): Promise<VideoDimensions | null> {
  const probed = await readVideoDimensionsWithFfprobe(path, probe);
  if (probed) return probed;
  const fileStat = await stat(path);
  if (fileStat.size > 256 * 1024 * 1024) return null;
  return readMp4Dimensions(await readFile(path));
}

export async function upscaleImage(file: UploadedFile, scale: 2 | 4) {
  const provider = await providerById("image-upscale");
  const status = await readUpscaleStatus();
  if (!provider || provider.endpointType !== "upscayl-cli" || !status.image.ready || !status.image.executable) {
    throw new Error(status.image.detail);
  }

  const inputPath = await writeInput(file, "image-upscale-input");
  const storedName = safeStoredName(`image-upscale-${randomUUID()}.png`);
  const outputPath = join(uploadsRoot, storedName);
  const modelsPath = await upscaylModelsPath(status.image.executable);
  const nativeScale = upscaylNativeScale(provider.model);
  const args = [
    "-i", inputPath,
    "-o", outputPath,
    "-m", modelsPath,
    "-n", provider.model || "upscayl-standard-4x",
    "-z", String(nativeScale),
    "-f", "png",
    "-c", "0",
  ];
  if (scale !== nativeScale) args.push("-s", String(scale));
  if (process.env.UPSCAYL_GPU_ID) args.push("-g", process.env.UPSCAYL_GPU_ID);

  let completed = false;
  try {
    await runProcess(status.image.executable, args, 15 * 60 * 1000);
    const sourceDimensions = readImageDimensions(file.bytes);
    const outputDimensions = readImageDimensions(await readFile(outputPath));
    const item = await addLibraryItem({
      type: "image",
      mode: "image-upscale",
      title: `图片高清 ${scale}x`,
      prompt: file.fileName,
      providerId: provider.id,
      model: provider.model,
      status: "done",
      output: await storedOutput(storedName, "image/png"),
      params: {
        scale,
        sourceName: file.fileName,
        ...(sourceDimensions ? {
          sourceWidth: sourceDimensions.width,
          sourceHeight: sourceDimensions.height,
        } : {}),
        ...(outputDimensions ? {
          outputWidth: outputDimensions.width,
          outputHeight: outputDimensions.height,
        } : {}),
      },
    });
    completed = true;
    return item;
  } finally {
    await unlink(inputPath).catch(() => undefined);
    if (!completed) await unlink(outputPath).catch(() => undefined);
  }
}

export async function submitVideoUpscale(file: UploadedFile, scale: 2 | 4) {
  const provider = await providerById("video-upscale");
  const status = await readUpscaleStatus();
  if (!provider || provider.endpointType !== "video2x-cli" || !status.video.ready || !status.video.executable) {
    throw new Error(status.video.detail);
  }

  const inputPath = await writeInput(file, "video-upscale-input");
  const storedName = safeStoredName(`video-upscale-${randomUUID()}.mp4`);
  const outputPath = join(uploadsRoot, storedName);
  const sourceDimensions = await readVideoDimensions(inputPath, status.video.ffprobeExecutable);
  const item = await addLibraryItem({
    type: "video",
    mode: "video-upscale",
    title: `视频高清 ${scale}x`,
    prompt: file.fileName,
    providerId: provider.id,
    model: provider.model,
    status: "queued",
    params: {
      scale,
      sourceName: file.fileName,
      ...(sourceDimensions ? {
        sourceWidth: sourceDimensions.width,
        sourceHeight: sourceDimensions.height,
      } : {}),
    },
  });
  const job = await addJob({
    id: randomUUID(),
    libraryItemId: item.id,
    type: "video",
    providerId: provider.id,
    status: "queued",
    statusUrl: "",
  });
  const args = [
    "-i", inputPath,
    "-o", outputPath,
    "-p", "realesrgan",
    "-s", String(scale),
    "--realesrgan-model", provider.model || "realesr-animevideov3",
    "-c", process.env.VIDEO2X_CODEC || "libx264",
    "-e", `crf=${process.env.VIDEO2X_CRF || "18"}`,
    "--no-progress",
  ];
  if (process.env.VIDEO2X_GPU_ID) args.push("-d", process.env.VIDEO2X_GPU_ID);

  await updateJob(job.id, { status: "generating" });
  await updateLibraryItem(item.id, { status: "generating" });
  const child = spawn(status.video.executable, args, {
    cwd: dirname(status.video.executable),
    windowsHide: true,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      AOHUANG_VIDEO2X_JOB_ID: job.id,
      AOHUANG_VIDEO2X_ITEM_ID: item.id,
    },
  });
  let processLog = "";
  const appendLog = (chunk: Buffer) => {
    processLog = `${processLog}${chunk.toString("utf8")}`.slice(-16000);
  };
  child.stdout.on("data", appendLog);
  child.stderr.on("data", appendLog);
  child.unref();

  void monitorVideoProcess(child, {
    inputPath,
    outputPath,
    storedName,
    itemId: item.id,
    jobId: job.id,
    ffprobeExecutable: status.video.ffprobeExecutable,
    getLog: () => processLog,
  });

  return {
    item: await updateLibraryItem(item.id, { status: "generating" }) || item,
    job: await updateJob(job.id, { status: "generating" }) || job,
  };
}

async function monitorVideoProcess(
  child: ReturnType<typeof spawn>,
  context: {
    inputPath: string;
    outputPath: string;
    storedName: string;
    itemId: string;
    jobId: string;
    ffprobeExecutable?: string;
    getLog: () => string;
  },
) {
  let settled = false;
  const timeout = setTimeout(() => {
    child.kill();
    void fail("Video2X 任务运行超时。");
  }, 60 * 60 * 1000);

  const fail = async (message: string) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    await unlink(context.outputPath).catch(() => undefined);
    await updateLibraryItem(context.itemId, { status: "failed", error: sanitizeProcessDetail(message) });
    await updateJob(context.jobId, { status: "failed", error: sanitizeProcessDetail(message) });
    await unlink(context.inputPath).catch(() => undefined);
  };

  const complete = async (code: number | null) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    try {
      const processLog = context.getLog();
      const recoveredWindowsSuccess = [3221226505, 3221225477].includes(code ?? -1)
        && processLog.includes("Video processed successfully")
        && await isValidMp4Output(context.outputPath);
      const outputWrittenSuccess = [3221226505, 3221225477].includes(code ?? -1)
        && processLog.includes("Output written to:")
        && await isValidMp4Output(context.outputPath);
      if (code === 0 || recoveredWindowsSuccess || outputWrittenSuccess) {
        const output = await storedOutput(context.storedName, "video/mp4");
        const outputDimensions = await readVideoDimensions(context.outputPath, context.ffprobeExecutable);
        const currentItems = await readLibrary();
        const currentItem = currentItems.find((item) => item.id === context.itemId);
        await updateLibraryItem(context.itemId, {
          status: "done",
          output,
          params: {
            ...(currentItem?.params || {}),
            ...(outputDimensions ? {
              outputWidth: outputDimensions.width,
              outputHeight: outputDimensions.height,
            } : {}),
          },
        });
        await updateJob(context.jobId, { status: "done" });
      } else {
        const detail = processLog.trim().split(/\r?\n/).filter(Boolean).slice(-4).join(" ");
        const message = `Video2X 任务失败，退出代码 ${code ?? "unknown"}。${detail ? ` ${detail}` : ""}`;
        await unlink(context.outputPath).catch(() => undefined);
        await updateLibraryItem(context.itemId, { status: "failed", error: sanitizeProcessDetail(message) });
        await updateJob(context.jobId, { status: "failed", error: sanitizeProcessDetail(message) });
      }
    } finally {
      await unlink(context.inputPath).catch(() => undefined);
    }
  };
  child.once("error", async (error) => {
    await fail(error.message);
  });
  child.once("close", complete);
}

async function isValidMp4Output(path: string) {
  try {
    const fileStat = await stat(path);
    if (fileStat.size < 1024) return false;
    const file = await import("node:fs/promises");
    const handle = await file.open(path, "r");
    try {
      const header = Buffer.alloc(12);
      await handle.read(header, 0, header.length, 0);
      return header.toString("ascii", 4, 8) === "ftyp";
    } finally {
      await handle.close();
    }
  } catch {
    return false;
  }
}

export async function uploadedUpscaleFile(
  form: FormData,
  kind: "image" | "video",
): Promise<UploadedFile> {
  const value = form.get("file");
  if (!(value instanceof File) || value.size === 0) throw new Error("请选择要高清处理的文件。");
  const allowed = kind === "image"
    ? new Set(["image/png", "image/jpeg", "image/webp"])
    : new Set(["video/mp4", "video/webm", "video/quicktime"]);
  if (!allowed.has(value.type)) {
    throw new Error(kind === "image"
      ? "图片高清仅支持 PNG、JPEG 和 WebP。"
      : "视频高清仅支持 MP4、WebM 和 MOV。");
  }
  const limit = kind === "image" ? 25 * 1024 * 1024 : 1024 * 1024 * 1024;
  if (value.size > limit) {
    throw new Error(kind === "image" ? "图片不能超过 25MB。" : "视频不能超过 1GB。");
  }
  return {
    bytes: Buffer.from(await value.arrayBuffer()),
    mimeType: value.type,
    fileName: value.name || (kind === "image" ? "image.png" : "video.mp4"),
  };
}
