import type { TikTokCopyDraft } from "#tiktok-copy";

export type CanvasNodeKind = "prompt" | "media" | "generator" | "group";
export type CanvasMediaType = "image" | "video" | "audio";
export type CanvasGenerationKind = "image" | "video";
export type CanvasGeneratorStatus = "idle" | "queued" | "generating" | "done" | "failed";
export type CanvasReferenceRole = "identity" | "first-frame" | "last-frame" | "product" | "environment" | "motion" | "camera" | "timing" | "audio" | "style";
export type CanvasCommerceDirection = "human-wear" | "sport-motion" | "daily-style" | "product-asmr" | "handheld" | "malay-review";
export type CanvasCommerceCreativeStyle = "pain-point" | "contrast" | "motion";

export type CanvasCommerceCreativeOption = {
  id: string;
  style: CanvasCommerceCreativeStyle;
  title: string;
  hookLine: string;
  scene: string;
  visualBeat: string;
};

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

export type CanvasCommerceProductImage = {
  nodeId: string;
  libraryItemId?: string;
  title: string;
};

export type CanvasCommercePlanHook = {
  visualPatternId: string;
  copyPatternId: string;
  title: string;
  reason: string;
  hookLine: string;
  onScreenText: string;
  scene: string;
  visualBeat: string;
};

export type CanvasCommercePlan = {
  id: string;
  direction: CanvasCommerceDirection;
  title: string;
  sellingPoint: string;
  prompt: string;
  referenceBindings: CanvasReferenceBinding[];
  hook?: CanvasCommercePlanHook;
  publishingCopy?: TikTokCopyDraft;
  selected: boolean;
  providerId?: string;
  createdGroupId?: string;
  createdPromptNodeId?: string;
  createdGeneratorNodeId?: string;
};

export type CanvasCommerceProductDraft = {
  id: string;
  createdAt: string;
  updatedAt: string;
  images: CanvasCommerceProductImage[];
  productName: string;
  sellingPoints: string[];
  visibleFacts: string[];
  recommendedDirections: CanvasCommerceDirection[];
  selectedDirections: CanvasCommerceDirection[];
  directionSellingPoints: Partial<Record<CanvasCommerceDirection, string>>;
  creativeOptions?: CanvasCommerceCreativeOption[];
  selectedCreativeOptionId?: string;
  plans: CanvasCommercePlan[];
  sharedProviderId?: string;
  extraRequirements: string;
  phase: "setup" | "product-ready" | "planning" | "plans-ready" | "error";
  error?: string;
};

export type CanvasCommerceAssistantState = {
  products: Record<string, CanvasCommerceProductDraft>;
};

export type CanvasNodeData = Record<string, unknown> & {
  kind: CanvasNodeKind;
  title: string;
  createdAt?: string;
  completedAt?: string;
  generationStartedAt?: string;
  generationRequestId?: string;
  fileSize?: number;
  mediaOrigin?: "upload" | "generated";
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
  ratioAutoAdjusted?: boolean;
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
  assistantProductId?: string;
  assistantPlanId?: string;
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
  assistantState?: {
    commerce?: CanvasCommerceAssistantState;
  };
};

export type CanvasProject = {
  id: string;
  title: string;
  document: CanvasProjectDocument;
  version: number;
  createdAt: string;
  updatedAt: string;
};
