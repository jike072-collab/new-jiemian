"use client";

import { Bot, Check, Image as ImageIcon, LoaderCircle, Send, Sparkles, WandSparkles, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import { fetchJsonWithCsrf } from "@/lib/client/api";
import {
  CanvasCommerceAssistant,
  type CanvasCommerceCreateResult,
  type CanvasCommerceLibraryImage,
} from "@/components/canvas/canvas-commerce-assistant";
import type { EnabledProviders } from "@/components/studio/types";
import { normalizeCanvasAssistantResponse, type CanvasAssistantAction, type CanvasAssistantResponse } from "@/lib/canvas/assistant";
import type { CanvasCommerceAssistantState, CanvasCommerceProductDraft, CanvasMediaType, CanvasReferenceBinding, CanvasSequenceState } from "@/lib/canvas/types";

export type CanvasAssistantNodeContext = {
  id: string;
  kind: "prompt" | "media" | "generator" | "group";
  title: string;
  prompt?: string;
  selected?: boolean;
  mediaType?: CanvasMediaType;
  libraryItemId?: string;
  connectedNodeIds?: string[];
  referenceLabels?: Array<{ generatorId: string; label: string }>;
  generationKind?: "image" | "video";
  providerId?: string;
  ratio?: string;
  duration?: number;
  resolution?: string;
  referenceBindings?: CanvasReferenceBinding[];
  sequenceState?: CanvasSequenceState;
};

type Message = { role: "user" | "assistant"; content: string };
type MentionQuery = { start: number; end: number; query: string };
type AssistantModule = "prompt" | "replace";
type ContentDirection = "human-demo" | "sport-scene" | "product-detail" | "daily-use" | "spoken-review";
type AssistantPhase = "idle" | "analyzing" | "preview" | "created" | "error";
type PromptAction = Extract<CanvasAssistantAction, { type: "add_prompt" }>;

const contentDirections: Array<{ id: ContentDirection; label: string; detail: string }> = [
  { id: "human-demo", label: "真人展示", detail: "真人自然试用与动作展示" },
  { id: "sport-scene", label: "运动场景", detail: "运动前后与动态细节" },
  { id: "product-detail", label: "产品细节", detail: "材质、结构与近景展示" },
  { id: "daily-use", label: "生活场景", detail: "马来西亚日常使用场景" },
  { id: "spoken-review", label: "口播推荐", detail: "自然马来语口播与演示" },
];

export function CanvasAssistantPanel({
  projectId,
  canvasTitle,
  scope,
  nodes,
  providers,
  commerceState,
  libraryImages,
  mentionSelection,
  onMentionModeChange,
  onApply,
  onCommerceStateChange,
  onUploadProductImages,
  onAddLibraryImage,
  onCreateCommercePlans,
  onClose,
}: {
  projectId: string;
  canvasTitle: string;
  scope: "personal" | "shared";
  nodes: CanvasAssistantNodeContext[];
  providers: EnabledProviders;
  commerceState?: CanvasCommerceAssistantState;
  libraryImages: CanvasCommerceLibraryImage[];
  mentionSelection: { nodeId: string; revision: number } | null;
  onMentionModeChange: (active: boolean) => void;
  onApply: (actions: CanvasAssistantAction[]) => void;
  onCommerceStateChange: (state: CanvasCommerceAssistantState) => void;
  onUploadProductImages: (files: File[]) => Promise<string[]>;
  onAddLibraryImage: (libraryItemId: string) => string | undefined;
  onCreateCommercePlans: (draft: CanvasCommerceProductDraft, planIds: string[]) => CanvasCommerceCreateResult[];
  onClose: () => void;
}) {
  const [activeModule, setActiveModule] = useState<AssistantModule>("prompt");
  const [contentDirection] = useState<ContentDirection>("human-demo");
  const [phase, setPhase] = useState<AssistantPhase>("idle");
  const [previewPrompt, setPreviewPrompt] = useState("");
  const [previewTitle, setPreviewTitle] = useState("提示词");
  const [previewBindings, setPreviewBindings] = useState<CanvasReferenceBinding[]>([]);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([{
    role: "assistant",
    content: "先在画布中选中要分析的素材，再选择功能并点击分析。分析结果确认后，才会创建一个提示词节点。",
  }]);
  const [mentionQuery, setMentionQuery] = useState<MentionQuery | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const handledMentionRevisionRef = useRef(0);
  const contextNodes = useMemo(() => nodes.slice(0, 120), [nodes]);
  const selectedNodes = useMemo(() => nodes.filter((node) => node.selected), [nodes]);
  const selectedImages = useMemo(() => selectedNodes.filter((node) => node.kind === "media" && node.mediaType === "image"), [selectedNodes]);
  const selectedVideos = useMemo(() => selectedNodes.filter((node) => node.kind === "media" && node.mediaType === "video"), [selectedNodes]);
  const mentionCandidates = useMemo(() => {
    if (!mentionQuery) return [];
    const query = mentionQuery.query.trim().toLowerCase();
    return contextNodes
      .filter((node) => node.kind !== "group")
      .filter((node) => !query || `${assistantMentionToken(node)} ${node.title} ${assistantNodeKindLabel(node)}`.toLowerCase().includes(query))
      .slice(0, 8);
  }, [contextNodes, mentionQuery]);
  const selectedImageOverflow = selectedImages.length > 4;
  const canPromptAnalyze = selectedImages.length > 0 && !selectedImageOverflow;
  const canReplaceAnalyze = selectedVideos.length === 1 && selectedImages.length > 0 && !selectedImageOverflow;
  const canAnalyze = activeModule === "prompt" ? canPromptAnalyze : canReplaceAnalyze;
  const selectionSignature = `${activeModule}:${contentDirection}:${selectedNodes.map((node) => node.id).sort().join(",")}`;

  useEffect(() => {
    // A changed selection or content direction invalidates the previous analysis.
    setPhase("idle");
    setPreviewPrompt("");
    setPreviewTitle("提示词");
    setPreviewBindings([]);
  }, [selectionSignature]);

  function resetPreview(nextModule = activeModule) {
    setActiveModule(nextModule);
    setPhase("idle");
    setPreviewPrompt("");
    setPreviewTitle("提示词");
    setPreviewBindings([]);
  }

  function updateInput(value: string, cursor: number) {
    setInput(value);
    const match = value.slice(0, cursor).match(/(?:^|\s)(@[^\s@]*)$/u);
    if (!match) {
      setMentionQuery(null);
      return;
    }
    setMentionQuery({ start: cursor - match[1].length, end: cursor, query: match[1].slice(1) });
    setMentionIndex(0);
  }

  const selectMention = useCallback((node: CanvasAssistantNodeContext) => {
    if (!mentionQuery) return;
    const token = assistantMentionToken(node);
    const next = `${input.slice(0, mentionQuery.start)}${token} ${input.slice(mentionQuery.end)}`;
    const cursor = mentionQuery.start + token.length + 1;
    setInput(next);
    setMentionQuery(null);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(cursor, cursor);
    });
  }, [input, mentionQuery]);

  useEffect(() => {
    onMentionModeChange(Boolean(mentionQuery));
  }, [mentionQuery, onMentionModeChange]);

  useEffect(() => () => onMentionModeChange(false), [onMentionModeChange]);

  useEffect(() => {
    if (!mentionQuery || !mentionSelection || mentionSelection.revision <= handledMentionRevisionRef.current) return;
    const node = contextNodes.find((candidate) => candidate.id === mentionSelection.nodeId);
    if (!node || node.kind === "group") return;
    handledMentionRevisionRef.current = mentionSelection.revision;
    selectMention(node);
  }, [contextNodes, mentionQuery, mentionSelection, selectMention]);

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!mentionQuery || !mentionCandidates.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setMentionIndex((current) => (current + (event.key === "ArrowDown" ? 1 : -1) + mentionCandidates.length) % mentionCandidates.length);
      return;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      selectMention(mentionCandidates[mentionIndex] || mentionCandidates[0]);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setMentionQuery(null);
    }
  }

  async function submitMessage(value: string, mode: AssistantModule, selectedIds: string[]) {
    const message = value.trim();
    if (!message || busyPhase(phase)) return;
    const nextMessages = [...messages, { role: "user" as const, content: message }];
    const selected = new Set(selectedIds);
    setMessages(nextMessages);
    setMentionQuery(null);
    setPhase("analyzing");
    try {
      const response = await fetchJsonWithCsrf<CanvasAssistantResponse>("/api/canvas/assistant", {
        method: "POST",
        body: JSON.stringify({
          message,
          canvasTitle,
          scope,
          assistantMode: mode === "prompt" ? "prompt-generation" : "reference-replacement",
          contentDirection,
          selectedNodeIds: selectedIds,
          nodes: contextNodes.map((node) => ({ ...node, selected: selected.has(node.id) })),
          history: nextMessages.slice(-8),
        }),
      });
      const normalized = normalizeCanvasAssistantResponse(response);
      const action = normalized.actions.find((candidate): candidate is PromptAction => candidate.type === "add_prompt");
      if (!action) throw new Error("助手没有返回可确认的提示词，请补充素材或要求后重试。");
      const promptAction: PromptAction = {
        ...action,
      };
      const bindings = buildReferenceBindings(mode, selectedImages, selectedVideos, "");
      const prompt = rebindPreviewReferences(promptAction.prompt, promptAction.referenceBindings || [], bindings);
      setPreviewTitle(promptAction.title || (mode === "prompt" ? "15 秒带货视频提示词" : "专业视频换物提示词"));
      setPreviewPrompt(prompt);
      setPreviewBindings(bindings);
      setMessages((current) => [...current, { role: "assistant", content: normalized.reply.slice(0, 240) }]);
      setPhase("preview");
    } catch (error) {
      setMessages((current) => [...current, { role: "assistant", content: error instanceof Error ? error.message : "助手暂时不可用，请稍后重试。" }]);
      setPhase("error");
    }
  }

  function analyzeCurrent() {
    if (!canAnalyze) return;
    const selectedIds = activeModule === "prompt"
      ? selectedImages.slice(0, 4).map((node) => node.id)
      : [...selectedVideos.map((node) => node.id), ...selectedImages.slice(0, 4).map((node) => node.id)];
    const extra = input.trim() ? `用户补充要求：${input.trim()}` : "没有额外要求。";
    const direction = contentDirections.find((item) => item.id === contentDirection)?.detail || "真人自然展示";
    const message = activeModule === "prompt"
      ? `只分析明确选中的产品图片，按“${direction}”制作一条 15 秒马来西亚 TikTok Shop 带货提示词。口播和画面内自然语言使用 Bahasa Melayu，表达贴近当地短视频习惯但不虚构商品事实。采用 0-2 秒钩子、2-7 秒核心价值、7-12 秒可见证据、12-15 秒行动的时间轴。输出素材职责、产品可见事实、时间轴、声音/口播和禁止项；只返回一个 add_prompt，不生成分镜，不开始生成视频。${extra}`
      : `只分析明确选中的 @Video 基础视频和 @Image 参考图，按马来西亚本地短视频表达生成一条局部换物提示词。@Video 只负责原视频动作、镜头和时间线，@Image 只负责目标物外观；只返回一个 add_prompt，不开始生成视频。${extra}`;
    void submitMessage(message, activeModule, selectedIds);
  }

  function createPromptNode() {
    if (phase !== "preview" || !previewPrompt.trim()) return;
    const sourceNodeIds = activeModule === "prompt"
      ? selectedImages.slice(0, 4).map((node) => node.id)
      : [...selectedVideos.slice(0, 1).map((node) => node.id), ...selectedImages.slice(0, 4).map((node) => node.id)];
    onApply([{
      type: "add_prompt",
      title: previewTitle,
      prompt: previewPrompt.trim(),
      sourceNodeIds,
      createVideoGenerator: true,
      ...(previewBindings.length ? { referenceBindings: previewBindings } : {}),
    }]);
    setPhase("created");
    setMessages((current) => [...current, { role: "assistant", content: "提示词和视频生成节点已创建，并已连接选中的素材；尚未开始生成。" }]);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    analyzeCurrent();
  }

  const phaseLabel = phase === "analyzing"
    ? "分析中"
    : phase === "preview"
      ? "可编辑预览"
      : phase === "created"
        ? "已创建"
        : phase === "error"
          ? "失败，可重新分析"
          : canAnalyze ? "待分析" : "待选素材";

  return (
    <aside className={`canvas-assistant${activeModule === "prompt" ? " is-commerce" : ""}`} aria-label="画布智能助手">
      <header className="canvas-assistant__header">
        <div><Bot /><span><strong>智能助手</strong><small>GPT-5.6 Sol · 仅限当前画布</small></span></div>
        <button type="button" className="canvas-icon-button" onClick={onClose} aria-label="关闭智能助手" title="关闭智能助手"><X /></button>
      </header>
      <div className="canvas-assistant__modules" role="tablist" aria-label="助手模块">
        <button type="button" role="tab" aria-selected={activeModule === "prompt"} className={activeModule === "prompt" ? "is-active" : undefined} onClick={() => resetPreview("prompt")}><WandSparkles /><span>提示词生成</span><small>15 秒带货短视频</small></button>
        <button type="button" role="tab" aria-selected={activeModule === "replace"} className={activeModule === "replace" ? "is-active" : undefined} onClick={() => resetPreview("replace")}><ImageIcon /><span>参考图替换</span><small>视频换物</small></button>
      </div>
      {activeModule === "prompt" ? <CanvasCommerceAssistant
        projectId={projectId}
        canvasTitle={canvasTitle}
        scope={scope}
        nodes={nodes}
        providers={providers}
        state={commerceState}
        libraryImages={libraryImages}
        onStateChange={onCommerceStateChange}
        onUploadImages={onUploadProductImages}
        onAddLibraryImage={onAddLibraryImage}
        onCreatePlans={onCreateCommercePlans}
      /> : <>
        <section className="canvas-assistant__module-panel" aria-label="参考图替换">
          <div className="canvas-assistant__module-heading"><div><strong>参考图替换</strong><span>分析、编辑、确认后创建连接好的节点</span></div><ImageIcon /></div>
          <div className="canvas-assistant__compact-controls">
            <SelectionSummary label="基础视频" nodes={selectedVideos} empty="未选中" limit={1} />
            <SelectionSummary label="参考图" nodes={selectedImages} empty="未选中" limit={4} />
          </div>
          {selectedVideos.length > 1 ? <p className="canvas-assistant__validation">参考图替换一次只能选择一个基础视频。</p> : null}
          {selectedImageOverflow ? <p className="canvas-assistant__validation">最多选择 4 张参考图片，请取消多余选择。</p> : null}
          <button type="button" className="canvas-assistant__analyze-action" disabled={phase === "analyzing" || !canReplaceAnalyze} onClick={analyzeCurrent}><Sparkles />分析换物提示词</button>
        </section>
        <div className="canvas-assistant__context"><span>当前状态</span><strong>{phaseLabel}</strong></div>
        {previewPrompt ? (
          <section className="canvas-assistant__preview" aria-label="提示词分析结果">
            <div className="canvas-assistant__preview-heading"><strong>分析结果</strong><span>可编辑</span></div>
            <textarea value={previewPrompt} onChange={(event) => setPreviewPrompt(event.target.value)} disabled={phase === "created"} aria-label="可编辑提示词预览" />
            <div className="canvas-assistant__bindings"><span>素材职责</span>{previewBindings.length ? previewBindings.map((binding) => <small key={`${binding.label}-${binding.role}`}>{binding.label} · {binding.role}{binding.transfer ? ` · ${binding.transfer}` : ""}</small>) : <small>助手未返回结构化职责，请在提示词中检查引用。</small>}</div>
            <button type="button" className="canvas-assistant__create-action" disabled={phase !== "preview" || !previewPrompt.trim()} onClick={createPromptNode}><Check />创建提示词和视频节点</button>
          </section>
        ) : null}
        {phase !== "preview" && phase !== "created" ? <div className="canvas-assistant__messages" aria-live="polite">
          {messages.map((message, index) => <div key={`${message.role}-${index}`} className={`canvas-assistant__message is-${message.role}`}>{message.role === "assistant" ? <Sparkles /> : null}<p>{message.content}</p></div>)}
          {phase === "analyzing" ? <div className="canvas-assistant__message is-assistant"><LoaderCircle className="is-spinning" /><p>正在读取已选素材并分析提示词…</p></div> : null}
        </div> : null}
        <form className="canvas-assistant__composer" onSubmit={submit}>
          {mentionQuery && mentionCandidates.length ? <div className="canvas-assistant__mentions" role="listbox" aria-label="引用画布节点">{mentionCandidates.map((node, index) => <button key={node.id} type="button" role="option" aria-selected={index === mentionIndex} className={index === mentionIndex ? "is-active" : undefined} onMouseDown={(event) => event.preventDefault()} onClick={() => selectMention(node)}><strong>{assistantMentionToken(node)}</strong><small>{assistantNodeKindLabel(node)} · {node.title}</small></button>)}</div> : null}
          <textarea ref={textareaRef} value={input} maxLength={1_200} onChange={(event) => updateInput(event.target.value, event.target.selectionStart)} onKeyDown={handleComposerKeyDown} placeholder="补充换物要求（可选）" aria-label="换物补充要求" aria-autocomplete="list" />
          <button type="submit" disabled={phase === "analyzing" || !canAnalyze} aria-label="分析换物提示词" title="分析换物提示词"><Send /></button>
        </form>
        <small className="canvas-assistant__scope">只分析明确选中的素材；节点创建后仍需你手动点击生成</small>
      </>}
    </aside>
  );
}

