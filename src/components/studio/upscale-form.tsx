"use client";

import { useEffect, useRef, useState } from "react";

import { upscaleUnavailableMessage } from "@/components/studio/constants";
import {
  CompactDropzone,
  FieldFrame,
  FormPanel,
  ModeSegmentedControl,
  StackedControl,
  StickyPrimaryAction,
  SubmitButton,
} from "@/components/studio/shared";
import type {
  ImageUpscaleWorkspaceState,
  MobileActionState,
  VideoUpscaleWorkspaceState,
} from "@/components/studio/types";

export function ImageUpscaleForm({
  state,
  canSubmit,
  onScaleChange,
  onFilesChange,
  onFileRemove,
  onFilesClear,
  onSubmit,
  registerMobileAction,
}: {
  state: ImageUpscaleWorkspaceState;
  canSubmit: boolean;
  onScaleChange: (value: string) => void;
  onFilesChange: (files: File[]) => void;
  onFileRemove: () => void;
  onFilesClear: () => void;
  onSubmit: () => void;
  registerMobileAction: (action: MobileActionState) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const file = state.file;

  useEffect(() => {
    registerMobileAction({
      label: state.loading ? "正在增强" : "开始增强",
      loading: state.loading,
      disabled: !canSubmit,
      onClick: onSubmit,
    });
    return () => registerMobileAction(null);
  }, [canSubmit, onSubmit, registerMobileAction, state.loading]);

  return (
    <FormPanel>
      <FieldFrame label="图像" required>
        <CompactDropzone
          inputRef={inputRef}
          inputId="image-upscale-input"
          accept="image/png,image/jpeg,image/webp"
          multiple={false}
          dragging={dragging}
          files={file ? [{ name: file.file.name, size: file.file.size, previewUrl: file.previewUrl }] : []}
          emptyTitle="上传图像"
          filledTitle="已选择图像"
          helpText="支持 JPG、PNG、WEBP"
          onFiles={onFilesChange}
          onRemove={file ? () => onFileRemove() : undefined}
          onClear={file ? onFilesClear : undefined}
          onDraggingChange={setDragging}
        />
        {state.fileError ? <p className="studio-error-text" role="alert">{state.fileError}</p> : null}
      </FieldFrame>

      <StackedControl label="放大倍数" required>
        <ModeSegmentedControl
          label="放大倍数"
          labelHidden
          groupId="image-upscale-scale"
          value={state.scale}
          options={[
            ["1", "1K"],
            ["2", "2K"],
            ["4", "4K"],
          ]}
          onChange={onScaleChange}
        />
      </StackedControl>

      {state.checked && !state.statusLoading && !state.availability?.ready ? (
        <p className="studio-error-text" role="alert">{upscaleUnavailableMessage}</p>
      ) : null}

      <StickyPrimaryAction>
        <SubmitButton disabled={!canSubmit} loading={state.loading} loadingLabel="正在增强" onClick={onSubmit}>
          开始增强
        </SubmitButton>
      </StickyPrimaryAction>
    </FormPanel>
  );
}

export function VideoUpscaleForm({
  state,
  canSubmit,
  onScaleChange,
  onFilesChange,
  onFileRemove,
  onFilesClear,
  onSubmit,
  registerMobileAction,
}: {
  state: VideoUpscaleWorkspaceState;
  canSubmit: boolean;
  onScaleChange: (value: string) => void;
  onFilesChange: (files: File[]) => void;
  onFileRemove: () => void;
  onFilesClear: () => void;
  onSubmit: () => void;
  registerMobileAction: (action: MobileActionState) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const file = state.file;
  const processing = state.loading || state.job?.status === "queued" || state.job?.status === "generating";

  useEffect(() => {
    registerMobileAction({
      label: processing ? "正在增强" : "开始增强",
      loading: processing,
      disabled: !canSubmit || processing,
      onClick: onSubmit,
    });
    return () => registerMobileAction(null);
  }, [canSubmit, onSubmit, processing, registerMobileAction]);

  return (
    <FormPanel>
      <FieldFrame label="视频" required>
        <CompactDropzone
          inputRef={inputRef}
          inputId="video-upscale-input"
          accept="video/mp4,video/webm,video/quicktime"
          multiple={false}
          dragging={dragging}
          files={file ? [{
            name: file.file.name,
            size: file.file.size,
            previewUrl: file.previewUrl,
            mediaType: "video",
          }] : []}
          emptyTitle="上传视频"
          filledTitle="已选择视频"
          helpText="支持常见视频格式"
          onFiles={onFilesChange}
          onRemove={file ? () => onFileRemove() : undefined}
          onClear={file ? onFilesClear : undefined}
          onDraggingChange={setDragging}
        />
        {state.fileError ? <p className="studio-error-text" role="alert">{state.fileError}</p> : null}
      </FieldFrame>

      <StackedControl label="放大倍数" required>
        <ModeSegmentedControl
          label="放大倍数"
          labelHidden
          groupId="video-upscale-scale"
          value={state.scale}
          options={[
            ["1", "1K"],
            ["2", "2K"],
            ["4", "4K"],
          ]}
          onChange={onScaleChange}
        />
      </StackedControl>

      {state.checked && !state.statusLoading && !state.availability?.ready ? (
        <p className="studio-error-text" role="alert">{upscaleUnavailableMessage}</p>
      ) : null}

      <StickyPrimaryAction>
        <SubmitButton disabled={!canSubmit || processing} loading={processing} loadingLabel="正在增强" onClick={onSubmit}>
          开始增强
        </SubmitButton>
      </StickyPrimaryAction>
    </FormPanel>
  );
}
