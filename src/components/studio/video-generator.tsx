"use client";

/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";

import { featuredVideoPromptTemplates } from "@/lib/template-catalog";
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
import type { MobileActionState, VideoWorkspaceFile, VideoWorkspaceState, WorkspacePublicProvider } from "@/components/studio/types";
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
  onFilesChange: (files: File[]) => void;
  onFrameFileChange: (frameRole: "first" | "last", file: File) => void;
  onFileRemove: (index: number) => void;
  onFilesClear: () => void;
  referenceMode: VideoWorkspaceState["referenceMode"];
  supportsFirstLastFrame: boolean;
  onReferenceModeChange: (mode: VideoWorkspaceState["referenceMode"]) => void;
  ratioOptions: string[];
  durationOptions: number[];
  resolutionOptions: string[];
  modelRequiresImage: boolean;
  onReloadProviders: () => Promise<void>;
  onSubmit: () => void;
  registerMobileAction: (action: MobileActionState) => void;
}) {
  const meta = videoWorkspaceModeMeta[mode];
  const durationField = (
    <FieldFrame label="时长" required>
      <CustomSelect
        label="时长"
        value={String(state.duration)}
        options={durationOptions.map((value) => ({
          value: String(value),
          label: `${value} 秒`,
        }))}
        onChange={(value) => onDurationChange(Number(value))}
      />
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
  onChange: (files: File[]) => void;
  onFrameFileChange: (frameRole: "first" | "last", file: File) => void;
  onRemove: (index: number) => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const firstLastMode = supportsFirstLastFrame && referenceMode === "first-last";

  return (
    <FieldFrame
      label={label}
      required={required || firstLastMode}
      hint={supportsFirstLastFrame ? undefined : required ? "必填" : mode === "image-to-video" ? "已上传" : "可选"}
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
        <FirstLastFrameInput files={files} onChange={onFrameFileChange} onRemove={onRemove} />
      ) : (
        <CompactDropzone
          inputRef={inputRef}
          inputId="video-first-frame-input"
          accept="image/png,image/jpeg,image/webp"
          multiple={false}
          dragging={dragging}
          error={error}
          files={files.map((item) => ({
            name: item.file.name,
            size: item.file.size,
            previewUrl: item.previewUrl,
          }))}
          emptyTitle={emptyTitle}
          filledTitle={filledTitle}
          helpText={helpText}
          onFiles={onChange}
          onRemove={onRemove}
          onClear={files.length ? onClear : undefined}
          onDraggingChange={setDragging}
        />
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
                <X className="size-4" aria-hidden="true" />
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
      <div className="studio-textarea-wrap">
        <textarea
          id="video-prompt"
          data-testid="video-prompt-input"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          aria-describedby={descriptionId}
          className="studio-textarea"
        />
        <span id={descriptionId} className="studio-counter">{value.length} 个字符</span>
      </div>
      {optimizeError ? <p className="studio-error-text" role="alert">{optimizeError}</p> : null}
    </FieldFrame>
  );
}
