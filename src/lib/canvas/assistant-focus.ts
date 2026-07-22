export type CanvasAssistantFocusNode = {
  id: string;
  kind: "prompt" | "media" | "generator" | "group";
  selected?: boolean;
  mediaType?: "image" | "video" | "audio";
  connectedNodeIds?: string[];
  referenceLabels?: Array<{ generatorId: string; label: string }>;
};

export type CanvasAssistantMediaFocus = {
  nodeIds: string[];
  generatorId: string;
  ambiguous: boolean;
  reason: string;
};

export function resolveCanvasAssistantMediaFocus(nodes: CanvasAssistantFocusNode[], message: string): CanvasAssistantMediaFocus {
  const mediaNodes = nodes.filter((node) => node.kind === "media" && (node.mediaType === "image" || node.mediaType === "video"));
  const generatorIds = new Set(nodes.filter((node) => node.kind === "generator").map((node) => node.id));
  const selectedGeneratorIds = new Set(nodes.flatMap((node) => {
    if (!node.selected) return [];
    if (node.kind === "generator") return [node.id];
    return node.connectedNodeIds?.filter((id) => generatorIds.has(id)) || [];
  }));
  const selectedFocus = mediaNodes.filter((node) => (
    node.selected
    || node.referenceLabels?.some((reference) => selectedGeneratorIds.has(reference.generatorId))
  ));
  if (selectedFocus.length) {
    return {
      nodeIds: selectedFocus.map((node) => node.id),
      generatorId: [...selectedGeneratorIds][0] || "",
      ambiguous: false,
      reason: "已选节点或连接到已选生成节点的素材",
    };
  }

  const mentionedLabels = new Set((message.match(/@(Image|Video)\d+\b/gi) || []).map((label) => label.toLowerCase()));
  if (mentionedLabels.size) {
    const mentioned = mediaNodes.filter((node) => node.referenceLabels?.some((reference) => mentionedLabels.has(reference.label.toLowerCase())));
    const duplicatedLabel = [...mentionedLabels].some((label) => mentioned.filter((node) => node.referenceLabels?.some((reference) => reference.label.toLowerCase() === label)).length > 1);
    if (mentioned.length && !duplicatedLabel) {
      return {
        nodeIds: mentioned.map((node) => node.id),
        generatorId: mentioned[0].referenceLabels?.[0]?.generatorId || "",
        ambiguous: false,
        reason: "消息中点名的唯一引用",
      };
    }
    return { nodeIds: [], generatorId: "", ambiguous: true, reason: "点名的引用标签在多个生成链路中重复" };
  }

  const generatorIdList = [...generatorIds];
  if (generatorIdList.length === 1) {
    const generatorId = generatorIdList[0];
    return {
      nodeIds: mediaNodes.filter((node) => node.connectedNodeIds?.includes(generatorId) || node.referenceLabels?.some((reference) => reference.generatorId === generatorId)).map((node) => node.id),
      generatorId,
      ambiguous: false,
      reason: "画布中唯一的生成链路",
    };
  }
  if (!generatorIdList.length && mediaNodes.length <= 2) {
    return { nodeIds: mediaNodes.map((node) => node.id), generatorId: "", ambiguous: false, reason: "画布中的全部少量素材" };
  }
  return { nodeIds: [], generatorId: "", ambiguous: mediaNodes.length > 0, reason: "存在多个生成链路且未选中或点名素材" };
}
