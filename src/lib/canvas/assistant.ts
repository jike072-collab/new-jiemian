export type CanvasAssistantAction =
  | { type: "add_prompt"; title?: string; prompt: string }
  | { type: "add_generator"; generationKind: "image" | "video" }
  | { type: "replace_selected_prompt"; prompt: string }
  | { type: "organize"; layout: "flow" | "grid" }
  | { type: "select_nodes"; nodeIds: string[] }
  | { type: "connect_nodes"; sourceNodeIds: string[]; targetNodeId: string }
  | { type: "group_nodes"; nodeIds: string[] }
  | { type: "ungroup"; groupId: string };

export type CanvasAssistantResponse = {
  reply: string;
  actions: CanvasAssistantAction[];
};

export function localCanvasAssistantFallback(input: {
  message: string;
  canvasTitle?: string;
  nodes?: Array<{ kind: "prompt" | "media" | "generator" | "group"; title: string; prompt?: string; selected?: boolean }>;
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
  if (/(优化|改写|润色)/.test(message) && sourcePrompt) {
    const optimizedPrompt = `${sourcePrompt.replace(/[。！？!?.]+$/u, "")}，保持主体、数量、颜色和结构不变，补充清晰的画面层次、自然光线与可执行的细节。`;
    return {
      reply: "上游助手暂时不可用，我已在当前画布内完成保守优化，可继续编辑后使用。",
      actions: [{ type: "replace_selected_prompt", prompt: optimizedPrompt }],
    };
  }
  if (/(提示词|prompt)/i.test(message) && /(写|新增|生成|补充|创建)/.test(message)) {
    const subject = sourcePrompt || boundedText(input.canvasTitle, 120) || "当前画布主题";
    return {
      reply: "上游助手暂时不可用，我已根据当前画布内容生成一条可继续编辑的提示词。",
      actions: [{
        type: "add_prompt",
        title: "画布助手提示词",
        prompt: `${subject}，主体清晰完整，构图有层次，画面重点突出，材质与颜色自然，光线统一，背景干净，不添加未要求的文字、Logo 或额外对象。`,
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
      if (prompt) actions.push({ type, prompt, title: boundedText(action.title, 80) || undefined });
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
    }
  }

  return { reply, actions };
}

function normalizeIds(value: unknown, limit: number) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.slice(0, limit).map((item) => boundedText(item, 100)).filter(Boolean))];
}
