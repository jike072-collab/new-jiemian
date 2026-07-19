export type CanvasAssistantAction =
  | { type: "add_prompt"; title?: string; prompt: string }
  | { type: "replace_selected_prompt"; prompt: string }
  | { type: "organize"; layout: "flow" | "grid" };

export type CanvasAssistantResponse = {
  reply: string;
  actions: CanvasAssistantAction[];
};

export function localCanvasAssistantFallback(input: {
  message: string;
  canvasTitle?: string;
  nodes?: Array<{ kind: "prompt" | "media" | "generator"; title: string }>;
}): CanvasAssistantResponse | null {
  const message = boundedText(input.message, 1_200);
  const nodes = Array.isArray(input.nodes) ? input.nodes.slice(0, 120) : [];
  if (/(有什么|有哪些|概览|总结|查看.{0,4}画布|画布.{0,4}内容)/.test(message)) {
    const counts = { prompt: 0, media: 0, generator: 0 };
    nodes.forEach((node) => { counts[node.kind] += 1; });
    const title = boundedText(input.canvasTitle, 120) || "未命名画布";
    if (!nodes.length) return { reply: `当前画布“${title}”还没有内容节点。`, actions: [] };
    const names = nodes.slice(0, 8).map((node) => boundedText(node.title, 120)).filter(Boolean);
    const more = nodes.length > names.length ? `，另有 ${nodes.length - names.length} 个节点` : "";
    return {
      reply: `当前画布“${title}”共有 ${nodes.length} 个内容节点：${counts.prompt} 个提示词、${counts.media} 个素材、${counts.generator} 个生成节点。${names.length ? `包括：${names.join("、")}${more}。` : ""}`,
      actions: [],
    };
  }
  if (/(整理|排列|布局)/.test(message)) {
    const layout = /网格/.test(message) ? "grid" as const : "flow" as const;
    return { reply: `可以按${layout === "grid" ? "网格" : "从左到右的创作流程"}整理当前画布。`, actions: [{ type: "organize", layout }] };
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
    if (type === "organize" && (action.layout === "flow" || action.layout === "grid")) {
      actions.push({ type, layout: action.layout });
    }
  }

  return { reply, actions };
}
