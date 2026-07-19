"use client";

import {
  AlertCircle,
  AtSign,
  Check,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Film,
  Image as ImageIcon,
  Layers3,
  LoaderCircle,
  Music,
  Play,
  Sparkles,
  Trash2,
  Type,
} from "lucide-react";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import {
  Handle,
  NodeResizer,
  Position,
  type Node,
  type NodeProps,
} from "@xyflow/react";

import type { EnabledProviders, WorkspacePublicProvider } from "@/components/studio/types";
import type { CanvasMediaType, CanvasNodeData } from "@/lib/canvas/types";
import { seedanceReferenceIssues } from "@/lib/seedance/prompt-guidance";
import { cn } from "@/lib/utils";
import { canvasImageCountLimit } from "@/lib/canvas/image-batch";

export type CanvasFlowNode = Node<CanvasNodeData, "canvas" | "group">;

export type GeneratorInputSummary = {
  prompts: number;
  images: number;
  videos: number;
  audios: number;
};

export type CanvasPromptReference = {
  label: string;
  mediaType: CanvasMediaType;
  title: string;
  url: string;
};

type CanvasNodeActions = {
  providers: EnabledProviders;
  internalCanvas: boolean;
  inputSummary: Record<string, GeneratorInputSummary>;
  inputPreviews: Record<string, Array<{ url: string; mediaType: CanvasMediaType; title: string }>>;
  promptReferences: Record<string, CanvasPromptReference[]>;
  updateNodeData: (id: string, patch: Partial<CanvasNodeData>) => void;
  removeNode: (id: string) => void;
  runGenerator: (id: string) => void;
  toggleGroup: (id: string) => void;
};

export const CanvasNodeActionsContext = createContext<CanvasNodeActions | null>(null);

const imageRatios = ["1:1", "16:9", "9:16", "4:3", "3:4"];
const imageQualities = ["1k", "2k", "4k"];

export function CanvasNode({ id, data, selected }: NodeProps<CanvasFlowNode>) {
  const actions = useCanvasNodeActions();
  const minWidth = data.kind === "media" ? 260 : 300;
  const minHeight = data.kind === "prompt" ? 210 : data.kind === "generator" ? 380 : data.mediaType === "audio" ? 180 : 220;

  return (
    <article data-canvas-node-id={id} className={cn("canvas-node", `canvas-node--${data.kind}`, selected && "is-selected")}>
      <NodeResizer
        color="var(--primary)"
        isVisible={selected}
        minWidth={minWidth}
        minHeight={minHeight}
        maxWidth={760}
        maxHeight={720}
      />
      {data.kind !== "prompt" ? <Handle type="target" position={Position.Left} id="input" className="canvas-node__handle" /> : null}
      <NodeHeader data={data} onRemove={() => actions.removeNode(id)} />
      {data.kind === "prompt" ? <PromptNode id={id} data={data} /> : null}
      {data.kind === "media" ? <MediaNode data={data} /> : null}
      {data.kind === "generator" ? <GeneratorNode id={id} data={data} /> : null}
      <Handle type="source" position={Position.Right} id="output" className="canvas-node__handle" />
    </article>
  );
}

export function CanvasGroupNode({ id, data, selected }: NodeProps<CanvasFlowNode>) {
  const actions = useCanvasNodeActions();
  const collapsed = Boolean(data.collapsed);
  return (
    <section className={cn("canvas-node-group", selected && "is-selected", collapsed && "is-collapsed")}>
      <NodeResizer
        color="var(--primary)"
        isVisible={selected && !collapsed}
        minWidth={360}
        minHeight={280}
        maxWidth={2_400}
        maxHeight={1_800}
      />
      <header className="canvas-node-group__header">
        <Layers3 />
        <strong>{data.title}</strong>
        <button type="button" className="canvas-node__icon-button nodrag" onClick={() => actions.toggleGroup(id)} title={collapsed ? "展开分组" : "折叠分组"} aria-label={collapsed ? "展开分组" : "折叠分组"}>
          {collapsed ? <ChevronRight /> : <ChevronDown />}
        </button>
      </header>
    </section>
  );
}

