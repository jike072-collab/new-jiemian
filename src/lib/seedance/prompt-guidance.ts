export type SeedancePromptMode =
  | "text-to-video"
  | "image-to-video"
  | "reference-to-video"
  | "first-last-frame"
  | "edit"
  | "extend"
  | "storyboard";

type SeedancePromptContext = {
  prompt: string;
  hasImage?: boolean;
  duration?: number;
  referenceMediaTypes?: readonly ("image" | "video" | "audio")[];
};

const modeLabels: Record<SeedancePromptMode, string> = {
  "text-to-video": "文生视频",
  "image-to-video": "图生视频",
  "reference-to-video": "参考生视频",
  "first-last-frame": "首尾帧视频",
  edit: "视频编辑",
  extend: "视频续写或延长",
  storyboard: "分镜或连续项目",
};

export function inferSeedancePromptMode(input: SeedancePromptContext): SeedancePromptMode {
  const prompt = input.prompt;
  if (/分镜|镜头脚本|多集|连续项目|故事拆解|剧本转视频/u.test(prompt)) return "storyboard";
  if (/延长|续写|续拍|继续上一段|接着上一段|下一段视频|下一集/u.test(prompt)) return "extend";
  if (/首帧|尾帧|首尾帧|第一帧|最后一帧|first\s*frame|last\s*frame/iu.test(prompt)) return "first-last-frame";
  if (/编辑视频|修改视频|视频换物|局部替换|重剪|局部修改|(?:替换|换成|换掉|删除|移除).{0,16}(?:视频中|画面中|原视频|鞋|服装|产品|物体)|视频.{0,16}(?:替换|换成|换掉|删除|移除)/u.test(prompt)) return "edit";
  if (/@Video\d+\b/i.test(prompt) || input.referenceMediaTypes?.includes("video")) return "reference-to-video";
  if (/@Image\d+\b/i.test(prompt) || input.referenceMediaTypes?.includes("image") || input.hasImage) return "image-to-video";
  return "text-to-video";
}

export function seedancePromptGuidance(input: SeedancePromptContext) {
  const mode = inferSeedancePromptMode(input);
  const prompt = input.prompt;
  const explicitlyReferencesContext = /(?:参考|保持|复刻|模仿|沿用|锁定).{0,12}(?:动作|环境|场景|运镜|镜头)|(?:动作|环境|场景|运镜|镜头).{0,12}(?:参考|保持|复刻|模仿|沿用|锁定)/u.test(prompt);
  const guidance = [
    `Seedance 任务模式：${modeLabels[mode]}。`,
    "用一个明确创作意图统领主体动作、主要运镜、光线和声音；优先具体可见的动作，删除空泛的电影感、专业感和氛围感堆砌。",
    "Seedance 可以理解紧凑的明确指令：只写影响结果的关键信息，同一约束只写一次，保护项合并表达。",
    "普通单段视频保持简单：一个主要主体、一个主要动作、一个主要运镜；只有故事或多镜头需求才拆分时间段。",
  ];

  if (/@(?:Image|Video|Audio)\d+\b/i.test(prompt)) {
    guidance.push(
      "精确保留用户写出的 @ImageN、@VideoN、@AudioN 标签，不翻译、不重编号、不新增不存在的引用。",
      "为每个引用指定一个主要职责，例如人物身份、首帧、尾帧、产品、环境、动作、运镜、节奏、音频或风格，并明确哪些内容不要从该素材转移。",
    );
  }

  if (/@Audio\d+\b/i.test(prompt)) {
    guidance.push("音频引用只控制用户指定的音乐、音色、节奏或音效，不得据此改变人物身份、场景或画面结构。");
  }

  if (mode === "image-to-video") {
    guidance.push("锁定参考图中的主体身份、外观、颜色、结构和比例，按起始状态、连续动作、主要运镜、结束状态组织提示词。");
  } else if (mode === "reference-to-video") {
    guidance.push("明确视频引用究竟只参考动作、运镜、节奏、音频还是风格；动作或运镜参考不得覆盖图片引用锁定的人物、产品和场景。");
  } else if (mode === "first-last-frame") {
    guidance.push("明确哪张图是首帧、哪张图是尾帧，描述中间连续变化和运动方向，避免无依据的切镜、跳变或新增主体。");
  } else if (mode === "edit") {
    guidance.push(
      "用户指定的编辑对象和修改目标是最高优先级；先写基础视频引用、目标对象、目标图片引用和替换范围，不要把编辑任务改写成从零生成。",
      "先按时间顺序识别原对象的存在、缺失、首次出现和消失；只在原对象存在时替换，原对象不存在时保持不存在，替换对象必须与原对象同时出现和消失。",
      "替换对象要随原对象逐帧匹配位置、尺寸、透视、形变、遮挡、运动模糊、接触阴影和离地状态；禁止残留原对象、叠加两个对象、复制目标或改变未指定区域。",
      explicitlyReferencesContext
        ? "用户已明确要求参考动作、环境、场景或镜头，应围绕被点名的内容进行必要分析，同时不得覆盖主要编辑目标。"
        : "用户未明确要求参考动作、环境、场景或镜头时，这些内容只作为不可误改的保护项，不展开描述，不让它们抢占编辑目标。",
    );
  } else if (mode === "extend") {
    guidance.push("续写必须从已成功视频的实际结束画面、人物状态、运动方向和声音状态开始，不重复已经完成的情节，也不提前泄露后续保留情节。");
  } else if (mode === "storyboard") {
    guidance.push("先拆分镜头目标和素材职责，再为每个镜头写可独立生成的提示词；记录角色、场景、道具、已完成情节和每段结束状态以保持连续性。");
  }

  if (/带货|电商|tiktok\s*shop|商品推广|转化/iu.test(prompt)) {
    guidance.push(
      "15 秒电商短视频优先使用四段时间轴：0-2 秒钩子，2-7 秒一个核心价值演示，7-12 秒可见证据或细节确认，12-15 秒结果收束和行动；每段只安排一个主要动作。",
      "产品卖点必须来自参考图可见事实或用户明确提供的信息；不可见的功效、成分、价格、折扣、销量、评价和品牌身份都不能补写。",
      "带货提示词的输出顺序为：素材职责、主体/产品事实、时间轴、声音/口播、合并后的禁止项；镜头必须服务于当前段落动作，不要连续堆叠无动机运镜。",
    );
  }

  if (input.duration) {
    guidance.push(`界面时长为 ${input.duration} 秒，只用于控制动作密度和时间段，不要在最终提示词中重复时长参数。`);
  }

  return guidance;
}

