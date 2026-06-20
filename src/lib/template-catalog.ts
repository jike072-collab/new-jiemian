import type { WorkspaceImageMode, WorkspaceVideoMode } from "@/lib/workspace-registry";

export type TemplateCategory = "商品" | "背景" | "广告" | "创意";

type TemplateBase = {
  id: string;
  label: string;
  summary: string;
  thumbnail: string;
  category: TemplateCategory;
  prompt: string;
  requiresImage: boolean;
  featured: boolean;
};

export type ImagePromptTemplate = TemplateBase & {
  scope: "image";
  targetToolId: "image" | "image-editor";
  mode: WorkspaceImageMode;
  aspectRatio: string;
  quality: "1k" | "2k";
};

export type VideoPromptTemplate = TemplateBase & {
  scope: "video";
  targetToolId: "video";
  mode: WorkspaceVideoMode;
  aspectRatio: string;
  duration: number;
};

export type TemplatePromptTemplate = ImagePromptTemplate | VideoPromptTemplate;

export const templateCategories: Array<TemplateCategory | "全部"> = ["全部", "商品", "背景", "广告", "创意"];

export const imagePromptTemplates: ImagePromptTemplate[] = [
  {
    id: "product-hero",
    scope: "image",
    label: "商品主图",
    summary: "主体居中，背景干净，适合电商首图。",
    thumbnail: "/images/reference/hero-cover.png",
    category: "商品",
    targetToolId: "image",
    mode: "text-to-image",
    aspectRatio: "1:1",
    quality: "2k",
    requiresImage: false,
    featured: true,
    prompt: "生成一张 TikTok Shop 商品主图，商品主体居中，占画面主要位置，背景干净，光线柔和，突出材质、颜色和核心卖点。",
  },
  {
    id: "white-background",
    scope: "image",
    label: "纯白背景",
    summary: "纯白背景，突出商品轮廓和质感。",
    thumbnail: "/images/reference/sample-2.png",
    category: "背景",
    targetToolId: "image",
    mode: "text-to-image",
    aspectRatio: "1:1",
    quality: "2k",
    requiresImage: false,
    featured: true,
    prompt: "生成一张纯白背景商品图，主体边缘清晰，阴影自然，画面干净，适合 TikTok Shop 商品展示。",
  },
  {
    id: "product-scene",
    scope: "image",
    label: "商品场景图",
    summary: "把商品放进真实使用场景。",
    thumbnail: "/images/reference/hero-cover.png",
    category: "商品",
    targetToolId: "image",
    mode: "text-to-image",
    aspectRatio: "1:1",
    quality: "2k",
    requiresImage: false,
    featured: true,
    prompt: "生成一张商品场景图，把商品放在真实使用环境中，场景自然、有生活感，突出商品用途和 TikTok Shop 转化卖点。",
  },
  {
    id: "promo-poster",
    scope: "image",
    label: "促销海报",
    summary: "预留促销信息位，突出活动氛围。",
    thumbnail: "/images/reference/sample-2.png",
    category: "广告",
    targetToolId: "image",
    mode: "text-to-image",
    aspectRatio: "4:5",
    quality: "2k",
    requiresImage: false,
    featured: true,
    prompt: "生成一张 TikTok Shop 促销海报，商品醒目，画面有促销氛围，留出适合放置优惠信息和行动号召的空间。",
  },
  {
    id: "text-translation",
    scope: "image",
    label: "文字翻译",
    summary: "翻译画面文字，并保持原布局。",
    thumbnail: "/images/reference/sample-3.png",
    category: "创意",
    targetToolId: "image-editor",
    mode: "image-to-image",
    aspectRatio: "1:1",
    quality: "2k",
    requiresImage: true,
    featured: true,
    prompt: "基于上传图像翻译画面中的文字，保持原始排版、布局、字体风格和商品主体不变，翻译后画面自然清晰。",
  },
  {
    id: "smart-cutout",
    scope: "image",
    label: "智能抠图",
    summary: "自动抠出主体，保留边缘细节。",
    thumbnail: "/images/reference/sample-1.png",
    category: "创意",
    targetToolId: "image-editor",
    mode: "image-to-image",
    aspectRatio: "1:1",
    quality: "2k",
    requiresImage: true,
    featured: false,
    prompt: "基于上传图像智能抠出商品主体，保持原始比例和主体细节，输出透明背景，边缘干净自然。",
  },
  {
    id: "multi-angle",
    scope: "image",
    label: "多角度展示",
    summary: "用多角度展现商品外观。",
    thumbnail: "/images/reference/sample-1.png",
    category: "商品",
    targetToolId: "image",
    mode: "text-to-image",
    aspectRatio: "1:1",
    quality: "2k",
    requiresImage: false,
    featured: false,
    prompt: "生成商品多角度展示图，围绕主体展示正面、侧面和细节视角，画面统一，适合 TikTok Shop 商品讲解。",
  },
  {
    id: "detail-shot",
    scope: "image",
    label: "商品细节图",
    summary: "放大材质、纹理和关键细节。",
    thumbnail: "/images/reference/sample-3.png",
    category: "商品",
    targetToolId: "image",
    mode: "text-to-image",
    aspectRatio: "1:1",
    quality: "2k",
    requiresImage: false,
    featured: false,
    prompt: "生成商品细节展示图，突出材质、纹理、结构和功能亮点，画面干净，适合电商详情页。",
  },
];

