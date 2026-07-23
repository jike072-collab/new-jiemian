"use client";

import { Bot, Check, LoaderCircle, Send, Sparkles, WandSparkles, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import { fetchJsonWithCsrf } from "@/lib/client/api";
import { normalizeCanvasAssistantResponse, type CanvasAssistantAction, type CanvasAssistantResponse } from "@/lib/canvas/assistant";
import type { CanvasMediaType, CanvasReferenceBinding, CanvasSequenceState } from "@/lib/canvas/types";
import { seedanceTemplates } from "@/lib/seedance/templates";

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

export function CanvasAssistantPanel({
  canvasTitle,
  scope,
  nodes,
  mentionSelection,
  onMentionModeChange,
  onApply,
  onClose,
}: {
  canvasTitle: string;
  scope: "personal" | "shared";
  nodes: CanvasAssistantNodeContext[];
  mentionSelection: { nodeId: string; revision: number } | null;
  onMentionModeChange: (active: boolean) => void;
  onApply: (actions: CanvasAssistantAction[]) => void;
  onClose: () => void;
}) {
  const selectedPrompt = nodes.find((node) => node.selected && node.kind === "prompt")?.prompt || "";
  const [messages, setMessages] = useState<Message[]>([{
    role: "assistant",
    content: "我只处理当前画布。可以让我写提示词、改写选中的提示词，或整理节点布局。",
  }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingActions, setPendingActions] = useState<CanvasAssistantAction[]>([]);
  const [mentionQuery, setMentionQuery] = useState<MentionQuery | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionedNodeIds, setMentionedNodeIds] = useState<string[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const handledMentionRevisionRef = useRef(0);
  const contextNodes = useMemo(() => nodes.slice(0, 120), [nodes]);
  const selectedNodes = useMemo(() => nodes.filter((node) => node.selected), [nodes]);
  const mentionedNodes = useMemo(() => nodes.filter((node) => mentionedNodeIds.includes(node.id)), [mentionedNodeIds, nodes]);
  const mentionCandidates = useMemo(() => {
    if (!mentionQuery) return [];
    const query = mentionQuery.query.trim().toLowerCase();
    return contextNodes
      .filter((node) => node.kind !== "group")
      .filter((node) => {
        if (!query) return true;
        return `${assistantMentionToken(node)} ${node.title} ${assistantNodeKindLabel(node)}`.toLowerCase().includes(query);
      })
      .slice(0, 8);
  }, [contextNodes, mentionQuery]);
  const generatorCount = useMemo(() => nodes.filter((node) => node.kind === "generator").length, [nodes]);
  const contextLabel = mentionedNodes.length
    ? `已引用 ${mentionedNodes.length} 个：${mentionedNodes.slice(0, 2).map((node) => node.title).join("、")}${mentionedNodes.length > 2 ? "…" : ""}`
    : selectedNodes.length
    ? `已选 ${selectedNodes.length} 个：${selectedNodes.slice(0, 2).map((node) => node.title).join("、")}${selectedNodes.length > 2 ? "…" : ""}`
    : generatorCount === 1 ? "自动使用唯一生成链路" : `全画布 ${generatorCount} 条生成链路`;

  function updateInput(value: string, cursor: number) {
    setInput(value);
    setMentionedNodeIds((current) => current.filter((id) => {
      const node = nodes.find((candidate) => candidate.id === id);
      return Boolean(node && value.includes(assistantMentionToken(node)));
    }));
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
    setMentionedNodeIds((current) => current.includes(node.id) ? current : [...current, node.id]);
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

  async function submitMessage(value: string) {
    const message = value.trim();
    if (!message || busy) return;
    const nextMessages = [...messages, { role: "user" as const, content: message }];
    const mentioned = new Set(mentionedNodeIds);
    setMessages(nextMessages);
    setInput("");
    setMentionQuery(null);
    setMentionedNodeIds([]);
    setBusy(true);
    setPendingActions([]);
    try {
      const response = await fetchJsonWithCsrf<CanvasAssistantResponse>("/api/canvas/assistant", {
        method: "POST",
        body: JSON.stringify({
          message,
          canvasTitle,
          scope,
          nodes: contextNodes.map((node) => ({
            ...node,
            selected: mentioned.size ? mentioned.has(node.id) : node.selected,
          })),
          history: nextMessages.slice(-8),
        }),
      });
      const normalized = normalizeCanvasAssistantResponse(response);
      setMessages((current) => [...current, { role: "assistant", content: normalized.reply }]);
      setPendingActions(normalized.actions);
    } catch (error) {
      setMessages((current) => [...current, {
        role: "assistant",
        content: error instanceof Error ? error.message : "助手暂时不可用，请稍后重试。",
      }]);
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void submitMessage(input);
  }

  return (
    <aside className="canvas-assistant" aria-label="画布智能助手">
      <header className="canvas-assistant__header">
        <div><Bot /><span><strong>智能助手</strong><small>GPT-5.6 Luna · 仅限当前画布</small></span></div>
        <button type="button" className="canvas-icon-button" onClick={onClose} aria-label="关闭智能助手" title="关闭智能助手"><X /></button>
      </header>
      <div className="canvas-assistant__quick" aria-label="快捷请求">
        <button type="button" disabled={busy} onClick={() => { void submitMessage("分析当前画布已经连接的素材和生成参数，新增一条专业、完整、可直接生成的提示词；使用准确引用标签，写清必须保留、需要改变和禁止变化的内容。"); }}>专业提示词</button>
        <button type="button" disabled={busy} onClick={() => { void submitMessage("根据当前选中或已连接的素材，写一条用于马来西亚 TikTok Shop 的带货短视频提示词。按当前视频时长安排开场钩子、一个核心价值、可信证据和结尾行动，不虚构素材中没有的卖点；只创建提示词，不要开始生成。"); }}>带货短视频</button>
        <button type="button" disabled={busy || !selectedPrompt} onClick={() => { void submitMessage("优化当前选中的提示词，保留原意并让它更适合生成。"); }}>优化选中</button>
        <button type="button" disabled={busy} onClick={() => { void submitMessage("按从左到右的创作流程整理当前画布节点。"); }}>整理画布</button>
        <button type="button" disabled={busy} onClick={() => { void submitMessage("把当前故事拆成 3-5 个 Seedance 分镜节点，分别生成提示词和视频生成节点。"); }}>生成分镜</button>
      </div>
      <div className="canvas-assistant__context" title={(mentionedNodes.length ? mentionedNodes : selectedNodes).map((node) => node.title).join("、") || contextLabel}>
        <span>分析范围</span><strong>{contextLabel}</strong>
      </div>
      <label className="canvas-assistant__template">
        <span>Seedance 模板</span>
        <select
          aria-label="选择 Seedance 模板"
          defaultValue=""
          onChange={(event) => {
            const template = seedanceTemplates.find((item) => item.id === event.target.value);
            if (template) setInput(template.prompt);
            event.currentTarget.value = "";
          }}
        >
          <option value="">选择模板</option>
          {seedanceTemplates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
        </select>
      </label>
      <div className="canvas-assistant__messages" aria-live="polite">
        {messages.map((message, index) => (
          <div key={`${message.role}-${index}`} className={`canvas-assistant__message is-${message.role}`}>
            {message.role === "assistant" ? <Sparkles /> : null}
            <p>{message.content}</p>
          </div>
        ))}
        {busy ? <div className="canvas-assistant__message is-assistant"><LoaderCircle className="is-spinning" /><p>正在分析当前画布…</p></div> : null}
      </div>
      {pendingActions.length ? (
        <div className="canvas-assistant__actions">
          <span><WandSparkles />建议执行 {pendingActions.length} 项画布操作</span>
          <button type="button" onClick={() => {
            const count = pendingActions.length;
            onApply(pendingActions);
            setPendingActions([]);
            setMessages((current) => [...current, { role: "assistant", content: `已应用 ${count} 项操作，画布未自动开始生成。` }]);
          }}><Check />应用到画布</button>
        </div>
      ) : null}
      <form className="canvas-assistant__composer" onSubmit={submit}>
        {mentionQuery && mentionCandidates.length ? (
          <div className="canvas-assistant__mentions" role="listbox" aria-label="引用画布节点">
            {mentionCandidates.map((node, index) => (
              <button
                key={node.id}
                type="button"
                role="option"
                aria-selected={index === mentionIndex}
                className={index === mentionIndex ? "is-active" : undefined}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectMention(node)}
              >
                <strong>{assistantMentionToken(node)}</strong>
                <small>{assistantNodeKindLabel(node)} · {node.title}</small>
              </button>
            ))}
          </div>
        ) : null}
        <textarea
          ref={textareaRef}
          value={input}
          maxLength={1_200}
          onChange={(event) => updateInput(event.target.value, event.target.selectionStart)}
          onKeyDown={handleComposerKeyDown}
          placeholder="输入 @ 引用画布节点"
          aria-label="给画布助手发送消息"
          aria-autocomplete="list"
        />
        <button type="submit" disabled={busy || !input.trim()} aria-label="发送" title="发送"><Send /></button>
      </form>
      <small className="canvas-assistant__scope">不会访问账号、服务器、网页，也不会自动提交生成任务</small>
    </aside>
  );
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
