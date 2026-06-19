export type ProviderKind = "image" | "video" | "image-upscale" | "video-upscale";

export type EndpointType =
  | "images-generations"
  | "images-edits"
  | "videos-generations"
  | "upscayl-cli"
  | "video2x-cli"
  | "upscale-placeholder";

export type ProviderConfig = {
  id: string;
  kind: ProviderKind;
  title: string;
  role: string;
  apiUrl: string;
  model: string;
  displayName: string;
  apiKey: string;
  enabled: boolean;
  endpointType: EndpointType;
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
};

export type ProviderUpdate = Partial<
  Pick<ProviderConfig, "apiUrl" | "model" | "displayName" | "enabled" | "endpointType">
> & {
  id: string;
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

export type LibraryItem = {
  id: string;
  type: MediaType;
  mode: string;
  title: string;
  prompt: string;
  providerId: string;
  model: string;
  status: "done" | "queued" | "generating" | "failed";
  createdAt: string;
  updatedAt: string;
  output?: LibraryOutput;
  params: Record<string, string | number | boolean>;
  error?: string;
  fileAvailable?: boolean;
};

export type JobRecord = {
  id: string;
  libraryItemId: string;
  type: "video";
  providerId: string;
  status: "queued" | "generating" | "done" | "failed";
  statusUrl: string;
  sourceUrl?: string;
  createdAt: string;
  updatedAt: string;
  error?: string;
};
