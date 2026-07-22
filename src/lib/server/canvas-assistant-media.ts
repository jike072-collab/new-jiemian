import "server-only";

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

import type { CanvasMediaType } from "@/lib/canvas/types";
import { canvasAssistantVideoTimestamps } from "@/lib/canvas/assistant";
import { resolveCanvasAssistantMediaFocus, type CanvasAssistantFocusNode } from "@/lib/canvas/assistant-focus";
import { resolveLibraryMediaForOwners } from "@/lib/server/library";
import { resolveUploadPath } from "@/lib/server/paths";
import { probeVideoDuration } from "@/lib/server/video-trim";

const maxEvidenceItems = 8;
const maxFrameBytes = 2_000_000;
const frameTimeoutMs = 20_000;

export type CanvasAssistantVisualEvidence = {
  label: string;
  description: string;
  dataUrl: string;
};

type MediaCandidate = {
  nodeId: string;
  libraryItemId: string;
  mediaType: "image" | "video";
  title: string;
  selected: boolean;
  connectedNodeIds: string[];
  referenceLabels: Array<{ generatorId: string; label: string }>;
};

function text(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function referenceLabels(value: unknown, mediaType: CanvasMediaType, fallbackIndex: number) {
  const labels: Array<{ generatorId: string; label: string }> = [];
  if (Array.isArray(value)) {
    for (const candidate of value.slice(0, 8)) {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
      const item = candidate as Record<string, unknown>;
      const generatorId = text(item.generatorId, 100);
      const label = text(item.label, 24);
      if (generatorId && /^@(Image|Video|Audio)\d+$/i.test(label)) labels.push({ generatorId, label });
    }
  }
  return labels.length ? labels : [{ generatorId: "", label: `@${mediaType === "video" ? "Video" : "Image"}${fallbackIndex}` }];
}

function mediaCandidates(value: unknown): MediaCandidate[] {
  if (!Array.isArray(value)) return [];
  const counts: Record<"image" | "video", number> = { image: 0, video: 0 };
  const seen = new Set<string>();
  return value.slice(0, 120).flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
    const node = candidate as Record<string, unknown>;
    if (node.kind !== "media" || (node.mediaType !== "image" && node.mediaType !== "video")) return [];
    const libraryItemId = text(node.libraryItemId, 160);
    const nodeId = text(node.id, 100);
    if (!nodeId || !libraryItemId || seen.has(libraryItemId)) return [];
    seen.add(libraryItemId);
    const mediaType = node.mediaType as "image" | "video";
    counts[mediaType] += 1;
    return [{
      nodeId,
      libraryItemId,
      mediaType,
      title: text(node.title, 120) || (mediaType === "video" ? "视频素材" : "图片素材"),
      selected: Boolean(node.selected),
      connectedNodeIds: Array.isArray(node.connectedNodeIds)
        ? node.connectedNodeIds.slice(0, 24).map((id) => text(id, 100)).filter(Boolean)
        : [],
      referenceLabels: referenceLabels(node.referenceLabels, mediaType, counts[mediaType]),
    }];
  }).sort((left, right) => Number(right.selected) - Number(left.selected));
}

function selectMediaCandidates(nodes: unknown, message: string) {
  const candidates = mediaCandidates(nodes);
  const records = Array.isArray(nodes) ? nodes.filter((node) => node && typeof node === "object" && !Array.isArray(node)) as Array<Record<string, unknown>> : [];
  const focusNodes = records.flatMap((node): CanvasAssistantFocusNode[] => {
    const id = text(node.id, 100);
    if (!id || !(node.kind === "prompt" || node.kind === "media" || node.kind === "generator" || node.kind === "group")) return [];
    return [{
      id,
      kind: node.kind,
      selected: Boolean(node.selected),
      mediaType: node.mediaType === "image" || node.mediaType === "video" || node.mediaType === "audio" ? node.mediaType : undefined,
      connectedNodeIds: Array.isArray(node.connectedNodeIds) ? node.connectedNodeIds.map((value) => text(value, 100)).filter(Boolean) : undefined,
      referenceLabels: referenceLabels(node.referenceLabels, node.mediaType === "video" ? "video" : "image", 1),
    }];
  });
  const focus = resolveCanvasAssistantMediaFocus(focusNodes, message);
  const focusedNodeIds = new Set(focus.nodeIds);
  return { ...focus, candidates: candidates.filter((candidate) => focusedNodeIds.has(candidate.nodeId)) };
}

function candidateLabel(candidate: MediaCandidate, generatorId: string) {
  return candidate.referenceLabels.find((reference) => reference.generatorId === generatorId)?.label
    || candidate.referenceLabels[0]?.label
    || `@${candidate.mediaType === "video" ? "Video" : "Image"}1`;
}