function busyPhase(phase: AssistantPhase) {
  return phase === "analyzing";
}

function SelectionSummary({ label, nodes, empty, limit }: { label: string; nodes: CanvasAssistantNodeContext[]; empty: string; limit: number }) {
  return <div className="canvas-assistant__selection"><span>{label}</span><strong>{nodes.length ? nodes.slice(0, limit).map((node) => node.title).join("、") : empty}</strong></div>;
}

function buildReferenceBindings(mode: AssistantModule, images: CanvasAssistantNodeContext[], videos: CanvasAssistantNodeContext[], generatorId: string): CanvasReferenceBinding[] {
  const imageBindings = images.slice(0, 4).map((node, index) => ({
    label: referenceLabel(node, generatorId, `@Image${index + 1}`),
    role: "product" as const,
    transfer: mode === "replace" ? "只转移参考图中的目标物外观、材质和颜色" : "只转移图片中真实可见的产品外观、材质和颜色",
    ignore: "不转移背景、动作、镜头或未提供的功效信息",
  }));
  if (mode === "prompt") return imageBindings;
  const videoBindings = videos.slice(0, 1).map((node) => ({
    label: referenceLabel(node, generatorId, "@Video1"),
    role: "motion" as const,
    transfer: "只保留基础视频中的动作、镜头和时间线",
    ignore: "不把基础视频中的原产品外观带入替换结果",
  }));
  return [...videoBindings, ...imageBindings];
}

