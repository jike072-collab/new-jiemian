"use client";

/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useRef, useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";

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
  standardImageMode,
  onStandardImageModeChange,
  whiteBackgroundFourViewMode,
  onWhiteBackgroundFourViewModeChange,
  ecommerceTenPageMode,
  onEcommerceTenPageModeChange,
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
  standardImageMode: boolean;
  onStandardImageModeChange: () => void;
  whiteBackgroundFourViewMode: boolean;
  onWhiteBackgroundFourViewModeChange: () => void;
  ecommerceTenPageMode: boolean;
  onEcommerceTenPageModeChange: () => void;
  onReloadProviders: () => Promise<void>;
  onSubmit: () => void;
  registerMobileAction: (action: MobileActionState) => void;
}) {
  const meta = imageWorkspaceModeMeta[mode];
  const ecommerceCount = Math.min(Math.max(Math.round(Number(state.count) || 1), 1), 10);
  const submitLabel = ecommerceTenPageMode ? `生成电商套图 ${ecommerceCount} 张` : whiteBackgroundFourViewMode ? "生成四视图白底图" : meta.submitLabel;
  const loadingLabel = ecommerceTenPageMode ? "正在生成电商套图" : whiteBackgroundFourViewMode ? "正在生成四视图" : meta.loadingLabel;
  const onSubmitRef = useRef(onSubmit);
  const handleMobileSubmit = useCallback(() => onSubmitRef.current(), []);

  useEffect(() => {
    onSubmitRef.current = onSubmit;
  }, [onSubmit]);

  useEffect(() => {
    registerMobileAction({
      label: loading ? loadingLabel : submitLabel,
      costLabel: costLabel || formatQuotaSymbolLabel(estimatedQuotaUnits),
      loading,
      disabled: !canSubmit,
      onClick: handleMobileSubmit,
    });
    return () => registerMobileAction(null);
  }, [canSubmit, costLabel, estimatedQuotaUnits, handleMobileSubmit, loading, loadingLabel, registerMobileAction, submitLabel]);

  return (
    <FormPanel>
      <div className="studio-image-feature-mobile-tabs" aria-label="图片功能切换">
        <button type="button" className="studio-four-view-mobile-toggle" aria-pressed={standardImageMode} onClick={onStandardImageModeChange}>图片生成</button>
        <button type="button" className="studio-four-view-mobile-toggle" aria-pressed={whiteBackgroundFourViewMode} onClick={onWhiteBackgroundFourViewModeChange}>四视图</button>
        <button type="button" className="studio-four-view-mobile-toggle" aria-pressed={ecommerceTenPageMode} onClick={onEcommerceTenPageModeChange}>电商套图</button>
      </div>
      <ProviderSelect
        providers={providers}
        value={selectedProvider?.id || state.providerId}
        loading={providersLoading}
        error={providersError}
        onChange={onProviderChange}
        onReload={onReloadProviders}
      />
      {showTemplates && !whiteBackgroundFourViewMode && !ecommerceTenPageMode ? (
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
      ) : ecommerceTenPageMode ? (
        <>
          <EcommerceTenPageInput files={state.files} error={state.fileError} onChange={onFilesChange} onRemove={onFileRemove} onClear={onFilesClear} />
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
                value={String(ecommerceCount)}
                options={Array.from({ length: 10 }, (_, index) => ({ value: String(index + 1), label: `${index + 1}张` }))}
                onChange={(value) => onCountChange(Number(value))}
              />
            </StackedControl>
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
  const views = ["侧视图 1", "侧视图 2", "顶部", "鞋底"];
  const nextIndex = files.length;

  const applyFiles = (selectedFiles: FileList | File[]) => {
    if (nextIndex >= views.length) return;
    const selected = Array.from(selectedFiles).slice(0, views.length - nextIndex);
    if (!selected.length) return;
    onChange([...files.map((item) => item.file), ...selected]);
  };

  return (
    <FieldFrame
      label="鞋子四视图"
      required
      action={files.length ? <button type="button" className="studio-prompt-action" onClick={onClear}><Trash2 className="size-3.5" aria-hidden="true" />一键清除素材</button> : undefined}
    >
      <input
        id="four-view-reference-input"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        className="studio-file-input"
        aria-label={nextIndex < views.length ? `上传${views[nextIndex]}视图` : "四视图已上传"}
        onChange={(event) => {
          applyFiles(event.target.files || []);
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
              {!file && canUpload ? (
                <label htmlFor="four-view-reference-input">
                  <ImagePlus className="size-5" aria-hidden="true" />
                  <span>{files.length ? `继续上传${view}` : "选择 1-4 张图片"}</span>
                </label>
              ) : null}
              <span>{`第 ${index + 1} 张 · ${view}`}</span>
            </div>
          );
        })}
      </div>
      <p className="studio-four-view-upload-note">可一次选择 4 张：前两张分别为外侧和内侧，顺序不限；第 3 张为顶部，第 4 张为鞋底。</p>
      {error ? <p className="studio-error-text" role="alert">{error}</p> : null}
    </FieldFrame>
  );
}

function EcommerceTenPageInput({
  files,
  error,
  onChange,
  onRemove,
  onClear,
}: {
  files: ImageWorkspaceFile[];
  error: string;
  onChange: (files: File[]) => void;
  onRemove: (index: number) => void;
  onClear: () => void;
}) {
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const boardInputRef = useRef<HTMLInputElement | null>(null);
  const logo = files[0];
  const boards = files.slice(1);

  return (
    <FieldFrame
      label="电商套图素材"
      required
      action={files.length ? <button type="button" className="studio-prompt-action" onClick={onClear}><Trash2 className="size-3.5" aria-hidden="true" />一键清除素材</button> : undefined}
    >
      <input
        ref={logoInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="studio-file-input"
        aria-label="上传品牌 Logo"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onChange([file, ...files.slice(1).map((item) => item.file)]);
          event.currentTarget.value = "";
        }}
      />
      <div className="studio-ecommerce-logo-upload">
        <div className="studio-ecommerce-upload-heading">
          <strong>品牌 Logo</strong>
          <span>每张图固定放在左上角</span>
        </div>
        {logo ? (
          <div className="studio-ecommerce-logo-preview">
            <img src={logo.previewUrl} alt="品牌 Logo" />
            <button type="button" aria-label="删除品牌 Logo" onClick={() => onRemove(0)}>×</button>
          </div>
        ) : (
          <button type="button" className="studio-ecommerce-upload-button" onClick={() => logoInputRef.current?.click()}>
            <ImagePlus className="size-5" aria-hidden="true" />
            <span>上传 Logo</span>
          </button>
        )}
      </div>
      <input
        ref={boardInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        className="studio-file-input"
        aria-label="上传配色四视图白底图"
        onChange={(event) => {
          const selected = Array.from(event.target.files || []);
          if (selected.length) onChange([files[0]?.file, ...boards.map((item) => item.file), ...selected].filter(Boolean) as File[]);
          event.currentTarget.value = "";
        }}
      />
      <div className="studio-ecommerce-board-upload">
        <div className="studio-ecommerce-upload-heading">
          <strong>配色四视图白底图</strong>
          <span>每张图对应一个颜色</span>
        </div>
        <div className="studio-ecommerce-board-grid">
          {boards.map((board, index) => (
            <div key={`${board.file.name}-${index}`} className="studio-ecommerce-board-preview">
              <img src={board.previewUrl} alt={`配色 ${index + 1} 四视图`} />
              <span>配色 {index + 1}</span>
              <button type="button" aria-label={`删除配色 ${index + 1}`} onClick={() => onRemove(index + 1)}>×</button>
            </div>
          ))}
          <button type="button" className="studio-ecommerce-upload-button studio-ecommerce-upload-button--board" onClick={() => boardInputRef.current?.click()} disabled={!logo}>
            <ImagePlus className="size-5" aria-hidden="true" />
            <span>添加配色</span>
          </button>
        </div>
      </div>
      <p className="studio-four-view-upload-note">先上传 1 张 Logo，再上传前一个功能生成的配色四视图白底图；一次最多 9 个配色。</p>
      {error ? <p className="studio-error-text" role="alert">{error}</p> : null}
    </FieldFrame>
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
