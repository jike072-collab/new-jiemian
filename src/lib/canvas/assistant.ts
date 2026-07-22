import type { CanvasMediaType, CanvasReferenceBinding, CanvasSequenceState } from "./types";

export type CanvasAssistantAction =
  | { type: "add_prompt"; title?: string; prompt: string; targetGeneratorId?: string }
  | { type: "add_generator"; generationKind: "image" | "video" }
  | { type: "replace_selected_prompt"; prompt: string }
  | { type: "organize"; layout: "flow" | "grid" }
  | { type: "select_nodes"; nodeIds: string[] }
  | { type: "connect_nodes"; sourceNodeIds: string[]; targetNodeId: string }
  | { type: "group_nodes"; nodeIds: string[] }
  | { type: "ungroup"; groupId: string }
  | { type: "annotate_references"; promptNodeId: string; bindings: CanvasReferenceBinding[] }
  | { type: "annotate_sequence"; nodeId: string; sequenceState: CanvasSequenceState }
  | {
    type: "add_storyboard";
    title?: string;
    shots: Array<{
      shotId: string;
      title: string;
      prompt: string;
      timeRange?: string;
      referenceBindings?: CanvasReferenceBinding[];
      sequenceState?: CanvasSequenceState;
    }>;
  };

export type CanvasAssistantResponse = {
  reply: string;
  actions: CanvasAssistantAction[];
};

export function canvasAssistantVideoTimestamps(durationSeconds: number) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return [];
  return [0.08, 0.29, 0.5, 0.71, 0.92].map((ratio) => Number(Math.min(durationSeconds - 0.05, Math.max(0, durationSeconds * ratio)).toFixed(3)));
}

