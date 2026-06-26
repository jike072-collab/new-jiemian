"use client";

/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, ImageUp, Loader2, UploadCloud, Wand2, X } from "lucide-react";

import { ratioShapeClass, ratios } from "@/components/studio/constants";
import type { SelectOption, StudioErrorDiagnostic, UploadFilePreview } from "@/components/studio/types";
import type { FrontendProvider } from "@/lib/server/types";
import { cn } from "@/lib/utils";

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
          aria-label={currentTitle}
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
                <button type="button" className="studio-icon-button" aria-label={`删除 ${file.name}`} onClick={() => onRemove(index)}>
                  <X className="size-4" aria-hidden="true" />
                </button>
              ) : null}
            </div>
          ))}
          {files.length > 1 && onClear ? (
            <button type="button" className="studio-secondary-button studio-upload-clear" onClick={onClear}>
              全部删除
            </button>
          ) : null}
        </div>
      ) : null}
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
  role,
  live,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  badge?: string;
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
        {badge ? <span className="shell-chip">{badge}</span> : null}
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

export function CustomSelect({
  label,
  value,
  options,
  icon,
  disabled,
  placeholder = "请选择",
  onChange,
}: {
  label: string;
  value: string;
  options: SelectOption[];
  icon?: React.ReactNode;
  disabled?: boolean;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  const generatedId = useId();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [openAbove, setOpenAbove] = useState(false);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : null;
  const [activeIndex, setActiveIndex] = useState(selectedIndex >= 0 ? selectedIndex : 0);
  const listId = `${generatedId}-listbox`;

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || listRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const openMenu = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      const availableBelow = window.innerHeight - rect.bottom;
      setOpenAbove(availableBelow < 280 && rect.top > availableBelow);
    }
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  }, [selectedIndex]);

  const enabledOptions = options.filter((option) => !option.disabled);
  const chooseOption = useCallback((option: SelectOption) => {
    if (option.disabled) return;
    onChange(option.value);
    setOpen(false);
    buttonRef.current?.focus();
  }, [onChange]);

  const moveActive = useCallback((direction: 1 | -1) => {
    if (!enabledOptions.length) return;
    const currentValue = options[activeIndex]?.value;
    const enabledIndex = Math.max(0, enabledOptions.findIndex((option) => option.value === currentValue));
    const nextEnabled = enabledOptions[(enabledIndex + direction + enabledOptions.length) % enabledOptions.length];
    const nextIndex = options.findIndex((option) => option.value === nextEnabled.value);
    setActiveIndex(nextIndex >= 0 ? nextIndex : 0);
  }, [activeIndex, enabledOptions, options]);

  return (
    <div className={cn("studio-custom-select", open && "is-open")}>
      <button
        ref={buttonRef}
        type="button"
        className="studio-custom-select__button"
        disabled={disabled || !options.length}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => {
          if (open) {
            setOpen(false);
          } else {
            openMenu();
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            if (!open) openMenu();
            moveActive(1);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) openMenu();
            moveActive(-1);
          } else if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (!open) {
              openMenu();
              return;
            }
            const option = options[activeIndex];
            if (option) chooseOption(option);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
      >
        {icon ? <span className="studio-custom-select__icon" aria-hidden="true">{icon}</span> : null}
        <span className="studio-custom-select__value">{selectedOption?.label || placeholder}</span>
        <ChevronDown className={cn("size-4 transition", open && "rotate-180")} aria-hidden="true" />
      </button>
      <div
        ref={listRef}
        id={listId}
        className={cn("studio-custom-select__menu", openAbove && "is-above")}
        role="listbox"
        aria-label={label}
        aria-hidden={!open}
      >
        {options.map((option, index) => {
          const selected = option.value === value;
          const active = index === activeIndex;
          return (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={selected}
              disabled={option.disabled}
              tabIndex={open ? 0 : -1}
              className={cn("studio-custom-select__option", selected && "is-selected", active && "is-active")}
              onMouseEnter={() => setActiveIndex(index)}
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                chooseOption(option);
              }}
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                chooseOption(option);
              }}
              onClick={() => chooseOption(option)}
            >
              <span>{option.label}</span>
              {selected ? <Check className="size-4" aria-hidden="true" /> : null}
            </button>
          );
        })}
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
    label: provider.displayName || provider.model,
  }));

  return (
    <FieldFrame label={label} required>
      <div className="studio-provider">
        <CustomSelect
          label={label}
          value={value}
          options={options}
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

export function PromptBox({
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
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  required?: boolean;
  optimizing: boolean;
  optimizeCostLabel?: string;
  optimizeError: string;
  canUndoOptimize: boolean;
  onOptimize: () => void;
  onUndoOptimize: () => void;
}) {
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
          <button
            type="button"
            className="studio-prompt-action"
            onClick={onOptimize}
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
          {canUndoOptimize ? (
            <button type="button" className="studio-prompt-action" onClick={onUndoOptimize}>
              撤销优化
            </button>
          ) : null}
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
