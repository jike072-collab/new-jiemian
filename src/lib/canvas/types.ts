export type CanvasNodeKind = "prompt" | "media" | "generator" | "group";
export type CanvasMediaType = "image" | "video" | "audio";
export type CanvasGenerationKind = "image" | "video";
export type CanvasGeneratorStatus = "idle" | "queued" | "generating" | "done" | "failed";
export type CanvasReferenceRole = "identity" | "first-frame" | "last-frame" | "product" | "environment" | "motion" | "camera" | "timing" | "audio" | "style";

export type CanvasReferenceBinding = {
  label: string;
  role: CanvasReferenceRole;
  transfer?: string;
  ignore?: string;
};

export type CanvasSequenceState = {
  projectId?: string;
  shotId?: string;
  accepted?: boolean;
  sourceMediaNodeId?: string;
  acceptedEndState?: string;
  continuityLocks?: string[];
  completedBeats?: string[];
};

export type CanvasNodeData = Record<string, unknown> & {
  kind: CanvasNodeKind;
  title: string;
  createdAt?: string;
  model?: string;
  sourceNodeIds?: string[];
  prompt?: string;
  mediaType?: CanvasMediaType;
  libraryItemId?: string;
  intrinsicWidth?: number;
  intrinsicHeight?: number;
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
  collapsed?: boolean;
  expandedWidth?: number;
  expandedHeight?: number;
  hidden?: boolean;
  locked?: boolean;
  zIndex?: number;
  notes?: string;
  referenceBindings?: CanvasReferenceBinding[];
  sequenceState?: CanvasSequenceState;
};

export type CanvasStoredNode = {
  id: string;
  type: "canvas" | "group";
  position: { x: number; y: number };
  width?: number;
  height?: number;
  parentId?: string;
  extent?: "parent";
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