export function localCanvasAssistantFallback(input: {
  message: string;
  canvasTitle?: string;
  nodes?: Array<{
    kind: "prompt" | "media" | "generator" | "group";
    title: string;
    prompt?: string;
    selected?: boolean;
    mediaType?: CanvasMediaType;
    referenceLabels?: Array<{ generatorId: string; label: string }>;
    sequenceState?: CanvasSequenceState;
  }>;
}): CanvasAssistantResponse | null {
  const message = boundedText(input.message, 1_200);
  const nodes = Array.isArray(input.nodes) ? input.nodes.slice(0, 120) : [];
  if (/(有什么|有哪些|概览|总结|查看.{0,4}画布|画布.{0,4}内容)/.test(message)) {
    const counts = { prompt: 0, media: 0, generator: 0, group: 0 };
    nodes.forEach((node) => { counts[node.kind] += 1; });
    const title = boundedText(input.canvasTitle, 120) || "未命名画布";
    if (!nodes.length) return { reply: `当前画布“${title}”还没有内容节点。`, actions: [] };
    const names = nodes.slice(0, 8).map((node) => boundedText(node.title, 120)).filter(Boolean);
    const more = nodes.length > names.length ? `，另有 ${nodes.length - names.length} 个节点` : "";
    return {
      reply: `当前画布“${title}”共有 ${nodes.length} 个节点：${counts.prompt} 个提示词、${counts.media} 个素材、${counts.generator} 个生成节点、${counts.group} 个分组。${names.length ? `包括：${names.join("、")}${more}。` : ""}`,
      actions: [],
    };
  }
  if (/(整理|排列|布局)/.test(message)) {
    const layout = /网格/.test(message) ? "grid" as const : "flow" as const;
    return { reply: `可以按${layout === "grid" ? "网格" : "从左到右的创作流程"}整理当前画布。`, actions: [{ type: "organize", layout }] };
  }
  const selectedPrompt = nodes.find((node) => node.kind === "prompt" && node.selected)?.prompt?.trim();
  const sourcePrompt = selectedPrompt || nodes.find((node) => node.kind === "prompt")?.prompt?.trim();
  if (/(续写|延长|继续上一段|下一段)/.test(message)) {
    const acceptedVideo = nodes.find((node) => node.kind === "media" && node.mediaType === "video" && node.sequenceState?.accepted);
    if (!acceptedVideo) {
      return { reply: "续写前需要画布中存在一个已成功的视频节点，并记录它的实际结束状态；当前没有满足条件的素材。", actions: [] };
    }
    return {
      reply: "我会基于已成功视频的实际结束状态创建下一段提示词，请先确认提示词后再生成。",
      actions: [{
        type: "add_prompt",
        title: "Seedance 续写提示词",
        prompt: `${sourcePrompt || "沿用已成功视频"}，从已成功视频的实际结束状态继续，保持人物身份、服装、场景和运动方向连续，只推进一个新的主要动作，不重复已经完成的动作。`,
      }],
    };
  }
  if (/(分镜|镜头脚本|多集|故事拆解)/.test(message)) {
    const subject = sourcePrompt || boundedText(input.canvasTitle, 120) || "当前故事主题";
    return {
      reply: "上游助手暂时不可用，我已生成 3 个可继续编辑的基础分镜节点；请确认每个镜头后再逐个生成。",
      actions: [{
        type: "add_storyboard",
        title: "Seedance 分镜项目",
        shots: [
          { shotId: "SH01", title: "建立主体和场景", timeRange: "0-3s", prompt: `${subject}，明确主体、场景和起始状态，使用一个稳定的建立镜头。`, sequenceState: { shotId: "SH01", completedBeats: [] } },
          { shotId: "SH02", title: "推进主要动作", timeRange: "3-10s", prompt: `${subject}，从上一镜头实际结束状态继续，只完成一个主要动作，使用一个服务于动作的运镜。`, sequenceState: { shotId: "SH02", completedBeats: [] } },
          { shotId: "SH03", title: "收束到结束状态", timeRange: "10-15s", prompt: `${subject}，保持角色和场景连续，完成动作后的收束画面，不重复前面已完成的动作。`, sequenceState: { shotId: "SH03", completedBeats: [] } },
        ],
      }],
    };
  }
  if (/(视频换物|局部替换|替换|换成|换掉)/.test(message) && nodes.some((node) => node.kind === "media" && node.mediaType === "video") && nodes.some((node) => node.kind === "media" && node.mediaType === "image")) {
    const videoNode = nodes.find((node) => node.kind === "media" && node.mediaType === "video");
    const imageNode = nodes.find((node) => node.kind === "media" && node.mediaType === "image");
    const videoLabel = videoNode?.referenceLabels?.[0]?.label || "@Video1";
    const imageLabel = imageNode?.referenceLabels?.[0]?.label || "@Image1";
    const prompt = [
      `执行视频局部换物编辑：以 ${videoLabel} 作为唯一基础视频，完整保留原视频的主体身份、身体结构、动作轨迹、速度节奏、镜头位置、构图、场景、光线、色调、时长和声音`,
      `仅将原视频中用户指定的目标对象替换为 ${imageLabel} 中的目标物体；以 ${imageLabel} 只锁定该物体的真实外观、轮廓、结构比例、颜色、材质、纹理和关键细节，不转移参考图的白底、排版、视角或其他对象`,
      "替换结果必须逐帧跟随原对象的位置、尺寸、朝向、透视、形变和运动轨迹；在快速运动、遮挡、出入画、旋转、接触、离地和运动模糊期间保持同一物体结构稳定，并匹配原场景的受光、接触阴影和反射",
      "除指定对象外不修改任何像素语义；禁止残留原对象、叠加新旧对象、复制目标、增加无关物体、改变人物肢体或服装、改变动作和镜头、重绘背景、切镜、变焦、加字、加 Logo、闪烁、漂移、穿模或纹理跳变",
    ].join("。") + "。";
    return {
      reply: `上游助手暂时不可用，我已按通用视频换物规范生成可直接编辑的专业提示词，并使用 ${videoLabel} 与 ${imageLabel} 标明素材职责。`,
      actions: [{ type: "add_prompt", title: "专业视频换物提示词", prompt }],
    };
  }
  if (/(优化|改写|润色)/.test(message) && sourcePrompt) {
    const optimizedPrompt = `${sourcePrompt.replace(/[。！？!?.]+$/u, "")}，保持主体、数量、颜色和结构不变，补充清晰的画面层次、自然光线与可执行的细节。`;
    return {
      reply: "上游助手暂时不可用，我已在当前画布内完成保守优化，可继续编辑后使用。",
      actions: [{ type: "replace_selected_prompt", prompt: optimizedPrompt }],
    };
  }
  if (/(提示词|prompt)/i.test(message) && /(写|新增|生成|补充|创建)/.test(message)) {
    const subject = sourcePrompt || boundedText(input.canvasTitle, 120) || "当前画布主题";
    const isVideoPrompt = /seedance|视频|分镜|首帧|尾帧|续写|延长|@Video\d+\b|@Audio\d+\b/iu.test(`${message}\n${subject}`);
    const prompt = isVideoPrompt
      ? `${subject.replace(/[。！？!?.]+$/u, "")}，主体和场景保持一致，描述一个主要动作的起始状态、连续过程和结束状态，使用一个服务于动作的主要运镜，明确真实光源与必要声音；已有 @ImageN、@VideoN、@AudioN 标签必须原样保留，并为每个引用说明只参考什么以及不要转移什么。`
      : `${subject}，主体清晰完整，构图有层次，画面重点突出，材质与颜色自然，光线统一，背景干净，不添加未要求的文字、Logo 或额外对象。`;
    return {
      reply: "上游助手暂时不可用，我已根据当前画布内容生成一条可继续编辑的提示词。",
      actions: [{
        type: "add_prompt",
        title: isVideoPrompt ? "Seedance 视频提示词" : "画布助手提示词",
        prompt,
      }],
    };
  }
  return null;
}