export const videoPromptTemplates: VideoPromptTemplate[] = [
  {
    id: "product-rotation",
    scope: "video",
    label: "商品旋转",
    summary: "商品缓慢旋转，突出外观和质感。",
    thumbnail: "/images/reference/hero-cover.png",
    category: "商品",
    targetToolId: "video",
    mode: "text-to-video",
    aspectRatio: "9:16",
    duration: 5,
    requiresImage: false,
    featured: true,
    prompt: "生成 TikTok Shop 商品旋转展示短视频，商品居中缓慢旋转，镜头稳定，光线干净，突出外观、材质和卖点。",
  },
  {
    id: "detail-closeup",
    scope: "video",
    label: "细节特写",
    summary: "镜头推进，展示商品细节。",
    thumbnail: "/images/reference/sample-3.png",
    category: "商品",
    targetToolId: "video",
    mode: "text-to-video",
    aspectRatio: "9:16",
    duration: 5,
    requiresImage: false,
    featured: true,
    prompt: "生成商品细节特写短视频，镜头缓慢推进，展示材质、纹理、按键、接口或功能细节，节奏清楚，适合 TikTok 商品展示。",
  },
  {
    id: "usage-demo",
    scope: "video",
    label: "使用展示",
    summary: "展示真实使用动作和效果。",
    thumbnail: "/images/reference/sample-1.png",
    category: "商品",
    targetToolId: "video",
    mode: "text-to-video",
    aspectRatio: "9:16",
    duration: 8,
    requiresImage: false,
    featured: true,
    prompt: "生成穿戴或使用展示短视频，展示用户如何自然使用商品，动作连贯，场景真实，突出使用效果和日常适用性。",
  },
  {
    id: "unboxing",
    scope: "video",
    label: "开箱视频",
    summary: "从包装到开箱，节奏轻快。",
    thumbnail: "/images/reference/sample-2.png",
    category: "商品",
    targetToolId: "video",
    mode: "text-to-video",
    aspectRatio: "9:16",
    duration: 8,
    requiresImage: false,
    featured: true,
    prompt: "生成 TikTok 风格开箱展示短视频，从包装到取出商品，镜头节奏轻快，展示配件、质感和第一眼亮点。",
  },
  {
    id: "product-scene-video",
    scope: "video",
    label: "商品场景视频",
    summary: "放进真实环境，营造种草氛围。",
    thumbnail: "/images/reference/hero-cover.png",
    category: "商品",
    targetToolId: "video",
    mode: "text-to-video",
    aspectRatio: "9:16",
    duration: 8,
    requiresImage: false,
    featured: false,
    prompt: "生成商品场景展示短视频，商品出现在真实生活环境中，镜头有轻微推进和转场，氛围自然，适合 TikTok Shop 种草。",
  },
  {
    id: "promo-video",
    scope: "video",
    label: "促销广告短片",
    summary: "前几秒直接给卖点和氛围。",
    thumbnail: "/images/reference/sample-1.png",
    category: "广告",
    targetToolId: "video",
    mode: "text-to-video",
    aspectRatio: "9:16",
    duration: 10,
    requiresImage: false,
    featured: true,
    prompt: "生成促销短视频，前 2 秒快速展示商品和卖点，随后展示使用场景和优惠氛围，节奏明快，适合 TikTok Shop 推广。",
  },
  {
    id: "before-after",
    scope: "video",
    label: "前后对比",
    summary: "用前后变化突出效果。",
    thumbnail: "/images/reference/sample-2.png",
    category: "创意",
    targetToolId: "video",
    mode: "text-to-video",
    aspectRatio: "9:16",
    duration: 8,
    requiresImage: false,
    featured: false,
    prompt: "生成前后对比短视频，用清晰的前后变化展示商品效果，镜头简洁，节奏明快，适合转化表达。",
  },
  {
    id: "tiktok-ad",
    scope: "video",
    label: "TikTok 竖屏广告",
    summary: "竖屏节奏紧凑，适合投放。",
    thumbnail: "/images/reference/sample-3.png",
    category: "广告",
    targetToolId: "video",
    mode: "text-to-video",
    aspectRatio: "9:16",
    duration: 10,
    requiresImage: false,
    featured: false,
    prompt: "生成 TikTok 竖屏广告短视频，节奏紧凑，前几秒突出卖点，中段展示场景和细节，结尾带转化信息。",
  },
];

export const featuredImagePromptTemplates = [
  imagePromptTemplates.find((template) => template.id === "product-hero"),
  imagePromptTemplates.find((template) => template.id === "white-background"),
  imagePromptTemplates.find((template) => template.id === "product-scene"),
  imagePromptTemplates.find((template) => template.id === "promo-poster"),
  imagePromptTemplates.find((template) => template.id === "text-translation"),
].filter((template): template is ImagePromptTemplate => Boolean(template));

export const featuredVideoPromptTemplates = [
  videoPromptTemplates.find((template) => template.id === "product-rotation"),
  videoPromptTemplates.find((template) => template.id === "detail-closeup"),
  videoPromptTemplates.find((template) => template.id === "usage-demo"),
  videoPromptTemplates.find((template) => template.id === "unboxing"),
  videoPromptTemplates.find((template) => template.id === "promo-video"),
].filter((template): template is VideoPromptTemplate => Boolean(template));

export function templateById(id: string) {
  return [...imagePromptTemplates, ...videoPromptTemplates].find((template) => template.id === id) || null;
}

export function templateCloneHref(id: string) {
  return `/?template=${encodeURIComponent(id)}`;
}

export function templateTabHref(scope: TemplatePromptTemplate["scope"]) {
  return `/templates?tab=${scope}`;
}

export function templateScopeLabel(scope: TemplatePromptTemplate["scope"]) {
  return scope === "image" ? "图片模板" : "视频模板";
}
