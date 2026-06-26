"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

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
  SubmitButton,
} from "@/components/studio/shared";
import type { MobileActionState, VideoWorkspaceFile, VideoWorkspaceState, WorkspacePublicProvider } from "@/components/studio/types";
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
  onProviderChange,
  onRatioChange,
  onDurationChange,
  onTemplateChange,
  onPromptChange,
  onPromptOptimize,
  onPromptOptimizeUndo,
  onFilesChange,
  onFileRemove,
  onFilesClear,
  ratioOptions,
  durationOptions,
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
  onProviderChange: (value: string) => void;
  onRatioChange: (value: string) => void;
  onDurationChange: (value: number) => void;
  onTemplateChange: (value: string) => void;
  onPromptChange: (value: string) => void;
  onPromptOptimize: () => void;
  onPromptOptimizeUndo: () => void;
  onFilesChange: (files: File[]) => void;
  onFileRemove: (index: number) => void;
  onFilesClear: () => void;
  ratioOptions: string[];
  durationOptions: number[];
  modelRequiresImage: boolean;
  onReloadProviders: () => Promise<void>;
  onSubmit: () => void;
  registerMobileAction: (action: MobileActionState) => void;
}) {
  const meta = videoWorkspaceModeMeta[mode];

  useEffect(() => {
    registerMobileAction({
      label: state.loading ? meta.loadingLabel : meta.submitLabel,
      costLabel: formatQuotaSymbolLabel(estimatedQuotaUnits),
      loading: state.loading,
      disabled: !canSubmit,
      onClick: onSubmit,
    });
    return () => registerMobileAction(null);
  }, [canSubmit, estimatedQuotaUnits, meta.loadingLabel, meta.submitLabel, onSubmit, registerMobileAction, state.loading]);

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
        onChange={onFilesChange}
        onRemove={onFileRemove}
        onClear={onFilesClear}
      />
      {modelRequiresImage && !state.files.length ? (
        <p className="studio-help-text">{videoModelReferenceMessage}</p>
      ) : null}
      <StackedControl label="比例" required>
        <AspectRatioSelector label="比例" value={state.ratio} options={ratioOptions} onChange={onRatioChange} />
      </StackedControl>
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
      <VideoPromptBox
        label={meta.promptLabel}
        value={state.prompt}
        onChange={onPromptChange}
        optimizeCostLabel={promptOptimizationCostLabel}
        optimizing={state.promptOptimizing}
        optimizeError={state.promptOptimizeError}
        canUndoOptimize={Boolean(state.promptOptimizeUndo)}
        onOptimize={onPromptOptimize}
        onUndoOptimize={onPromptOptimizeUndo}
        required
        placeholder={meta.promptPlaceholder}
      />
      {state.submitError ? <p className="studio-error-text" role="alert">{state.submitError}</p> : null}
      <StickyPrimaryAction>
        <SubmitButton
          disabled={!canSubmit}
          loading={state.loading}
          loadingLabel={meta.loadingLabel}
          costLabel={formatQuotaSymbolLabel(estimatedQuotaUnits)}
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
  onChange,
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
  onChange: (files: File[]) => void;
  onRemove: (index: number) => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <FieldFrame label={label} required={required} hint={required ? "必填" : mode === "image-to-video" ? "已上传" : "可选"}>
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
      {error ? <p className="studio-error-text" role="alert">{error}</p> : null}
    </FieldFrame>
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
  onOptimize: () => void;
  onUndoOptimize: () => void;
}) {
  const descriptionId = "video-prompt-counter";

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
          <button
            type="button"
            className={cn("studio-prompt-action", !enableOptimization && "hidden")}
            onClick={onOptimize}
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
          {enableOptimization && canUndoOptimize ? (
            <button type="button" className="studio-prompt-action" onClick={onUndoOptimize}>
              撤销优化
            </button>
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
