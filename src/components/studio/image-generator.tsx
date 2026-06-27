"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { featuredImagePromptTemplates } from "@/lib/template-catalog";
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

export function ImageGenerator({
  mode,
  showTemplates,
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
  onQualityChange,
  onCountChange,
  onTemplateChange,
  onPromptChange,
  onPromptOptimize,
  onPromptOptimizeUndo,
  onFilesChange,
  onFileRemove,
  onFilesClear,
  onReloadProviders,
  onSubmit,
  registerMobileAction,
}: {
  mode: WorkspaceImageMode;
  showTemplates: boolean;
  providers: FrontendProvider[];
  providersLoading: boolean;
  providersError: string;
  selectedProvider: FrontendProvider | null;
  templateCenterHref: string;
  state: ImageWorkspaceState;
  canSubmit: boolean;
  estimatedQuotaUnits: number;
  onProviderChange: (value: string) => void;
  onRatioChange: (value: string) => void;
  onQualityChange: (value: string) => void;
  onCountChange: (value: number) => void;
  onTemplateChange: (value: string) => void;
  onPromptChange: (value: string) => void;
  onPromptOptimize: () => void;
  onPromptOptimizeUndo: () => void;
  onFilesChange: (files: File[]) => void;
  onFileRemove: (index: number) => void;
  onFilesClear: () => void;
  onReloadProviders: () => Promise<void>;
  onSubmit: () => void;
  registerMobileAction: (action: MobileActionState) => void;
}) {
  const meta = imageWorkspaceModeMeta[mode];

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
      {showTemplates ? (
        <TemplateRail
          title="模板"
          viewAllHref={templateCenterHref}
          templates={featuredImagePromptTemplates}
          activeTemplateId={state.templateId}
          onSelect={(template) => onTemplateChange(template.id)}
        />
      ) : null}
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
      <StudioErrorAlert message={state.submitError} diagnostic={state.submitDiagnostic} />

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