export function seedanceReferenceMentions(prompt: string) {
  return [...new Set(prompt.match(/@(Image|Video|Audio)\d+\b/gi) || [])];
}

export function seedanceReferenceIssues(prompt: string, availableLabels: string[]) {
  const mentions = seedanceReferenceMentions(prompt);
  const available = availableLabels.map((label) => `@${label}`);
  return {
    missing: mentions.filter((label) => !available.some((candidate) => candidate.toLowerCase() === label.toLowerCase())),
    unused: available.filter((label) => !mentions.some((candidate) => candidate.toLowerCase() === label.toLowerCase())),
  };
}

export const seedanceCanvasAssistantRules = [
  "处理 Seedance 视频提示词时，先判断是文生视频、图生视频、参考生视频、首尾帧、编辑、续写还是分镜任务。",
  "Seedance 提示词保持紧凑，只写影响结果的关键目标、素材职责、时序和禁止项；同一约束不得换用近义句重复。",
  "引用标签只使用当前系统支持的 @ImageN、@VideoN、@AudioN，必须原样保留，不翻译、不重编号、不编造引用。",
  "每个引用素材只指定一个主要职责，并说明需要转移和不要转移的内容；动作或运镜参考不得覆盖人物身份、产品结构或场景约束。",
  "普通单段视频优先一个主要主体、一个主要动作和一个主要运镜；长故事、多镜头或多集任务才拆成多个提示词节点。",
  "15 秒电商带货默认采用 0-2、2-7、7-12、12-15 秒四段时间轴；每段只写一个可见动作和一个有动机的主要运镜，先写素材职责再写时间轴。",
  "商品事实只能来自参考素材可见内容或用户明确提供的内容；对不可见的功效、成分、价格、折扣、销量、评价和品牌身份使用不声明原则。",
  "视频换物和局部替换必须使用准确的视频与图片引用标签，逐帧锁定替换对象的透视、遮挡、运动模糊和接触关系，同时保护所有未指定内容。",
  "续写或延长必须基于画布中已成功视频的实际结束状态；缺少成功视频或结束状态时先要求用户补充，actions 必须为空。",
];
