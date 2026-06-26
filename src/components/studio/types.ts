import type { FrontendProvider, JobRecord, LibraryItem } from "@/lib/server/types";

export type BusinessToolId = "image" | "video" | "image-upscale" | "video-upscale" | "library";
export type LibraryFilter = "image" | "video";
export type LibrarySort = "recent" | "title";
export type UpscaleKind = "image" | "video";
export type UpscaleAvailability = { ready: boolean; detail: string };
export type UpscaleStatusResponse = Record<UpscaleKind, UpscaleAvailability>;

export type EnabledProviders = {
  image: FrontendProvider[];
  video: FrontendProvider[];
};

export type WorkspaceVideoOptions = {
  durations?: number[];
  ratios?: string[];
};

export type WorkspacePublicProvider = FrontendProvider & {
  videoOptions?: WorkspaceVideoOptions;
};

export type OutputState = {
  item: LibraryItem;
  job?: JobRecord | null;
  title: string;
  tool: BusinessToolId;
} | null;

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
  mediaType?: "image" | "video";
};

export type SelectOption = {
  value: string;
  label: string;
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
  loading: boolean;
};

export type VideoWorkspaceFile = {
  file: File;
  previewUrl: string;
};

export type VideoWorkspaceState = {
  providerId: string;
  ratio: string;
  duration: number;
  templateId: string;
  prompt: string;
  promptOptimizing: boolean;
  promptOptimizeError: string;
  promptOptimizeUndo: string;
  files: VideoWorkspaceFile[];
  fileError: string;
  submitError: string;
  loading: boolean;
  job: JobRecord | null;
};

export type ImageGenerationProgressState = {
  status: "running" | "done" | "failed";
  current: number;
  total: number;
  startedAt: number;
  completedAt?: number;
  message?: string;
} | null;

export type ImageUpscaleWorkspaceFile = {
  file: File;
  previewUrl: string;
};

export type VideoUpscaleWorkspaceFile = {
  file: File;
  previewUrl: string;
};

export type ImageUpscaleWorkspaceState = {
  scale: "1" | "2" | "4";
  file: ImageUpscaleWorkspaceFile | null;
  fileError: string;
  submitError: string;
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
  loading: boolean;
  statusLoading: boolean;
  checked: boolean;
  availability: UpscaleAvailability | null;
  statusError: string;
  job: JobRecord | null;
};