function boundedText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}
export function normalizeCanvasAssistantResponse(value: unknown): CanvasAssistantResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { reply: "我只能协助处理当前画布。", actions: [] };
  }
  const record = value as Record<string, unknown>;
  const reply = boundedText(record.reply, 1_500) || "我已经检查了当前画布。";
  const sourceActions = Array.isArray(record.actions) ? record.actions.slice(0, 8) : [];
  const actions: CanvasAssistantAction[] = [];

  for (const candidate of sourceActions) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const action = candidate as Record<string, unknown>;
    const type = boundedText(action.type, 40);
    if (type === "add_prompt") {
      const prompt = boundedText(action.prompt, 4_000);
      if (prompt) {
        const targetGeneratorId = boundedText(action.targetGeneratorId, 100);
        actions.push({
          type,
          prompt,
          title: boundedText(action.title, 80) || undefined,
          ...(targetGeneratorId ? { targetGeneratorId } : {}),
        });
      }
      continue;
    }
    if (type === "replace_selected_prompt") {
      const prompt = boundedText(action.prompt, 4_000);
      if (prompt) actions.push({ type, prompt });
      continue;
    }
    if (type === "add_generator" && (action.generationKind === "image" || action.generationKind === "video")) {
      actions.push({ type, generationKind: action.generationKind });
      continue;
    }
    if (type === "organize" && (action.layout === "flow" || action.layout === "grid")) {
      actions.push({ type, layout: action.layout });
      continue;
    }
    if (type === "select_nodes" || type === "group_nodes") {
      const nodeIds = normalizeIds(action.nodeIds, 32);
      if (nodeIds.length >= (type === "group_nodes" ? 2 : 1)) actions.push({ type, nodeIds });
      continue;
    }
    if (type === "connect_nodes") {
      const sourceNodeIds = normalizeIds(action.sourceNodeIds, 16);
      const targetNodeId = boundedText(action.targetNodeId, 100);
      if (sourceNodeIds.length && targetNodeId) actions.push({ type, sourceNodeIds, targetNodeId });
      continue;
    }
    if (type === "ungroup") {
      const groupId = boundedText(action.groupId, 100);
      if (groupId) actions.push({ type, groupId });
      continue;
    }
    if (type === "annotate_references") {
      const promptNodeId = boundedText(action.promptNodeId, 100);
      const bindings = normalizeReferenceBindings(action.bindings);
      if (promptNodeId && bindings.length) actions.push({ type, promptNodeId, bindings });
      continue;
    }
    if (type === "annotate_sequence") {
      const nodeId = boundedText(action.nodeId, 100);
      const sequenceState = normalizeSequenceState(action.sequenceState);
      if (nodeId && sequenceState) actions.push({ type, nodeId, sequenceState });
      continue;
    }
    if (type === "add_storyboard") {
      const shots = normalizeStoryboardShots(action.shots);
      if (shots.length) actions.push({ type, title: boundedText(action.title, 120) || undefined, shots });
    }
  }

  return { reply, actions };
}