function NodeHeader({ data, onRemove }: { data: CanvasNodeData; onRemove: () => void }) {
  const Icon = data.kind === "prompt"
    ? Type
    : data.kind === "media"
      ? data.mediaType === "video" ? Film : data.mediaType === "audio" ? Music : ImageIcon
      : data.generationKind === "video" ? Film : Sparkles;
  return (
    <header className="canvas-node__header">
      <span className="canvas-node__type-icon" aria-hidden="true"><Icon /></span>
      <strong title={data.title}>{data.title}</strong>
      <button type="button" className="canvas-node__icon-button nodrag" aria-label="删除节点" title="删除节点" onClick={onRemove}>
        <Trash2 />
      </button>
    </header>
  );
}

function PromptNode({ id, data }: { id: string; data: CanvasNodeData }) {
  const actions = useCanvasNodeActions();
  const references = actions.promptReferences[id] || [];
  const value = data.prompt || "";
  const referenceIssues = seedanceReferenceIssues(value, references.map((reference) => reference.label));
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const promptWrapRef = useRef<HTMLDivElement | null>(null);
  const promptCursorRef = useRef(value.length);
  const [mentionContext, setMentionContext] = useState<{ start: number; end: number; query: string } | null>(null);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const filteredReferences = mentionContext
    ? references.filter((reference) => reference.label.toLowerCase().includes(mentionContext.query.toLowerCase()))
    : [];
  const mentionOpen = Boolean(mentionContext && filteredReferences.length);

  useEffect(() => {
    if (!mentionOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!promptWrapRef.current?.contains(event.target as globalThis.Node)) setMentionContext(null);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [mentionOpen]);

  const updateMentionContext = (nextValue: string, cursor: number) => {
    const prefix = nextValue.slice(0, cursor);
    const atIndex = prefix.lastIndexOf("@");
    const query = atIndex >= 0 ? prefix.slice(atIndex + 1) : "";
    if (atIndex < 0 || !/^[A-Za-z0-9]*$/.test(query) || !references.length) {
      setMentionContext(null);
      return;
    }
    setMentionContext({ start: atIndex, end: cursor, query });
    setActiveMentionIndex(0);
  };

  const focusPromptAt = (cursor: number) => {
    promptCursorRef.current = cursor;
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(cursor, cursor);
    });
  };

  const insertReference = (label: string) => {
    if (!mentionContext) return;
    const token = `@${label}`;
    const suffix = value.slice(mentionContext.end);
    const trailingSpace = suffix && /^\s/.test(suffix) ? "" : " ";
    const nextValue = `${value.slice(0, mentionContext.start)}${token}${trailingSpace}${suffix}`;
    const cursor = mentionContext.start + token.length + trailingSpace.length;
    actions.updateNodeData(id, { prompt: nextValue });
    setMentionContext(null);
    focusPromptAt(cursor);
  };

  const openReferenceMenu = () => {
    if (!references.length) return;
    const cursor = Math.min(promptCursorRef.current, value.length);
    const needsLeadingSpace = cursor > 0 && !/\s/.test(value[cursor - 1]);
    const insertion = `${needsLeadingSpace ? " " : ""}@`;
    const nextValue = `${value.slice(0, cursor)}${insertion}${value.slice(cursor)}`;
    const start = cursor + (needsLeadingSpace ? 1 : 0);
    actions.updateNodeData(id, { prompt: nextValue });
    setMentionContext({ start, end: start + 1, query: "" });
    setActiveMentionIndex(0);
    focusPromptAt(start + 1);
  };

  return (
    <div className="canvas-node__body canvas-node__body--prompt">
      <div ref={promptWrapRef} className="canvas-node__prompt-editor">
        <textarea
          ref={textareaRef}
          className="canvas-node__textarea nodrag nowheel"
          value={value}
          maxLength={30_000}
          aria-label="提示词"
          placeholder="输入画面或镜头描述"
          onChange={(event) => {
            const nextValue = event.target.value;
            actions.updateNodeData(id, { prompt: nextValue });
            updateMentionContext(nextValue, event.target.selectionStart ?? nextValue.length);
          }}
          onSelect={(event) => {
            promptCursorRef.current = event.currentTarget.selectionStart ?? event.currentTarget.value.length;
          }}
          onKeyDown={(event) => {
            if (!mentionOpen) return;
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const direction = event.key === "ArrowDown" ? 1 : -1;
              setActiveMentionIndex((current) => (current + direction + filteredReferences.length) % filteredReferences.length);
              return;
            }
            if (event.key === "Enter" || event.key === "Tab") {
              event.preventDefault();
              insertReference(filteredReferences[activeMentionIndex]?.label || filteredReferences[0].label);
              return;
            }
            if (event.key === "Escape") {
              event.preventDefault();
              setMentionContext(null);
            }
          }}
        />
        {mentionOpen ? (
          <div className="canvas-prompt-reference-menu" role="listbox" aria-label="选择参考素材">
            {filteredReferences.map((reference, index) => (
              <button
                key={`${reference.label}-${reference.title}`}
                type="button"
                className={cn("canvas-prompt-reference-option", index === activeMentionIndex && "is-active", "nodrag")}
                role="option"
                aria-selected={index === activeMentionIndex}
                onMouseEnter={() => setActiveMentionIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => insertReference(reference.label)}
              >
                <span className="canvas-prompt-reference-option__preview" aria-hidden="true">
                  {reference.mediaType === "video" ? <Film /> : reference.mediaType === "audio" ? <Music /> : <ImageIcon />}
                </span>
                <span className="canvas-prompt-reference-option__copy">
                  <strong>{reference.label}</strong>
                  <small>{reference.title}</small>
                </span>
              </button>
            ))}
          </div>
        ) : null}
        <div className="canvas-node__prompt-footer">
          {references.length ? <span className="canvas-node__mention-hint">输入 @ 引用素材</span> : null}
          <span className="canvas-node__counter">{value.length}</span>
          {references.length ? (
            <button type="button" className="canvas-node__mention-trigger nodrag" aria-label="插入参考素材" title="插入参考素材" onClick={openReferenceMenu}>
              <AtSign />
            </button>
          ) : null}
        </div>
      </div>
      {data.referenceBindings?.length ? (
        <div className="canvas-node__reference-bindings" aria-label="引用职责">
          {data.referenceBindings.map((binding) => <span key={`${binding.label}-${binding.role}`} title={`${binding.transfer || binding.role}${binding.ignore ? `；不转移：${binding.ignore}` : ""}`}>{binding.label} · {referenceRoleLabel(binding.role)}</span>)}
        </div>
      ) : null}
      {referenceIssues.missing.length ? <div className="canvas-node__reference-warning">未连接：{referenceIssues.missing.join("、")}</div> : null}
      {value && /@(Image|Video|Audio)\d+\b/i.test(value) && referenceIssues.unused.length ? <div className="canvas-node__reference-warning is-muted">未指定职责：{referenceIssues.unused.join("、")}</div> : null}
    </div>
  );
}

