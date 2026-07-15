"use client";

/* eslint-disable @next/next/no-img-element */

import { useCallback } from "react";
import { ImageUp, Loader2, UploadCloud, Wand2, X } from "lucide-react";

import { ratioShapeClass, ratios } from "@/components/studio/constants";
import { HierarchicalSelect, type HierarchicalSelectItem } from "@/components/studio/custom-select";
import { PromptSettingsButton, usePromptPreferences } from "@/components/studio/prompt-settings";
import type { StudioErrorDiagnostic, UploadFilePreview } from "@/components/studio/types";
import type { PromptPreferences, PromptPreferenceTool } from "@/lib/prompt-preferences";
import type { FrontendProvider } from "@/lib/server/types";
import { cn } from "@/lib/utils";

export { CustomSelect, HierarchicalSelect } from "@/components/studio/custom-select";

function formatFileSize(size: number) {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  if (size >= 1024) return `${Math.round(size / 1024)} KB`;
  return `${size} B`;
}

export function FormPanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="studio-form-panel">
      <div className="studio-form-panel__content">{children}</div>
    </div>
  );
}

export function StudioErrorAlert({
  message,
  diagnostic,
}: {
  message?: string;
  diagnostic?: StudioErrorDiagnostic | null;
}) {
  if (!message && !diagnostic) return null;
  const code = diagnostic?.code;
  const requestId = diagnostic?.requestId;
  const retryText = diagnostic ? (diagnostic.retryable ? "可重试" : "需调整后重试") : "";
  return (
    <div className="studio-error-alert" role="alert">
      <p className="studio-error-alert__message">{diagnostic?.message || message}</p>
      {diagnostic?.action ? <p className="studio-error-alert__action">{diagnostic.action}</p> : null}
      {code || requestId || retryText ? (
        <dl className="studio-error-alert__meta" aria-label="错误诊断信息">
          {code ? (
            <div>
              <dt>Code</dt>
              <dd>{code}</dd>
            </div>
          ) : null}
          {requestId ? (
            <div>
              <dt>Request ID</dt>
              <dd>{requestId}</dd>
            </div>
          ) : null}
          {retryText ? (
            <div>
              <dt>Retry</dt>
              <dd>{retryText}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
    </div>
  );
}

export function MobileActionBar({
  label,
  costLabel,
  loading,
  disabled,
  onClick,
}: {
  label: string;
  costLabel?: string;
  loading: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <div className="studio-mobile-action">
      <button type="button" className="studio-primary-action studio-mobile-action__button" disabled={disabled} onClick={onClick}>
        {loading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Wand2 className="size-4" aria-hidden="true" />}
        <span className="studio-primary-action__copy">
          <span>{label}</span>
          {!loading && costLabel ? <small>{costLabel}</small> : null}
        </span>
      </button>
    </div>
  );
}

export function FieldFrame({
  label,
  required,
  hint,
  action,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const showHint = !required && Boolean(hint);
  const hasMeta = showHint || Boolean(action);

  return (
    <div className="studio-field">
      <div className="studio-field__label">
        <span className="studio-field__label-text">
          {label}
          {required ? <span className="studio-required">*</span> : null}
        </span>
        {hasMeta ? (
          <div className="studio-field__meta">
            {showHint ? <span className="shell-chip">{hint}</span> : null}
            {action}
          </div>
        ) : null}
      </div>
      <div className="studio-field__body">{children}</div>
    </div>
  );
}

export function StackedControl({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return <FieldFrame label={label} required={required}>{children}</FieldFrame>;
}

export function AspectRatioSelector({
  label,
  value,
  options = ratios,
  onChange,
}: {
  label: string;
  value: string;
  options?: string[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="studio-ratio" role="group" aria-label={label}>
      {options.map((ratio) => (
        <button
          key={ratio}
          type="button"
          data-testid={`ratio-${ratio.replace(":", "-")}`}
          aria-pressed={value === ratio}
          onClick={() => onChange(ratio)}
          className={cn("studio-ratio__item", value === ratio && "is-active")}
        >
          <span className="studio-ratio__graphic" aria-hidden="true">
            <span className={cn("studio-ratio__shape", ratioShapeClass[ratio])} />
          </span>
          <span className="studio-ratio__label">{ratio}</span>
        </button>
      ))}
    </div>
  );
}

export function CompactDropzone({
  inputRef,
  inputId,
  accept,
  multiple = true,
  dragging,
  error,
  files,
  emptyTitle,
  filledTitle,
  helpText,
  onFiles,
  onRemove,
  onClear,
  onDraggingChange,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  inputId: string;
  accept: string;
  multiple?: boolean;
  dragging?: boolean;
  error?: string;
  files: UploadFilePreview[];
  emptyTitle: string;
  filledTitle: string;
  helpText: string;
  onFiles: (files: File[]) => void;
  onRemove?: (index: number) => void;
  onClear?: () => void;
  onDraggingChange?: (dragging: boolean) => void;
}) {
  const helpId = `${inputId}-help`;
  const hasFiles = files.length > 0;
  const currentTitle = dragging ? "松开以上传" : hasFiles ? filledTitle : emptyTitle;
  const fileInputLabel = hasFiles ? "选择替换文件" : "选择上传文件";

  const applyFiles = useCallback((fileList: FileList | File[]) => {
    const nextFiles = Array.from(fileList);
    if (!nextFiles.length) return;
    onFiles(nextFiles);
  }, [onFiles]);

  return (
    <div className="studio-upload-group">
      <div
        className={cn("studio-upload", dragging && "is-dragging", hasFiles && "is-filled", error && "is-error")}
        role="button"
        tabIndex={0}
        aria-controls={inputId}
        aria-describedby={helpId}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(event) => {
          event.preventDefault();
          onDraggingChange?.(true);
        }}
        onDragLeave={() => onDraggingChange?.(false)}
        onDrop={(event) => {
          event.preventDefault();
          onDraggingChange?.(false);
          applyFiles(event.dataTransfer.files);
        }}
      >
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          aria-label={fileInputLabel}
          aria-describedby={helpId}
          accept={accept}
          multiple={multiple}
          onChange={(event) => {
            applyFiles(event.target.files || []);
            event.currentTarget.value = "";
          }}
          className="studio-file-input"
        />
        <div className="studio-upload__icon" aria-hidden="true">
          <UploadCloud className="size-5" />
        </div>
        <div className="studio-upload__content">
          <strong>{currentTitle}</strong>
          <p id={helpId}>{helpText}</p>
          {dragging ? <span className="studio-upload__drop-hint">释放后自动读取文件</span> : null}
          {hasFiles && !dragging ? <span>点击区域可替换文件</span> : null}
        </div>
        {hasFiles ? (
          <div className="studio-upload-list">
            {files.map((file, index) => (
              <div key={`${file.name}-${file.size}-${index}`} className="studio-upload-item">
                {file.previewUrl ? (
                  file.mediaType === "video"
                    ? <video src={file.previewUrl} controls />
                    : <img src={file.previewUrl} alt={file.name} />
                ) : (
                  <span className="studio-upload-item__placeholder" aria-hidden="true">
                    <ImageUp className="size-5" />
                  </span>
                )}
                <div>
                  <strong>{file.name}</strong>
                  <span>{formatFileSize(file.size)}</span>
                </div>
                {onRemove ? (
                  <button
                    type="button"
                    className="studio-icon-button"
                    aria-label={`删除 ${file.name}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onRemove(index);
                    }}
                  >
                    <X className="size-4" aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            ))}
            {files.length > 1 && onClear ? (
              <button
                type="button"
                className="studio-secondary-button studio-upload-clear"
                onClick={(event) => {
                  event.stopPropagation();
                  onClear();
                }}
              >
                全部删除
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function StickyPrimaryAction({ children, helpText }: { children: React.ReactNode; helpText?: string }) {
  return (
    <div className="studio-sticky-action">
      {children}
      {helpText ? <span className="studio-help-text">{helpText}</span> : null}
    </div>
  );
}

export function PreviewState({
  title,
  description,
  badge,
  action,
  role,
  live,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  badge?: string;
  action?: React.ReactNode;
  role?: "status" | "alert";
  live?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="studio-preview" role={role} aria-live={live ? "polite" : undefined}>
      <div className="studio-preview__top">
        <div>
          <h3>{title}</h3>
          {description ? <p>{description}</p> : null}
        </div>
        {badge || action ? (
          <div className="studio-preview__meta">
            {badge ? <span className="shell-chip">{badge}</span> : null}
            {action}
          </div>
        ) : null}
      </div>
      <div className="studio-preview__content">{children}</div>
    </div>
  );
}

export function ModeSegmentedControl({
  label,
  labelHidden,
  groupId,
  value,
  options,
  onChange,
}: {
  label?: string;
  labelHidden?: boolean;
  groupId?: string;
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="studio-mode">
      {label ? (
        <span id={groupId ? `${groupId}-label` : undefined} className={cn("studio-label", labelHidden && "studio-sr-only")}>
          {label}
        </span>
      ) : null}
      <div className="studio-mode__options" role="group" aria-labelledby={label && groupId ? `${groupId}-label` : undefined}>
        {options.map(([id, text]) => (
          <button
            key={id}
            type="button"
            data-testid={`mode-${id}`}
            aria-pressed={value === id}
            onClick={() => onChange(id)}
            className={cn("studio-mode__button", value === id && "is-active")}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ProviderSelect({
  providers,
  value,
  loading,
  error,
  onChange,
  onReload,
  label = "模型",
}: {
  providers: FrontendProvider[];
  value: string;
  loading?: boolean;
  error?: string;
  onChange: (value: string) => void;
  onReload?: () => Promise<void>;
  label?: string;
}) {
  const options = providers.map((provider) => ({
    value: provider.id,
    label: providerModelName(provider.model, provider.displayName),
    description: providerUseCase(provider.model, provider.displayName),
  }));
  const familyDefinitions = [
    { value: "veo", label: "Veo", matches: (provider: FrontendProvider) => provider.model.startsWith("veo-") },
    { value: "grok", label: "Grok", matches: (provider: FrontendProvider) => provider.model.startsWith("grok-video-") },
    { value: "seedance", label: "Seedance", matches: (provider: FrontendProvider) => provider.model.toLowerCase().includes("seedance") },
    { value: "banana", label: "Banana", matches: (provider: FrontendProvider) => ["banana2", "banana-pro"].includes(provider.model.toLowerCase()) },
  ];
  const groupedProviderIds = new Set<string>();
  const items: HierarchicalSelectItem[] = [];
  for (const family of familyDefinitions) {
    const familyOptions = providers
      .map((provider, index) => ({ provider, option: options[index] }))
      .filter(({ provider }) => family.matches(provider));
    if (!familyOptions.length) continue;
    familyOptions.forEach(({ provider }) => groupedProviderIds.add(provider.id));
    if (familyOptions.length === 1) {
      items.push({ type: "option", option: familyOptions[0].option });
    } else {
      items.push({
        type: "group",
        value: family.value,
        label: family.label,
        options: familyOptions.map(({ option }) => option),
      });
    }
  }
  providers.forEach((provider, index) => {
    if (!groupedProviderIds.has(provider.id)) items.push({ type: "option", option: options[index] });
  });

  return (
    <FieldFrame label={label} required>
      <div className="studio-provider">
        <HierarchicalSelect
          label={label}
          value={value}
          items={items}
          disabled={loading || Boolean(error)}
          placeholder={loading ? "正在读取模型" : "选择模型"}
          onChange={onChange}
        />
        {loading ? <p id="image-provider-status" className="studio-help-text" role="status" aria-live="polite">正在读取可用模型。</p> : null}
        {!loading && !error && !providers.length ? (
          <p id="image-provider-empty" className="studio-help-text" role="status" aria-live="polite">
            当前尚未配置可用模型。
          </p>
        ) : null}
        {error ? (
          <div id="image-provider-error" className="studio-inline-error" role="alert">
            <p>{error}</p>
            {onReload ? (
              <button type="button" className="studio-secondary-button" onClick={() => void onReload()}>
                重新加载
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </FieldFrame>
  );
}

function providerModelName(model: string, displayName: string) {
  const normalized = model.trim().toLowerCase();
  if (normalized === "image" || normalized === "banana-img2") return "Image";
  if (normalized === "banana2") return "Banana2";
  if (normalized === "banana-pro") return "Banana Pro";
  if (normalized === "grok-video-1.5") return "Grok";
  return displayName || model;
}

function providerUseCase(model: string, displayName: string) {
  const normalized = model.trim().toLowerCase();
  const normalizedDisplayName = displayName.trim().toLowerCase();
  if (normalized === "image" || normalized === "banana-img2" || normalizedDisplayName === "image") {
    return "全风格兼容·创意测试通用款";
  }
  if (normalized === "banana2") return "极速省积分·批量草图首选";
  if (normalized === "banana-pro") return "电商质感专项优化·商用成品直出";
  if (normalized === "veo-3.1-pro") return "高质量视频生成·细节与稳定性优先";
  if (normalized === "veo-3.1-fast") return "快速视频生成·兼顾质量与生成速度";
  if (normalized === "grok-video-1.5") return "动态影像直出·商品短片一键生成";
  if (normalized === "暗黑破甲破限seedance 720p-fast-nsp") {
    return "0.88元/秒，13.2元/15秒；禁区，国内慎用慎发，破甲、破限、无审核，除了版权都能过。Seedance 720P Fast，支持 9 图、3 音频、0 视频，自由时长，按秒计费。";
  }
  if (normalized === "暗黑破甲破限seedance 720p-pro-nsp") {
    return "0.99元/秒，14.85元/15秒；禁区，国内慎用慎发，破甲、破限、无审核，除了版权都能过。Seedance 720P Pro，支持 9 图、3 音频、0 视频，自由时长，按秒计费。";
  }
  if (normalized === "oc-seedance 720-pro-15s") {
    return "0.36元/秒，满血 720P Pro，支持 9 图、3 视频、3 音频，高并发，不卡真人脸，自由时长固定价格。";
  }
  if (normalized === "seedance2.0 720p-pro-gz-15s") {
    return "Seedance 2.0 720P Pro，支持 4 个参考图、3 个视频、1 个音频，固定时长 15 秒，过人脸，高并发。";
  }
  if (normalized === "sh-seedance2.0-fast 720p-nv-15s") {
    return "渠道四：0.29元/秒，固定价格自由时长；官转 Seedance 2.0 原生 720P Fast，支持 9 张参考图片、3 个参考音频，不排队，过真人脸，不支持参考视频。";
  }
  if (normalized === "sh-seedance2.0-mini-720p-nv-15s") {
    return "渠道四：0.25元/秒，固定价格自由时长；Seedance 2.0 原生 720P Mini，支持 9 张参考图片、3 个参考音频，不排队，过真人脸，不支持参考视频。";
  }
  if (normalized === "xx-seedance 720p-pro-gz-15s") {
    return "0.29元/秒，Seedance 720P Pro，支持 9 图、1 音频、1 视频，高并发、不排队、过人脸，固定时长 15 秒。";
  }
  return undefined;
}

export function PromptBox({
  tool,
  value,
  onChange,
  placeholder,
  required,
  optimizing,
  optimizeCostLabel,
  optimizeError,
  canUndoOptimize,
  onOptimize,
  onUndoOptimize,
}: {
  tool: PromptPreferenceTool;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  required?: boolean;
  optimizing: boolean;
  optimizeCostLabel?: string;
  optimizeError: string;
  canUndoOptimize: boolean;
  onOptimize: (preferences: PromptPreferences) => void;
  onUndoOptimize: () => void;
}) {
  const promptPreferences = usePromptPreferences(tool);

  return (
    <FieldFrame
      label="提示词"
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
          {canUndoOptimize ? (
            <button type="button" className="studio-prompt-action" onClick={onUndoOptimize} aria-label="撤销优化">
              撤销优化
            </button>
          ) : (
            <button
              type="button"
              className="studio-prompt-action"
              onClick={() => onOptimize(promptPreferences.preferences)}
              disabled={optimizing}
              aria-busy={optimizing}
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
          <PromptSettingsButton tool={tool} store={promptPreferences.store} onChange={promptPreferences.saveStore} />
        </div>
      )}
    >
      <label className="studio-sr-only" htmlFor="image-prompt">
        提示词
      </label>
      <div className="studio-textarea-wrap">
        <textarea
          id="image-prompt"
          data-testid="prompt-input"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          aria-describedby="image-prompt-counter"
          className="studio-textarea"
        />
        <span id="image-prompt-counter" className="studio-counter">{value.length} 个字符</span>
      </div>
      {optimizeError ? <p className="studio-error-text" role="alert">{optimizeError}</p> : null}
    </FieldFrame>
  );
}

export function SubmitButton({
  disabled,
  loading,
  loadingLabel,
  costLabel,
  children,
  onClick,
}: {
  disabled: boolean;
  loading: boolean;
  loadingLabel?: string;
  costLabel?: string;
  children: React.ReactNode;
  onClick: () => void;
}) {
  const label = loading ? loadingLabel || children : children;

  return (
    <button type="button" data-testid="primary-submit" disabled={disabled} onClick={onClick} className="studio-primary-action" aria-busy={loading}>
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Wand2 className="size-4" aria-hidden="true" />}
      <span className="studio-primary-action__copy">
        <span>{label}</span>
        {!loading && costLabel ? <small>{costLabel}</small> : null}
      </span>
    </button>
  );
}
