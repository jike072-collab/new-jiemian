"use client";

/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useRef, useState } from "react";
import { ImagePlus, RotateCcw } from "lucide-react";

import { featuredImageGenerationPromptTemplates } from "@/lib/template-catalog";
import type { FrontendProvider } from "@/lib/server/types";
import type { WorkspaceImageMode } from "@/lib/workspace-registry";
import { TemplateRail } from "@/components/template-center";
import { formatQuotaSymbolLabel, imageWorkspaceModeMeta, promptOptimizationCostLabel } from "@/components/studio/constants";
import {
  AspectRatioSelector,
  CompactDropzone,
  CustomSelect,
  FieldFrame,
  FormPanel,
  PromptBox,
  ProviderSelect,
  StackedControl,
  StickyPrimaryAction,
  StudioErrorAlert,
  SubmitButton,
} from "@/components/studio/shared";
import type { ImageWorkspaceFile, ImageWorkspaceState, MobileActionState } from "@/components/studio/types";
import type { PromptPreferences, PromptPreferenceTool } from "@/lib/prompt-preferences";
import { cn } from "@/lib/utils";

export function ImageGenerator({
  mode,
  promptTool,
  showTemplates,
  providers,
  providersLoading,
  providersError,
  selectedProvider,
  templateCenterHref,
  state,
  loading = state.loading,
  canSubmit,
  estimatedQuotaUnits,
  costLabel,
  onProviderChange,
  onRatioChange,
  onQualityChange,
  onCountChange,
  onTemplateChange,
  onPromptChange,
  onPromptOptimize,
  onPromptOptimizeUndo,
  promptOptimizeCostLabel,
  onFilesChange,
  onFileRemove,
  onFilesClear,
  whiteBackgroundFourViewMode,
  onWhiteBackgroundFourViewModeChange,
  onReloadProviders,
  onSubmit,
  registerMobileAction,
}: {
  mode: WorkspaceImageMode;
  promptTool: Extract<PromptPreferenceTool, "image-generator" | "image-editor">;
  showTemplates: boolean;
  providers: FrontendProvider[];
  providersLoading: boolean;
  providersError: string;
  selectedProvider: FrontendProvider | null;
  templateCenterHref: string;
  state: ImageWorkspaceState;
  loading?: boolean;
  canSubmit: boolean;
  estimatedQuotaUnits: number;
  costLabel?: string;
  onProviderChange: (value: string) => void;
  onRatioChange: (value: string) => void;
  onQualityChange: (value: string) => void;
  onCountChange: (value: number) => void;
  onTemplateChange: (value: string) => void;
  onPromptChange: (value: string) => void;
  onPromptOptimize: (preferences: PromptPreferences) => void;
  onPromptOptimizeUndo: () => void;
  promptOptimizeCostLabel?: string;
  onFilesChange: (files: File[]) => void;
  onFileRemove: (index: number) => void;
  onFilesClear: () => void;
  whiteBackgroundFourViewMode: boolean;
  onWhiteBackgroundFourViewModeChange: () => void;
  onReloadProviders: () => Promise<void>;
  onSubmit: () => void;
  registerMobileAction: (action: MobileActionState) => void;
}) {
  const meta = imageWorkspaceModeMeta[mode];
  const submitLabel = whiteBackgroundFourViewMode ? "生成四视图白底图" : meta.submitLabel;
  const loadingLabel = whiteBackgroundFourViewMode ? "正在生成四视图" : meta.loadingLabel;

  useEffect(() => {
    registerMobileAction({
      label: loading ? loadingLabel : submitLabel,
      costLabel: costLabel || formatQuotaSymbolLabel(estimatedQuotaUnits),
      loading,
      disabled: !canSubmit,
      onClick: onSubmit,
    });
    return () => registerMobileAction(null);
  }, [canSubmit, costLabel, estimatedQuotaUnits, loading, loadingLabel, onSubmit, registerMobileAction, submitLabel]);

  return (
    <FormPanel>
      <button
        type="button"
        className="studio-four-view-mobile-toggle"
        aria-pressed={whiteBackgroundFourViewMode}
        onClick={onWhiteBackgroundFourViewModeChange}
      >
        四视图白底图
      </button>
      <ProviderSelect
        providers={providers}
        value={selectedProvider?.id || state.providerId}
        loading={providersLoading}
        error={providersError}
        onChange={onProviderChange}
        onReload={onReloadProviders}
      />
      {showTemplates && !whiteBackgroundFourViewMode ? (
        <TemplateRail
          scope="image"
          title="模板"
          viewAllHref={templateCenterHref}
          templates={featuredImageGenerationPromptTemplates}
          activeTemplateId={state.templateId}
          onSelect={(template) => onTemplateChange(template.id)}
        />
      ) : null}
      {whiteBackgroundFourViewMode ? (
        <>
          <WhiteBackgroundFourViewInput files={state.files} error={state.fileError} onChange={onFilesChange} onClear={onFilesClear} />
          <div className="studio-fixed-generation-settings" aria-label="固定生成设置">
            <span>固定生成</span>
            <strong>1:1</strong>
            <strong>1K</strong>
            <strong>1 张</strong>
          </div>
        </>
      ) : (
        <>
          <ReferenceImageInput
            mode={mode}
            files={state.files}
            error={state.fileError}
            onChange={onFilesChange}
            onRemove={onFileRemove}
            onClear={onFilesClear}
          />
          <StackedControl label="比例" required>
            <AspectRatioSelector label="比例" value={state.ratio} onChange={onRatioChange} />
          </StackedControl>
          <div className="studio-dual-fields">
            <StackedControl label="清晰度" required>
              <CustomSelect
                label="清晰度"
                value={state.quality}
                options={[
                  { value: "1k", label: "1K（默认）" },
                  { value: "2k", label: "2K（细节更多）" },
                  { value: "4k", label: "4K（大图输出）" },
                ]}
                onChange={onQualityChange}
              />
            </StackedControl>
            <StackedControl label="数量" required>
              <CustomSelect
                label="数量"
                value={String(state.count)}
                options={[
                  { value: "1", label: "1张" },
                  { value: "2", label: "2张" },
                  { value: "3", label: "3张" },
                  { value: "4", label: "4张" },
                ]}
                onChange={(value) => onCountChange(Number(value))}
              />
            </StackedControl>
          </div>
          <PromptBox
            tool={promptTool}
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
        </>
      )}
      <StudioErrorAlert message={state.submitError} diagnostic={state.submitDiagnostic} />

      <StickyPrimaryAction>
        <SubmitButton
          disabled={!canSubmit}
          loading={loading}
          loadingLabel={loadingLabel}
          costLabel={costLabel || formatQuotaSymbolLabel(estimatedQuotaUnits)}
          onClick={onSubmit}
        >
          {submitLabel}
        </SubmitButton>
      </StickyPrimaryAction>
    </FormPanel>
  );
}

