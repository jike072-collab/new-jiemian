"use client";

/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { AtSign, FileAudio2, ImagePlus, Loader2, Video, X } from "lucide-react";

import { featuredVideoPromptTemplates } from "@/lib/template-catalog";
import { isSeedance20VideoModel } from "@/lib/seedance-model-display";
import type { FrontendProvider } from "@/lib/server/types";
import type { WorkspaceVideoMode } from "@/lib/workspace-registry";
import { TemplateRail } from "@/components/template-center";
import {
  formatQuotaSymbolLabel,
  promptOptimizationCostLabel,
  videoModelReferenceMessage,
  videoWorkspaceModeMeta,
} from "@/components/studio/constants";
import {
  AspectRatioSelector,
  CompactDropzone,
  CustomSelect,
  FieldFrame,
  FormPanel,
  ProviderSelect,
  StackedControl,
  StickyPrimaryAction,
  StudioErrorAlert,
  SubmitButton,
} from "@/components/studio/shared";
import type { MobileActionState, VideoWorkspaceFile, VideoWorkspaceState, WorkspacePublicProvider, WorkspaceVideoOptions } from "@/components/studio/types";
import { PromptSettingsButton, usePromptPreferences } from "@/components/studio/prompt-settings";
import type { PromptPreferences } from "@/lib/prompt-preferences";
import { cn } from "@/lib/utils";

