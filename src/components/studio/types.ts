import type { FrontendProvider, JobRecord, LibraryItem } from "@/lib/server/types";
import type { ErrorDiagnostic } from "@/lib/error-diagnostic-catalog";
import type { PublicUploadLimits } from "@/lib/upload-limits";

export type BusinessToolId = "image" | "video" | "image-upscale" | "video-upscale" | "library";
export type LibraryFilter = "image" | "video";
export type LibrarySort = "created-desc" | "created-asc" | "size-desc" | "size-asc";
export type UpscaleKind = "image" | "video";
export type UpscaleAvailability = { ready: boolean; detail: string };
export type UpscaleStatusResponse = Record<UpscaleKind, UpscaleAvailability> & {
  uploadLimits?: Pick<PublicUploadLimits, "imageUpscale" | "videoUpscale">;
};

export type EnabledProviders = {
  image: FrontendProvider[];
  video: FrontendProvider[];
};

export type WorkspaceVideoOptions = {
  durations?: number[];
  ratios?: string[];
  resolution?: string;
  resolutions?: string[];
  maxReferenceImages?: number;
  maxReferenceVideos?: number;
  maxReferenceAudios?: number;
  maxReferenceDurationSeconds?: number;
};

export type WorkspacePublicProvider = FrontendProvider & {
  videoOptions?: WorkspaceVideoOptions;
};

export type OutputItemState = {
  item: LibraryItem;
  job?: JobRecord | null;
  title: string;
  tool: BusinessToolId;
};

export type OutputState = OutputItemState | null;

export type StudioErrorDiagnostic = ErrorDiagnostic;

export type MobileActionState = {
  label: string;
  costLabel?: string;
  loading: boolean;
  disabled: boolean;
  onClick: () => void;
} | null;

export type ImageWorkspaceFile = {
  file: File;
  previewUrl: string;
};

export type UploadFilePreview = {
  name: string;
  size: number;
  previewUrl?: string;
  mediaType?: "image" | "video" | "audio";
};

export type SelectOption = {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
};

export type ImageWorkspaceState = {
  providerId: string;
  ratio: string;
  quality: string;
  count: number;
  templateId: string;
  prompt: string;
  promptOptimizing: boolean;
  promptOptimizeError: string;
  promptOptimizeUndo: string;
  files: ImageWorkspaceFile[];
  fileError: string;
  submitError: string;
  submitDiagnostic?: StudioErrorDiagnostic | null;
  inFlightCount: number;
  loading: boolean;
};

export type VideoWorkspaceFile = {
  file: File;
  previewUrl: string;
  mediaType: "image" | "video" | "audio";
  durationSeconds?: number;
  frameRole?: "first" | "last";
};

export type VideoWorkspaceState = {
  providerId: string;
  referenceMode: "single" | "first-last";
  ratio: string;
  duration: number;
  resolution: string;
  templateId: string;
  prompt: string;
  promptOptimizing: boolean;
  promptOptimizeError: string;
  promptOptimizeUndo: string;
  files: VideoWorkspaceFile[];
  fileError: string;
  submitError: string;
  submitDiagnostic?: StudioErrorDiagnostic | null;
  inFlightCount: number;
  loading: boolean;
  job: JobRecord | null;
};

export type ImageGenerationProgressItem = {
  id: string;
  scope: "image" | "image-editor" | "video";
  status: "running" | "done" | "failed";
  current: number;
  total: number;
  startedAt: number;
  completedAt?: number;
  message?: string;
};

export type ImageGenerationProgressState = ImageGenerationProgressItem[];

export type ImageUpscaleWorkspaceFile = {
  file: File;
  previewUrl: string;
};

export type VideoUpscaleWorkspaceFile = {
  file: File;
  previewUrl: string;
  width?: number;
  height?: number;
};

export type ImageUpscaleWorkspaceState = {
  scale: "1" | "2" | "4";
  file: ImageUpscaleWorkspaceFile | null;
  fileError: string;
  submitError: string;
  submitDiagnostic?: StudioErrorDiagnostic | null;
  loading: boolean;
  statusLoading: boolean;
  checked: boolean;
  availability: UpscaleAvailability | null;
  statusError: string;
};

export type VideoUpscaleWorkspaceState = {
  scale: "1" | "2" | "4";
  file: VideoUpscaleWorkspaceFile | null;
  fileError: string;
  submitError: string;
  submitDiagnostic?: StudioErrorDiagnostic | null;
  loading: boolean;
  statusLoading: boolean;
  checked: boolean;
  availability: UpscaleAvailability | null;
  statusError: string;
  job: JobRecord | null;
};