function WhiteBackgroundFourViewInput({
  files,
  error,
  onChange,
  onClear,
}: {
  files: ImageWorkspaceFile[];
  error: string;
  onChange: (files: File[]) => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const views = ["外侧", "内侧", "顶部", "鞋底"];
  const nextIndex = files.length;

  const applyFile = (file: File | undefined) => {
    if (!file || nextIndex >= views.length) return;
    onChange([...files.map((item) => item.file), file]);
  };

  return (
    <FieldFrame
      label="鞋子四视图"
      required
      action={files.length ? <button type="button" className="studio-prompt-action" onClick={onClear}><RotateCcw className="size-3.5" aria-hidden="true" />重新上传</button> : undefined}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="studio-file-input"
        aria-label={nextIndex < views.length ? `上传${views[nextIndex]}视图` : "四视图已上传"}
        onChange={(event) => {
          applyFile(event.target.files?.[0]);
          event.currentTarget.value = "";
        }}
      />
      <div className="studio-four-view-upload-grid">
        {views.map((view, index) => {
          const file = files[index];
          const canUpload = index === nextIndex;
          return (
            <div key={view} className={cn("studio-four-view-upload-slot", file && "is-filled", canUpload && "is-next")}>
              {file ? <img src={file.previewUrl} alt={`${view}视图`} /> : null}
              {!file ? <ShoeViewOutline view={view} active={canUpload} /> : null}
              {!file && canUpload ? (
                <button type="button" onClick={() => inputRef.current?.click()}>
                  <ImagePlus className="size-5" aria-hidden="true" />
                  <span>上传{view}</span>
                </button>
              ) : null}
              <span>{`第 ${index + 1} 张 · ${view}`}</span>
            </div>
          );
        })}
      </div>
      <p className="studio-four-view-upload-note">请严格按外侧、内侧、顶部、鞋底顺序上传。重新上传会清空当前四张图片。</p>
      {error ? <p className="studio-error-text" role="alert">{error}</p> : null}
    </FieldFrame>
  );
}

function ShoeViewOutline({ view, active }: { view: string; active: boolean }) {
  const strokeClass = "studio-four-view-shoe-outline__stroke";

  return (
    <svg
      className={cn("studio-four-view-shoe-outline", active && "is-active", `is-${view}`)}
      viewBox="0 0 160 92"
      aria-hidden="true"
      focusable="false"
    >
      {view === "外侧" || view === "内侧" ? (
        <g transform={view === "内侧" ? "translate(160 0) scale(-1 1)" : undefined}>
          <path className={strokeClass} d="M12 68c11-3 20-10 28-22l13-21c4-7 11-11 19-11h15c7 0 13 3 18 9l14 16c6 6 13 10 21 13l17 6c5 2 8 6 8 11v3H12z" />
          <path className={strokeClass} d="M12 72h143v8H12zM38 56c12-2 22-8 30-18l12-14M57 52h42M74 25l18 16M85 22l18 16M96 25l17 14M120 49c8 4 15 7 24 9M136 63h11" />
        </g>
      ) : view === "顶部" ? (
        <g>
          <path className={strokeClass} d="M55 82c-8-11-11-24-8-39l7-24c2-7 8-11 15-11h22c7 0 13 4 15 11l7 24c3 15 0 28-8 39z" />
          <path className={strokeClass} d="M66 13v53M94 13v53M68 28h24M66 40h28M64 52h32M61 65h38M55 82h50" />
          <path className={strokeClass} d="M72 73c5 4 11 6 16 6s11-2 16-6" />
        </g>
      ) : (
        <g>
          <path className={strokeClass} d="M56 8c-14 3-25 14-29 30l-7 25c-4 14 7 25 22 25h76c15 0 26-11 22-25l-7-25c-4-16-15-27-29-30z" />
          <path className={strokeClass} d="M48 18l13 16M77 10v74M112 18L99 34M32 48h96M26 67h108" />
          <path className={strokeClass} d="M45 40l13 13M109 40L96 53M40 58l13 13M114 58l-13 13" />
        </g>
      )}
    </svg>
  );
}

function ReferenceImageInput({
  mode,
  files,
  error,
  onChange,
  onRemove,
  onClear,
}: {
  mode: WorkspaceImageMode;
  files: ImageWorkspaceFile[];
  error: string;
  onChange: (files: File[]) => void;
  onRemove: (index: number) => void;
  onClear: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const applyFiles = useCallback((fileList: FileList | File[]) => {
    const nextFiles = Array.from(fileList);
    if (!nextFiles.length) return;
    onChange(nextFiles);
  }, [onChange]);

  return (
    <FieldFrame label="图像" hint={mode === "image-to-image" ? "已上传" : "可选"}>
      <CompactDropzone
        inputRef={fileInputRef}
        inputId="reference-image-input"
        accept="image/png,image/jpeg,image/webp"
        multiple
        dragging={dragging}
        error={error}
        files={files.map((item) => ({
          name: item.file.name,
          size: item.file.size,
          previewUrl: item.previewUrl,
        }))}
        emptyTitle="上传图像"
        filledTitle="已选择图像"
        helpText="支持 JPG、PNG、WEBP"
        onFiles={applyFiles}
        onRemove={onRemove}
        onClear={files.length ? onClear : undefined}
        onDraggingChange={setDragging}
      />
      {error ? <p id="reference-image-error" className="studio-error-text" role="alert">{error}</p> : null}
    </FieldFrame>
  );
}