function referenceRoleLabel(role: NonNullable<CanvasNodeData["referenceBindings"]>[number]["role"]) {
  return {
    identity: "身份",
    "first-frame": "首帧",
    "last-frame": "尾帧",
    product: "产品",
    environment: "环境",
    motion: "动作",
    camera: "运镜",
    timing: "节奏",
    audio: "音频",
    style: "风格",
  }[role];
}

function MediaNode({ data }: { data: CanvasNodeData }) {
  const pending = data.status === "queued" || data.status === "generating";
  return (
    <div className="canvas-node__body canvas-node__body--media">
      {data.mediaUrl && data.mediaType === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element -- generated media URLs are authenticated runtime assets.
        <img src={data.mediaUrl} alt={data.title} draggable={false} />
      ) : null}
      {data.mediaUrl && data.mediaType === "video" ? (
        <video src={data.mediaUrl} controls preload="metadata" className="nodrag nowheel" />
      ) : null}
      {data.mediaUrl && data.mediaType === "audio" ? (
        <audio src={data.mediaUrl} controls preload="metadata" className="nodrag nowheel" />
      ) : null}
      {!data.mediaUrl ? (
        <div className="canvas-node__media-placeholder">
          {pending ? <LoaderCircle className="is-spinning" /> : <AlertCircle />}
          <span>{pending ? "生成中" : "媒体暂不可用"}</span>
        </div>
      ) : null}
      <StatusLine status={data.status} progress={data.progress} error={data.error} />
    </div>
  );
}

