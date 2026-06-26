import type { WorkspaceImageMode, WorkspaceVideoMode } from "@/lib/workspace-registry";

export function upscaleTargetLabel(scale: string) {
  if (scale === "4") return "4K";
  if (scale === "2") return "2K";
  return "1K";
}

export function videoUpscaleScaleLabel(scale: string) {
  return upscaleTargetLabel(scale);
}

export const ratios = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"];
export const defaultVideoDurations = [5, 8, 10, 15];
export const grokVideoDurations = [4, 6, 8, 10, 12, 15];
export const grokVideo10Ratios = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"];
export const grokVideo15Ratios = ["16:9", "9:16"];
export const jimengVideoRatios = ["16:9", "9:16", "1:1"];
export const upscaleUnavailableMessage = "高清处理暂时不可用，请稍后重试";
export const promptOptimizationTargetPlatform = "TikTok Shop";
export const PROMPT_OPTIMIZATION_QUOTA_UNITS = 0;
export const quotaSymbol = "✦";

export const imageWorkspaceModeMeta: Record<WorkspaceImageMode, {
  title: string;
  subtitle: string;
  submitLabel: string;
  loadingLabel: string;
  promptPlaceholder: string;
  guideTitle: string;
  guideDescription: string;
  guideNotes: string[];
}> = {
  "text-to-image": {
    title: "AI 图像生成器",
    subtitle: "描述画面，可选图像。",
    submitLabel: "生成图片",
    loadingLabel: "正在生成",
    promptPlaceholder: "描述你要生成的画面、风格、主体和氛围。",
    guideTitle: "准备开始生成",
    guideDescription: "描述你想生成的画面。",
    guideNotes: ["选择模型", "填写提示词", "生成后可下载或放大"],
  },
  "image-to-image": {
    title: "AI 图片编辑器",
    subtitle: "上传图像并描述修改要求。",
    submitLabel: "开始编辑",
    loadingLabel: "正在编辑",
    promptPlaceholder: "描述你要如何修改这张图像，保留哪些元素、替换哪些内容。",
    guideTitle: "准备开始编辑",
    guideDescription: "描述希望如何修改图像。",
    guideNotes: ["上传图像", "写清修改要求", "生成后可下载或放大"],
  },
};

export const allowedReferenceImageTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
export const allowedUpscaleVideoTypes = new Set(["video/mp4", "video/webm", "video/quicktime"]);
export const maxReferenceImageSize = 10 * 1024 * 1024;
export const maxReferenceImageCount = 10;
export const maxVideoFirstFrameCount = 1;
export const maxImageUpscaleSize = 25 * 1024 * 1024;
export const maxVideoUpscaleSize = 1024 * 1024 * 1024;

export const videoWorkspaceModeMeta: Record<WorkspaceVideoMode, {
  submitLabel: string;
  loadingLabel: string;
  uploadLabel: string;
  uploadRequired: boolean;
  uploadEmptyTitle: string;
  uploadFilledTitle: string;
  uploadHelpText: string;
  promptLabel: string;
  promptPlaceholder: string;
  guideDescription: string;
  guideEmpty: string;
  guideReady: string;
  guideNotes: string[];
}> = {
  "text-to-video": {
    submitLabel: "生成视频",
    loadingLabel: "正在生成视频",
    uploadLabel: "图像",
    uploadRequired: false,
    uploadEmptyTitle: "上传图像",
    uploadFilledTitle: "已选择图像",
    uploadHelpText: "支持 JPG、PNG、WEBP",
    promptLabel: "提示词",
    promptPlaceholder: "描述主体、动作、场景、镜头、运镜、光线和氛围。例如：雨夜霓虹街道，低机位缓慢推进，人物回头看向镜头。",
    guideDescription: "描述你想生成的视频画面、动作和镜头。",
    guideEmpty: "描述你想生成的视频画面、动作和镜头，真实视频结果会显示在这里。",
    guideReady: "提示词已填写，可以提交真实视频任务。",
    guideNotes: ["选择视频模型", "描述画面动作和镜头", "生成后可下载或放大"],
  },
  "image-to-video": {
    submitLabel: "生成视频",
    loadingLabel: "正在生成视频",
    uploadLabel: "图像",
    uploadRequired: true,
    uploadEmptyTitle: "上传图像",
    uploadFilledTitle: "已选择图像",
    uploadHelpText: "支持 JPG、PNG、WEBP",
    promptLabel: "提示词",
    promptPlaceholder: "描述图像中的主体如何运动、镜头如何推进/拉远/环绕、背景如何变化，以及哪些元素必须保持一致。",
    guideDescription: "上传图像，再描述希望画面如何运动。",
    guideEmpty: "先上传图像，再补充提示词。这里不会用假视频冒充结果。",
    guideReady: "图像已准备好，补充提示词后可以提交真实视频任务。",
    guideNotes: ["上传图像", "描述运动和镜头变化", "生成后可下载或放大"],
  },
};

export const videoModelReferenceMessage = "当前模型需要上传 1 张图像。";

export const ratioShapeClass: Record<string, string> = {
  "1:1": "ratio-1-1",
  "16:9": "ratio-16-9",
  "9:16": "ratio-9-16",
  "4:3": "ratio-4-3",
  "3:4": "ratio-3-4",
  "3:2": "ratio-3-2",
  "2:3": "ratio-2-3",
};

export function formatQuotaUnits(value: number | null | undefined) {
  if (value === null || value === undefined) return "0";
  return new Intl.NumberFormat("zh-CN").format(value);
}

export function formatQuotaSymbolLabel(value: number | null | undefined) {
  return `${formatQuotaUnits(value)} ${quotaSymbol}`;
}

export const promptOptimizationCostLabel = formatQuotaSymbolLabel(PROMPT_OPTIMIZATION_QUOTA_UNITS);
