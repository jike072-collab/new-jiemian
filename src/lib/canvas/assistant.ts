export type CanvasAssistantAction =
  | { type: "add_prompt"; title?: string; prompt: string }
  | { type: "replace_selected_prompt"; prompt: string }
  | { type: "organize"; layout: "flow" | "grid" };

export type CanvasAssistantResponse = {
  reply: string;
  actions: CanvasAssistantAction[];
};

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