function GeneratorNode({ id, data }: { id: string; data: CanvasNodeData }) {
  const actions = useCanvasNodeActions();
  const isVideo = data.generationKind === "video";
  const providers = (isVideo ? actions.providers.video : actions.providers.image) as WorkspacePublicProvider[];
  const selectedProvider = providers.find((provider) => provider.id === data.providerId) || providers[0];
  const videoOptions = selectedProvider?.videoOptions;
  const ratios = isVideo && videoOptions?.ratios?.length ? videoOptions.ratios : isVideo ? ["16:9", "9:16", "1:1"] : imageRatios;
  const durations = videoOptions?.durations?.length ? videoOptions.durations : [5, 10, 15];
  const resolutions = videoOptions?.resolutions?.length
    ? videoOptions.resolutions
    : [videoOptions?.resolution || "720p"];
  const selectedRatio = ratios.includes(data.ratio || "") ? data.ratio : ratios[0];
  const selectedDuration = durations.includes(data.duration || 0) ? data.duration : durations[0];
  const selectedResolution = resolutions.includes(data.resolution || "") ? data.resolution : resolutions[0];
  const imageMode = data.imageMode === "image-to-image" ? "image-to-image" : "text-to-image";
  const maxImageCount = canvasImageCountLimit(actions.internalCanvas);
  const imageCount = Math.min(Math.max(Math.round(Number(data.count) || 1), 1), maxImageCount);
  const busy = data.status === "queued" || data.status === "generating";
  const summary = actions.inputSummary[id] || { prompts: 0, images: 0, videos: 0, audios: 0 };
  const previews = actions.inputPreviews[id] || [];
  const [previewOpen, setPreviewOpen] = useState(false);

  return (
    <div className="canvas-node__body canvas-node__body--generator">
      {!isVideo ? (
        <div className="canvas-node__mode-tabs nodrag" role="tablist" aria-label="图片生成模式">
          <button type="button" role="tab" aria-selected={imageMode === "text-to-image"} className={imageMode === "text-to-image" ? "is-active" : undefined} disabled={busy} onClick={() => actions.updateNodeData(id, { imageMode: "text-to-image" })}><Type />文生图</button>
          <button type="button" role="tab" aria-selected={imageMode === "image-to-image"} className={imageMode === "image-to-image" ? "is-active" : undefined} disabled={busy} onClick={() => actions.updateNodeData(id, { imageMode: "image-to-image" })}><ImageIcon />图生图</button>
        </div>
      ) : null}
      <label className="canvas-node__field">
        <span>模型</span>
        <select
          className="nodrag nowheel"
          value={selectedProvider?.id || ""}
          disabled={busy || !providers.length}
          onChange={(event) => {
            const provider = providers.find((item) => item.id === event.target.value);
            const options = provider?.videoOptions;
            actions.updateNodeData(id, {
              providerId: event.target.value,
              model: provider?.model || "",
              ...(isVideo ? {
                duration: options?.durations?.[0] || data.duration || 5,
                ratio: options?.ratios?.[0] || data.ratio || "16:9",
                resolution: options?.resolutions?.[0] || options?.resolution || data.resolution || "720p",
              } : {}),
            });
          }}
        >
          {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.displayName}</option>)}
        </select>
      </label>

      <div className={cn("canvas-node__field-grid", !isVideo && "is-image")}>
        <label className="canvas-node__field">
          <span>比例</span>
          <select className="nodrag nowheel" value={selectedRatio} disabled={busy} onChange={(event) => actions.updateNodeData(id, { ratio: event.target.value })}>
            {ratios.map((ratio) => <option key={ratio} value={ratio}>{ratio}</option>)}
          </select>
        </label>
        {!isVideo ? (
          <label className="canvas-node__field">
            <span>清晰度</span>
            <select className="nodrag nowheel" value={data.quality || "1k"} disabled={busy} onChange={(event) => actions.updateNodeData(id, { quality: event.target.value })}>
              {imageQualities.map((quality) => <option key={quality} value={quality}>{quality.toUpperCase()}</option>)}
            </select>
          </label>
        ) : (
          <label className="canvas-node__field">
            <span>时长</span>
            <select className="nodrag nowheel" value={String(selectedDuration)} disabled={busy} onChange={(event) => actions.updateNodeData(id, { duration: Number(event.target.value) })}>
              {durations.map((duration) => <option key={duration} value={duration}>{duration} 秒</option>)}
            </select>
          </label>
        )}
        {!isVideo ? (
          <label className="canvas-node__field">
            <span>数量</span>
            <select className="nodrag nowheel" value={String(imageCount)} disabled={busy} onChange={(event) => actions.updateNodeData(id, { count: Number(event.target.value) })}>
              {Array.from({ length: maxImageCount }, (_, index) => index + 1).map((count) => <option key={count} value={count}>{count} 张</option>)}
            </select>
          </label>
        ) : null}
      </div>

      {isVideo ? (
        <label className="canvas-node__field">
          <span>分辨率</span>
          <select className="nodrag nowheel" value={selectedResolution} disabled={busy} onChange={(event) => actions.updateNodeData(id, { resolution: event.target.value })}>
            {resolutions.map((resolution) => <option key={resolution} value={resolution}>{resolution}</option>)}
          </select>
        </label>
      ) : null}

      <div className="canvas-node__inputs" aria-label="已连接输入">
        <span>{summary.prompts} 个提示词</span>
        <span>{summary.images} 张图片</span>
        {isVideo ? <span>{summary.videos} 个视频</span> : null}
        {isVideo && summary.audios ? <span>{summary.audios} 个音频</span> : null}
      </div>
      {previews.length ? (
        <div className="canvas-node__preview">
          <button type="button" className="canvas-node__preview-toggle nodrag" onClick={() => setPreviewOpen((value) => !value)}>
            {previewOpen ? <EyeOff /> : <Eye />}
            <span>{previewOpen ? "关闭预览" : `预览 ${previews.length}`}</span>
          </button>
          {previewOpen ? (
            <div className="canvas-node__preview-strip" aria-label="请求素材预览">
              {previews.map((item, index) => (
                <figure key={`${item.url}-${index}`} className="canvas-node__preview-item">
                  {item.mediaType === "video" ? (
                    <video src={item.url} muted playsInline preload="metadata" />
                  ) : item.mediaType === "audio" ? (
                    <Music aria-hidden="true" />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element -- generated media URLs are authenticated runtime assets.
                    <img src={item.url} alt={item.title} draggable={false} />
                  )}
                  <figcaption title={item.title}>{item.title}</figcaption>
                </figure>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {!isVideo && imageMode === "image-to-image" && summary.images < 1 ? <div className="canvas-node__mode-warning">请连接至少一张参考图</div> : null}

      <StatusLine status={data.status} progress={data.progress} error={data.error} />
      <button
        type="button"
        className="canvas-node__generate nodrag"
        disabled={busy || !selectedProvider || summary.prompts < 1 || (!isVideo && imageMode === "image-to-image" && summary.images < 1)}
        onClick={() => actions.runGenerator(id)}
      >
        {busy ? <LoaderCircle className="is-spinning" /> : <Play />}
        <span>{busy ? "生成中" : "开始生成"}</span>
      </button>
    </div>
  );
}

function StatusLine({ status, progress, error }: Pick<CanvasNodeData, "status" | "progress" | "error">) {
  if (!status || status === "idle") return null;
  const Icon = status === "done" ? Check : status === "failed" ? AlertCircle : LoaderCircle;
  const label = status === "done"
    ? "已完成"
    : status === "failed"
      ? "生成失败"
      : status === "queued" ? "排队中" : "生成中";
  return (
    <div className={cn("canvas-node__status", `is-${status}`)} title={error || label}>
      <Icon className={status === "queued" || status === "generating" ? "is-spinning" : undefined} />
      <span>{error || label}</span>
      {typeof progress === "number" && status !== "done" && status !== "failed" ? <strong>{Math.round(progress)}%</strong> : null}
    </div>
  );
}

function useCanvasNodeActions() {
  const value = useContext(CanvasNodeActionsContext);
  if (!value) throw new Error("Canvas node actions are unavailable.");
  return value;
}