async function jpegDataUrl(bytes: Buffer, fallbackMimeType = "image/jpeg") {
  let output = bytes;
  let mimeType = fallbackMimeType.split(";")[0].trim().toLowerCase();
  try {
    const sharp = (await import("sharp")).default;
    output = await sharp(bytes)
      .rotate()
      .resize({ width: 960, height: 960, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 72 })
      .toBuffer();
    mimeType = "image/jpeg";
  } catch {
    // FFmpeg frames are already JPEG; original images remain valid vision inputs.
  }
  if (!/^image\/(png|jpeg|webp)$/i.test(mimeType) || output.length > maxFrameBytes) {
    throw new Error("Canvas assistant visual evidence is unsupported or too large.");
  }
  return `data:${mimeType};base64,${output.toString("base64")}`;
}

function captureVideoFrame(inputPath: string, timestamp: number) {
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn("ffmpeg", [
      "-nostdin",
      "-hide_banner",
      "-loglevel", "error",
      "-ss", timestamp.toFixed(3),
      "-i", inputPath,
      "-frames:v", "1",
      "-vf", "scale='min(960,iw)':-2",
      "-q:v", "4",
      "-f", "image2pipe",
      "-vcodec", "mjpeg",
      "pipe:1",
    ], { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let total = 0;
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
      finish(() => reject(new Error("Canvas assistant video frame extraction timed out.")));
    }, frameTimeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxFrameBytes) {
        child.kill("SIGKILL");
        finish(() => reject(new Error("Canvas assistant video frame exceeded size limit.")));
        return;
      }
      chunks.push(chunk);
    });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => { stderr = `${stderr}${chunk}`.slice(0, 2_000); });
    child.once("error", (error) => finish(() => reject(error)));
    child.once("close", (code) => finish(() => {
      const output = Buffer.concat(chunks);
      if (code === 0 && output.length) resolve(output);
      else reject(new Error(stderr || "Canvas assistant could not extract a video frame."));
    }));
  });
}

export async function buildCanvasAssistantVisualEvidence(nodes: unknown, ownerIds: readonly string[], message = "") {
  if (!/(图片|图像|照片|视频|素材|画面|提示词|分镜|镜头|替换|换成|换掉|换物|编辑|修改|产品|动作|@(?:Image|Video)\d+)/iu.test(message)) {
    return { images: [] as CanvasAssistantVisualEvidence[], summary: "本次请求不需要读取视觉素材。", ambiguous: false };
  }
  const selection = selectMediaCandidates(nodes, message);
  const candidates = selection.candidates.slice(0, 4);
  const images: CanvasAssistantVisualEvidence[] = [];
  const summaries: string[] = [];

  if (selection.ambiguous) {
    return {
      images,
      summary: "素材范围不明确：当前画布存在多个生成链路。请用户选中目标素材或生成节点，或在问题中明确写出引用标签后再分析。",
      ambiguous: true,
    };
  }

  for (const candidate of candidates) {
    if (images.length >= maxEvidenceItems) break;
    try {
      const media = await resolveLibraryMediaForOwners(candidate.libraryItemId, ownerIds);
      if (!media.storedName) continue;
      const inputPath = resolveUploadPath(media.storedName);
      const label = candidateLabel(candidate, selection.generatorId);
      if (candidate.mediaType === "image") {
        images.push({
          label,
          description: `图片参考“${candidate.title}”，请识别其中需要保留或转移的真实外观、结构、颜色和材质。`,
          dataUrl: await jpegDataUrl(await readFile(inputPath), media.mimeType || "image/jpeg"),
        });
        summaries.push(`${label}=图片“${candidate.title}”`);
        continue;
      }

      const duration = await probeVideoDuration(inputPath);
      const timestamps = canvasAssistantVideoTimestamps(duration);
      const frames = await Promise.all(timestamps.map(async (timestamp, index) => ({
        label,
        description: `视频“${candidate.title}”代表帧 ${index + 1}/${timestamps.length}，时间约 ${timestamp.toFixed(1)} 秒。按顺序理解原视频主体、动作、镜头、遮挡和场景，不要把单帧误当成独立图片任务。`,
        dataUrl: await jpegDataUrl(await captureVideoFrame(inputPath, timestamp)),
      })));
      images.push(...frames.slice(0, maxEvidenceItems - images.length));
      summaries.push(`${label}=视频“${candidate.title}”（${duration.toFixed(1)}秒，已提供${frames.length}个时序代表帧）`);
    } catch {
      const label = candidateLabel(candidate, selection.generatorId);
      summaries.push(`${label}=素材“${candidate.title}”（视觉读取失败，只能使用节点元数据）`);
    }
  }

  return {
    images,
    summary: `${selection.reason}；${summaries.join("；")}`.slice(0, 1_500),
    ambiguous: false,
  };
}