export function VideoGenerator({
  mode,
  providers,
  providersLoading,
  providersError,
  selectedProvider,
  templateCenterHref,
  state,
  canSubmit,
  estimatedQuotaUnits,
  costLabel,
  onProviderChange,
  onRatioChange,
  onDurationChange,
  onResolutionChange,
  onTemplateChange,
  onPromptChange,
  onPromptOptimize,
  onPromptOptimizeUndo,
  promptOptimizeCostLabel,
  onFilesChange,
  onFrameFileChange,
  onFileRemove,
  onFilesClear,
  referenceMode,
  supportsFirstLastFrame,
  onReferenceModeChange,
  ratioOptions,
  durationOptions,
  resolutionOptions,
  referenceOptions,
  modelRequiresImage,
  onReloadProviders,
  onSubmit,
  registerMobileAction,
}: {
  mode: WorkspaceVideoMode;
  providers: FrontendProvider[];
  providersLoading: boolean;
  providersError: string;
  selectedProvider: WorkspacePublicProvider | null;
  templateCenterHref: string;
  state: VideoWorkspaceState;
  canSubmit: boolean;
  estimatedQuotaUnits: number;
  costLabel?: string;
  onProviderChange: (value: string) => void;
  onRatioChange: (value: string) => void;
  onDurationChange: (value: number) => void;
  onResolutionChange: (value: string) => void;
  onTemplateChange: (value: string) => void;
  onPromptChange: (value: string) => void;
  onPromptOptimize: (preferences: PromptPreferences) => void;
  onPromptOptimizeUndo: () => void;
  promptOptimizeCostLabel?: string;
  onFilesChange: (mediaType: VideoWorkspaceFile["mediaType"], files: File[]) => void;
  onFrameFileChange: (frameRole: "first" | "last", file: File) => void;
  onFileRemove: (mediaType: VideoWorkspaceFile["mediaType"], index: number) => void;
  onFilesClear: (mediaType: VideoWorkspaceFile["mediaType"]) => void;
  referenceMode: VideoWorkspaceState["referenceMode"];
  supportsFirstLastFrame: boolean;
  onReferenceModeChange: (mode: VideoWorkspaceState["referenceMode"]) => void;
  ratioOptions: string[];
  durationOptions: number[];
  resolutionOptions: string[];
  referenceOptions?: WorkspaceVideoOptions;
  modelRequiresImage: boolean;
  onReloadProviders: () => Promise<void>;
  onSubmit: () => void;
  registerMobileAction: (action: MobileActionState) => void;
}) {
  const meta = videoWorkspaceModeMeta[mode];
  const durationMin = durationOptions[0] ?? state.duration;
  const durationMax = durationOptions[durationOptions.length - 1] ?? state.duration;
  const durationMidpoint = Math.round((durationMin + durationMax) / 2);
  const durationProgress = durationMax > durationMin
    ? ((state.duration - durationMin) / (durationMax - durationMin)) * 100
    : 0;
  const useDurationSlider = selectedProvider?.model.toLowerCase() === "sdquan-2-miao" && durationOptions.length > 1;
  const durationField = (
    <FieldFrame label="时长" required>
      {useDurationSlider ? (
        <div
          className="studio-duration-slider"
          style={{ "--studio-duration-progress": `${durationProgress}%` } as CSSProperties}
        >
          <div className="studio-duration-slider__track-group">
            <input
              id="studio-video-duration"
              type="range"
              min={durationMin}
              max={durationMax}
              step={1}
              value={state.duration}
              aria-label="视频时长"
              aria-valuetext={`${state.duration} 秒`}
              onInput={(event) => onDurationChange(Number(event.currentTarget.value))}
            />
            <div className="studio-duration-slider__ticks" aria-hidden="true">
              <span>{durationMin}</span>
              <span>{durationMidpoint}</span>
              <span>{durationMax}</span>
            </div>
          </div>
          <output className="studio-duration-slider__value" htmlFor="studio-video-duration">
            <strong>{state.duration}</strong>
            <span>秒</span>
          </output>
        </div>
      ) : (
        <CustomSelect
          label="时长"
          value={String(state.duration)}
          options={durationOptions.map((value) => ({
            value: String(value),
            label: `${value} 秒`,
          }))}
          onChange={(value) => onDurationChange(Number(value))}
        />
      )}
    </FieldFrame>
  );

  useEffect(() => {
    registerMobileAction({
      label: state.loading ? meta.loadingLabel : meta.submitLabel,
      costLabel: costLabel || formatQuotaSymbolLabel(estimatedQuotaUnits),
      loading: state.loading,
      disabled: !canSubmit,
      onClick: onSubmit,
    });
    return () => registerMobileAction(null);
  }, [canSubmit, costLabel, estimatedQuotaUnits, meta.loadingLabel, meta.submitLabel, onSubmit, registerMobileAction, state.loading]);

  return (
    <FormPanel>
      <ProviderSelect
        providers={providers}
        value={selectedProvider?.id || state.providerId}
        loading={providersLoading}
        error={providersError}
        onChange={onProviderChange}
        onReload={onReloadProviders}
      />
      <TemplateRail
        scope="video"
        title="模板"
        viewAllHref={templateCenterHref}
        templates={featuredVideoPromptTemplates}
        activeTemplateId={state.templateId}
        onSelect={(template) => onTemplateChange(template.id)}
      />
      <VideoReferenceInput
        files={state.files}
        error={state.fileError}
        label={meta.uploadLabel}
        mode={mode}
        emptyTitle={meta.uploadEmptyTitle}
        filledTitle={meta.uploadFilledTitle}
        helpText={meta.uploadHelpText}
        required={modelRequiresImage || meta.uploadRequired}
        referenceMode={referenceMode}
        supportsFirstLastFrame={supportsFirstLastFrame}
        onReferenceModeChange={onReferenceModeChange}
        onChange={onFilesChange}
        onFrameFileChange={onFrameFileChange}
        onRemove={onFileRemove}
        onClear={onFilesClear}
        referenceOptions={referenceOptions}
      />
      {modelRequiresImage && !state.files.length && !state.fileError ? (
        <p className="studio-help-text">{videoModelReferenceMessage}</p>
      ) : null}
      <StackedControl label="比例" required>
        <AspectRatioSelector label="比例" value={state.ratio} options={ratioOptions} onChange={onRatioChange} />
      </StackedControl>
      {resolutionOptions.length > 1 ? (
        <div className="studio-dual-fields">
          {durationField}
          <FieldFrame label="清晰度" required>
            <CustomSelect
              label="清晰度"
              value={state.resolution}
              options={resolutionOptions.map((value) => ({
                value,
                label: value.toUpperCase(),
              }))}
              onChange={onResolutionChange}
            />
          </FieldFrame>
        </div>
      ) : durationField}
      <VideoPromptBox
        label={meta.promptLabel}
        value={state.prompt}
        files={state.files}
        enableReferenceMentions={isSeedance20VideoModel(selectedProvider?.model)}
        maxLength={referenceOptions?.maxPromptCharacters}
        onChange={onPromptChange}
        optimizeCostLabel={promptOptimizeCostLabel || promptOptimizationCostLabel}
        optimizing={state.promptOptimizing}
        optimizeError={state.promptOptimizeError}
        canUndoOptimize={Boolean(state.promptOptimizeUndo)}
        onOptimize={onPromptOptimize}
        onUndoOptimize={onPromptOptimizeUndo}
        required
        placeholder={meta.promptPlaceholder}
      />
      <StudioErrorAlert message={state.submitError} diagnostic={state.submitDiagnostic} />
      <StickyPrimaryAction>
        <SubmitButton
          disabled={!canSubmit}
          loading={state.loading}
          loadingLabel={meta.loadingLabel}
          costLabel={costLabel || formatQuotaSymbolLabel(estimatedQuotaUnits)}
          onClick={onSubmit}
        >
          {meta.submitLabel}
        </SubmitButton>
      </StickyPrimaryAction>
    </FormPanel>
  );
}

