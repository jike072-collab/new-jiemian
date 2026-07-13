export type PromptPreferenceTool = "image-generator" | "image-editor" | "video-generator";

export type PromptPreferenceKey =
  | "purpose"
  | "style"
  | "scene"
  | "composition"
  | "camera"
  | "lighting"
  | "palette"
  | "person"
  | "platform"
  | "language"
  | "editMode"
  | "preserve"
  | "videoType"
  | "motion"
  | "pace"
  | "audio";

export type PromptPreferences = Partial<Record<PromptPreferenceKey, string>> & {
  negativePrompt?: string;
  customInstructions?: string;
};

export type PromptPreferenceField = {
  key: PromptPreferenceKey;
  label: string;
  options: Array<{ value: string; label: string }>;
};

export type BuiltInPromptPreset = {
  id: string;
  name: string;
  tool: PromptPreferenceTool;
  settings: PromptPreferences;
};

const auto = { value: "", label: "自动判断" };

const sharedFields = {
  style: {
    key: "style",
    label: "视觉风格",
    options: [auto,
      { value: "photoreal", label: "写实摄影" },
      { value: "cinematic", label: "电影质感" },
      { value: "editorial", label: "杂志编辑" },
      { value: "illustration", label: "精致插画" },
      { value: "anime", label: "动漫风格" },
      { value: "three-dimensional", label: "三维渲染" },
      { value: "minimal", label: "极简设计" },
      { value: "retro", label: "复古艺术" },
      { value: "futuristic", label: "未来主义" },
    ],
  },
  scene: {
    key: "scene",
    label: "场景氛围",
    options: [auto,
      { value: "clean-studio", label: "干净影棚" },
      { value: "warm-home", label: "温馨居家" },
      { value: "outdoor", label: "自然户外" },
      { value: "urban", label: "城市街景" },
      { value: "nature", label: "森林自然" },
      { value: "night", label: "夜景氛围" },
      { value: "abstract", label: "抽象空间" },
      { value: "fantasy", label: "幻想世界" },
    ],
  },
  lighting: {
    key: "lighting",
    label: "光线",
    options: [auto,
      { value: "natural", label: "自然光" },
      { value: "soft", label: "柔和漫射光" },
      { value: "studio", label: "专业棚拍光" },
      { value: "dramatic", label: "戏剧明暗" },
      { value: "golden-hour", label: "黄金时刻" },
      { value: "backlight", label: "轮廓逆光" },
      { value: "neon", label: "霓虹光影" },
    ],
  },
  palette: {
    key: "palette",
    label: "色彩",
    options: [auto,
      { value: "natural", label: "自然真实" },
      { value: "vibrant", label: "鲜明高饱和" },
      { value: "soft", label: "柔和低饱和" },
      { value: "warm", label: "温暖色调" },
      { value: "cool", label: "冷静色调" },
      { value: "monochrome", label: "单色统一" },
      { value: "brand", label: "匹配主体配色" },
    ],
  },
  person: {
    key: "person",
    label: "人物",
    options: [auto,
      { value: "none", label: "无人物" },
      { value: "single", label: "单人" },
      { value: "multiple", label: "多人互动" },
      { value: "hands-only", label: "仅手部出镜" },
      { value: "silhouette", label: "人物剪影" },
    ],
  },
  platform: {
    key: "platform",
    label: "用途平台",
    options: [auto,
      { value: "none", label: "不限定平台" },
      { value: "tiktok", label: "TikTok" },
      { value: "tiktok-shop", label: "TikTok Shop" },
      { value: "instagram", label: "Instagram" },
      { value: "youtube", label: "YouTube" },
      { value: "xiaohongshu", label: "小红书" },
      { value: "douyin", label: "抖音" },
      { value: "ecommerce", label: "通用电商" },
      { value: "advertising", label: "广告投放" },
    ],
  },
  language: {
    key: "language",
    label: "画面文案/台词语言",
    options: [auto,
      { value: "none", label: "不要文字或台词" },
      { value: "zh-cn", label: "简体中文" },
      { value: "english", label: "英语" },
      { value: "japanese", label: "日语" },
      { value: "korean", label: "韩语" },
      { value: "malay", label: "马来语" },
      { value: "thai", label: "泰语" },
      { value: "vietnamese", label: "越南语" },
      { value: "spanish", label: "西班牙语" },
    ],
  },
} satisfies Partial<Record<PromptPreferenceKey, PromptPreferenceField>>;

