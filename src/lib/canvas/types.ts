export type CanvasNodeKind = "prompt" | "media" | "generator";
export type CanvasMediaType = "image" | "video";
export type CanvasGenerationKind = "image" | "video";
export type CanvasGeneratorStatus = "idle" | "queued" | "generating" | "done" | "failed";

export type CanvasNodeData = Record<string, unknown> & {
  kind: CanvasNodeKind;
  title: string;
  prompt?: string;
  mediaType?: CanvasMediaType;
  libraryItemId?: string;
  generationKind?: CanvasGenerationKind;
  providerId?: string;
  imageMode?: "text-to-image" | "image-to-image";
  count?: number;
  ratio?: string;
  quality?: string;
  duration?: number;
  resolution?: string;
  status?: CanvasGeneratorStatus;
  progress?: number;
  jobId?: string;
  outputNodeId?: string;
  error?: string;
  mediaUrl?: string;
};

export type CanvasStoredNode = {
  id: string;
  type: "canvas";
  position: { x: number; y: number };
  width?: number;
  height?: number;
  data: CanvasNodeData;
};

export type CanvasStoredEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
};

export type CanvasViewport = {
  x: number;
  y: number;
  zoom: number;
};

export type CanvasProjectDocument = {
  nodes: CanvasStoredNode[];
  edges: CanvasStoredEdge[];
  viewport: CanvasViewport;
};

export type CanvasProject = {
  id: string;
  title: string;
  document: CanvasProjectDocument;
  version: number;
  createdAt: string;
  updatedAt: string;
};