function normalizeIds(value: unknown, limit: number) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.slice(0, limit).map((item) => boundedText(item, 100)).filter(Boolean))];
}

const referenceRoles = new Set<CanvasReferenceBinding["role"]>([
  "identity", "first-frame", "last-frame", "product", "environment",
  "motion", "camera", "timing", "audio", "style",
]);

function normalizeReferenceBindings(value: unknown): CanvasReferenceBinding[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
    const item = candidate as Record<string, unknown>;
    const label = boundedText(item.label, 24);
    const role = boundedText(item.role, 24) as CanvasReferenceBinding["role"];
    if (!/^@(Image|Video|Audio)\d+$/i.test(label) || !referenceRoles.has(role)) return [];
    const transfer = boundedText(item.transfer, 240);
    const ignore = boundedText(item.ignore, 240);
    return [{ label, role, ...(transfer ? { transfer } : {}), ...(ignore ? { ignore } : {}) }];
  });
}

function normalizeSequenceState(value: unknown): CanvasSequenceState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const projectId = boundedText(item.projectId, 120);
  const shotId = boundedText(item.shotId, 80);
  const sourceMediaNodeId = boundedText(item.sourceMediaNodeId, 100);
  const acceptedEndState = boundedText(item.acceptedEndState, 1_000);
  const continuityLocks = normalizeStringList(item.continuityLocks, 8, 160);
  const completedBeats = normalizeStringList(item.completedBeats, 12, 160);
  if (!projectId && !shotId && !sourceMediaNodeId && !acceptedEndState && !continuityLocks.length && !completedBeats.length && typeof item.accepted !== "boolean") return null;
  return {
    ...(projectId ? { projectId } : {}),
    ...(shotId ? { shotId } : {}),
    ...(sourceMediaNodeId ? { sourceMediaNodeId } : {}),
    ...(acceptedEndState ? { acceptedEndState } : {}),
    ...(continuityLocks.length ? { continuityLocks } : {}),
    ...(completedBeats.length ? { completedBeats } : {}),
    ...(typeof item.accepted === "boolean" ? { accepted: item.accepted } : {}),
  };
}

function normalizeStringList(value: unknown, limit: number, maxLength: number) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.slice(0, limit).map((item) => boundedText(item, maxLength)).filter(Boolean))];
}

function normalizeStoryboardShots(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 8).flatMap((candidate, index) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
    const item = candidate as Record<string, unknown>;
    const shotId = boundedText(item.shotId, 40) || `SH${String(index + 1).padStart(2, "0")}`;
    const title = boundedText(item.title, 100) || `分镜 ${index + 1}`;
    const prompt = boundedText(item.prompt, 4_000);
    if (!prompt) return [];
    const timeRange = boundedText(item.timeRange, 40);
    const referenceBindings = normalizeReferenceBindings(item.referenceBindings);
    const sequenceState = normalizeSequenceState(item.sequenceState);
    return [{
      shotId,
      title,
      prompt,
      ...(timeRange ? { timeRange } : {}),
      ...(referenceBindings.length ? { referenceBindings } : {}),
      ...(sequenceState ? { sequenceState } : {}),
    }];
  });
}