export const promptPreferenceToolLabels: Record<PromptPreferenceTool, string> = {
  "image-generator": "图片生成",
  "image-editor": "图片编辑",
  "video-generator": "视频生成",
};

export const promptPreferenceFields: Record<PromptPreferenceTool, PromptPreferenceField[]> = {
  "image-generator": [
    {
      key: "purpose",
      label: "创作目的",
      options: [auto,
        { value: "free-create", label: "自由创作" },
        { value: "product", label: "商品展示" },
        { value: "portrait", label: "人物肖像" },
        { value: "social-cover", label: "社媒封面" },
        { value: "poster", label: "海报主视觉" },
        { value: "concept-art", label: "概念艺术" },
        { value: "story-scene", label: "故事场景" },
      ],
    },
    sharedFields.style,
    sharedFields.scene,
    {
      key: "composition",
      label: "构图",
      options: [auto,
        { value: "close-up", label: "细节特写" },
        { value: "medium", label: "中景主体" },
        { value: "wide", label: "广角全景" },
        { value: "top-down", label: "俯拍平铺" },
        { value: "symmetry", label: "中心对称" },
        { value: "rule-thirds", label: "三分构图" },
        { value: "negative-space", label: "留白构图" },
        { value: "dynamic", label: "动态构图" },
      ],
    },
    {
      key: "camera",
      label: "镜头视角",
      options: [auto,
        { value: "eye-level", label: "平视" },
        { value: "low-angle", label: "低机位仰拍" },
        { value: "high-angle", label: "高机位俯拍" },
        { value: "macro", label: "微距细节" },
        { value: "telephoto", label: "长焦压缩" },
        { value: "wide-angle", label: "广角透视" },
      ],
    },
    sharedFields.lighting,
    sharedFields.palette,
    sharedFields.person,
    sharedFields.platform,
    sharedFields.language,
  ],
  "image-editor": [
    {
      key: "editMode",
      label: "编辑任务",
      options: [auto,
        { value: "precise", label: "精准局部修改" },
        { value: "background", label: "替换或清理背景" },
        { value: "retouch", label: "主体精修" },
        { value: "relight", label: "重塑光线" },
        { value: "style-transfer", label: "风格转换" },
        { value: "text-replace", label: "文字替换" },
        { value: "composite", label: "元素合成" },
        { value: "outpaint", label: "扩图补全" },
      ],
    },
    {
      key: "preserve",
      label: "保留重点",
      options: [auto,
        { value: "subject", label: "严格保持主体身份" },
        { value: "product", label: "保持商品结构和数量" },
        { value: "layout", label: "保持构图与排版" },
        { value: "color", label: "保持原有颜色材质" },
        { value: "text", label: "保持未指定文字" },
        { value: "background", label: "保持背景不变" },
      ],
    },
    sharedFields.style,
    sharedFields.scene,
    sharedFields.lighting,
    sharedFields.palette,
    sharedFields.platform,
    sharedFields.language,
  ],
  "video-generator": [
    {
      key: "videoType",
      label: "视频类型",
      options: [auto,
        { value: "free-create", label: "自由短片" },
        { value: "cinematic", label: "电影叙事" },
        { value: "product-demo", label: "商品演示" },
        { value: "ugc", label: "UGC 真实分享" },
        { value: "unboxing", label: "开箱体验" },
        { value: "social-hook", label: "社媒强钩子" },
        { value: "motion-design", label: "动态图形" },
        { value: "seamless-loop", label: "无缝循环" },
      ],
    },
    sharedFields.style,
    sharedFields.scene,
    {
      key: "motion",
      label: "镜头运动",
      options: [auto,
        { value: "static", label: "固定镜头" },
        { value: "push-in", label: "缓慢推进" },
        { value: "pull-out", label: "拉远揭示" },
        { value: "pan", label: "横向摇摄" },
        { value: "orbit", label: "环绕主体" },
        { value: "tracking", label: "跟随运动" },
        { value: "handheld", label: "轻微手持" },
        { value: "aerial", label: "航拍移动" },
      ],
    },
    {
      key: "pace",
      label: "节奏",
      options: [auto,
        { value: "slow", label: "舒缓沉浸" },
        { value: "steady", label: "稳定清晰" },
        { value: "fast", label: "快速紧凑" },
        { value: "dynamic", label: "强弱变化" },
        { value: "single-shot", label: "一镜到底" },
      ],
    },
    sharedFields.lighting,
    {
      key: "audio",
      label: "声音",
      options: [auto,
        { value: "ambient", label: "仅环境声/音乐" },
        { value: "voiceover", label: "旁白解说" },
        { value: "dialogue", label: "人物对话" },
        { value: "silent", label: "无台词" },
        { value: "custom", label: "按原提示词台词" },
      ],
    },
    sharedFields.person,
    sharedFields.platform,
    sharedFields.language,
  ],
};

