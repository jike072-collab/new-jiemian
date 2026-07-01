export type ProviderKind = "image" | "video" | "prompt" | "image-upscale" | "video-upscale";

export type EndpointType =
  | "images-generations"
  | "images-edits"
  | "chat-completions"
  | "videos-generations"
  | "grok-videos"
  | "volcengine-imagex-upscale"
  | "volcengine-vod-upscale";

export type ProviderConfig = {
  id: string;
  kind: ProviderKind;
  title: string;
  role: string;
  apiUrl: string;
  model: string;
  models?: string[];
  modelDisplayNames?: Record<string, string>;
  enabledModels?: string[];
  displayName?: string;
  videoOptions?: {
    durations?: number[];
    ratios?: string[];
    resolution?: string;
    maxReferenceImages?: number;
    supportsVideoReference?: boolean;
    supportsAudioReference?: boolean;
  };
  apiKey: string;
  enabled: boolean;
  endpointType: EndpointType;
  custom?: boolean;
};

export type PublicProvider = Omit<ProviderConfig, "apiKey"> & {
  configured: boolean;
  keyPreview: string;
};

export type FrontendProvider = {
  id: string;
  model: string;
  displayName: string;
  capabilities: string[];
  enabled: boolean;
  endpointType: EndpointType;
  videoOptions?: ProviderConfig["videoOptions"];
};

export type ProviderUpdate = Partial<
  Pick<ProviderConfig, "apiUrl" | "model" | "models" | "modelDisplayNames" | "enabledModels" | "displayName" | "videoOptions" | "enabled" | "endpointType">
> & {
  id: string;
  kind?: ProviderKind;
  title?: string;
  role?: string;
  custom?: boolean;
  delete?: boolean;
  apiKey?: string;
  clearApiKey?: boolean;
};

export type MediaType = "image" | "video";

export type LibraryOutput = {
  url: string;
  mimeType: string;
  storedName?: string;
  size?: number;
  sourceUrl?: string;
};

export type MediaExpirationStage = "pending" | "quarantined" | "fileDeleted";

export type LibraryItem = {
  id: string;
  ownerLocalUserId?: string | null;
  type: MediaType;
  mode: string;
  title: string;
  prompt: string;
  providerId: string;
  model: string;
  status: "done" | "queued" | "generating" | "failed";
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  expiresAt?: string;
  expired?: boolean;
  expiredAt?: string;
  expirationPending?: boolean;
  expirationStage?: MediaExpirationStage;
  expirationPendingAt?: string;
  expirationPendingStoredName?: string;
  expirationQuarantineName?: string;
  output?: LibraryOutput;
  params: Record<string, string | number | boolean>;
  error?: string;
  fileAvailable?: boolean;
};

export type JobRecord = {
  id: string;
  libraryItemId: string;
  type: "video";
  ownerLocalUserId?: string | null;
  providerId: string;
  status: "queued" | "generating" | "done" | "failed";
  statusUrl: string;
  sourceUrl?: string;
  billing_task_id?: string | null;
  billing_local_user_id?: string | null;
  billing_idempotency_key?: string | null;
  billing_estimated_quota_units?: number | null;
  billing_state?: string | null;
  billing_last_error?: string | null;
  createdAt: string;
  updatedAt: string;
  error?: string;
};
