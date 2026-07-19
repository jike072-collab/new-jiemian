"use client";

import { Bot, Check, LoaderCircle, Send, Sparkles, WandSparkles, X } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";

import { fetchJsonWithCsrf } from "@/lib/client/api";
import { normalizeCanvasAssistantResponse, type CanvasAssistantAction, type CanvasAssistantResponse } from "@/lib/canvas/assistant";

export type CanvasAssistantNodeContext = {
  id: string;
  kind: "prompt" | "media" | "generator";
  title: string;
  prompt?: string;
  selected?: boolean;
};

type Message = { role: "user" | "assistant"; content: string };

export function CanvasAssistantPanel({
  canvasTitle,
  nodes,
  onApply,
  onClose,
}: {
  canvasTitle: string;
  nodes: CanvasAssistantNodeContext[];
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
  const contextNodes = useMemo(() => nodes.slice(0, 120), [nodes]);

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    const message = input.trim();
    if (!message || busy) return;
    const nextMessages = [...messages, { role: "user" as const, content: message }];
    setMessages(nextMessages);
    setInput("");
    setBusy(true);
    setPendingActions([]);
    try {
      const response = await fetchJsonWithCsrf<CanvasAssistantResponse>("/api/canvas/assistant", {
        method: "POST",
        body: JSON.stringify({
          message,
          canvasTitle,
          nodes: contextNodes,
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

  function setQuickPrompt(value: string) {
    setInput(value);
  }

  return (
    <aside className="canvas-assistant" aria-label="画布智能助手">
      <header className="canvas-assistant__header">
        <div><Bot /><span><strong>智能助手</strong><small>GPT-5.5 · 仅限当前画布</small></span></div>
        <button type="button" className="canvas-icon-button" onClick={onClose} aria-label="关闭智能助手" title="关闭智能助手"><X /></button>
      </header>
      <div className="canvas-assistant__quick" aria-label="快捷请求">
        <button type="button" onClick={() => setQuickPrompt("根据当前画布主题，新增一个可直接用于生图的详细提示词。")}>写提示词</button>
        <button type="button" disabled={!selectedPrompt} onClick={() => setQuickPrompt("优化当前选中的提示词，保留原意并让它更适合生成。")}>优化选中</button>
        <button type="button" onClick={() => setQuickPrompt("按从左到右的创作流程整理当前画布节点。")}>整理画布</button>
      </div>
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
          <button type="button" onClick={() => { onApply(pendingActions); setPendingActions([]); }}><Check />应用到画布</button>
        </div>
      ) : null}
      <form className="canvas-assistant__composer" onSubmit={submit}>
        <textarea value={input} maxLength={1_200} onChange={(event) => setInput(event.target.value)} placeholder="只询问或操作当前画布" aria-label="给画布助手发送消息" />
        <button type="submit" disabled={busy || !input.trim()} aria-label="发送" title="发送"><Send /></button>
      </form>
      <small className="canvas-assistant__scope">不会访问账号、服务器、网页，也不会自动提交生成任务</small>
    </aside>
  );
}