function VideoReferenceInput({
  files,
  error,
  label,
  mode,
  emptyTitle,
  filledTitle,
  helpText,
  required,
  referenceMode,
  supportsFirstLastFrame,
  onReferenceModeChange,
  onChange,
  onFrameFileChange,
  onRemove,
  onClear,
  referenceOptions,
}: {
  files: VideoWorkspaceFile[];
  error: string;
  label: string;
  mode: WorkspaceVideoMode;
  emptyTitle: string;
  filledTitle: string;
  helpText: string;
  required: boolean;
  referenceMode: VideoWorkspaceState["referenceMode"];
  supportsFirstLastFrame: boolean;
  onReferenceModeChange: (mode: VideoWorkspaceState["referenceMode"]) => void;
  onChange: (mediaType: VideoWorkspaceFile["mediaType"], files: File[]) => void;
  onFrameFileChange: (frameRole: "first" | "last", file: File) => void;
  onRemove: (mediaType: VideoWorkspaceFile["mediaType"], index: number) => void;
  onClear: (mediaType: VideoWorkspaceFile["mediaType"]) => void;
  referenceOptions?: WorkspaceVideoOptions;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [activeMediaType, setActiveMediaType] = useState<VideoWorkspaceFile["mediaType"]>("image");
  const firstLastMode = supportsFirstLastFrame && referenceMode === "first-last";
  const maxImages = supportsFirstLastFrame ? 1 : referenceOptions?.maxReferenceImages ?? 1;
  const maxVideos = referenceOptions?.maxReferenceVideos ?? 0;
  const maxAudios = referenceOptions?.maxReferenceAudios ?? 0;
  const maxDurationSeconds = referenceOptions?.maxReferenceDurationSeconds ?? 15;
  const requiredReferenceMedia = new Set(referenceOptions?.requiredReferenceMedia || (required ? ["image"] : []));
  const mediaOptions = [
    { type: "image" as const, label: "参考图", max: maxImages },
    { type: "video" as const, label: "参考视频", max: maxVideos },
    { type: "audio" as const, label: "参考音频", max: maxAudios },
  ].filter((item) => item.max > 0);
  const hasMediaTabs = maxVideos > 0 || maxAudios > 0;
  const activeMediaTypeAvailable = activeMediaType === "image" ? maxImages > 0 : activeMediaType === "video" ? maxVideos > 0 : maxAudios > 0;
  const effectiveActiveMediaType = activeMediaTypeAvailable ? activeMediaType : "image";
  const activeOption = mediaOptions.find((item) => item.type === effectiveActiveMediaType) || mediaOptions[0];
  const activeFiles = files.filter((item) => item.mediaType === activeOption?.type);

  const activeConfig = activeOption?.type === "video"
    ? { accept: "video/mp4,video/webm,video/quicktime", title: "上传参考视频", help: `支持 MP4、WebM、MOV，总时长不超过 ${maxDurationSeconds} 秒` }
    : activeOption?.type === "audio"
      ? { accept: "audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/x-wav", title: "上传参考音频", help: `支持 MP3、M4A、WAV，总时长不超过 ${maxDurationSeconds} 秒` }
      : { accept: "image/png,image/jpeg,image/webp", title: maxImages > 1 ? "上传参考图" : emptyTitle, help: maxImages > 1 ? "支持 PNG、JPEG、WebP，300-6000px" : helpText };

  return (
    <FieldFrame
      label={hasMediaTabs ? "参考素材" : maxImages > 1 ? "参考图" : label}
      required={firstLastMode || (!hasMediaTabs && requiredReferenceMedia.has("image"))}
      hint={supportsFirstLastFrame ? undefined : !hasMediaTabs && requiredReferenceMedia.has("image") ? "必填" : mode === "image-to-video" ? "已上传" : "可选"}
      action={supportsFirstLastFrame ? (
        <button
          type="button"
          className="studio-reference-mode-toggle"
          onClick={() => onReferenceModeChange(firstLastMode ? "single" : "first-last")}
          aria-pressed={firstLastMode}
        >
          {firstLastMode ? "图生视频" : "首尾帧视频"}
        </button>
      ) : undefined}
    >
      {firstLastMode ? (
        <FirstLastFrameInput files={files} onChange={onFrameFileChange} onRemove={(index) => onRemove("image", index)} />
      ) : (
        <div className="studio-reference-media">
          {hasMediaTabs ? (
            <div className="studio-reference-media__tabs" role="tablist" aria-label="参考素材类型">
              {mediaOptions.map((item) => {
                const count = files.filter((file) => file.mediaType === item.type).length;
                const itemRequired = requiredReferenceMedia.has(item.type);
                return (
                  <button
                    key={item.type}
                    type="button"
                    role="tab"
                    aria-label={`${item.label}${itemRequired ? "，必填" : ""} ${count}/${item.max}`}
                    aria-selected={effectiveActiveMediaType === item.type}
                    className={cn("studio-reference-media__tab", effectiveActiveMediaType === item.type && "is-active")}
                    onClick={() => setActiveMediaType(item.type)}
                  >
                    <span className={cn("studio-reference-media__tab-content", itemRequired && "is-required")}>{item.label} {count}/{item.max}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
          <CompactDropzone
            inputRef={inputRef}
            inputId="video-first-frame-input"
            accept={activeConfig.accept}
            multiple={(activeOption?.max || 1) > 1}
            dragging={dragging}
            error={error}
            files={activeFiles.map((item) => ({
              name: item.file.name,
              size: item.file.size,
              previewUrl: item.previewUrl,
              mediaType: item.mediaType,
            }))}
            emptyTitle={activeConfig.title}
            filledTitle={filledTitle}
            helpText={activeConfig.help}
            onFiles={(nextFiles) => onChange(activeOption?.type || "image", nextFiles)}
            onRemove={(index) => onRemove(activeOption?.type || "image", index)}
            onClear={activeFiles.length ? () => onClear(activeOption?.type || "image") : undefined}
            onDraggingChange={setDragging}
          />
        </div>
      )}
      {error ? <p className="studio-error-text" role="alert">{error}</p> : null}
    </FieldFrame>
  );
}

function FirstLastFrameInput({
  files,
  onChange,
  onRemove,
}: {
  files: VideoWorkspaceFile[];
  onChange: (frameRole: "first" | "last", file: File) => void;
  onRemove: (index: number) => void;
}) {
  const firstInputRef = useRef<HTMLInputElement | null>(null);
  const lastInputRef = useRef<HTMLInputElement | null>(null);
  const frames = (["first", "last"] as const).map((frameRole) => {
    const index = files.findIndex((item) => item.frameRole === frameRole);
    return { frameRole, index, file: index >= 0 ? files[index] : null };
  });

  return (
    <div className="studio-video-frame-pair" role="group" aria-label="首尾帧图片">
      {frames.map(({ frameRole, index, file }) => {
        const inputRef = frameRole === "first" ? firstInputRef : lastInputRef;
        const label = frameRole === "first" ? "首帧图" : "尾帧图";
        const applyFile = (nextFile: File | undefined) => {
          if (nextFile) onChange(frameRole, nextFile);
        };
        return (
          <div key={frameRole} className={cn("studio-video-frame-slot", file && "is-filled")}>
            <input
              ref={inputRef}
              id={`video-${frameRole}-frame-input`}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              aria-label={`上传${label}`}
              className="studio-file-input"
              onChange={(event) => {
                applyFile(event.target.files?.[0]);
                event.currentTarget.value = "";
              }}
            />
            <button
              type="button"
              className="studio-video-frame-slot__button"
              onClick={() => inputRef.current?.click()}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                applyFile(event.dataTransfer.files[0]);
              }}
            >
              {file ? (
                <img src={file.previewUrl} alt={file.file.name} />
              ) : (
                <ImagePlus className="size-6" aria-hidden="true" />
              )}
              <strong>{label}</strong>
              <span>必填</span>
            </button>
            {file ? (
              <button
                type="button"
                className="studio-video-frame-slot__remove"
                aria-label={`删除${label}`}
                onClick={() => onRemove(index)}
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function VideoPromptBox({
  label,
  value,
  files,
  enableReferenceMentions,
  maxLength,
  onChange,
  enableOptimization = true,
  placeholder,
  required,
  optimizing,
  optimizeCostLabel,
  optimizeError,
  canUndoOptimize,
  onOptimize,
  onUndoOptimize,
}: {
  label: string;
  value: string;
  files: VideoWorkspaceFile[];
  enableReferenceMentions: boolean;
  maxLength?: number;
  onChange: (value: string) => void;
  enableOptimization?: boolean;
  placeholder: string;
  required?: boolean;
  optimizing: boolean;
  optimizeCostLabel?: string;
  optimizeError: string;
  canUndoOptimize: boolean;
  onOptimize: (preferences: PromptPreferences) => void;
  onUndoOptimize: () => void;
}) {
  const descriptionId = "video-prompt-counter";
  const promptPreferences = usePromptPreferences("video-generator");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const promptHighlightRef = useRef<HTMLDivElement | null>(null);
  const promptWrapRef = useRef<HTMLDivElement | null>(null);
  const promptCursorRef = useRef(value.length);
  const [mentionContext, setMentionContext] = useState<{ start: number; end: number; query: string } | null>(null);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const referenceCounts: Record<VideoWorkspaceFile["mediaType"], number> = { image: 0, video: 0, audio: 0 };
  const references = enableReferenceMentions ? files.map((file) => {
    const index = ++referenceCounts[file.mediaType];
    const prefix = file.mediaType === "image" ? "Image" : file.mediaType === "video" ? "Video" : "Audio";
    return {
      id: `video-prompt-reference-${file.mediaType}-${index}`,
      label: `${prefix}${index}`,
      typeLabel: file.mediaType === "image" ? "参考图" : file.mediaType === "video" ? "参考视频" : "参考音频",
      file,
    };
  }) : [];
  const filteredReferences = mentionContext
    ? references.filter((reference) => reference.label.toLowerCase().includes(mentionContext.query.toLowerCase()))
    : [];
  const mentionOpen = Boolean(mentionContext && filteredReferences.length);
  const referencesByLabel = new Map(references.map((reference) => [reference.label, reference]));
  const promptParts = value.split(/(@(?:Image|Video|Audio)\d+)/g);
  const showReferenceOverlay = Boolean(references.length || promptParts.length > 1);

  useEffect(() => {
    if (!mentionOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!promptWrapRef.current?.contains(event.target as Node)) setMentionContext(null);
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
    if (maxLength && nextValue.length > maxLength) return;
    const cursor = mentionContext.start + token.length + trailingSpace.length;
    onChange(nextValue);
    setMentionContext(null);
    focusPromptAt(cursor);
  };

  const openReferenceMenu = () => {
    if (!references.length) return;
    const cursor = Math.min(promptCursorRef.current, value.length);
    const needsLeadingSpace = cursor > 0 && !/\s/.test(value[cursor - 1]);
    const insertion = `${needsLeadingSpace ? " " : ""}@`;
    const nextValue = `${value.slice(0, cursor)}${insertion}${value.slice(cursor)}`;
    if (maxLength && nextValue.length > maxLength) return;
    const start = cursor + (needsLeadingSpace ? 1 : 0);
    const end = start + 1;
    onChange(nextValue);
    setMentionContext({ start, end, query: "" });
    setActiveMentionIndex(0);
    focusPromptAt(end);
  };

  return (
    <FieldFrame
      label={label}
      required={required}
      action={(
        <div className="studio-prompt-actions">
          <button
            type="button"
            className="studio-prompt-action studio-prompt-action--clear"
            onClick={() => onChange("")}
            disabled={!value}
            aria-label="清除提示词"
          >
            清除
          </button>
          {enableOptimization && canUndoOptimize ? (
            <button type="button" className="studio-prompt-action" onClick={onUndoOptimize} aria-label="撤销优化">
              撤销优化
            </button>
          ) : (
            <button
              type="button"
              className={cn("studio-prompt-action", !enableOptimization && "hidden")}
              onClick={() => onOptimize(promptPreferences.preferences)}
              disabled={optimizing || !enableOptimization}
              aria-busy={optimizing}
              aria-hidden={!enableOptimization}
            >
              {optimizing ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  正在优化…
                </>
              ) : (
                <span className="studio-prompt-action__copy">
                  <span>✨ 优化提示词</span>
                  {optimizeCostLabel ? <small>{optimizeCostLabel}</small> : null}
                </span>
              )}
            </button>
          )}
          {enableOptimization ? (
            <PromptSettingsButton tool="video-generator" store={promptPreferences.store} onChange={promptPreferences.saveStore} />
          ) : null}
        </div>
      )}
    >
      <label className="studio-sr-only" htmlFor="video-prompt">
        {label}
      </label>
      <div ref={promptWrapRef} className="studio-textarea-wrap">
        {showReferenceOverlay ? (
          <div ref={promptHighlightRef} className="studio-textarea-highlight" aria-hidden="true">
            {promptParts.map((part, index) => {
              const match = /^@(Image|Video|Audio)\d+$/.test(part);
              if (!match) return <span key={`${index}-${part}`}>{part}</span>;
              const reference = referencesByLabel.get(part.slice(1));
              if (reference) {
                return (
                  <mark
                    key={`${index}-${part}`}
                    className="studio-prompt-reference-token has-preview"
                    title={reference.typeLabel}
                  >
                    <span className="studio-prompt-reference-token__preview">
                      {reference.file.mediaType === "image" ? (
                        <img src={reference.file.previewUrl} alt="" />
                      ) : reference.file.mediaType === "video" ? (
                        <Video aria-hidden="true" />
                      ) : (
                        <FileAudio2 aria-hidden="true" />
                      )}
                    </span>
                    <span>{reference.label}</span>
                  </mark>
                );
              }
              return (
                <mark
                  key={`${index}-${part}`}
                  className="studio-prompt-reference-token is-invalid"
                >
                  {part}
                </mark>
              );
            })}
            {"\n"}
          </div>
        ) : null}
        <textarea
          ref={textareaRef}
          id="video-prompt"
          data-testid="video-prompt-input"
          value={value}
          maxLength={maxLength}
          onChange={(event) => {
            promptCursorRef.current = event.target.selectionStart ?? event.target.value.length;
            onChange(event.target.value);
            updateMentionContext(event.target.value, event.target.selectionStart ?? event.target.value.length);
          }}
          onSelect={(event) => {
            promptCursorRef.current = event.currentTarget.selectionStart ?? event.currentTarget.value.length;
          }}
          onScroll={(event) => {
            if (!promptHighlightRef.current) return;
            promptHighlightRef.current.scrollTop = event.currentTarget.scrollTop;
            promptHighlightRef.current.scrollLeft = event.currentTarget.scrollLeft;
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
          placeholder={placeholder}
          aria-describedby={descriptionId}
          aria-invalid={Boolean(maxLength && value.length > maxLength)}
          aria-controls={mentionOpen ? "video-prompt-reference-menu" : undefined}
          aria-haspopup={references.length ? "listbox" : undefined}
          aria-activedescendant={mentionOpen ? filteredReferences[activeMentionIndex]?.id : undefined}
          className={cn("studio-textarea", showReferenceOverlay && "studio-textarea--reference-overlay")}
        />
        {mentionOpen ? (
          <div id="video-prompt-reference-menu" className="studio-prompt-reference-menu" role="listbox" aria-label="选择参考素材">
            {filteredReferences.map((reference, index) => (
              <button
                key={reference.id}
                id={reference.id}
                type="button"
                role="option"
                aria-selected={index === activeMentionIndex}
                className={cn("studio-prompt-reference-option", index === activeMentionIndex && "is-active")}
                onMouseEnter={() => setActiveMentionIndex(index)}
                onClick={() => insertReference(reference.label)}
              >
                <span className="studio-prompt-reference-option__preview" aria-hidden="true">
                  {reference.file.mediaType === "image" ? (
                    <img src={reference.file.previewUrl} alt="" />
                  ) : reference.file.mediaType === "video" ? (
                    <Video className="size-4" />
                  ) : (
                    <FileAudio2 className="size-4" />
                  )}
                </span>
                <span className="studio-prompt-reference-option__copy">
                  <strong>{reference.label}</strong>
                  <small>{reference.typeLabel}</small>
                </span>
              </button>
            ))}
          </div>
        ) : null}
        <div className={cn("studio-prompt-footer", references.length && "has-references")}>
          {references.length ? <span className="studio-prompt-reference-hint">输入 @ 引用素材</span> : null}
          <span id={descriptionId} className="studio-counter">{maxLength ? `${value.length}/${maxLength}` : value.length} 个字符</span>
          {references.length ? (
            <button type="button" className="studio-prompt-reference-trigger" aria-label="引用参考素材" title="引用参考素材" onClick={openReferenceMenu}>
              <AtSign className="size-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>
      {maxLength && value.length > maxLength ? <p className="studio-error-text" role="alert">提示词最多 {maxLength} 个字符。</p> : null}
      {optimizeError ? <p className="studio-error-text" role="alert">{optimizeError}</p> : null}
    </FieldFrame>
  );
}