function referenceLabel(node: CanvasAssistantNodeContext, generatorId: string, fallback: string) {
  return generatorId ? node.referenceLabels?.find((item) => item.generatorId === generatorId)?.label || fallback : fallback;
}

function rebindPreviewReferences(prompt: string, generated: CanvasReferenceBinding[], canonical: CanvasReferenceBinding[]) {
  const labels = new Map<string, string>();
  for (const type of ["Image", "Video"] as const) {
    const expected = canonical.filter((binding) => binding.label.startsWith(`@${type}`));
    const received = generated.filter((binding) => binding.label.startsWith(`@${type}`));
    received.forEach((binding, index) => {
      if (expected[index]) labels.set(binding.label, expected[index].label);
    });
    if (expected.length === 1) {
      prompt.match(new RegExp(`@${type}\\d+`, "g"))?.forEach((label) => labels.set(label, expected[0].label));
    }
  }
  return prompt.replace(/@(Image|Video)\d+/g, (label) => labels.get(label) || label);
}

function assistantMentionToken(node: CanvasAssistantNodeContext) {
  return node.referenceLabels?.[0]?.label || `@${node.title.replace(/\s+/gu, " ").trim()}`;
}

function assistantNodeKindLabel(node: CanvasAssistantNodeContext) {
  if (node.kind === "prompt") return "提示词";
  if (node.kind === "generator") return node.generationKind === "video" ? "视频生成" : "图片生成";
  if (node.mediaType === "video") return "视频";
  if (node.mediaType === "audio") return "音频";
  return "图片";
}
