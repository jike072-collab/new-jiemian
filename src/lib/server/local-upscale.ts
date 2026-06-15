import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { promisify } from "node:util";

import {
  addJob,
  addLibraryItem,
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
};

type UploadedFile = {
  bytes: Buffer;
  mimeType: string;
  fileName: string;
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
      ? { ready: true, detail: `已检测到 Upscayl：${imageExecutable}`, executable: imageExecutable }
      : { ready: false, detail: `已找到 Upscayl，但模型 ${model} 在目录 ${modelsPath} 中不完整。` };
  }

  let video: LocalToolStatus;
  if (!videoProvider?.enabled) {
    video = { ready: false, detail: "视频高清已在供应商后台停用。" };
  } else if (!videoExecutable) {
    video = {
      ready: false,
      detail: "未检测到 Video2X。安装 CLI 发行版后可在供应商后台填写 video2x.exe 路径。",
    };
  } else {
    video = {
      ready: true,
      detail: `已检测到 Video2X：${videoExecutable}`,
      executable: videoExecutable,
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
  const extension = extname(file.fileName) || extensionForUpload(file.mimeType);
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

  try {
    await runProcess(status.image.executable, args, 15 * 60 * 1000);
    return addLibraryItem({
      type: "image",
      mode: "image-upscale",
      title: `图片高清 ${scale}x`,
      prompt: file.fileName,
      providerId: provider.id,
      model: provider.model,
      status: "done",
      output: await storedOutput(storedName, "image/png"),
      params: { scale, sourceName: file.fileName },
    });
  } finally {
    await unlink(inputPath).catch(() => undefined);
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
  const item = await addLibraryItem({
    type: "video",
    mode: "video-upscale",
    title: `视频高清 ${scale}x`,
    prompt: file.fileName,
    providerId: provider.id,
    model: provider.model,
    status: "queued",
    params: { scale, sourceName: file.fileName },
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
  ];
  if (process.env.VIDEO2X_GPU_ID) args.push("-d", process.env.VIDEO2X_GPU_ID);

  await updateJob(job.id, { status: "generating" });
  await updateLibraryItem(item.id, { status: "generating" });
  const child = spawn(status.video.executable, args, {
    windowsHide: true,
    detached: process.platform !== "win32",
    stdio: "ignore",
    env: {
      ...process.env,
      AOHUANG_VIDEO2X_JOB_ID: job.id,
      AOHUANG_VIDEO2X_ITEM_ID: item.id,
    },
  });
  child.unref();

  void monitorVideoProcess(child, {
    inputPath,
    outputPath,
    storedName,
    itemId: item.id,
    jobId: job.id,
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
  },
) {
  let settled = false;
  const complete = async (code: number | null) => {
    if (settled) return;
    settled = true;
    try {
      if (code === 0) {
        const output = await storedOutput(context.storedName, "video/mp4");
        await updateLibraryItem(context.itemId, { status: "done", output });
        await updateJob(context.jobId, { status: "done" });
      } else {
        const message = `Video2X 任务失败，退出代码 ${code ?? "unknown"}。`;
        await unlink(context.outputPath).catch(() => undefined);
        await updateLibraryItem(context.itemId, { status: "failed", error: message });
        await updateJob(context.jobId, { status: "failed", error: message });
      }
    } finally {
      await unlink(context.inputPath).catch(() => undefined);
    }
  };
  child.once("error", async (error) => {
    if (settled) return;
    settled = true;
    await unlink(context.outputPath).catch(() => undefined);
    await updateLibraryItem(context.itemId, { status: "failed", error: error.message });
    await updateJob(context.jobId, { status: "failed", error: error.message });
    await unlink(context.inputPath).catch(() => undefined);
  });
  child.once("close", complete);
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