export const builtInPromptPresets: BuiltInPromptPreset[] = [
  { id: "image-free", name: "自由创作", tool: "image-generator", settings: { purpose: "free-create", platform: "none" } },
  { id: "image-photo", name: "写实摄影", tool: "image-generator", settings: { purpose: "free-create", style: "photoreal", lighting: "natural", palette: "natural", platform: "none" } },
  { id: "image-product", name: "商品视觉", tool: "image-generator", settings: { purpose: "product", style: "photoreal", scene: "clean-studio", composition: "close-up", lighting: "studio", person: "none", platform: "ecommerce" } },
  { id: "image-social", name: "社媒封面", tool: "image-generator", settings: { purpose: "social-cover", composition: "negative-space", palette: "vibrant", platform: "xiaohongshu" } },
  { id: "edit-precise", name: "精准修改", tool: "image-editor", settings: { editMode: "precise", preserve: "subject", platform: "none" } },
  { id: "edit-product", name: "商品精修", tool: "image-editor", settings: { editMode: "retouch", preserve: "product", style: "photoreal", lighting: "studio", platform: "ecommerce" } },
  { id: "edit-background", name: "替换背景", tool: "image-editor", settings: { editMode: "background", preserve: "subject", style: "photoreal" } },
  { id: "video-free", name: "自由短片", tool: "video-generator", settings: { videoType: "free-create", platform: "none" } },
  { id: "video-cinematic", name: "电影镜头", tool: "video-generator", settings: { videoType: "cinematic", style: "cinematic", motion: "tracking", pace: "steady", lighting: "dramatic", platform: "none" } },
  { id: "video-ugc", name: "UGC 分享", tool: "video-generator", settings: { videoType: "ugc", style: "photoreal", motion: "handheld", pace: "fast", audio: "voiceover", platform: "tiktok" } },
  { id: "video-product", name: "商品展示", tool: "video-generator", settings: { videoType: "product-demo", style: "photoreal", motion: "orbit", pace: "steady", lighting: "studio", person: "hands-only", platform: "ecommerce" } },
];

export function emptyPromptPreferences(): PromptPreferences {
  return {};
}

export function normalizePromptPreferences(value: unknown): PromptPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  const output: PromptPreferences = {};
  for (const field of Object.values(promptPreferenceFields).flat()) {
    const inputValue = input[field.key];
    const raw = typeof inputValue === "string" ? inputValue.trim() : "";
    if (raw && field.options.some((option) => option.value === raw)) output[field.key] = raw;
  }
  const negativePrompt = typeof input.negativePrompt === "string" ? input.negativePrompt.trim().slice(0, 400) : "";
  const customInstructions = typeof input.customInstructions === "string" ? input.customInstructions.trim().slice(0, 600) : "";
  if (negativePrompt) output.negativePrompt = negativePrompt;
  if (customInstructions) output.customInstructions = customInstructions;
  return output;
}

export function promptPreferenceLines(tool: PromptPreferenceTool, preferences: PromptPreferences) {
  const normalized = normalizePromptPreferences(preferences);
  const lines = promptPreferenceFields[tool].flatMap((field) => {
    const value = normalized[field.key];
    if (!value) return [];
    const option = field.options.find((entry) => entry.value === value);
    return option ? [`${field.label}：${option.label}`] : [];
  });
  if (normalized.negativePrompt) lines.push(`避免内容：${normalized.negativePrompt}`);
  if (normalized.customInstructions) lines.push(`补充偏好：${normalized.customInstructions}`);
  return lines;
}
