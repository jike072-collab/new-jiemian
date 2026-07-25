"use client";

import Link from "next/link";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceBetween,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceBetween,
  Copy,
  CopyPlus,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  CircleHelp,
  ArrowDown,
  ArrowUp,
  Bot,
  Eraser,
  Film,
  FolderOpen,
  Image as ImageIcon,
  Info,
  Keyboard,
  Eye,
  EyeOff,
  Layers3,
  LayoutDashboard,
  LoaderCircle,
  Link2,
  ListChecks,
  Lock,
  Maximize2,
  MousePointer2,
  MoreHorizontal,
  Music,
  PanelLeftClose,
  PanelLeftOpen,
  Palette,
  Play,
  Plus,
  Redo2,
  RefreshCw,
  Save,
  Scissors,
  Search,
  Send,
  Settings2,
  Sparkles,
  Star,
  Undo2,
  Ungroup,
  Unlock,
  Trash2,
  Type,
  Upload,
  UsersRound,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  reconnectEdge,
  SelectionMode,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange,
  type OnConnectEnd,
  type OnSelectionChangeParams,
  type Viewport,
} from "@xyflow/react";

import { BrandLogo } from "@/components/brand-logo";
import { CanvasAssistantPanel, type CanvasAssistantNodeContext } from "@/components/canvas/canvas-assistant-panel";
import { CanvasCommandPalette, type CanvasCommand } from "@/components/canvas/canvas-command-palette";
import { CanvasSelectionHint, CanvasShortcutsPanel } from "@/components/canvas/canvas-shortcuts-panel";
import {
  CanvasBezierConnectionLine,
  CanvasEdge,
  CanvasSmoothStepConnectionLine,
  CanvasStraightConnectionLine,
} from "@/components/canvas/canvas-edge";
import { CanvasImageEditor } from "@/components/canvas/canvas-image-editor";
import { CanvasMediaViewer } from "@/components/canvas/canvas-media-viewer";
import { CanvasTikTokPublisher, type CanvasTikTokCopyState } from "@/components/canvas/canvas-tiktok-publisher";
import { CanvasVideoTrimmer } from "@/components/canvas/canvas-video-trimmer";
import { CanvasVideoPreview } from "@/components/canvas/canvas-video-preview";
import { CanvasVozebTopbar } from "@/components/canvas/canvas-vozeb-shell";
import {
  CanvasGroupNode,
  CanvasNode,
  CanvasNodeActionsContext,
  type CanvasPromptReference,
  type CanvasFlowNode,
  type GeneratorInputSummary,
} from "@/components/canvas/canvas-node";
import type { EnabledProviders, WorkspacePublicProvider } from "@/components/studio/types";
import {
  estimateImageGenerationEntitlementUnits,
  estimateImageGenerationTotalQuota,
  estimateVideoGenerationEntitlementUnits,
  estimateVideoGenerationQuota,
  generationBillingFingerprint,
} from "@/lib/generation-quota";
import { ApiError, fetchJson, fetchJsonWithCsrf } from "@/lib/client/api";
import type {
  CanvasMediaType,
  CanvasNodeData,
  CanvasProject,
  CanvasProjectDocument,
  CanvasSequenceState,
  CanvasStoredEdge,
  CanvasStoredNode,
} from "@/lib/canvas/types";
import { normalizeCanvasDocument, removeUnavailableLibraryItemsFromCanvasDocument } from "@/lib/canvas/document";
import { duplicateCanvasNodeData } from "@/lib/canvas/duplicate";
import { canvasDropMediaType, collectCanvasFolderDropFiles, isSupportedCanvasDropFile, MAX_CANVAS_FOLDER_FILES } from "@/lib/canvas/folder-drop";
import {
  CANVAS_IMAGE_RATIOS,
  canvasMediaNodeSize,
  nearestCanvasAspectRatio,
  normalizeMediaDimensions,
} from "@/lib/canvas/media-sizing";
import {
  canvasImageResultGrid,
  INTERNAL_CANVAS_IMAGE_REQUEST_CONCURRENCY,
  planCanvasImageRequests,
} from "@/lib/canvas/image-batch";
import { mergeCanvasWorkspace } from "@/lib/canvas/merge";
import { layoutCanvasFlowNodes } from "@/lib/canvas/layout";
import { matchPendingGeneratedMedia } from "@/lib/canvas/pending-results";
import {
  canvasPresenceMembersForNode,
  dedupeCanvasPresenceMembers,
  type CanvasPresenceMember,
} from "@/lib/canvas/presence";
import { normalizeCanvasAssistantResponse, type CanvasAssistantAction } from "@/lib/canvas/assistant";
import type { FrontendProvider, JobRecord, LibraryItem } from "@/lib/server/types";
import { cn } from "@/lib/utils";

type SaveState = "saved" | "dirty" | "saving" | "error";
type CanvasPresentation = "classic" | "vozeb";
type LibraryFilter = "all" | "image" | "video";
type CanvasWorkspaceSnapshot = {
  title: string;
  document: CanvasProjectDocument;
};
type DeferredCanvasSync = {
  base: CanvasWorkspaceSnapshot;
  project: CanvasProject;
  notice: string;
};
type CanvasTheme = "midnight" | "light";
type ConnectionStyle = "bezier" | "smoothstep" | "straight";
type CanvasLibraryResponse = { items: LibraryItem[]; recoveryItems?: LibraryItem[] };
type CanvasContextMenuState = {
  kind: "pane" | "node" | "edge" | "connection";
  left: number;
  top: number;
  flowPosition: { x: number; y: number };
  nodeId?: string;
  edgeId?: string;
  sourceNodeId?: string;
};
type CanvasClipboard = { nodes: CanvasFlowNode[]; edges: Edge[] };
type CanvasBatchArrangeMode = "left" | "horizontal-center" | "right" | "top" | "vertical-center" | "bottom" | "distribute-horizontal" | "distribute-vertical";
type CanvasMediaReference = {
  id: string;
  type: CanvasMediaType;
  title: string;
  output?: { url: string; mimeType?: string };
};

const nodeTypes = { canvas: CanvasNode, group: CanvasGroupNode };
const edgeTypes = { "canvas-edge": CanvasEdge };
const connectionLineComponents = {
  bezier: CanvasBezierConnectionLine,
  smoothstep: CanvasSmoothStepConnectionLine,
  straight: CanvasStraightConnectionLine,
};
const emptyProviders: EnabledProviders = { image: [], video: [] };
const defaultViewport: Viewport = { x: 0, y: 0, zoom: 1 };
const libraryDragType = "application/x-aohuang-library-item";

function canvasConnectionError(
  connection: Connection | Edge,
  nodes: readonly CanvasFlowNode[],
  edges: readonly Edge[],
  providers: EnabledProviders,
  ignoredEdgeId?: string,
) {
  if (!connection.source || !connection.target || connection.source === connection.target) return "连接节点无效。";
  const source = nodes.find((node) => node.id === connection.source);
  const target = nodes.find((node) => node.id === connection.target);
  if (!source || target?.data.kind !== "generator") return "只能连接到生成节点。";
  if (source.data.kind !== "prompt" && source.data.kind !== "media") return "只有提示词或素材节点可以作为输入。";
  if (edges.some((edge) => edge.id !== ignoredEdgeId && edge.source === connection.source && edge.target === connection.target)) return "该节点已经连接到此生成节点。";
  if (source.data.kind === "prompt") return null;

  const mediaType = source.data.mediaType || "image";
  if (target.data.generationKind === "image") {
    return mediaType === "image" ? null : "图片生成节点只支持图片素材。";
  }
  if (target.data.generationKind !== "video") return "当前生成节点没有可用的视频能力。";

  const provider = providers.video.find((item) => item.id === target.data.providerId) || providers.video[0];
  if (!provider) return "当前没有可用的视频模型。";
  const options = provider.videoOptions;
  if (mediaType === "video" && options?.supportsVideoReference === false) return "当前视频模型不支持参考视频。";
  if (mediaType === "audio" && options?.supportsAudioReference === false) return "当前视频模型不支持参考音频。";
  const limit = mediaType === "image"
    ? options?.maxReferenceImages ?? 1
    : mediaType === "video"
      ? options?.maxReferenceVideos ?? 0
      : options?.maxReferenceAudios ?? 0;
  if (!limit) return `当前视频模型不支持参考${mediaType === "video" ? "视频" : mediaType === "audio" ? "音频" : "图"}。`;
  const connected = edges.filter((edge) => edge.id !== ignoredEdgeId && edge.target === target.id)
    .map((edge) => nodes.find((node) => node.id === edge.source))
    .filter((node): node is CanvasFlowNode => Boolean(node?.data.kind === "media" && (node.data.mediaType || "image") === mediaType));
  if (connected.length >= limit) return `当前视频模型最多支持 ${limit} 个参考${mediaType === "image" ? "图" : mediaType === "video" ? "视频" : "音频"}。`;
  return null;
}

function canvasNodeDragHandle(kind: CanvasNodeData["kind"]) {
  return kind === "group" ? ".canvas-node-group__header" : ".canvas-node__header";
}

function decorateCanvasEdge(edge: Edge | CanvasStoredEdge, nodes: Array<CanvasFlowNode | CanvasStoredNode>, routing: ConnectionStyle): Edge {
  void nodes;
  const data = "data" in edge && edge.data && typeof edge.data === "object" ? edge.data : {};
  return {
    ...edge,
    type: "canvas-edge",
    data: { ...data, routing },
  };
}

function adjustConnectedGeneratorRatios(nodes: CanvasFlowNode[], edges: Edge[], providers: EnabledProviders) {
  let changed = false;
  const nextNodes = nodes.map((generator) => {
    if (generator.data.kind !== "generator" || generator.data.ratioAutoAdjusted) return generator;
    const source = edges
      .filter((edge) => edge.target === generator.id)
      .map((edge) => nodes.find((node) => node.id === edge.source))
      .find((node) => node?.data.kind === "media" && node.data.mediaType !== "audio");
    if (!source?.data.intrinsicWidth || !source.data.intrinsicHeight) return generator;

    const providerList = generator.data.generationKind === "video" ? providers.video : providers.image;
    const provider = providerList.find((item) => item.id === generator.data.providerId) || providerList[0];
    const ratios = generator.data.generationKind === "video"
      ? provider?.videoOptions?.ratios?.length ? provider.videoOptions.ratios : ["16:9", "9:16", "1:1"]
      : CANVAS_IMAGE_RATIOS;
    const ratio = nearestCanvasAspectRatio(source.data.intrinsicWidth, source.data.intrinsicHeight, ratios);
    if (!ratio) return generator;
    changed = true;
    return { ...generator, data: { ...generator.data, ratio, ratioAutoAdjusted: true } };
  });
  return changed ? nextNodes : nodes;
}

function applyCanvasNodePresentation(nodes: CanvasFlowNode[], edges: Edge[]) {
  const inactiveGroups = new Set(nodes.filter((node) => node.data.kind === "group" && (node.data.collapsed || node.data.hidden)).map((node) => node.id));
  const hiddenNodes = new Set(nodes.filter((node) => node.data.hidden || (node.parentId && inactiveGroups.has(node.parentId))).map((node) => node.id));
  return {
    nodes: nodes.map((node) => {
      const hidden = hiddenNodes.has(node.id);
      return {
        ...node,
        hidden,
        selected: hidden ? false : node.selected,
        draggable: !node.data.locked,
        zIndex: Number(node.data.zIndex) || 0,
      };
    }),
    edges: edges.map((edge) => ({ ...edge, hidden: hiddenNodes.has(edge.source) || hiddenNodes.has(edge.target) })),
  };
}

function canvasScope() {
  if (typeof window === "undefined") return "shared" as const;
  return new URLSearchParams(window.location.search).get("scope") === "personal" ? "personal" as const : "shared" as const;
}

function sharedViewportStorageKey(accountName: string, projectId: string) {
  return `aohuang-canvas-shared-viewport:${accountName}:${projectId}`;
}

function readSharedViewport(accountName: string, projectId: string) {
  try {
    const value = JSON.parse(window.localStorage.getItem(sharedViewportStorageKey(accountName, projectId)) || "null") as Partial<Viewport> | null;
    if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y) || !Number.isFinite(value.zoom)) return null;
    return { x: Number(value.x), y: Number(value.y), zoom: Number(value.zoom) };
  } catch {
    return null;
  }
}

function writeSharedViewport(accountName: string, projectId: string, viewport: Viewport) {
  try {
    window.localStorage.setItem(sharedViewportStorageKey(accountName, projectId), JSON.stringify(viewport));
  } catch {
    // Local viewport persistence is optional when browser storage is unavailable.
  }
}

function canvasProjectsUrl(id?: string) {
  const base = id ? `/api/canvas/projects/${encodeURIComponent(id)}` : "/api/canvas/projects";
  return `${base}?scope=${canvasScope()}`;
}

function canvasLibraryUrl() {
  return `/api/library?scope=${canvasScope()}`;
}

function canvasJobUrl(id: string) {
  return `/api/jobs/${encodeURIComponent(id)}?scope=${canvasScope()}`;
}

function canvasLibraryMediaUrl(id: string, revision?: string) {
  const query = new URLSearchParams({ scope: canvasScope() });
  if (revision) query.set("v", revision);
  return `/api/library/${encodeURIComponent(id)}/media?${query}`;
}

function canvasLibraryThumbnailUrl(item: LibraryItem) {
  const url = item.output?.url || "";
  if (!url.startsWith("/api/")) return url;
  return `${url}${url.includes("?") ? "&" : "?"}view=thumb&v=${encodeURIComponent(item.updatedAt)}`;
}

function canvasProjectEventsUrl(id: string, clientId: string) {
  const query = new URLSearchParams({ scope: canvasScope(), client: clientId });
  return `/api/canvas/projects/${encodeURIComponent(id)}/events?${query}`;
}

function canvasProjectPresenceUrl(id: string, clientId?: string) {
  const query = new URLSearchParams({ scope: canvasScope() });
  if (clientId) query.set("client", clientId);
  return `/api/canvas/projects/${encodeURIComponent(id)}/presence?${query}`;
}

function storedCanvasSettings(presentation: CanvasPresentation) {
  const defaults = { theme: "midnight" as CanvasTheme, connectionStyle: "bezier" as ConnectionStyle, snapEnabled: false };
  if (typeof window === "undefined") return defaults;
  try {
    const storageKey = presentation === "vozeb" ? "aohuang-canvas-v2-settings" : "aohuang-canvas-settings";
    const value = JSON.parse(window.localStorage.getItem(storageKey) || "{}") as Partial<typeof defaults>;
    return {
      theme: (["midnight", "light"] as const).includes(value.theme as CanvasTheme) ? value.theme as CanvasTheme : defaults.theme,
      connectionStyle: (["bezier", "smoothstep", "straight"] as const).includes(value.connectionStyle as ConnectionStyle) ? value.connectionStyle as ConnectionStyle : defaults.connectionStyle,
      snapEnabled: Boolean(value.snapEnabled),
    };
  } catch {
    return defaults;
  }
}

function shouldShowShortcutHint() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem("aohuang-canvas-shortcuts-seen") !== "1";
  } catch {
    return true;
  }
}

function markShortcutHintSeen() {
  try {
    window.localStorage.setItem("aohuang-canvas-shortcuts-seen", "1");
  } catch {
    // The hint can still be dismissed for the current page when storage is unavailable.
  }
}

function escapeXml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&apos;",
  })[character] || character);
}

function copyableCanvasSelection(nodes: CanvasFlowNode[]) {
  const selectedIds = new Set(nodes.filter((node) => node.selected).map((node) => node.id));
  const selected = nodes.filter((node) => selectedIds.has(node.id) || Boolean(node.parentId && selectedIds.has(node.parentId)));
  const includedIds = new Set(selected.map((node) => node.id));
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  return selected.map((node) => {
    const copy = { ...node, data: { ...node.data } };
    if (!node.parentId || includedIds.has(node.parentId)) return copy;
    const parent = nodesById.get(node.parentId);
    delete copy.parentId;
    delete copy.extent;
    delete copy.expandParent;
    return {
      ...copy,
      position: parent ? { x: parent.position.x + node.position.x, y: parent.position.y + node.position.y } : node.position,
    };
  });
}

export function CanvasWorkspace({
  accountName,
  isTeamOwner,
  isInternalCanvas,
  presentation = "classic",
}: {
  accountName: string;
  isTeamOwner: boolean;
  isInternalCanvas?: boolean;
  presentation?: CanvasPresentation;
}) {
  return (
    <ReactFlowProvider>
      <CanvasWorkspaceInner
        accountName={accountName}
        isTeamOwner={isTeamOwner}
        isInternalCanvas={Boolean(isInternalCanvas)}
        presentation={presentation}
      />
    </ReactFlowProvider>
  );
}

function CanvasWorkspaceInner({
  accountName,
  isTeamOwner,
  isInternalCanvas,
  presentation,
}: {
  accountName: string;
  isTeamOwner: boolean;
  isInternalCanvas: boolean;
  presentation: CanvasPresentation;
}) {
  const flow = useReactFlow<CanvasFlowNode, Edge>();
  const flowRef = useRef(flow);
  const [nodes, setNodes] = useState<CanvasFlowNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [projects, setProjects] = useState<CanvasProject[]>([]);
  const [activeProjectId, setActiveProjectId] = useState("");
  const [title, setTitle] = useState("未命名画布");
  const [viewport, setViewportState] = useState<Viewport>(defaultViewport);
  const [providers, setProviders] = useState<EnabledProviders>(emptyProviders);
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [libraryOpen, setLibraryOpen] = useState(presentation === "classic");
  const [libraryFilter, setLibraryFilter] = useState<LibraryFilter>("all");
  const [librarySearch, setLibrarySearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [notice, setNotice] = useState("");
  const [infoOpen, setInfoOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantMentionMode, setAssistantMentionMode] = useState(false);
  const [assistantMentionSelection, setAssistantMentionSelection] = useState<{ nodeId: string; revision: number } | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandInsertPosition, setCommandInsertPosition] = useState<{ x: number; y: number } | undefined>();
  const [selectionHintOpen, setSelectionHintOpen] = useState(() => presentation === "classic" && shouldShowShortcutHint());
  const [editingNodeId, setEditingNodeId] = useState("");
  const [previewingNodeId, setPreviewingNodeId] = useState("");
  const [trimmingLibraryItemId, setTrimmingLibraryItemId] = useState("");
  const [batchTrimming, setBatchTrimming] = useState(false);
  const [tiktokLibraryItemId, setTikTokLibraryItemId] = useState("");
  const [tiktokCopyDrafts, setTikTokCopyDrafts] = useState<Record<string, CanvasTikTokCopyState>>({});
  const [teamOpen, setTeamOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const [touchMultiSelect, setTouchMultiSelect] = useState(false);
  const [contextMenu, setContextMenu] = useState<CanvasContextMenuState | null>(null);
  const [clipboardHasNodes, setClipboardHasNodes] = useState(false);
  const [canvasTheme, setCanvasTheme] = useState<CanvasTheme>(() => storedCanvasSettings(presentation).theme);
  const [connectionStyle, setConnectionStyle] = useState<ConnectionStyle>(() => storedCanvasSettings(presentation).connectionStyle);
  const [snapEnabled, setSnapEnabled] = useState(() => storedCanvasSettings(presentation).snapEnabled);
  const [syncState, setSyncState] = useState<"live" | "syncing" | "paused">("live");
  const [hoveredNodeId, setHoveredNodeId] = useState("");
  const [collaborationClientId] = useState(() => canvasId("client"));
  const [presenceMembers, setPresenceMembers] = useState<CanvasPresenceMember[]>([]);
  const [presenceEditingNodeId, setPresenceEditingNodeId] = useState("");
  const [presenceGeneratingNodeIds, setPresenceGeneratingNodeIds] = useState<string[]>([]);
  const [fileDropActive, setFileDropActive] = useState(false);

  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const projectsRef = useRef(projects);
  const libraryRef = useRef(library);
  const libraryRefreshPromiseRef = useRef<Promise<LibraryItem[]> | null>(null);
  const providersRef = useRef(providers);
  const titleRef = useRef(title);
  const viewportRef = useRef(viewport);
  const viewportInteractingRef = useRef(false);
  const stageRef = useRef<HTMLElement | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const mediaInputRef = useRef<HTMLInputElement | null>(null);
  const fileDragDepthRef = useRef(0);
  const clipboardRef = useRef<CanvasClipboard | null>(null);
  const activeProjectRef = useRef<CanvasProject | null>(null);
  const loadedRef = useRef(false);
  const revisionRef = useRef(0);
  const savedRevisionRef = useRef(0);
  const saveTimerRef = useRef<number | null>(null);
  const savePromiseRef = useRef<Promise<boolean> | null>(null);
  const queuedSaveRef = useRef(false);
  const deferredCanvasSyncRef = useRef<DeferredCanvasSync | null>(null);
  const focusedEditorNodeIdRef = useRef("");
  const contextMenuOpenRef = useRef(false);
  const selectionActiveRef = useRef(false);
  const historyPastRef = useRef<CanvasWorkspaceSnapshot[]>([]);
  const historyFutureRef = useRef<CanvasWorkspaceSnapshot[]>([]);
  const historySignatureRef = useRef("");
  const [historyState, setHistoryState] = useState({ undo: 0, redo: 0 });
  const saveNowRef = useRef<(force?: boolean) => Promise<boolean>>(async () => true);
  const presencePayloadRef = useRef({ selectedNodeIds: [] as string[], editingNodeId: "", generatingNodeIds: [] as string[] });
  const presenceSendTimerRef = useRef<number | null>(null);

  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  useEffect(() => { edgesRef.current = edges; }, [edges]);
  useEffect(() => { projectsRef.current = projects; }, [projects]);
  useEffect(() => { libraryRef.current = library; }, [library]);
  useEffect(() => { providersRef.current = providers; }, [providers]);
  useEffect(() => { titleRef.current = title; }, [title]);
  useEffect(() => { viewportRef.current = viewport; }, [viewport]);

  const replaceCanvasElements = useCallback((nextNodes: CanvasFlowNode[], nextEdges: Edge[]) => {
    nodesRef.current = nextNodes;
    edgesRef.current = nextEdges;
    setNodes(nextNodes);
    setEdges(nextEdges);
  }, []);
  useEffect(() => { flowRef.current = flow; }, [flow]);
  useEffect(() => {
    const storageKey = presentation === "vozeb" ? "aohuang-canvas-v2-settings" : "aohuang-canvas-settings";
    window.localStorage.setItem(storageKey, JSON.stringify({ theme: canvasTheme, connectionStyle, snapEnabled }));
  }, [canvasTheme, connectionStyle, presentation, snapEnabled]);
  const openShortcuts = useCallback(() => {
    markShortcutHintSeen();
    setSelectionHintOpen(false);
    setAssistantOpen(false);
    setInfoOpen(false);
    setLayersOpen(false);
    setSettingsOpen(false);
    setShortcutsOpen(true);
  }, []);

  const handleAssistantMentionModeChange = useCallback((active: boolean) => {
    setAssistantMentionMode(active);
    if (!active) setAssistantMentionSelection(null);
  }, []);

  const dismissSelectionHint = useCallback(() => {
    markShortcutHintSeen();
    setSelectionHintOpen(false);
  }, []);

  const toggleShortcuts = useCallback(() => {
    if (shortcutsOpen) setShortcutsOpen(false);
    else openShortcuts();
  }, [openShortcuts, shortcutsOpen]);

  const openCommandPalette = useCallback((position?: { x: number; y: number }) => {
    setCommandInsertPosition(position);
    setContextMenu(null);
    setAssistantOpen(false);
    setInfoOpen(false);
    setLayersOpen(false);
    setSettingsOpen(false);
    setShortcutsOpen(false);
    setCommandOpen(true);
  }, []);

  const closeCommandPalette = useCallback(() => {
    setCommandOpen(false);
    setCommandInsertPosition(undefined);
  }, []);

  const changeConnectionStyle = useCallback((value: ConnectionStyle) => {
    setConnectionStyle(value);
    setEdges((current) => current.map((edge) => decorateCanvasEdge(edge, nodesRef.current, value)));
  }, []);
  useEffect(() => {
    const mobileViewport = window.matchMedia("(max-width: 820px)");
    const closeLibraryOnMobile = (matches: boolean) => {
      if (matches) setLibraryOpen(false);
    };
    closeLibraryOnMobile(mobileViewport.matches);
    const onViewportChange = (event: MediaQueryListEvent) => closeLibraryOnMobile(event.matches);
    mobileViewport.addEventListener("change", onViewportChange);
    return () => mobileViewport.removeEventListener("change", onViewportChange);
  }, []);

  const syncHistoryState = useCallback(() => {
    setHistoryState({ undo: historyPastRef.current.length, redo: historyFutureRef.current.length });
  }, []);

  const snapshotWorkspace = useCallback((): CanvasWorkspaceSnapshot => {
    const document = serializeDocument(nodesRef.current, edgesRef.current, viewportRef.current);
    if (canvasScope() === "shared" && activeProjectRef.current) {
      document.viewport = activeProjectRef.current.document.viewport;
    }
    return { title: titleRef.current, document };
  }, []);

  const pushHistorySnapshot = useCallback((snapshot = snapshotWorkspace()) => {
    const signature = JSON.stringify(snapshot);
    if (signature === historySignatureRef.current) return;
    historyPastRef.current.push(snapshot);
    if (historyPastRef.current.length > 50) historyPastRef.current.shift();
    historyFutureRef.current = [];
    historySignatureRef.current = signature;
    syncHistoryState();
  }, [snapshotWorkspace, syncHistoryState]);

  const resetHistory = useCallback(() => {
    historyPastRef.current = [];
    historyFutureRef.current = [];
    historySignatureRef.current = "";
    syncHistoryState();
  }, [syncHistoryState]);

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      void saveNowRef.current();
    }, 900);
  }, []);

  const markDirty = useCallback(() => {
    if (!loadedRef.current) return;
    revisionRef.current += 1;
    setSaveState("dirty");
    scheduleSave();
  }, [scheduleSave]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (!loadedRef.current) return;
      const adjusted = adjustConnectedGeneratorRatios(nodesRef.current, edgesRef.current, providersRef.current);
      if (adjusted === nodesRef.current) return;
      nodesRef.current = adjusted;
      setNodes(adjusted);
      markDirty();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [edges, markDirty, nodes, providers]);

  const hydrateMediaNodes = useCallback((sourceNodes: CanvasStoredNode[] | CanvasFlowNode[], items: LibraryItem[], preserveNonMedia = false) => {
    const itemMap = new Map(items.map((item) => [item.id, item]));
    const recoveredItemIds = matchPendingGeneratedMedia(sourceNodes, items);
    return sourceNodes.map((node) => {
      const dragHandle = canvasNodeDragHandle(node.data.kind);
      const libraryItemId = node.data.libraryItemId || recoveredItemIds.get(node.id);
      if (node.data.kind !== "media" || !libraryItemId) {
        if (preserveNonMedia && "dragHandle" in node) return node as CanvasFlowNode;
        return { ...node, type: node.data.kind === "group" ? "group" as const : "canvas" as const, dragHandle };
      }
      const item = itemMap.get(libraryItemId);
      if (!item) {
        const pending = node.data.status === "queued" || node.data.status === "generating";
        return {
          ...node,
          type: "canvas" as const,
          dragHandle,
          data: {
            ...node.data,
            libraryItemId,
            mediaUrl: pending ? undefined : node.data.mediaUrl || canvasLibraryMediaUrl(libraryItemId),
          },
        };
      }
      return {
        ...node,
        type: "canvas" as const,
        dragHandle,
        data: {
          ...node.data,
          libraryItemId,
          generationRequestId: undefined,
          title: item.title || node.data.title,
          mediaType: item.type,
          mediaUrl: item.output?.url?.startsWith("/api/library/")
            ? canvasLibraryMediaUrl(libraryItemId, item.updatedAt)
            : item.output?.url,
          status: libraryStatus(item),
          error: item.error || undefined,
          ...canvasMediaNodeMetadata(item),
        },
      };
    }) as CanvasFlowNode[];
  }, []);

  const applyWorkspaceDocument = useCallback((document: CanvasProjectDocument, items = libraryRef.current, projectId?: string) => {
    const hydratedNodes = hydrateMediaNodes(document.nodes, items);
    const hydrated = applyCanvasNodePresentation(
      hydratedNodes,
      document.edges.map((edge) => decorateCanvasEdge(edge, hydratedNodes, connectionStyle)),
    );
    nodesRef.current = hydrated.nodes;
    edgesRef.current = hydrated.edges;
    const nextViewport = canvasScope() === "shared"
      ? (projectId ? readSharedViewport(accountName, projectId) || document.viewport : viewportRef.current)
      : document.viewport;
    viewportRef.current = nextViewport;
    setNodes(hydrated.nodes);
    setEdges(hydrated.edges);
    setViewportState(nextViewport);
    void flowRef.current.setViewport(nextViewport, { duration: 0 });
  }, [accountName, connectionStyle, hydrateMediaNodes]);

  const activateProject = useCallback((project: CanvasProject, items = libraryRef.current) => {
    loadedRef.current = false;
    activeProjectRef.current = project;
    setActiveProjectId(project.id);
    titleRef.current = project.title;
    setTitle(project.title);
    applyWorkspaceDocument(project.document, items, project.id);
    revisionRef.current = 0;
    savedRevisionRef.current = 0;
    setSaveState("saved");
    setNotice("");
    setInfoOpen(false);
    window.requestAnimationFrame(() => {
      loadedRef.current = true;
    });
    resetHistory();
  }, [applyWorkspaceDocument, resetHistory]);

  const hasTransientCanvasInteraction = useCallback(() => (
    Boolean(focusedEditorNodeIdRef.current || contextMenuOpenRef.current || viewportInteractingRef.current || selectionActiveRef.current)
  ), []);

  const deferCanvasSync = useCallback((base: CanvasWorkspaceSnapshot, project: CanvasProject, notice: string) => {
    const current = deferredCanvasSyncRef.current;
    if (current && current.project.version > project.version) return;
    deferredCanvasSyncRef.current = {
      base: current?.base || base,
      project,
      notice,
    };
    setSyncState("syncing");
  }, []);

  const flushDeferredCanvasSync = useCallback(() => {
    if (hasTransientCanvasInteraction()) return;
    const deferred = deferredCanvasSyncRef.current;
    if (!deferred) return;
    deferredCanvasSyncRef.current = null;
    const hasLocalChanges = revisionRef.current !== savedRevisionRef.current;
    const merged = mergeCanvasWorkspace(deferred.base, snapshotWorkspace(), deferred.project);
    activeProjectRef.current = deferred.project;
    setProjects((current) => current
      .map((item) => item.id === deferred.project.id ? deferred.project : item)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    titleRef.current = merged.title;
    setTitle(merged.title);
    applyWorkspaceDocument(merged.document);
    setSyncState("live");
    if (deferred.notice) setNotice(deferred.notice);
    if (hasLocalChanges) {
      setSaveState("dirty");
      scheduleSave();
    }
  }, [applyWorkspaceDocument, hasTransientCanvasInteraction, scheduleSave, snapshotWorkspace]);

  const onSelectionChange = useCallback(({ nodes: selectedNodes, edges: selectedEdges }: OnSelectionChangeParams<CanvasFlowNode, Edge>) => {
    selectionActiveRef.current = selectedNodes.length > 0 || selectedEdges.length > 0;
    if (!selectionActiveRef.current && deferredCanvasSyncRef.current) {
      window.requestAnimationFrame(flushDeferredCanvasSync);
    }
  }, [flushDeferredCanvasSync]);

  const acceptRemoteProject = useCallback((project: CanvasProject) => {
    const active = activeProjectRef.current;
    if (!active || active.id !== project.id || project.version <= active.version) return;
    if (hasTransientCanvasInteraction()) {
      deferCanvasSync(active, project, "已在编辑结束后同步团队成员的画布更新。");
      return;
    }
    const hasLocalChanges = revisionRef.current !== savedRevisionRef.current;
    if (hasLocalChanges || savePromiseRef.current) {
      const merged = mergeCanvasWorkspace(active, snapshotWorkspace(), project);
      activeProjectRef.current = project;
      setProjects((current) => current
        .map((item) => item.id === project.id ? project : item)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
      titleRef.current = merged.title;
      setTitle(merged.title);
      applyWorkspaceDocument(merged.document);
      setSyncState("live");
      setNotice(merged.conflictCount
        ? `已合并团队更新，并按当前编辑处理 ${merged.conflictCount} 处冲突。`
        : "已实时合并团队成员的画布更新。");
      if (hasLocalChanges) {
        setSaveState("dirty");
        scheduleSave();
      }
      return;
    }
    activateProject(project);
    setSyncState("live");
    setNotice("已同步团队成员的最新画布。");
  }, [activateProject, applyWorkspaceDocument, deferCanvasSync, hasTransientCanvasInteraction, scheduleSave, snapshotWorkspace]);

  useEffect(() => {
    focusedEditorNodeIdRef.current = presenceEditingNodeId;
    contextMenuOpenRef.current = Boolean(contextMenu);
    if (presenceEditingNodeId || contextMenu || !deferredCanvasSyncRef.current) return;
    const frame = window.requestAnimationFrame(flushDeferredCanvasSync);
    return () => window.cancelAnimationFrame(frame);
  }, [contextMenu, flushDeferredCanvasSync, presenceEditingNodeId]);

  const reconcileCanvasLibrary = useCallback((items: LibraryItem[], persist = true) => {
    if (!activeProjectRef.current) return 0;
    const recoveredCount = matchPendingGeneratedMedia(nodesRef.current, items).size;
    const result = removeUnavailableLibraryItemsFromCanvasDocument(
      serializeDocument(nodesRef.current, edgesRef.current, viewportRef.current),
      items.map((item) => item.id),
    );
    if (!result.removedNodeIds.length) {
      setNodes((current) => hydrateMediaNodes(current, items, true));
      if (recoveredCount && persist) markDirty();
      return recoveredCount;
    }
    applyWorkspaceDocument(result.document, items);
    setNotice(`已自动清理 ${result.removedNodeIds.length} 个过期或已删除的素材节点。`);
    if (persist) markDirty();
    return result.removedNodeIds.length + recoveredCount;
  }, [applyWorkspaceDocument, hydrateMediaNodes, markDirty]);

  const refreshLibrary = useCallback(() => {
    if (libraryRefreshPromiseRef.current) return libraryRefreshPromiseRef.current;
    const refresh = (async () => {
      const data = await fetchJson<CanvasLibraryResponse>(canvasLibraryUrl());
      const hydrationItems = [...data.items, ...(data.recoveryItems || [])];
      libraryRef.current = data.items;
      setLibrary(data.items);
      reconcileCanvasLibrary(hydrationItems);
      return data.items;
    })().finally(() => {
      libraryRefreshPromiseRef.current = null;
    });
    libraryRefreshPromiseRef.current = refresh;
    return refresh;
  }, [reconcileCanvasLibrary]);

  const refreshProviders = useCallback(async () => {
    const data = await fetchJson<{ providers: EnabledProviders }>(`/api/providers/enabled?refresh=${Date.now()}`);
    providersRef.current = data.providers;
    setProviders(data.providers);
    return data.providers;
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadWorkspace() {
      setLoading(true);
      try {
        const [projectData, providerData, libraryData] = await Promise.all([
          fetchJson<{ projects: CanvasProject[] }>(canvasProjectsUrl()),
          fetchJson<{ providers: EnabledProviders }>(`/api/providers/enabled?refresh=${Date.now()}`),
          fetchJson<CanvasLibraryResponse>(canvasLibraryUrl()),
        ]);
        if (cancelled) return;
        let nextProjects = projectData.projects;
        if (!nextProjects.length) {
          const created = await fetchJsonWithCsrf<{ project: CanvasProject }>(canvasProjectsUrl(), {
            method: "POST",
            body: JSON.stringify({ title: "第一个画布", document: starterDocument() }),
          });
          nextProjects = [created.project];
        }
        if (cancelled) return;
        projectsRef.current = nextProjects;
        providersRef.current = providerData.providers;
        libraryRef.current = libraryData.items;
        setProjects(nextProjects);
        setProviders(providerData.providers);
        setLibrary(libraryData.items);
        const hydrationItems = [...libraryData.items, ...(libraryData.recoveryItems || [])];
        activateProject(nextProjects[0], hydrationItems);
        const removedCount = reconcileCanvasLibrary(hydrationItems, false);
        if (removedCount) window.requestAnimationFrame(() => markDirty());
      } catch (error) {
        if (!cancelled) setNotice(apiMessage(error, "画布加载失败。"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadWorkspace();
    return () => { cancelled = true; };
  }, [activateProject, markDirty, reconcileCanvasLibrary]);

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        void Promise.all([refreshLibrary(), refreshProviders()]).catch(() => undefined);
      }
    };
    const timer = window.setInterval(refreshWhenVisible, 60_000);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refreshLibrary, refreshProviders]);

  const saveNow = useCallback(async (force = false) => {
    const pendingSave = savePromiseRef.current;
    if (pendingSave) {
      queuedSaveRef.current = true;
      if (!(await pendingSave)) return false;
      if (revisionRef.current !== savedRevisionRef.current) return saveNowRef.current(force);
      return true;
    }
    const project = activeProjectRef.current;
    if (!project || !loadedRef.current) return true;
    if (!force && revisionRef.current === savedRevisionRef.current) return true;
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    queuedSaveRef.current = false;
    const snapshotRevision = revisionRef.current;
    const submitted = snapshotWorkspace();
    setSaveState("saving");
    const savePromise = (async () => {
      try {
        const response = await fetchJsonWithCsrf<{ project: CanvasProject; merged: boolean; conflictCount: number }>(canvasProjectsUrl(project.id), {
          method: "PATCH",
          body: JSON.stringify({
            title: submitted.title,
            document: submitted.document,
            version: project.version,
            baseTitle: project.title,
            baseDocument: project.document,
            sourceId: collaborationClientId,
          }),
        });
        activeProjectRef.current = response.project;
        setProjects((current) => current
          .map((item) => item.id === response.project.id ? response.project : item)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
        setSyncState("live");
        if (revisionRef.current === snapshotRevision) {
          savedRevisionRef.current = snapshotRevision;
          if (response.merged) {
            if (hasTransientCanvasInteraction()) {
              deferCanvasSync(project, response.project, "已在编辑结束后应用合并的团队更新。");
            } else {
              titleRef.current = response.project.title;
              setTitle(response.project.title);
              applyWorkspaceDocument(response.project.document);
            }
          }
          setSaveState("saved");
        } else {
          savedRevisionRef.current = snapshotRevision;
          queuedSaveRef.current = true;
          setSaveState("dirty");
          if (hasTransientCanvasInteraction()) {
            deferCanvasSync(project, response.project, "已在编辑结束后合并保存期间的团队更新。");
          } else {
            const mergedLive = mergeCanvasWorkspace(submitted, snapshotWorkspace(), response.project);
            activeProjectRef.current = response.project;
            titleRef.current = mergedLive.title;
            setTitle(mergedLive.title);
            applyWorkspaceDocument(mergedLive.document);
          }
        }
        if (response.merged) {
          setNotice(response.conflictCount
            ? `已保存并处理 ${response.conflictCount} 处并发冲突。`
            : "已保存并合并团队成员的同时修改。");
        }
        return true;
      } catch (error) {
        setSaveState("error");
        setNotice(apiMessage(error, "画布保存失败。"));
        return false;
      } finally {
        if (queuedSaveRef.current && revisionRef.current !== savedRevisionRef.current) scheduleSave();
      }
    })();
    savePromiseRef.current = savePromise;
    try {
      return await savePromise;
    } finally {
      if (savePromiseRef.current === savePromise) savePromiseRef.current = null;
    }
  }, [applyWorkspaceDocument, collaborationClientId, deferCanvasSync, hasTransientCanvasInteraction, scheduleSave, snapshotWorkspace]);

  useEffect(() => { saveNowRef.current = saveNow; }, [saveNow]);
  useEffect(() => () => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
  }, []);

  const presenceSelectedNodeIds = useMemo(
    () => nodes.filter((node) => node.selected && !node.hidden).map((node) => node.id).slice(0, 50),
    [nodes],
  );
  const sharedPresenceEnabled = isInternalCanvas && canvasScope() === "shared";
  const postPresence = useCallback(async () => {
    if (!sharedPresenceEnabled || !activeProjectId) return;
    const payload = presencePayloadRef.current;
    const data = await fetchJsonWithCsrf<{ presences: CanvasPresenceMember[] }>(canvasProjectPresenceUrl(activeProjectId), {
      method: "POST",
      body: JSON.stringify({
        clientId: collaborationClientId,
        selectedNodeIds: payload.selectedNodeIds,
        editingNodeId: payload.editingNodeId || undefined,
        generatingNodeIds: payload.generatingNodeIds,
      }),
    });
    setPresenceMembers(data.presences);
  }, [activeProjectId, collaborationClientId, sharedPresenceEnabled]);

  useEffect(() => {
    presencePayloadRef.current = {
      selectedNodeIds: presenceSelectedNodeIds,
      editingNodeId: presenceEditingNodeId,
      generatingNodeIds: presenceGeneratingNodeIds,
    };
    if (!sharedPresenceEnabled || !activeProjectId) return;
    if (presenceSendTimerRef.current) window.clearTimeout(presenceSendTimerRef.current);
    presenceSendTimerRef.current = window.setTimeout(() => {
      presenceSendTimerRef.current = null;
      void postPresence().catch(() => setSyncState("paused"));
    }, 160);
    return () => {
      if (presenceSendTimerRef.current) window.clearTimeout(presenceSendTimerRef.current);
      presenceSendTimerRef.current = null;
    };
  }, [activeProjectId, postPresence, presenceEditingNodeId, presenceGeneratingNodeIds, presenceSelectedNodeIds, sharedPresenceEnabled]);

  useEffect(() => {
    if (!sharedPresenceEnabled || !activeProjectId) return;
    void postPresence().catch(() => setSyncState("paused"));
    const heartbeat = window.setInterval(() => {
      void postPresence().catch(() => setSyncState("paused"));
    }, 10_000);
    const presenceUrl = canvasProjectPresenceUrl(activeProjectId, collaborationClientId);
    return () => {
      window.clearInterval(heartbeat);
      setPresenceMembers([]);
      void fetchJsonWithCsrf(presenceUrl, { method: "DELETE" }).catch(() => undefined);
    };
  }, [activeProjectId, collaborationClientId, postPresence, sharedPresenceEnabled]);

  useEffect(() => {
    if (!isInternalCanvas || !activeProjectId) return;
    const source = new EventSource(canvasProjectEventsUrl(activeProjectId, collaborationClientId));
    const onProject = (event: MessageEvent<string>) => {
      try {
        const value = JSON.parse(event.data) as { project?: CanvasProject };
        if (value.project) acceptRemoteProject(value.project);
      } catch {
        setSyncState("paused");
      }
    };
    const onDeleted = () => {
      setSyncState("paused");
      setNotice("当前画布已被团队成员删除，正在刷新画布列表。");
      window.setTimeout(() => window.location.reload(), 300);
    };
    const onPresence = (event: MessageEvent<string>) => {
      try {
        const value = JSON.parse(event.data) as { presences?: CanvasPresenceMember[] };
        setPresenceMembers(Array.isArray(value.presences) ? value.presences : []);
      } catch {
        setSyncState("paused");
      }
    };
    source.addEventListener("project", onProject as EventListener);
    source.addEventListener("deleted", onDeleted);
    source.addEventListener("presence", onPresence as EventListener);
    source.onopen = () => setSyncState("live");
    source.onerror = () => setSyncState("paused");
    return () => {
      source.removeEventListener("project", onProject as EventListener);
      source.removeEventListener("deleted", onDeleted);
      source.removeEventListener("presence", onPresence as EventListener);
      source.close();
    };
  }, [acceptRemoteProject, activeProjectId, collaborationClientId, isInternalCanvas]);

  const updateNodeData = useCallback((id: string, patch: Partial<CanvasNodeData>, persist = true) => {
    if (patch.status && patch.status !== "queued" && patch.status !== "generating") {
      setPresenceGeneratingNodeIds((current) => current.includes(id) ? current.filter((nodeId) => nodeId !== id) : current);
    }
    if (persist) pushHistorySnapshot();
    setNodes((current) => current.map((node) => node.id === id
      ? { ...node, data: { ...node.data, ...patch } }
      : node));
    if (persist) markDirty();
  }, [markDirty, pushHistorySnapshot]);

  const registerMediaDimensions = useCallback((id: string, width: number, height: number) => {
    const dimensions = normalizeMediaDimensions(width, height);
    const size = canvasMediaNodeSize(width, height);
    if (!dimensions || !size) return;
    const mediaNode = nodesRef.current.find((node) => node.id === id && node.data.kind === "media" && node.data.mediaType !== "audio");
    if (!mediaNode) return;
    if (
      mediaNode.data.intrinsicWidth === dimensions.width
      && mediaNode.data.intrinsicHeight === dimensions.height
      && mediaNode.width === size.width
      && mediaNode.height === size.height
    ) return;
    setNodes((current) => current.map((node) => node.id === id ? {
      ...node,
      width: size.width,
      height: size.height,
      style: { ...node.style, width: size.width, height: size.height },
      data: {
        ...node.data,
        intrinsicWidth: dimensions.width,
        intrinsicHeight: dimensions.height,
      },
    } : node));
    markDirty();
  }, [markDirty]);

  const removeNode = useCallback((id: string) => {
    const ids = new Set([id]);
    nodesRef.current.forEach((node) => { if (node.parentId === id) ids.add(node.id); });
    pushHistorySnapshot();
    const nextNodes = nodesRef.current.filter((node) => !ids.has(node.id));
    const nextEdges = edgesRef.current.filter((edge) => !ids.has(edge.source) && !ids.has(edge.target));
    replaceCanvasElements(nextNodes, nextEdges);
    markDirty();
  }, [markDirty, pushHistorySnapshot, replaceCanvasElements]);

  const toggleGroupCollapsed = useCallback((id: string) => {
    const group = nodesRef.current.find((node) => node.id === id && node.data.kind === "group");
    if (!group) return;
    pushHistorySnapshot();
    const collapsed = !group.data.collapsed;
    const expandedWidth = collapsed ? group.width || 640 : Number(group.data.expandedWidth) || 640;
    const expandedHeight = collapsed ? group.height || 480 : Number(group.data.expandedHeight) || 480;
    const nextNodes = nodesRef.current.map((node) => {
      if (node.id === id) {
        const width = collapsed ? 280 : expandedWidth;
        const height = collapsed ? 44 : expandedHeight;
        return {
          ...node,
          width,
          height,
          style: { ...node.style, width, height },
          data: { ...node.data, collapsed, expandedWidth, expandedHeight },
        };
      }
      if (node.parentId === id) return { ...node, hidden: collapsed, selected: collapsed ? false : node.selected };
      return node;
    });
    const presented = applyCanvasNodePresentation(nextNodes, edgesRef.current);
    setNodes(presented.nodes);
    setEdges(presented.edges);
    markDirty();
  }, [markDirty, pushHistorySnapshot]);

  const updateNodeLayerState = useCallback((id: string, patch: Pick<CanvasNodeData, "hidden" | "locked">) => {
    if (!nodesRef.current.some((node) => node.id === id)) return;
    pushHistorySnapshot();
    const nextNodes = nodesRef.current.map((node) => node.id === id ? { ...node, data: { ...node.data, ...patch } } : node);
    const presented = applyCanvasNodePresentation(nextNodes, edgesRef.current);
    setNodes(presented.nodes);
    setEdges(presented.edges);
    markDirty();
  }, [markDirty, pushHistorySnapshot]);

  const moveNodeLayer = useCallback((id: string, direction: "front" | "back") => {
    const node = nodesRef.current.find((item) => item.id === id);
    if (!node) return;
    pushHistorySnapshot();
    const levels = nodesRef.current.map((item) => Number(item.data.zIndex) || 0);
    const zIndex = direction === "front" ? Math.max(...levels, 0) + 1 : Math.min(...levels, 0) - 1;
    const nextNodes = nodesRef.current.map((item) => item.id === id ? { ...item, data: { ...item.data, zIndex }, zIndex } : item);
    setNodes(nextNodes);
    markDirty();
  }, [markDirty, pushHistorySnapshot]);

  const addNodeAtCenter = useCallback((data: CanvasNodeData, size: { width: number; height: number }, preferredCenter?: { x: number; y: number }) => {
    pushHistorySnapshot();
    const stageBounds = stageRef.current?.getBoundingClientRect();
    const position = preferredCenter || flow.screenToFlowPosition({
      x: stageBounds ? stageBounds.left + stageBounds.width / 2 : window.innerWidth / 2,
      y: stageBounds ? stageBounds.top + stageBounds.height / 2 : window.innerHeight / 2,
    });
    const basePosition = { x: position.x - size.width / 2, y: position.y - size.height / 2 };
    const spacingX = size.width + 48;
    const spacingY = size.height + 48;
    const offsets: Array<[number, number]> = [
      [0, 0], [spacingX, 0], [-spacingX, 0], [0, spacingY], [0, -spacingY],
      [spacingX, spacingY], [-spacingX, spacingY], [spacingX, -spacingY], [-spacingX, -spacingY],
    ];
    const availablePosition = offsets
      .map(([x, y]) => ({ x: basePosition.x + x, y: basePosition.y + y }))
      .find((candidate) => nodesRef.current.every((existing) => {
        const width = existing.width || 320;
        const height = existing.height || 280;
        return candidate.x + size.width + 24 <= existing.position.x
          || existing.position.x + width + 24 <= candidate.x
          || candidate.y + size.height + 24 <= existing.position.y
          || existing.position.y + height + 24 <= candidate.y;
      }));
    const node: CanvasFlowNode = {
      id: canvasId("node"),
      type: "canvas",
      dragHandle: canvasNodeDragHandle(data.kind),
      position: availablePosition || {
        x: basePosition.x + nodesRef.current.length * 32,
        y: basePosition.y + nodesRef.current.length * 32,
      },
      width: size.width,
      height: size.height,
      selected: true,
      data,
    };
    const nextNodes = [...nodesRef.current.map((current) => ({ ...current, selected: false })), node];
    nodesRef.current = nextNodes;
    setNodes(nextNodes);
    setEdges((current) => current.map((edge) => ({ ...edge, selected: false })));
    markDirty();
    window.requestAnimationFrame(() => {
      void flowRef.current.setCenter(node.position.x + size.width / 2, node.position.y + size.height / 2, {
        duration: 220,
        zoom: Math.max(flowRef.current.getZoom(), 0.7),
      });
    });
    return node;
  }, [flow, markDirty, pushHistorySnapshot]);

  const addPromptNode = useCallback((input?: { title?: string; prompt?: string }, position?: { x: number; y: number }) => {
    return addNodeAtCenter({
      kind: "prompt",
      title: input?.title?.trim().slice(0, 80) || "提示词",
      prompt: input?.prompt?.trim().slice(0, 4_000) || "",
      createdAt: new Date().toISOString(),
    }, { width: 320, height: 230 }, position);
  }, [addNodeAtCenter]);

  const addGeneratorNode = useCallback((kind: "image" | "video", position?: { x: number; y: number }) => {
    const available = kind === "image" ? providersRef.current.image : providersRef.current.video;
    const provider = available[0] as WorkspacePublicProvider | undefined;
    return addNodeAtCenter({
      kind: "generator",
      title: kind === "image" ? "图片生成" : "视频生成",
      generationKind: kind,
      providerId: provider?.id || "",
      model: provider?.model || "",
      createdAt: new Date().toISOString(),
      ...(kind === "image" ? { count: 1 } : {}),
      ratio: kind === "image" ? "1:1" : provider?.videoOptions?.ratios?.[0] || "16:9",
      quality: "1k",
      duration: provider?.videoOptions?.durations?.[0] || 5,
      resolution: provider?.videoOptions?.resolutions?.[0] || provider?.videoOptions?.resolution || "720p",
      status: "idle",
      progress: 0,
    }, { width: 360, height: 370 }, position);
  }, [addNodeAtCenter]);

  const createGeneratorFromSelected = useCallback((node: CanvasFlowNode, kind: "image" | "video") => {
    const available = kind === "image" ? providersRef.current.image : providersRef.current.video;
    const provider = available[0] as WorkspacePublicProvider | undefined;
    const generator = addNodeAtCenter({
      kind: "generator",
      title: kind === "image" ? "图片生成" : "视频生成",
      generationKind: kind,
      providerId: provider?.id || "",
      model: provider?.model || "",
      createdAt: new Date().toISOString(),
      sourceNodeIds: [node.id],
      ...(kind === "image" ? { count: 1 } : {}),
      ratio: kind === "image" ? "1:1" : provider?.videoOptions?.ratios?.[0] || "16:9",
      quality: "1k",
      duration: provider?.videoOptions?.durations?.[0] || 5,
      resolution: provider?.videoOptions?.resolutions?.[0] || provider?.videoOptions?.resolution || "720p",
      status: "idle",
      progress: 0,
    }, { width: 360, height: 370 });
    setEdges((current) => [...current, decorateCanvasEdge({
      id: canvasId("edge"),
      source: node.id,
      sourceHandle: "output",
      target: generator.id,
      targetHandle: "input",
    }, nodesRef.current, connectionStyle)]);
    markDirty();
    return generator;
  }, [addNodeAtCenter, connectionStyle, markDirty]);

  const addLibraryNode = useCallback((item: LibraryItem, position?: { x: number; y: number }) => {
    const existing = nodesRef.current.find((node) => node.data.kind === "media" && node.data.libraryItemId === item.id);
    if (existing) {
      setNodes((current) => current.map((node) => ({ ...node, selected: node.id === existing.id })));
      setEdges((current) => current.map((edge) => ({ ...edge, selected: false })));
      setNotice(`素材“${item.title}”已在画布中。`);
      void flow.setCenter(existing.position.x + (existing.width || 320) / 2, existing.position.y + (existing.height || 300) / 2, { duration: 240, zoom: Math.max(flow.getZoom(), 0.7) });
      return;
    }
    pushHistorySnapshot();
    const data: CanvasNodeData = {
      kind: "media",
      title: item.title || (item.type === "image" ? "图片素材" : "视频素材"),
      mediaType: item.type,
      libraryItemId: item.id,
      model: item.model,
      createdAt: item.createdAt,
      mediaUrl: item.output?.url,
      status: libraryStatus(item),
      progress: 0,
      error: item.error || undefined,
      ...canvasMediaNodeMetadata(item),
    };
    if (!position) {
      addNodeAtCenter(data, { width: 320, height: item.type === "image" ? 300 : 340 });
      return;
    }
    setNodes((current) => [...current, {
      id: canvasId("node"),
      type: "canvas",
      dragHandle: canvasNodeDragHandle(data.kind),
      position,
      width: 320,
      height: item.type === "image" ? 300 : 340,
      data,
    }]);
    markDirty();
  }, [addNodeAtCenter, flow, markDirty, pushHistorySnapshot]);

  const uploadCanvasAudioReference = useCallback(async (file: File) => {
    try {
      const form = new FormData();
      form.append("file", file);
      return await fetchJsonWithCsrf<{ url: string; title?: string; mimeType?: string }>("/api/canvas/audio", { method: "POST", body: form });
    } catch (error) {
      throw new Error(apiMessage(error, "音频上传失败。"));
    }
  }, []);

  const addAudioReference = useCallback(async (file: File) => {
    if (!isInternalCanvas) {
      setNotice("音频参考素材只在内部画布可用。");
      return;
    }
    setNotice("正在上传音频参考素材…");
    try {
      const result = await uploadCanvasAudioReference(file);
      addNodeAtCenter({
        kind: "media",
        title: result.title || file.name || "音频参考",
        mediaType: "audio",
        mediaUrl: result.url,
        createdAt: new Date().toISOString(),
        status: "done",
        notes: "Seedance 参考音频。请连接到视频生成节点，并在提示词中使用 @AudioN 指定音频职责。",
      }, { width: 320, height: 180 });
      setNotice("已添加音频参考节点。");
    } catch (error) {
      setNotice(apiMessage(error, "音频上传失败。"));
    }
  }, [addNodeAtCenter, isInternalCanvas, uploadCanvasAudioReference]);

  const uploadCanvasMediaFiles = useCallback(async (input: File[], position?: { x: number; y: number }, truncated = false) => {
    if (!isInternalCanvas) {
      setNotice("本地素材上传只在内部画布可用。");
      return;
    }
    const supported = input.filter(isSupportedCanvasDropFile);
    const files = supported.slice(0, MAX_CANVAS_FOLDER_FILES);
    const reachedLimit = truncated || supported.length > MAX_CANVAS_FOLDER_FILES;
    if (!files.length) {
      setNotice("文件夹中没有支持的图片或视频。");
      return;
    }
    pushHistorySnapshot();
    const columns = files.length > 12 ? 5 : 3;
    const stageBounds = stageRef.current?.getBoundingClientRect();
    const anchor = position || flow.screenToFlowPosition({
      x: stageBounds ? stageBounds.left + stageBounds.width / 2 : window.innerWidth / 2,
      y: stageBounds ? stageBounds.top + stageBounds.height / 2 : window.innerHeight / 2,
    });
    const rows = Math.ceil(files.length / columns);
    const basePosition = position ? anchor : {
      x: anchor.x - (Math.min(columns, files.length) * 350 - 30) / 2,
      y: anchor.y - (rows * 370 - 30) / 2,
    };
    const placeholders = files.map((file, index): CanvasFlowNode => {
      const mediaType = canvasDropMediaType(file);
      if (!mediaType) throw new Error("Unsupported canvas media file.");
      return {
        id: canvasId("upload"),
        type: "canvas",
        dragHandle: canvasNodeDragHandle("media"),
        position: {
          x: basePosition.x + (index % columns) * 350,
          y: basePosition.y + Math.floor(index / columns) * 370,
        },
        width: 320,
        height: mediaType === "audio" ? 180 : mediaType === "image" ? 300 : 340,
        selected: true,
        data: {
          kind: "media",
          title: file.name || (mediaType === "image" ? "图片素材" : mediaType === "video" ? "视频素材" : "音频参考"),
          mediaType,
          mediaUrl: URL.createObjectURL(file),
          mediaOrigin: "upload",
          createdAt: new Date().toISOString(),
          fileSize: file.size,
          status: "generating",
          progress: 5,
        },
      };
    });
    const nextNodes = [...nodesRef.current.map((node) => ({ ...node, selected: false })), ...placeholders];
    nodesRef.current = nextNodes;
    setNodes(nextNodes);
    setEdges((current) => current.map((edge) => ({ ...edge, selected: false })));
    setNotice(`正在上传 ${files.length} 个素材…`);
    if (!position) {
      window.requestAnimationFrame(() => {
        void flowRef.current.fitView({ nodes: placeholders, padding: 0.2, duration: 220, maxZoom: 1 });
      });
    }
    let uploadedCount = 0;
    const errors: unknown[] = [];
    let nextIndex = 0;
    const worker = async () => {
      while (nextIndex < files.length) {
        const index = nextIndex;
        nextIndex += 1;
        try {
          const placeholder = placeholders[index];
          const objectUrl = placeholder.data.mediaUrl;
          if (placeholder.data.mediaType === "audio") {
            const result = await uploadCanvasAudioReference(files[index]);
            uploadedCount += 1;
            setNodes((current) => {
              const next = current.map((node) => node.id === placeholder.id ? {
                ...node,
                data: {
                  ...node.data,
                  title: result.title || node.data.title,
                  mediaUrl: result.url,
                  status: "done" as const,
                  progress: 0,
                  error: undefined,
                  notes: "Seedance 参考音频。请连接到视频生成节点，并在提示词中使用 @AudioN 指定音频职责。",
                },
              } : node);
              nodesRef.current = next;
              return next;
            });
            markDirty();
            setNotice(`已上传 ${uploadedCount}/${files.length} 个素材`);
            if (typeof objectUrl === "string" && objectUrl.startsWith("blob:")) URL.revokeObjectURL(objectUrl);
            continue;
          }
          const form = new FormData();
          form.append("file", files[index]);
          form.append("canvasScope", canvasScope());
          const response = await fetchJsonWithCsrf<{ item: LibraryItem; reused?: boolean }>("/api/canvas/media", { method: "POST", body: form });
          const item = response.item;
          uploadedCount += 1;
          setLibrary((current) => [item, ...current.filter((candidate) => candidate.id !== item.id)]);
          setNodes((current) => {
            const existing = response.reused
              ? current.find((node) => node.id !== placeholder.id && node.data.kind === "media" && node.data.libraryItemId === item.id)
              : undefined;
            if (existing) {
              const next = current
                .filter((node) => node.id !== placeholder.id)
                .map((node) => ({ ...node, selected: node.id === existing.id }));
              nodesRef.current = next;
              return next;
            }
            const next = current.map((node) => node.id === placeholder.id ? {
              ...node,
              data: {
                ...node.data,
                title: item.title || node.data.title,
                mediaType: item.type,
                libraryItemId: item.id,
                model: item.model,
                createdAt: item.createdAt,
                mediaUrl: item.output?.url,
                status: libraryStatus(item),
                progress: 0,
                error: item.error || undefined,
                ...canvasMediaNodeMetadata(item),
              },
            } : node);
            nodesRef.current = next;
            return next;
          });
          markDirty();
          setNotice(response.reused ? `已复用已有素材 ${uploadedCount}/${files.length}` : `已上传 ${uploadedCount}/${files.length} 个素材`);
          if (typeof objectUrl === "string" && objectUrl.startsWith("blob:")) {
            window.requestAnimationFrame(() => window.requestAnimationFrame(() => URL.revokeObjectURL(objectUrl)));
          }
        } catch (error) {
          errors.push(error);
          const placeholder = placeholders[index];
          const objectUrl = placeholder.data.mediaUrl;
          setNodes((current) => {
            const next = current.filter((node) => node.id !== placeholder.id);
            nodesRef.current = next;
            return next;
          });
          if (typeof objectUrl === "string" && objectUrl.startsWith("blob:")) URL.revokeObjectURL(objectUrl);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, files.length) }, () => worker()));
    if (errors.length) {
      setNotice(`${uploadedCount ? `已添加 ${uploadedCount} 个素材；` : ""}${errors.length} 个上传失败：${apiMessage(errors[0], "素材上传失败。")}${reachedLimit ? `；单次最多导入 ${MAX_CANVAS_FOLDER_FILES} 个素材` : ""}`);
    } else {
      setNotice(`已添加 ${uploadedCount} 个素材到画布和作品库${reachedLimit ? `；单次最多导入 ${MAX_CANVAS_FOLDER_FILES} 个素材` : ""}。`);
    }
  }, [flow, isInternalCanvas, markDirty, pushHistorySnapshot, uploadCanvasAudioReference]);

  const addLibraryNodes = useCallback((items: LibraryItem[]) => {
    const existingIds = new Set(nodesRef.current.flatMap((node) => node.data.kind === "media" && node.data.libraryItemId ? [node.data.libraryItemId] : []));
    const seen = new Set<string>();
    const additions = items.filter((item) => !existingIds.has(item.id) && !seen.has(item.id) && seen.add(item.id));
    const skipped = items.length - additions.length;
    if (!additions.length) {
      setNotice("所选素材已全部在画布中。");
      return;
    }
    pushHistorySnapshot();
    const center = flow.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    const columns = Math.min(3, additions.length);
    const nextNodes = additions.map((item, index): CanvasFlowNode => ({
      id: canvasId("node"),
      type: "canvas",
      dragHandle: ".canvas-node__header",
      position: { x: center.x + (index % columns) * 350, y: center.y + Math.floor(index / columns) * 370 },
      width: 320,
      height: item.type === "image" ? 300 : 340,
      data: {
        kind: "media",
        title: item.title || (item.type === "image" ? "图片素材" : "视频素材"),
        mediaType: item.type,
        libraryItemId: item.id,
        model: item.model,
        createdAt: item.createdAt,
        mediaUrl: item.output?.url,
        status: libraryStatus(item),
        progress: 0,
        error: item.error || undefined,
      },
    }));
    setNodes((current) => [...current.map((node) => ({ ...node, selected: false })), ...nextNodes.map((node) => ({ ...node, selected: true }))]);
    markDirty();
    setNotice(`已添加 ${additions.length} 个素材${skipped ? `，跳过 ${skipped} 个重复项` : ""}。`);
  }, [flow, markDirty, pushHistorySnapshot]);

  const completeVideoTrim = useCallback((item: LibraryItem) => {
    const sourceNode = nodesRef.current.find((node) => node.data.kind === "media" && node.data.libraryItemId === trimmingLibraryItemId);
    setLibrary((current) => [item, ...current.filter((candidate) => candidate.id !== item.id)]);
    addLibraryNode(item, sourceNode ? {
      x: sourceNode.position.x + (sourceNode.width || 320) + 48,
      y: sourceNode.position.y,
    } : undefined);
    setTrimmingLibraryItemId("");
    setNotice("视频片段已保存到作品库并添加到画布。");
  }, [addLibraryNode, trimmingLibraryItemId]);

  const batchTrimSelectedVideos = useCallback(async () => {
    if (batchTrimming) return;
    const libraryItemIds = [...new Set(nodesRef.current
      .filter((node) => node.selected && node.data.kind === "media" && node.data.mediaType === "video" && node.data.libraryItemId)
      .map((node) => node.data.libraryItemId!))];
    if (!libraryItemIds.length) {
      setNotice("请先框选已完成的视频节点。");
      return;
    }
    if (!window.confirm(`将依次把 ${libraryItemIds.length} 个视频裁剪为开头 14.9 秒，原视频会保留。短视频会自动跳过。`)) return;
    setBatchTrimming(true);
    setNotice(`正在依次裁剪 ${libraryItemIds.length} 个视频…`);
    try {
      const response = await fetchJsonWithCsrf<{ items: LibraryItem[]; skipped: number; failed: number }>("/api/canvas/video-trim", {
        method: "POST",
        body: JSON.stringify({ libraryItemIds, scope: canvasScope() }),
      });
      if (response.items.length) {
        setLibrary((current) => [...response.items, ...current.filter((item) => !response.items.some((trimmed) => trimmed.id === item.id))]);
        for (const item of response.items) {
          const sourceId = typeof item.params.sourceLibraryItemId === "string" ? item.params.sourceLibraryItemId : "";
          const sourceNode = nodesRef.current.find((node) => node.data.kind === "media" && node.data.libraryItemId === sourceId);
          addLibraryNode(item, sourceNode ? {
            x: sourceNode.position.x + (sourceNode.width || 320) + 48,
            y: sourceNode.position.y,
          } : undefined);
        }
      }
      setNotice(`已裁剪 ${response.items.length} 个视频${response.skipped ? `，跳过 ${response.skipped} 个短视频或不可用素材` : ""}${response.failed ? `，${response.failed} 个失败` : ""}。`);
    } catch (error) {
      setNotice(apiMessage(error, "批量视频裁剪失败，请稍后重试。"));
    } finally {
      setBatchTrimming(false);
    }
  }, [addLibraryNode, batchTrimming]);

  const replaceSelectedMaterial = useCallback((item: LibraryItem) => {
    const selected = nodesRef.current.find((node) => node.selected && node.data.kind === "media");
    if (!selected) {
      setNotice("请先选择一个素材节点再替换。");
      return;
    }
    if (nodesRef.current.some((node) => node.id !== selected.id && node.data.kind === "media" && node.data.libraryItemId === item.id)) {
      setNotice(`素材“${item.title}”已在画布中，未重复替换。`);
      return;
    }
    pushHistorySnapshot();
    setNodes((current) => current.map((node) => node.id === selected.id ? {
      ...node,
      width: 320,
      height: item.type === "image" ? 300 : 340,
      style: { ...node.style, width: 320, height: item.type === "image" ? 300 : 340 },
      data: {
        ...node.data,
        title: item.title || (item.type === "image" ? "图片素材" : "视频素材"),
        mediaType: item.type,
        libraryItemId: item.id,
        model: item.model,
        createdAt: item.createdAt,
        mediaUrl: item.output?.url,
        status: libraryStatus(item),
        progress: 0,
        error: item.error || undefined,
        ...canvasMediaNodeMetadata(item),
        intrinsicWidth: undefined,
        intrinsicHeight: undefined,
      },
    } : node));
    markDirty();
    setNotice(`已将节点替换为“${item.title}”。`);
  }, [markDirty, pushHistorySnapshot]);

  const addResultNode = useCallback((generatorId: string, item: LibraryItem, job?: JobRecord | null, resultIndex = 0, resultTotal = 1, existingNodeId?: string) => {
    const generator = nodesRef.current.find((node) => node.id === generatorId);
    if (!generator) return;
    if (existingNodeId) {
      setNodes((current) => current.map((node) => {
        if (node.id !== existingNodeId) return node;
        return {
          ...node,
          width: 340,
          height: item.type === "image" ? 320 : 360,
          style: { ...node.style, width: 340, height: item.type === "image" ? 320 : 360 },
          data: {
            ...node.data,
            title: item.title || (item.type === "image" ? "图片结果" : "视频结果"),
            mediaType: item.type,
            libraryItemId: item.id,
            model: item.model,
            createdAt: item.createdAt,
            mediaUrl: item.output?.url,
            status: libraryStatus(item),
            progress: job?.progress || (item.status === "done" ? 100 : 0),
            jobId: job?.id || node.data.jobId,
            generationRequestId: undefined,
            error: item.error || undefined,
            ...canvasMediaNodeMetadata(item),
            generationStartedAt: node.data.generationStartedAt || canvasMediaNodeMetadata(item).generationStartedAt,
            intrinsicWidth: undefined,
            intrinsicHeight: undefined,
          },
        };
      }));
      markDirty();
      return;
    }
    pushHistorySnapshot();
    const id = canvasId("node");
    const resultGrid = canvasImageResultGrid(resultIndex, resultTotal);
    const resultNode: CanvasFlowNode = {
      id,
      type: "canvas",
      dragHandle: ".canvas-node__header",
      position: {
        x: generator.position.x + (generator.width || 340) + 130 + resultGrid.column * 380,
        y: generator.position.y + resultGrid.row * 360 - ((resultGrid.rowCount - 1) * 180),
      },
      width: 340,
      height: item.type === "image" ? 320 : 360,
      data: {
        kind: "media",
        title: item.title || (item.type === "image" ? "图片结果" : "视频结果"),
        mediaType: item.type,
        libraryItemId: item.id,
        model: item.model,
        createdAt: item.createdAt,
        sourceNodeIds: [generatorId],
        mediaUrl: item.output?.url,
        status: libraryStatus(item),
        progress: job?.progress || 0,
        jobId: job?.id,
        error: item.error || undefined,
        ...canvasMediaNodeMetadata(item),
        ...(item.type === "video" ? {
          sequenceState: {
            ...(generator.data.sequenceState || {}),
            accepted: item.status === "done" || job?.status === "done",
          },
        } : {}),
      },
    };
    setNodes((current) => [
      ...current.map((node) => node.id === generatorId
        ? { ...node, data: { ...node.data, ...(resultIndex === 0 ? { outputNodeId: id } : {}) } }
        : node),
      resultNode,
    ]);
    setEdges((current) => [...current, decorateCanvasEdge({
      id: canvasId("edge"),
      source: generatorId,
      sourceHandle: "output",
      target: id,
      targetHandle: "input",
    }, nodesRef.current, connectionStyle)]);
    markDirty();
  }, [connectionStyle, markDirty, pushHistorySnapshot]);

  const createPendingImageResultNodes = useCallback((generatorId: string, resultTotal: number) => {
    const generator = nodesRef.current.find((node) => node.id === generatorId);
    if (!generator || resultTotal < 1) return [];
    pushHistorySnapshot();
    const createdAt = new Date().toISOString();
    const pendingNodes = Array.from({ length: resultTotal }, (_, resultIndex): CanvasFlowNode => {
      const resultGrid = canvasImageResultGrid(resultIndex, resultTotal);
      return {
        id: canvasId("node"),
        type: "canvas",
        dragHandle: ".canvas-node__header",
        position: {
          x: generator.position.x + (generator.width || 340) + 130 + resultGrid.column * 380,
          y: generator.position.y + resultGrid.row * 360 - ((resultGrid.rowCount - 1) * 180),
        },
        width: 340,
        height: 320,
        data: {
          kind: "media",
          title: resultTotal > 1 ? `图片生成中 ${resultIndex + 1}/${resultTotal}` : "图片生成中",
          mediaType: "image",
          createdAt,
          generationStartedAt: createdAt,
          mediaOrigin: "generated",
          sourceNodeIds: [generatorId],
          status: "queued",
          progress: 5,
        },
      };
    });
    const pendingIds = pendingNodes.map((node) => node.id);
    setNodes((current) => [
      ...current.map((node) => node.id === generatorId ? { ...node, data: { ...node.data, outputNodeId: pendingIds[0] } } : node),
      ...pendingNodes,
    ]);
    setEdges((current) => [...current, ...pendingNodes.map((node) => decorateCanvasEdge({
      id: canvasId("edge"),
      source: generatorId,
      sourceHandle: "output",
      target: node.id,
      targetHandle: "input",
    }, [...nodesRef.current, ...pendingNodes], connectionStyle))]);
    markDirty();
    return pendingIds;
  }, [connectionStyle, markDirty, pushHistorySnapshot]);

  const createPendingVideoResultNode = useCallback((generatorId: string, generationRequestId: string, createdAt: string) => {
    const generator = nodesRef.current.find((node) => node.id === generatorId);
    if (!generator) return "";
    pushHistorySnapshot();
    const resultIds = new Set(edgesRef.current.filter((edge) => edge.source === generatorId).map((edge) => edge.target));
    const existingResults = nodesRef.current.filter((node) => resultIds.has(node.id) && node.data.kind === "media");
    const resultX = generator.position.x + (generator.width || 340) + 130;
    const resultY = existingResults.length
      ? Math.max(...existingResults.map((node) => node.position.y + (node.height || 360))) + 40
      : generator.position.y;
    const id = canvasId("node");
    const pendingNode: CanvasFlowNode = {
      id,
      type: "canvas",
      dragHandle: ".canvas-node__header",
      position: { x: resultX, y: resultY },
      width: 340,
      height: 360,
      data: {
        kind: "media",
        title: "视频生成中",
        mediaType: "video",
        createdAt,
        generationStartedAt: createdAt,
        generationRequestId,
        mediaOrigin: "generated",
        sourceNodeIds: [generatorId],
        status: "queued",
        progress: 5,
      },
    };
    setNodes((current) => [
      ...current.map((node) => node.id === generatorId ? { ...node, data: { ...node.data, outputNodeId: id } } : node),
      pendingNode,
    ]);
    setEdges((current) => [...current, decorateCanvasEdge({
      id: canvasId("edge"),
      source: generatorId,
      sourceHandle: "output",
      target: id,
      targetHandle: "input",
    }, [...nodesRef.current, pendingNode], connectionStyle)]);
    markDirty();
    return id;
  }, [connectionStyle, markDirty, pushHistorySnapshot]);

  const updatePendingImageResults = useCallback((ids: string[], patch: Partial<CanvasNodeData>) => {
    if (!ids.length) return;
    const targets = new Set(ids);
    setNodes((current) => current.map((node) => targets.has(node.id) && !node.data.mediaUrl ? {
      ...node,
      data: {
        ...node.data,
        ...patch,
        ...(patch.status === "failed" ? { title: node.data.title.replace("生成中", "生成失败") } : {}),
      },
    } : node));
    markDirty();
  }, [markDirty]);

  const executeGenerator = useCallback(async (generatorId: string) => {
    const generator = nodesRef.current.find((node) => node.id === generatorId);
    if (!generator || generator.data.kind !== "generator" || !generator.data.generationKind) return;
    const incomingIds = edgesRef.current.filter((edge) => edge.target === generatorId).map((edge) => edge.source);
    const inputs = nodesRef.current.filter((node) => incomingIds.includes(node.id));
    const prompt = inputs
      .filter((node) => node.data.kind === "prompt")
      .map((node) => String(node.data.prompt || "").trim())
      .filter(Boolean)
      .join("\n\n");
    if (!prompt) {
      updateNodeData(generatorId, { status: "failed", error: "请连接至少一个已填写的提示词节点。" });
      return;
    }

    const mediaItems = inputs
      .filter((node) => node.data.kind === "media" && (node.data.libraryItemId || node.data.mediaUrl))
      .flatMap<CanvasMediaReference>((node) => {
        if (node.data.kind !== "media") return [];
        const libraryItem = node.data.libraryItemId
          ? libraryRef.current.find((item) => item.id === node.data.libraryItemId)
          : undefined;
        if (libraryItem) return [libraryItem as CanvasMediaReference];
        if (!node.data.mediaUrl || !node.data.mediaType) return [];
        return [{
          id: `canvas-${node.id}`,
          type: node.data.mediaType,
          title: node.data.title,
          output: { url: node.data.mediaUrl, mimeType: node.data.mediaType === "audio" ? "audio/mpeg" : node.data.mediaType === "video" ? "video/mp4" : "image/png" },
        }];
      });
    const providerList = generator.data.generationKind === "image" ? providersRef.current.image : providersRef.current.video;
    const provider = providerList.find((item) => item.id === generator.data.providerId) || providerList[0];
    if (!provider) {
      updateNodeData(generatorId, { status: "failed", error: "当前没有可用模型。" });
      return;
    }

    setPresenceGeneratingNodeIds((current) => current.includes(generatorId) ? current : [...current, generatorId]);
    updateNodeData(generatorId, { status: "queued", progress: 0, error: undefined, providerId: provider.id });
    setNotice("");
    let pendingImageResultIds: string[] = [];
    let pendingVideoResultId = "";
    try {
      if (generator.data.generationKind === "image") {
        if (mediaItems.some((item) => item.type !== "image")) throw new Error("图片生成节点只能连接图片素材。");
        const imageMode = mediaItems.length ? "image-to-image" as const : "text-to-image" as const;
        const resultTotal = planCanvasImageRequests(Number(generator.data.count), isInternalCanvas).reduce((total, value) => total + value, 0);
        pendingImageResultIds = createPendingImageResultNodes(generatorId, resultTotal);
        updatePendingImageResults(pendingImageResultIds, { status: "generating", progress: 35 });
        await submitImageGeneration(generatorId, { ...generator.data, imageMode }, provider, prompt, mediaItems, addResultNode, updateNodeData, isInternalCanvas, pendingImageResultIds);
        updatePendingImageResults(pendingImageResultIds, { status: "failed", progress: 0, error: "生成接口未返回对应图片。" });
      } else {
        const taskId = canvasId("canvas-video");
        const canvasRequestedAt = new Date().toISOString();
        pendingVideoResultId = createPendingVideoResultNode(generatorId, taskId, canvasRequestedAt);
        await submitVideoGeneration(generatorId, generator.data, provider as WorkspacePublicProvider, prompt, mediaItems, addResultNode, updateNodeData, isInternalCanvas, pendingVideoResultId, taskId, canvasRequestedAt);
      }
      await refreshLibrary().catch(() => undefined);
    } catch (error) {
      const message = apiMessage(error, "生成失败。");
      updateNodeData(generatorId, { status: "failed", error: message });
      updatePendingImageResults(pendingImageResultIds, { status: "failed", progress: 0, error: message });
      if (pendingVideoResultId) updateNodeData(pendingVideoResultId, { status: "failed", progress: 0, error: message });
      setNotice(message);
    }
  }, [addResultNode, createPendingImageResultNodes, createPendingVideoResultNode, isInternalCanvas, refreshLibrary, updateNodeData, updatePendingImageResults]);

  const inputSummary = useMemo(() => {
    const summaries: Record<string, GeneratorInputSummary> = {};
    const nodeMap = new Map(nodes.map((node) => [node.id, node]));
    edges.forEach((edge) => {
      const target = nodeMap.get(edge.target);
      const source = nodeMap.get(edge.source);
      if (target?.data.kind !== "generator" || !source) return;
      const summary = summaries[target.id] || { prompts: 0, images: 0, videos: 0, audios: 0 };
      if (source.data.kind === "prompt" && String(source.data.prompt || "").trim()) summary.prompts += 1;
      if (source.data.kind === "media" && source.data.mediaType === "image") summary.images += 1;
      if (source.data.kind === "media" && source.data.mediaType === "video") summary.videos += 1;
      if (source.data.kind === "media" && source.data.mediaType === "audio") summary.audios += 1;
      summaries[target.id] = summary;
    });
    return summaries;
  }, [edges, nodes]);

  const inputPreviews = useMemo(() => {
    const previews: Record<string, Array<{ url: string; mediaType: CanvasMediaType; title: string }>> = {};
    const nodeMap = new Map(nodes.map((node) => [node.id, node]));
    edges.forEach((edge) => {
      const target = nodeMap.get(edge.target);
      const source = nodeMap.get(edge.source);
      if (target?.data.kind !== "generator" || source?.data.kind !== "media" || !source.data.mediaUrl) return;
      const current = previews[target.id] || [];
      if (current.length >= 4) return;
      current.push({
        url: source.data.mediaUrl,
        mediaType: source.data.mediaType || "image",
        title: source.data.title,
      });
      previews[target.id] = current;
    });
    return previews;
  }, [edges, nodes]);

  const promptReferences = useMemo(() => {
    const references: Record<string, CanvasPromptReference[]> = {};
    const nodeMap = new Map(nodes.map((node) => [node.id, node]));
    nodes.filter((node) => node.data.kind === "prompt").forEach((promptNode) => {
      const generatorId = edges.find((edge) => edge.source === promptNode.id && nodeMap.get(edge.target)?.data.kind === "generator")?.target;
      if (!generatorId) return;
      const mediaIds = new Set(edges.filter((edge) => edge.target === generatorId && nodeMap.get(edge.source)?.data.kind === "media").map((edge) => edge.source));
      const counts: Record<CanvasMediaType, number> = { image: 0, video: 0, audio: 0 };
      const options: CanvasPromptReference[] = [];
      nodes.forEach((node) => {
        if (!mediaIds.has(node.id) || node.data.kind !== "media" || !node.data.mediaUrl) return;
        const mediaType = node.data.mediaType || "image";
        counts[mediaType] += 1;
        options.push({
          label: `${mediaType === "video" ? "Video" : mediaType === "audio" ? "Audio" : "Image"}${counts[mediaType]}`,
          mediaType,
          title: node.data.title,
          url: node.data.mediaUrl,
        });
      });
      references[promptNode.id] = options;
    });
    return references;
  }, [edges, nodes]);

  const assistantNodeContexts = useMemo<CanvasAssistantNodeContext[]>(() => {
    const nodeMap = new Map(nodes.map((node) => [node.id, node]));
    const labelsByMediaNode = new Map<string, Array<{ generatorId: string; label: string }>>();
    nodes.filter((node) => node.data.kind === "generator").forEach((generator) => {
      const mediaIds = new Set(edges.filter((edge) => edge.target === generator.id && nodeMap.get(edge.source)?.data.kind === "media").map((edge) => edge.source));
      const counts: Record<CanvasMediaType, number> = { image: 0, video: 0, audio: 0 };
      nodes.forEach((node) => {
        if (!mediaIds.has(node.id) || node.data.kind !== "media") return;
        const mediaType = node.data.mediaType || "image";
        counts[mediaType] += 1;
        const label = `@${mediaType === "video" ? "Video" : mediaType === "audio" ? "Audio" : "Image"}${counts[mediaType]}`;
        labelsByMediaNode.set(node.id, [...(labelsByMediaNode.get(node.id) || []), { generatorId: generator.id, label }]);
      });
    });

    return nodes.map((node) => ({
      id: node.id,
      kind: node.data.kind,
      title: node.data.title,
      prompt: node.data.kind === "prompt" ? node.data.prompt : undefined,
      selected: Boolean(node.selected),
      mediaType: node.data.kind === "media" ? node.data.mediaType : undefined,
      libraryItemId: node.data.kind === "media" ? node.data.libraryItemId : undefined,
      connectedNodeIds: [...new Set(edges.flatMap((edge) => edge.source === node.id ? [edge.target] : edge.target === node.id ? [edge.source] : []))],
      referenceLabels: labelsByMediaNode.get(node.id),
      generationKind: node.data.kind === "generator" ? node.data.generationKind : undefined,
      providerId: node.data.kind === "generator" ? node.data.providerId : undefined,
      ratio: node.data.kind === "generator" ? node.data.ratio : undefined,
      duration: node.data.kind === "generator" ? node.data.duration : undefined,
      resolution: node.data.kind === "generator" ? node.data.resolution : undefined,
      referenceBindings: node.data.referenceBindings,
      sequenceState: node.data.sequenceState,
    }));
  }, [edges, nodes]);

  const uniquePresenceMembers = useMemo(
    () => dedupeCanvasPresenceMembers(presenceMembers, collaborationClientId),
    [collaborationClientId, presenceMembers],
  );
  const presenceByNode = useMemo(() => Object.fromEntries(nodes.map((node) => [
    node.id,
    canvasPresenceMembersForNode(uniquePresenceMembers, node.id, collaborationClientId),
  ])), [collaborationClientId, nodes, uniquePresenceMembers]);

  const optimizePromptNode = useCallback(async (id: string, prompt: string) => {
    const source = prompt.trim();
    if (!source) return;
    const generator = edgesRef.current
      .filter((edge) => edge.source === id)
      .map((edge) => nodesRef.current.find((node) => node.id === edge.target))
      .find((node) => node?.data.kind === "generator");
    const referenceMediaTypes = generator
      ? edgesRef.current
        .filter((edge) => edge.target === generator.id)
        .map((edge) => nodesRef.current.find((node) => node.id === edge.source))
        .filter((node): node is CanvasFlowNode => Boolean(node?.data.kind === "media" && node.data.mediaType))
        .map((node) => node.data.mediaType as CanvasMediaType)
      : [];
    const taskId = canvasId("prompt-optimize");
    try {
      const response = await fetchJsonWithCsrf<{ optimizedPrompt?: string }>("/api/prompts/optimize", {
        method: "POST",
        body: JSON.stringify({
          taskId,
          idempotencyKey: taskId,
          tool: generator?.data.generationKind === "video" ? "video-generator" : "image-generator",
          prompt: source,
          hasImage: referenceMediaTypes.includes("image"),
          aspectRatio: generator?.data.ratio,
          quality: generator?.data.quality,
          duration: generator?.data.duration,
          model: generator?.data.model,
          referenceMediaTypes,
        }),
      });
      const optimizedPrompt = String(response.optimizedPrompt || "").trim();
      if (!optimizedPrompt) throw new Error("提示词优化未返回内容。");
      updateNodeData(id, { prompt: optimizedPrompt });
      setNotice("提示词已优化，可继续编辑或撤销。");
    } catch (error) {
      setNotice(apiMessage(error, "提示词优化失败，请稍后重试。"));
      throw error;
    }
  }, [updateNodeData]);

  const nodeActions = useMemo(() => ({
    providers,
    internalCanvas: isInternalCanvas,
    inputSummary,
    inputPreviews,
    promptReferences,
    presenceByNode,
    updateNodeData: (id: string, patch: Partial<CanvasNodeData>) => updateNodeData(id, patch),
    registerMediaDimensions,
    removeNode,
    previewMedia: setPreviewingNodeId,
    trimVideo: (id: string) => {
      const node = nodesRef.current.find((item) => item.id === id);
      if (node?.data.kind === "media" && node.data.mediaType === "video" && node.data.libraryItemId) {
        setTrimmingLibraryItemId(node.data.libraryItemId);
      } else {
        setNotice("该视频尚未进入作品库，暂时不能裁剪。");
      }
    },
    openTikTokPublisher: (id: string) => {
      const node = nodesRef.current.find((item) => item.id === id);
      if (node?.data.kind === "media" && node.data.mediaType === "video" && node.data.libraryItemId) {
        setTikTokLibraryItemId(node.data.libraryItemId);
      } else {
        setNotice("该视频尚未进入作品库，暂时不能发布到 TikTok。");
      }
    },
    optimizePrompt: optimizePromptNode,
    runGenerator: (id: string) => { void executeGenerator(id); },
    toggleGroup: toggleGroupCollapsed,
  }), [executeGenerator, inputPreviews, inputSummary, isInternalCanvas, optimizePromptNode, presenceByNode, promptReferences, providers, registerMediaDimensions, removeNode, toggleGroupCollapsed, updateNodeData]);

  const onNodesChange = useCallback((changes: NodeChange<CanvasFlowNode>[]) => {
    if (changes.some((change) => change.type !== "select" && !(change.type === "position" && change.dragging))) {
      pushHistorySnapshot();
    }
    setNodes((current) => applyNodeChanges(changes, current));
    if (changes.some((change) => change.type !== "select")) markDirty();
  }, [markDirty, pushHistorySnapshot]);

  const onEdgesChange = useCallback((changes: EdgeChange<Edge>[]) => {
    if (changes.some((change) => change.type !== "select")) pushHistorySnapshot();
    setEdges((current) => applyEdgeChanges(changes, current));
    if (changes.some((change) => change.type !== "select")) markDirty();
  }, [markDirty, pushHistorySnapshot]);

  const canConnect = useCallback((connection: Connection | Edge, ignoredEdgeId?: string) => {
    return !canvasConnectionError(connection, nodesRef.current, edgesRef.current, providersRef.current, ignoredEdgeId);
  }, []);

  const isValidConnection = useCallback((connection: Connection | Edge) => canConnect(connection), [canConnect]);

  const onConnect = useCallback((connection: Connection) => {
    const error = canvasConnectionError(connection, nodesRef.current, edgesRef.current, providersRef.current);
    if (error) {
      setNotice(error);
      return;
    }
    pushHistorySnapshot();
    setEdges((current) => addEdge(decorateCanvasEdge({ ...connection, id: canvasId("edge") } as Edge, nodesRef.current, connectionStyle), current));
    markDirty();
  }, [connectionStyle, markDirty, pushHistorySnapshot]);

  const onConnectEnd = useCallback<OnConnectEnd>((event, connectionState) => {
    const sourceId = connectionState.fromNode?.id;
    if (!sourceId || connectionState.fromHandle?.type !== "source" || connectionState.toNode || !("clientX" in event) || !("clientY" in event)) return;
    const dropTarget = document.elementFromPoint(event.clientX, event.clientY);
    if (!dropTarget?.closest(".react-flow__pane") || dropTarget.closest(".react-flow__node, .react-flow__edge, .react-flow__panel, .canvas-bottom-dock")) return;
    const source = nodesRef.current.find((node) => node.id === sourceId);
    if (!source || (source.data.kind !== "prompt" && source.data.kind !== "media")) return;
    const bounds = stageRef.current?.getBoundingClientRect();
    const left = event.clientX - (bounds?.left || 0);
    const top = event.clientY - (bounds?.top || 0);
    setContextMenu({
      kind: "connection",
      sourceNodeId: sourceId,
      left: Math.max(8, Math.min(left, (bounds?.width || 320) - 296)),
      top: Math.max(8, Math.min(top, (bounds?.height || 220) - 168)),
      flowPosition: flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
    });
  }, [flow]);

  const addContextGenerator = useCallback((kind: "image" | "video", state: CanvasContextMenuState) => {
    const source = state.kind === "connection" && state.sourceNodeId
      ? nodesRef.current.find((node) => node.id === state.sourceNodeId)
      : undefined;
    if (state.kind === "connection" && (!source || (source.data.kind !== "prompt" && source.data.kind !== "media"))) {
      setContextMenu(null);
      return;
    }
    const available = kind === "image" ? providersRef.current.image : providersRef.current.video;
    const provider = available[0] as WorkspacePublicProvider | undefined;
    if (source) {
      const provisionalGenerator = {
        id: "new-generator",
        type: "canvas",
        position: state.flowPosition,
        data: { kind: "generator", title: "生成", generationKind: kind, providerId: provider?.id || "" },
      } as CanvasFlowNode;
      const error = canvasConnectionError(
        { source: source.id, target: provisionalGenerator.id, sourceHandle: "output", targetHandle: "input" },
        [...nodesRef.current, provisionalGenerator],
        edgesRef.current,
        providersRef.current,
      );
      if (error) {
        setNotice(error);
        setContextMenu(null);
        return;
      }
    }
    const generator = addGeneratorNode(kind, state.flowPosition);
    if (generator && source) {
      const connection = { source: source.id, target: generator.id, sourceHandle: "output", targetHandle: "input" };
      setEdges((current) => addEdge(decorateCanvasEdge({
        id: canvasId("edge"),
        ...connection,
      }, nodesRef.current, connectionStyle), current));
      setNodes((current) => current.map((node) => ({ ...node, selected: node.id === generator.id })));
      markDirty();
    }
    setContextMenu(null);
  }, [addGeneratorNode, connectionStyle, markDirty]);

  const onReconnect = useCallback((oldEdge: Edge, connection: Connection) => {
    if (!canConnect(connection, oldEdge.id)) {
      setNotice("这条连接不符合输入规则。");
      return;
    }
    pushHistorySnapshot();
    setEdges((current) => reconnectEdge(oldEdge, connection, current));
    markDirty();
  }, [canConnect, markDirty, pushHistorySnapshot]);

  const createProject = useCallback(async (skipCurrentSave = false) => {
    if (canvasScope() === "shared") {
      setNotice("团队画布固定为一个，不能新建。");
      return;
    }
    if (!skipCurrentSave && !(await saveNow(true))) return;
    try {
      const data = await fetchJsonWithCsrf<{ project: CanvasProject }>(canvasProjectsUrl(), {
        method: "POST",
        body: JSON.stringify({ title: `新画布 ${projectsRef.current.length + 1}`, document: starterDocument() }),
      });
      setProjects((current) => [data.project, ...current]);
      activateProject(data.project);
    } catch (error) {
      setNotice(apiMessage(error, "创建画布失败。"));
    }
  }, [activateProject, saveNow]);

  const switchProject = useCallback(async (id: string) => {
    if (id === activeProjectId || !(await saveNow(true))) return;
    const project = projectsRef.current.find((item) => item.id === id);
    if (project) activateProject(project);
  }, [activateProject, activeProjectId, saveNow]);

  const deleteProject = useCallback(async () => {
    if (canvasScope() === "shared") {
      setNotice("团队画布固定保留，不能删除。");
      return;
    }
    const project = activeProjectRef.current;
    if (!project || !window.confirm(`确定删除“${project.title}”？`)) return;
    const pendingSave = savePromiseRef.current;
    if (pendingSave && !(await pendingSave)) return;
    try {
      await fetchJsonWithCsrf(`${canvasProjectsUrl(project.id)}&client=${encodeURIComponent(collaborationClientId)}`, { method: "DELETE" });
      const remaining = projectsRef.current.filter((item) => item.id !== project.id);
      projectsRef.current = remaining;
      setProjects(remaining);
      if (remaining[0]) {
        activateProject(remaining[0]);
      } else {
        activeProjectRef.current = null;
        loadedRef.current = false;
        await createProject(true);
      }
    } catch (error) {
      setNotice(apiMessage(error, "删除画布失败。"));
    }
  }, [activateProject, collaborationClientId, createProject]);

  const activeJobsKey = useMemo(() => nodes
    .filter((node) => node.data.jobId && (node.data.status === "queued" || node.data.status === "generating"))
    .map((node) => `${node.id}:${node.data.jobId}`)
    .sort()
    .join("|"), [nodes]);

  useEffect(() => {
    if (!activeJobsKey) return;
    let cancelled = false;
    let timer: number | null = null;
    const poll = async () => {
      const activeJobs = nodesRef.current.filter((node) => node.data.jobId && (node.data.status === "queued" || node.data.status === "generating"));
      let refreshNeeded = false;
      await Promise.all(activeJobs.map(async (node) => {
        try {
          const data = await fetchJson<{ job: JobRecord | null }>(canvasJobUrl(node.data.jobId!));
          if (cancelled || !data.job) return;
          const terminal = data.job.status === "done" || data.job.status === "failed";
          updateNodeData(node.id, {
            status: data.job.status === "done" ? "done" : data.job.status === "failed" ? "failed" : data.job.status === "queued" ? "queued" : "generating",
            progress: data.job.progress || 0,
            error: data.job.error || undefined,
          }, terminal);
          refreshNeeded ||= data.job.status === "done";
        } catch {
          // Transient polling failures are retried without changing the paid task state.
        }
      }));
      if (refreshNeeded) await refreshLibrary().catch(() => undefined);
      if (!cancelled) timer = window.setTimeout(poll, 4_000);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [activeJobsKey, refreshLibrary, updateNodeData]);

  const filteredLibrary = useMemo(() => {
    const query = librarySearch.trim().toLowerCase();
    return library.filter((item) => {
      if (item.status !== "done" || !(item.output?.storedName || item.output?.url)) return false;
      if (libraryFilter !== "all" && item.type !== libraryFilter) return false;
      return !query || item.title.toLowerCase().includes(query) || item.prompt.toLowerCase().includes(query);
    }).sort((a, b) => Number(Boolean(b.favorite || b.params.favorite)) - Number(Boolean(a.favorite || a.params.favorite)) || b.updatedAt.localeCompare(a.updatedAt));
  }, [library, libraryFilter, librarySearch]);

  const selectedNodes = useMemo(() => nodes.filter((node) => node.selected), [nodes]);
  const selectedNode = selectedNodes[0] || null;
  const selectedVideoTrimCount = useMemo(() => selectedNodes.filter((node) => (
    node.data.kind === "media" && node.data.mediaType === "video" && node.data.libraryItemId && node.data.status === "done"
  )).length, [selectedNodes]);
  const activeRelationNodeId = hoveredNodeId || (selectedNodes.length === 1 ? selectedNode?.id || "" : "");
  const displayEdges = useMemo(() => edges.map((edge) => ({
    ...edge,
    data: { ...(edge.data || {}), active: Boolean(activeRelationNodeId && (edge.source === activeRelationNodeId || edge.target === activeRelationNodeId)) },
  })), [activeRelationNodeId, edges]);
  const contextSourceNode = contextMenu?.kind === "connection" && contextMenu.sourceNodeId
    ? nodes.find((node) => node.id === contextMenu.sourceNodeId)
    : undefined;
  const contextCanAddImage = !contextSourceNode
    || contextSourceNode.data.kind === "prompt"
    || (contextSourceNode.data.kind === "media" && contextSourceNode.data.mediaType === "image");
  const editingNode = nodes.find((node) => node.id === editingNodeId && node.data.kind === "media" && node.data.mediaType === "image") || null;
  const previewingNode = nodes.find((node) => node.id === previewingNodeId && node.data.kind === "media" && node.data.mediaType === "image" && node.data.mediaUrl) || null;
  const trimmingLibraryItem = library.find((item) => item.id === trimmingLibraryItemId && item.type === "video" && item.status === "done") || null;
  const tiktokLibraryItem = library.find((item) => item.id === tiktokLibraryItemId && item.type === "video" && item.status === "done") || null;
  const rememberTikTokCopy = useCallback((key: string, copy: CanvasTikTokCopyState) => {
    setTikTokCopyDrafts((current) => ({ ...current, [key]: copy }));
  }, []);
  const selectionToolbarStyle = useMemo<CSSProperties | undefined>(() => {
    if (!selectedNodes.length) return undefined;
    const minX = Math.min(...selectedNodes.map((node) => node.position.x));
    const maxX = Math.max(...selectedNodes.map((node) => node.position.x + (node.width || 340)));
    const minY = Math.min(...selectedNodes.map((node) => node.position.y));
    return {
      left: (minX + maxX) / 2 * viewport.zoom + viewport.x,
      top: Math.max(8, minY * viewport.zoom + viewport.y - 52),
      transform: "translateX(-50%)",
    };
  }, [selectedNodes, viewport]);

  const removeSelectedNodes = useCallback(() => {
    const ids = new Set(nodesRef.current.filter((node) => node.selected).map((node) => node.id));
    nodesRef.current.forEach((node) => { if (node.parentId && ids.has(node.parentId)) ids.add(node.id); });
    const edgeIds = new Set(edgesRef.current.filter((edge) => edge.selected).map((edge) => edge.id));
    if (!ids.size && !edgeIds.size) return;
    pushHistorySnapshot();
    const nextNodes = nodesRef.current.filter((node) => !ids.has(node.id));
    const nextEdges = edgesRef.current.filter((edge) => !edgeIds.has(edge.id) && !ids.has(edge.source) && !ids.has(edge.target));
    replaceCanvasElements(nextNodes, nextEdges);
    setInfoOpen(false);
    setContextMenu(null);
    markDirty();
  }, [markDirty, pushHistorySnapshot, replaceCanvasElements]);

  const removeEdge = useCallback((edgeId: string) => {
    if (!edgesRef.current.some((edge) => edge.id === edgeId)) return;
    pushHistorySnapshot();
    replaceCanvasElements(nodesRef.current, edgesRef.current.filter((edge) => edge.id !== edgeId));
    setContextMenu(null);
    markDirty();
  }, [markDirty, pushHistorySnapshot, replaceCanvasElements]);
  const copySelectedNodes = useCallback(() => {
    const selected = copyableCanvasSelection(nodesRef.current);
    if (!selected.length) return;
    const ids = new Set(selected.map((node) => node.id));
    clipboardRef.current = {
      nodes: selected,
      edges: edgesRef.current
        .filter((edge) => ids.has(edge.target) && (ids.has(edge.source) || selected.some((node) => node.id === edge.target && node.data.kind === "generator")))
        .map((edge) => ({ ...edge })),
    };
    setClipboardHasNodes(true);
    setNotice(`已复制 ${selected.length} 个节点。`);
    setContextMenu(null);
  }, []);

  const pasteCopiedNodes = useCallback((position?: { x: number; y: number }) => {
    const copied = clipboardRef.current;
    if (!copied?.nodes.length) {
      setNotice("还没有复制节点。");
      return;
    }
    pushHistorySnapshot();
    const copiedIds = new Set(copied.nodes.map((node) => node.id));
    const roots = copied.nodes.filter((node) => !node.parentId || !copiedIds.has(node.parentId));
    const minX = Math.min(...roots.map((node) => node.position.x));
    const minY = Math.min(...roots.map((node) => node.position.y));
    const target = position || { x: minX + 48, y: minY + 48 };
    const idMap = new Map(copied.nodes.map((node) => [node.id, canvasId("node")]));
    const copies = copied.nodes.map((node) => {
      const parentId = node.parentId ? idMap.get(node.parentId) : undefined;
      const copy = { ...node };
      delete copy.parentId;
      delete copy.extent;
      delete copy.expandParent;
      return {
        ...copy,
        id: idMap.get(node.id)!,
        selected: !parentId,
        ...(parentId ? { parentId, extent: "parent" as const, expandParent: true } : {}),
        position: parentId ? node.position : { x: target.x + node.position.x - minX, y: target.y + node.position.y - minY },
        data: duplicateCanvasNodeData(node.data, idMap),
      };
    });
    const copiedEdges = copied.edges.map((edge) => ({
      ...edge,
      id: canvasId("edge"),
      source: idMap.get(edge.source) || edge.source,
      target: idMap.get(edge.target) || edge.target,
      selected: false,
    }));
    setNodes((current) => [...current.map((node) => ({ ...node, selected: false })), ...copies]);
    setEdges((current) => [...current.map((edge) => ({ ...edge, selected: false })), ...copiedEdges]);
    setContextMenu(null);
    markDirty();
  }, [markDirty, pushHistorySnapshot]);

  const openContextMenu = useCallback((event: ReactMouseEvent | MouseEvent, kind: CanvasContextMenuState["kind"], id?: string) => {
    event.preventDefault();
    contextMenuOpenRef.current = true;
    const bounds = stageRef.current?.getBoundingClientRect();
    const left = event.clientX - (bounds?.left || 0);
    const top = event.clientY - (bounds?.top || 0);
    if (kind === "node" && id) {
      setNodes((current) => current.map((node) => ({ ...node, selected: node.id === id })));
      setEdges((current) => current.map((edge) => ({ ...edge, selected: false })));
    } else if (kind === "edge" && id) {
      setEdges((current) => current.map((edge) => ({ ...edge, selected: edge.id === id })));
      setNodes((current) => current.map((node) => ({ ...node, selected: false })));
    }
    setContextMenu({
      kind,
      left: Math.max(8, Math.min(left, (bounds?.width || 300) - 190)),
      top: Math.max(8, Math.min(top, (bounds?.height || 300) - 240)),
      flowPosition: flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
      ...(kind === "node" ? { nodeId: id } : {}),
      ...(kind === "edge" ? { edgeId: id } : {}),
    });
  }, [flow]);

  const duplicateSelectedNodes = useCallback(() => {
    const selected = copyableCanvasSelection(nodesRef.current);
    if (!selected.length) return;
    pushHistorySnapshot();
    const idMap = new Map(selected.map((node) => [node.id, canvasId("node")]));
    const copies = selected.map((node) => {
      const parentId = node.parentId ? idMap.get(node.parentId) : undefined;
      const copy = { ...node };
      delete copy.parentId;
      delete copy.extent;
      delete copy.expandParent;
      return {
        ...copy,
        id: idMap.get(node.id)!,
        selected: !parentId,
        ...(parentId ? { parentId, extent: "parent" as const, expandParent: true } : {}),
        position: parentId ? node.position : { x: node.position.x + 48, y: node.position.y + 48 },
        data: duplicateCanvasNodeData(node.data, idMap),
      };
    });
    const copiedEdges = edgesRef.current.flatMap((edge) => {
      const source = idMap.get(edge.source);
      const target = idMap.get(edge.target);
      return source && target ? [{ ...edge, id: canvasId("edge"), source, target }] : [];
    });
    setNodes((current) => [...current.map((node) => ({ ...node, selected: false })), ...copies]);
    setEdges((current) => [...current, ...copiedEdges]);
    markDirty();
  }, [markDirty, pushHistorySnapshot]);

  const connectSelectedNodes = useCallback(() => {
    const selected = nodesRef.current.filter((node) => node.selected);
    const sources = selected.filter((node) => node.data.kind === "prompt" || node.data.kind === "media");
    const targets = selected.filter((node) => node.data.kind === "generator");
    if (!sources.length || !targets.length) {
      setNotice("批量连接需要同时选择提示词/素材节点和生成节点。");
      return;
    }
    pushHistorySnapshot();
    setEdges((current) => {
      const next = [...current];
      for (const target of targets) {
        for (const source of sources) {
          const connection = { source: source.id, target: target.id, sourceHandle: "output", targetHandle: "input" };
          if (isValidConnection(connection) && !next.some((edge) => edge.source === source.id && edge.target === target.id)) {
            next.push(decorateCanvasEdge({ ...connection, id: canvasId("edge") } as Edge, nodesRef.current, connectionStyle));
          }
        }
      }
      return next;
    });
    markDirty();
  }, [connectionStyle, isValidConnection, markDirty, pushHistorySnapshot]);

  const arrangeSelectedNodes = useCallback((mode: CanvasBatchArrangeMode) => {
    const selected = nodesRef.current.filter((node) => node.selected && !node.hidden);
    const distributing = mode === "distribute-horizontal" || mode === "distribute-vertical";
    if (selected.length < (distributing ? 3 : 2)) {
      setNotice(distributing ? "均匀分布至少需要三个节点。" : "对齐至少需要两个节点。");
      return;
    }
    if (selected.some((node) => node.data.locked)) {
      setNotice("请先解锁选中的节点再排列。");
      return;
    }
    if (new Set(selected.map((node) => node.parentId || "root")).size > 1) {
      setNotice("请选择同一分组层级中的节点进行排列。");
      return;
    }

    const dimensions = new Map(selected.map((node) => [node.id, {
      width: node.measured?.width || node.width || 340,
      height: node.measured?.height || node.height || (node.data.kind === "generator" ? 560 : 280),
    }]));
    const minX = Math.min(...selected.map((node) => node.position.x));
    const minY = Math.min(...selected.map((node) => node.position.y));
    const maxX = Math.max(...selected.map((node) => node.position.x + dimensions.get(node.id)!.width));
    const maxY = Math.max(...selected.map((node) => node.position.y + dimensions.get(node.id)!.height));
    const positions = new Map<string, { x: number; y: number }>();

    if (mode === "distribute-horizontal") {
      const sorted = [...selected].sort((left, right) => left.position.x - right.position.x);
      const totalWidth = sorted.reduce((total, node) => total + dimensions.get(node.id)!.width, 0);
      const gap = Math.max(24, (maxX - minX - totalWidth) / (sorted.length - 1));
      let x = minX;
      sorted.forEach((node) => {
        positions.set(node.id, { x, y: node.position.y });
        x += dimensions.get(node.id)!.width + gap;
      });
    } else if (mode === "distribute-vertical") {
      const sorted = [...selected].sort((left, right) => left.position.y - right.position.y);
      const totalHeight = sorted.reduce((total, node) => total + dimensions.get(node.id)!.height, 0);
      const gap = Math.max(24, (maxY - minY - totalHeight) / (sorted.length - 1));
      let y = minY;
      sorted.forEach((node) => {
        positions.set(node.id, { x: node.position.x, y });
        y += dimensions.get(node.id)!.height + gap;
      });
    } else {
      selected.forEach((node) => {
        const size = dimensions.get(node.id)!;
        const x = mode === "left" ? minX : mode === "horizontal-center" ? (minX + maxX - size.width) / 2 : mode === "right" ? maxX - size.width : node.position.x;
        const y = mode === "top" ? minY : mode === "vertical-center" ? (minY + maxY - size.height) / 2 : mode === "bottom" ? maxY - size.height : node.position.y;
        positions.set(node.id, { x, y });
      });
    }

    pushHistorySnapshot();
    setNodes((current) => current.map((node) => positions.has(node.id) ? { ...node, position: positions.get(node.id)! } : node));
    markDirty();
  }, [markDirty, pushHistorySnapshot]);

  const groupSelectedNodes = useCallback((nodeIds?: string[]) => {
    const requestedIds = nodeIds?.length ? new Set(nodeIds) : null;
    const selected = nodesRef.current.filter((node) => (requestedIds ? requestedIds.has(node.id) : node.selected) && !node.parentId && node.data.kind !== "group");
    if (selected.length < 2) {
      setNotice("请选择至少两个未分组节点。");
      return;
    }
    pushHistorySnapshot();
    const padding = 36;
    const header = 44;
    const minX = Math.min(...selected.map((node) => node.position.x));
    const minY = Math.min(...selected.map((node) => node.position.y));
    const maxX = Math.max(...selected.map((node) => node.position.x + (node.width || 320)));
    const maxY = Math.max(...selected.map((node) => node.position.y + (node.height || 280)));
    const groupId = canvasId("group");
    const groupPosition = { x: minX - padding, y: minY - header - padding / 2 };
    const selectedIds = new Set(selected.map((node) => node.id));
    const groupWidth = Math.max(360, maxX - minX + padding * 2);
    const groupHeight = Math.max(280, maxY - minY + header + padding);
    const groupNode: CanvasFlowNode = {
      id: groupId,
      type: "group",
      dragHandle: ".canvas-node-group__header",
      position: groupPosition,
      width: groupWidth,
      height: groupHeight,
      selected: true,
      data: { kind: "group", title: `节点分组 ${nodesRef.current.filter((node) => node.data.kind === "group").length + 1}`, createdAt: new Date().toISOString(), collapsed: false, expandedWidth: groupWidth, expandedHeight: groupHeight },
    };
    setNodes((current) => [
      groupNode,
      ...current.map((node) => selectedIds.has(node.id) ? {
        ...node,
        selected: false,
        parentId: groupId,
        extent: "parent" as const,
        expandParent: true,
        position: { x: node.position.x - groupPosition.x, y: node.position.y - groupPosition.y },
      } : node),
    ]);
    markDirty();
  }, [markDirty, pushHistorySnapshot]);

  const ungroupSelectedNodes = useCallback((groupIdsInput?: string[]) => {
    const requestedIds = groupIdsInput?.length ? new Set(groupIdsInput) : null;
    const groups = nodesRef.current.filter((node) => (requestedIds ? requestedIds.has(node.id) : node.selected) && node.data.kind === "group");
    if (!groups.length) {
      setNotice("请先选择一个节点分组。");
      return;
    }
    pushHistorySnapshot();
    const positions = new Map(groups.map((group) => [group.id, group.position]));
    const groupIds = new Set(positions.keys());
    setNodes((current) => current.flatMap((node) => {
      if (groupIds.has(node.id)) return [];
      const parentPosition = node.parentId ? positions.get(node.parentId) : undefined;
      if (!parentPosition) return [{ ...node, selected: false }];
      const { parentId: _parentId, extent: _extent, expandParent: _expandParent, ...rest } = node;
      void _parentId;
      void _extent;
      void _expandParent;
      return [{ ...rest, hidden: false, selected: true, position: { x: node.position.x + parentPosition.x, y: node.position.y + parentPosition.y } } as CanvasFlowNode];
    }));
    setContextMenu(null);
    markDirty();
  }, [markDirty, pushHistorySnapshot]);

  const cleanCanvas = useCallback(() => {
    const selectedIds = new Set(nodesRef.current.filter((node) => node.selected).map((node) => node.id));
    const removable = selectedIds.size ? selectedIds : new Set(nodesRef.current.filter((node) => (
      (node.data.kind === "prompt" && !node.data.prompt?.trim())
      || node.data.status === "failed"
    )).map((node) => node.id));
    nodesRef.current.forEach((node) => { if (node.parentId && removable.has(node.parentId)) removable.add(node.id); });
    if (!removable.size) {
      setNotice("没有可清理的空节点或失败节点。");
      return;
    }
    if (!window.confirm(`确认清理 ${removable.size} 个节点？`)) return;
    pushHistorySnapshot();
    const nextNodes = nodesRef.current.filter((node) => !removable.has(node.id));
    const nextEdges = edgesRef.current.filter((edge) => !removable.has(edge.source) && !removable.has(edge.target));
    replaceCanvasElements(nextNodes, nextEdges);
    markDirty();
  }, [markDirty, pushHistorySnapshot, replaceCanvasElements]);
  const focusSelectedText = useCallback(() => {
    if (!selectedNode) return;
    const textarea = document.querySelector<HTMLTextAreaElement>(`[data-canvas-node-id="${selectedNode.id}"] textarea`);
    textarea?.focus();
  }, [selectedNode]);
  // Kept for the context-menu edit path; the selected-node floating toolbar is intentionally removed.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const editSelected = useCallback(() => {
    if (!selectedNode) return;
    if (selectedNode.data.kind === "prompt") {
      focusSelectedText();
      return;
    }
    if (selectedNode.data.kind === "media") {
      if (selectedNode.data.mediaType === "image" && selectedNode.data.mediaUrl) {
        setEditingNodeId(selectedNode.id);
      } else {
        createGeneratorFromSelected(selectedNode, "image");
      }
      return;
    }
    setNotice("请先选择提示词或媒体节点进行编辑。");
  }, [createGeneratorFromSelected, focusSelectedText, selectedNode]);
  const generateSelected = useCallback(() => {
    if (!selectedNode) return;
    if (selectedNode.data.kind === "generator") {
      void executeGenerator(selectedNode.id);
      return;
    }
    createGeneratorFromSelected(selectedNode, selectedNode.data.kind === "media" && selectedNode.data.mediaType === "image" ? "image" : "video");
  }, [createGeneratorFromSelected, executeGenerator, selectedNode]);

  const organizeCanvas = useCallback((layout: "flow" | "grid" = "flow") => {
    if (!nodesRef.current.length) return;
    pushHistorySnapshot();
    setNodes((current) => {
      const rootIndex = new Map(current.filter((node) => !node.parentId).map((node, index) => [node.id, index]));
      if (layout === "grid") {
        const columns = Math.max(1, Math.ceil(Math.sqrt(rootIndex.size)));
        return current.map((node) => node.parentId ? node : ({
          ...node,
          position: { x: ((rootIndex.get(node.id) || 0) % columns) * 420, y: Math.floor((rootIndex.get(node.id) || 0) / columns) * 390 },
        }));
      }
      return layoutCanvasFlowNodes(current, edgesRef.current);
    });
    markDirty();
    window.requestAnimationFrame(() => { void flowRef.current.fitView({ duration: 260, padding: 0.16 }); });
  }, [markDirty, pushHistorySnapshot]);

  const addStoryboardNodes = useCallback((action: Extract<CanvasAssistantAction, { type: "add_storyboard" }>) => {
    if (!action.shots.length) return;
    const provider = providersRef.current.video[0] as WorkspacePublicProvider | undefined;
    if (!provider) {
      setNotice("当前没有可用的视频模型，分镜节点未创建。");
      return;
    }
    pushHistorySnapshot();
    const center = flowRef.current.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    const projectId = activeProjectRef.current?.id;
    const nextNodes: CanvasFlowNode[] = [];
    const nextEdges: Edge[] = [];
    action.shots.forEach((shot, index) => {
      const column = index % 2;
      const row = Math.floor(index / 2);
      const x = center.x - 420 + column * 820;
      const y = center.y - 260 + row * 520;
      const promptId = canvasId("node");
      const generatorId = canvasId("node");
      const sequenceState: CanvasSequenceState = {
        ...(shot.sequenceState || {}),
        ...(projectId ? { projectId } : {}),
        shotId: shot.shotId,
      };
      nextNodes.push({
        id: promptId,
        type: "canvas",
        dragHandle: ".canvas-node__header",
        position: { x, y },
        width: 360,
        height: 280,
        data: {
          kind: "prompt",
          title: `${shot.shotId} · ${shot.title}`,
          prompt: shot.prompt,
          createdAt: new Date().toISOString(),
          notes: shot.timeRange ? `时间轴：${shot.timeRange}` : undefined,
          referenceBindings: shot.referenceBindings,
          sequenceState,
        },
      });
      nextNodes.push({
        id: generatorId,
        type: "canvas",
        dragHandle: ".canvas-node__header",
        position: { x: x + 430, y: y - 10 },
        width: 360,
        height: 410,
        data: {
          kind: "generator",
          title: `${shot.shotId} · 视频生成`,
          generationKind: "video",
          providerId: provider.id,
          model: provider.model,
          createdAt: new Date().toISOString(),
          sourceNodeIds: [promptId],
          ratio: provider.videoOptions?.ratios?.[0] || "16:9",
          quality: "1k",
          duration: provider.videoOptions?.durations?.[0] || 5,
          resolution: provider.videoOptions?.resolutions?.[0] || provider.videoOptions?.resolution || "720p",
          status: "idle",
          progress: 0,
          sequenceState,
        },
      });
      nextEdges.push(decorateCanvasEdge({
        id: canvasId("edge"),
        source: promptId,
        sourceHandle: "output",
        target: generatorId,
        targetHandle: "input",
      }, [...nodesRef.current, ...nextNodes], connectionStyle));
    });
    const presented = applyCanvasNodePresentation([...nodesRef.current, ...nextNodes], [...edgesRef.current, ...nextEdges]);
    nodesRef.current = presented.nodes;
    edgesRef.current = presented.edges;
    setNodes(presented.nodes);
    setEdges(presented.edges);
    markDirty();
    setNotice(`已创建 ${action.shots.length} 个分镜提示词和视频生成节点，请逐个确认后生成。`);
  }, [connectionStyle, markDirty, pushHistorySnapshot]);

  const applyAssistantActions = useCallback((input: CanvasAssistantAction[]) => {
    const actions = normalizeCanvasAssistantResponse({ reply: "已应用", actions: input }).actions;
    for (const action of actions) {
      if (action.type === "add_prompt") {
        const target = action.targetGeneratorId
          ? nodesRef.current.find((node) => node.id === action.targetGeneratorId && node.data.kind === "generator")
          : undefined;
        const promptNode = addPromptNode(
          { title: action.title, prompt: action.prompt },
          target ? { x: target.position.x - 400, y: target.position.y } : undefined,
        );
        if (target) {
          const edge = decorateCanvasEdge({
            id: canvasId("edge"),
            source: promptNode.id,
            sourceHandle: "output",
            target: target.id,
            targetHandle: "input",
          }, nodesRef.current, connectionStyle);
          edgesRef.current = [...edgesRef.current, edge];
          setEdges(edgesRef.current);
          markDirty();
        }
      } else if (action.type === "add_generator") {
        addGeneratorNode(action.generationKind);
      } else if (action.type === "replace_selected_prompt") {
        const selected = nodesRef.current.find((node) => node.selected && node.data.kind === "prompt");
        if (selected) updateNodeData(selected.id, { prompt: action.prompt });
      } else if (action.type === "organize") {
        organizeCanvas(action.layout);
      } else if (action.type === "select_nodes") {
        const ids = new Set(action.nodeIds);
        setNodes((current) => current.map((node) => ({ ...node, selected: ids.has(node.id) })));
        setEdges((current) => current.map((edge) => ({ ...edge, selected: false })));
      } else if (action.type === "connect_nodes") {
        const target = nodesRef.current.find((node) => node.id === action.targetNodeId && node.data.kind === "generator");
        const sources = nodesRef.current.filter((node) => action.sourceNodeIds.includes(node.id) && (node.data.kind === "prompt" || node.data.kind === "media"));
        if (target && sources.length) {
          const additions = sources.filter((source) => !edgesRef.current.some((edge) => edge.source === source.id && edge.target === target.id));
          if (additions.length) {
            pushHistorySnapshot();
            setEdges((current) => [...current, ...additions.map((source) => decorateCanvasEdge({
              id: canvasId("edge"),
              source: source.id,
              sourceHandle: "output",
              target: target.id,
              targetHandle: "input",
            }, nodesRef.current, connectionStyle))]);
            markDirty();
          }
        }
      } else if (action.type === "group_nodes") {
        groupSelectedNodes(action.nodeIds);
      } else if (action.type === "ungroup") {
        ungroupSelectedNodes([action.groupId]);
      } else if (action.type === "annotate_references") {
        const node = nodesRef.current.find((item) => item.id === action.promptNodeId && item.data.kind === "prompt");
        if (node) updateNodeData(node.id, { referenceBindings: action.bindings });
      } else if (action.type === "annotate_sequence") {
        const node = nodesRef.current.find((item) => item.id === action.nodeId);
        if (node) updateNodeData(node.id, { sequenceState: action.sequenceState });
      } else if (action.type === "add_storyboard") {
        addStoryboardNodes(action);
      }
    }
    setNotice(actions.length ? `已应用 ${actions.length} 项助手操作。` : "助手没有请求可应用的画布操作。");
  }, [addGeneratorNode, addPromptNode, addStoryboardNodes, connectionStyle, groupSelectedNodes, markDirty, organizeCanvas, pushHistorySnapshot, ungroupSelectedNodes, updateNodeData]);

  const submitEditedImage = useCallback(async (file: File, prompt: string) => {
    const source = nodesRef.current.find((node) => node.id === editingNodeId && node.data.kind === "media");
    const provider = providersRef.current.image[0] as WorkspacePublicProvider | undefined;
    if (!source || !provider) throw new Error("当前没有可用的图片编辑模型。");
    const promptNode = addPromptNode({ title: "局部重绘提示词", prompt });
    const generator = createGeneratorFromSelected(source, "image");
    setEdges((current) => [...current, decorateCanvasEdge({
      id: canvasId("edge"),
      source: promptNode.id,
      sourceHandle: "output",
      target: generator.id,
      targetHandle: "input",
    }, [...nodesRef.current, promptNode], connectionStyle)]);
    updateNodeData(generator.id, { imageMode: "image-to-image", status: "generating", progress: 5 }, false);
    const objectUrl = URL.createObjectURL(file);
    const now = new Date().toISOString();
    const reference: LibraryItem = {
      id: `canvas-edit-${Date.now()}`,
      type: "image",
      mode: "image-to-image",
      title: source.data.title,
      prompt,
      providerId: provider.id,
      model: provider.model,
      status: "done",
      createdAt: now,
      updatedAt: now,
      params: {},
      output: { url: objectUrl, mimeType: "image/png", size: file.size },
    };
    const pendingResultIds = createPendingImageResultNodes(generator.id, 1);
    updatePendingImageResults(pendingResultIds, { status: "generating", progress: 35 });
    try {
      await submitImageGeneration(generator.id, { ...generator.data, imageMode: "image-to-image", count: 1 }, provider, prompt, [reference], addResultNode, updateNodeData, isInternalCanvas, pendingResultIds);
      updatePendingImageResults(pendingResultIds, { status: "failed", progress: 0, error: "生成接口未返回对应图片。" });
      updateNodeData(generator.id, { status: "done", progress: 100 }, false);
    } catch (error) {
      const message = apiMessage(error, "局部重绘失败。");
      updateNodeData(generator.id, { status: "failed", error: message }, false);
      updatePendingImageResults(pendingResultIds, { status: "failed", progress: 0, error: message });
      throw error;
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }, [addPromptNode, addResultNode, connectionStyle, createGeneratorFromSelected, createPendingImageResultNodes, editingNodeId, isInternalCanvas, updateNodeData, updatePendingImageResults]);

  const undoCanvas = useCallback(() => {
    const snapshot = historyPastRef.current.pop();
    if (!snapshot) return;
    historyFutureRef.current.push(snapshotWorkspace());
    syncHistoryState();
    const document = normalizeCanvasDocument(snapshot.document);
    setTitle(snapshot.title);
    const hydratedNodes = hydrateMediaNodes(document.nodes, libraryRef.current);
    const hydrated = applyCanvasNodePresentation(hydratedNodes, document.edges.map((edge) => decorateCanvasEdge(edge, hydratedNodes, connectionStyle)));
    setNodes(hydrated.nodes);
    setEdges(hydrated.edges);
    setViewportState(document.viewport);
    setInfoOpen(false);
    historySignatureRef.current = "";
    window.requestAnimationFrame(() => {
      void flowRef.current.setViewport(document.viewport, { duration: 0 });
    });
    markDirty();
  }, [connectionStyle, hydrateMediaNodes, markDirty, snapshotWorkspace, syncHistoryState]);

  const redoCanvas = useCallback(() => {
    const snapshot = historyFutureRef.current.pop();
    if (!snapshot) return;
    historyPastRef.current.push(snapshotWorkspace());
    syncHistoryState();
    const document = normalizeCanvasDocument(snapshot.document);
    setTitle(snapshot.title);
    const hydratedNodes = hydrateMediaNodes(document.nodes, libraryRef.current);
    const hydrated = applyCanvasNodePresentation(hydratedNodes, document.edges.map((edge) => decorateCanvasEdge(edge, hydratedNodes, connectionStyle)));
    setNodes(hydrated.nodes);
    setEdges(hydrated.edges);
    setViewportState(document.viewport);
    setInfoOpen(false);
    historySignatureRef.current = "";
    window.requestAnimationFrame(() => {
      void flowRef.current.setViewport(document.viewport, { duration: 0 });
    });
    markDirty();
  }, [connectionStyle, hydrateMediaNodes, markDirty, snapshotWorkspace, syncHistoryState]);

  const exportCanvas = useCallback(() => {
    const payload = JSON.stringify({
      title: titleRef.current,
      document: serializeDocument(nodesRef.current, edgesRef.current, viewportRef.current),
    }, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${slugifyCanvasTitle(titleRef.current)}.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    setNotice("鐢诲竷宸茶緭鍑恒€?");
  }, []);

  const exportCanvasImage = useCallback(() => {
    const visibleNodes = nodesRef.current.filter((node) => !node.hidden);
    if (!visibleNodes.length) {
      setNotice("当前没有可导出的可见节点。");
      return;
    }
    const rawNodeMap = new Map(visibleNodes.map((node) => [node.id, node]));
    const source = visibleNodes.map((node) => {
      let x = node.position.x;
      let y = node.position.y;
      let parentId = node.parentId;
      while (parentId) {
        const parent = rawNodeMap.get(parentId);
        if (!parent) break;
        x += parent.position.x;
        y += parent.position.y;
        parentId = parent.parentId;
      }
      return { ...node, position: { x, y } };
    });
    const minX = Math.min(...source.map((node) => node.position.x));
    const minY = Math.min(...source.map((node) => node.position.y));
    const maxX = Math.max(...source.map((node) => node.position.x + (node.measured?.width || node.width || 340)));
    const maxY = Math.max(...source.map((node) => node.position.y + (node.measured?.height || node.height || (node.data.kind === "generator" ? 560 : 280))));
    const padding = 80;
    const width = Math.max(320, maxX - minX + padding * 2);
    const height = Math.max(240, maxY - minY + padding * 2);
    const nodeMap = new Map(source.map((node) => [node.id, node]));
    const lines = edgesRef.current.flatMap((edge) => {
      const from = nodeMap.get(edge.source);
      const to = nodeMap.get(edge.target);
      if (!from || !to) return [];
      const x1 = from.position.x - minX + padding + (from.measured?.width || from.width || 340);
      const y1 = from.position.y - minY + padding + (from.measured?.height || from.height || 280) / 2;
      const x2 = to.position.x - minX + padding;
      const y2 = to.position.y - minY + padding + (to.measured?.height || to.height || 280) / 2;
      return [`<path d="M ${x1} ${y1} C ${x1 + 80} ${y1}, ${x2 - 80} ${y2}, ${x2} ${y2}" fill="none" stroke="#71717a" stroke-width="2"/>`];
    });
    const cards = source.map((node) => {
      const x = node.position.x - minX + padding;
      const y = node.position.y - minY + padding;
      const nodeWidth = node.measured?.width || node.width || 340;
      const nodeHeight = node.measured?.height || node.height || (node.data.kind === "generator" ? 560 : 280);
      const subtitle = node.data.kind === "prompt" ? node.data.prompt || "" : node.data.kind === "generator" ? `${node.data.generationKind || ""} · ${node.data.providerId || ""}` : node.data.mediaType || "";
      return `<g><rect x="${x}" y="${y}" width="${nodeWidth}" height="${nodeHeight}" rx="8" fill="#18181b" stroke="#3f3f46"/><text x="${x + 18}" y="${y + 32}" fill="#fafafa" font-size="15" font-family="sans-serif" font-weight="700">${escapeXml(node.data.title)}</text><text x="${x + 18}" y="${y + 58}" fill="#a1a1aa" font-size="13" font-family="sans-serif">${escapeXml(String(subtitle).replace(/\s+/g, " ").slice(0, 120))}</text></g>`;
    });
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#09090b"/>${lines.join("")}${cards.join("")}</svg>`;
    const svgUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, 8_192 / width, 8_192 / height);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.ceil(width * scale));
      canvas.height = Math.max(1, Math.ceil(height * scale));
      const context = canvas.getContext("2d");
      if (!context) {
        URL.revokeObjectURL(svgUrl);
        setNotice("浏览器无法创建 PNG 画布。");
        return;
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(svgUrl);
      canvas.toBlob((blob) => {
        if (!blob) {
          setNotice("PNG 导出失败，请缩小画布后重试。");
          return;
        }
        const pngUrl = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = pngUrl;
        anchor.download = `${slugifyCanvasTitle(titleRef.current)}.png`;
        anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(pngUrl), 1_000);
        setNotice("画布 PNG 已导出。");
      }, "image/png");
    };
    image.onerror = () => {
      URL.revokeObjectURL(svgUrl);
      setNotice("PNG 导出失败，请重试。");
    };
    image.src = svgUrl;
  }, []);

  const importCanvasFromText = useCallback(async (text: string) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("画布 JSON 格式无效。");
    }
    const projectLike = isRecord(parsed) && "document" in parsed
      ? parsed as { title?: unknown; document: unknown }
      : { title: undefined, document: parsed };
    const document = normalizeCanvasDocument(projectLike.document);
    const requestedTitle = typeof projectLike.title === "string" && projectLike.title.trim()
      ? projectLike.title.trim().slice(0, 120)
      : `${titleRef.current} 导入`.slice(0, 120);
    const usedTitles = new Set(projectsRef.current.map((project) => project.title.trim().toLocaleLowerCase("zh-CN")));
    let nextTitle = requestedTitle;
    if (usedTitles.has(nextTitle.toLocaleLowerCase("zh-CN"))) {
      nextTitle = `${requestedTitle.slice(0, 115)} (导入)`;
      let index = 2;
      while (usedTitles.has(nextTitle.toLocaleLowerCase("zh-CN"))) {
        const suffix = ` (导入 ${index})`;
        nextTitle = `${requestedTitle.slice(0, 120 - suffix.length)}${suffix}`;
        index += 1;
      }
    }
    const created = await fetchJsonWithCsrf<{ project: CanvasProject }>(canvasProjectsUrl(), {
      method: "POST",
      body: JSON.stringify({ title: nextTitle, document }),
    });
    setProjects((current) => [created.project, ...current]);
    activateProject(created.project);
    setNotice(`已导入为新画布“${nextTitle}”。`);
  }, [activateProject]);

  const triggerImport = useCallback(() => {
    importInputRef.current?.click();
  }, []);

  const openCanvasMedia = useCallback((node: CanvasFlowNode) => {
    if (node.data.kind !== "media" || !node.data.mediaUrl) return;
    window.open(node.data.mediaUrl, "_blank", "noopener,noreferrer");
  }, []);

  const downloadCanvasMedia = useCallback((node: CanvasFlowNode) => {
    if (node.data.kind !== "media" || !node.data.mediaUrl) return;
    const anchor = document.createElement("a");
    anchor.href = node.data.mediaUrl;
    anchor.download = slugifyCanvasTitle(node.data.title);
    anchor.rel = "noopener";
    anchor.click();
  }, []);

  const copyCanvasMediaLink = useCallback(async (node: CanvasFlowNode) => {
    if (node.data.kind !== "media" || !node.data.mediaUrl) return;
    try {
      await navigator.clipboard.writeText(node.data.mediaUrl);
      setNotice("濯掍綋閾炬帴宸插鍒帮紝鍙互鐩存帴閲嶇敤銆?");
    } catch {
      setNotice("褰撳墠娴忚鍣ㄦ殏涓嶅厑璁稿鍒堕摼鎺ワ紝璇风洿鎺ユ墦寮€濯掍綋銆?");
    }
  }, []);

  const renameLibraryItem = useCallback(async (item: LibraryItem) => {
    const title = window.prompt("素材名称", item.title)?.trim();
    if (!title || title === item.title) return;
    await fetchJsonWithCsrf("/api/library", { method: "PATCH", body: JSON.stringify({ id: item.id, title }) });
    await refreshLibrary();
    setNotice("素材已重命名。");
  }, [refreshLibrary]);

  const toggleLibraryFavorite = useCallback(async (item: LibraryItem) => {
    const favorite = !Boolean(item.favorite || item.params.favorite);
    await fetchJsonWithCsrf("/api/library", { method: "PATCH", body: JSON.stringify({ id: item.id, favorite }) });
    await refreshLibrary();
  }, [refreshLibrary]);

  const deleteLibraryItem = useCallback(async (item: LibraryItem) => {
    if (!window.confirm(`确认删除素材“${item.title}”？`)) return;
    await fetchJsonWithCsrf("/api/library", { method: "DELETE", body: JSON.stringify({ id: item.id }) });
    const nextNodes = nodesRef.current.filter((node) => node.data.libraryItemId !== item.id);
    const remaining = new Set(nextNodes.map((node) => node.id));
    const nextEdges = edgesRef.current.filter((edge) => remaining.has(edge.source) && remaining.has(edge.target));
    replaceCanvasElements(nextNodes, nextEdges);
    await refreshLibrary();
    markDirty();
  }, [markDirty, refreshLibrary, replaceCanvasElements]);

  const copyLibraryItemLink = useCallback(async (item: LibraryItem) => {
    if (!item.output?.url) return;
    await navigator.clipboard.writeText(item.output.url);
    setNotice("素材链接已复制。");
  }, []);

  const downloadLibraryItem = useCallback((item: LibraryItem) => {
    if (!item.output?.url) return;
    const anchor = document.createElement("a");
    anchor.href = item.output.url;
    anchor.download = slugifyCanvasTitle(item.title);
    anchor.rel = "noopener";
    anchor.click();
  }, []);

  const selectAllVisibleNodes = useCallback(() => {
    setNodes((current) => current.map((node) => ({ ...node, selected: !node.hidden })));
    setEdges((current) => current.map((edge) => ({ ...edge, selected: false })));
    setContextMenu(null);
  }, []);

  const nudgeSelectedNodes = useCallback((deltaX: number, deltaY: number) => {
    const selected = nodesRef.current.filter((node) => node.selected && !node.hidden && !node.data.locked);
    if (!selected.length) return;
    const movableIds = new Set(selected.map((node) => node.id));
    const nodeById = new Map(nodesRef.current.map((node) => [node.id, node]));
    pushHistorySnapshot();
    setNodes((current) => current.map((node) => {
      if (!movableIds.has(node.id) || (node.parentId && movableIds.has(node.parentId))) return node;
      let x = node.position.x + deltaX;
      let y = node.position.y + deltaY;
      const parent = node.parentId ? nodeById.get(node.parentId) : undefined;
      if (parent?.width && parent.height && node.width && node.height) {
        x = Math.max(0, Math.min(parent.width - node.width, x));
        y = Math.max(0, Math.min(parent.height - node.height, y));
      }
      return { ...node, position: { x, y } };
    }));
    markDirty();
  }, [markDirty, pushHistorySnapshot]);

  const fitCanvasSelection = useCallback(() => {
    const selected = nodesRef.current.filter((node) => node.selected && !node.hidden);
    if (!selected.length) {
      void flow.fitView({ padding: 0.18, duration: 280 });
      return;
    }
    void flow.fitView({ nodes: selected, padding: 0.28, duration: 280, maxZoom: 1.2 });
  }, [flow]);

  const focusCanvasNode = useCallback((id: string) => {
    const node = nodesRef.current.find((item) => item.id === id && !item.hidden);
    if (!node) return;
    setNodes((current) => current.map((item) => ({ ...item, selected: item.id === id })));
    setEdges((current) => current.map((edge) => ({ ...edge, selected: false })));
    window.requestAnimationFrame(() => {
      void flow.fitView({ nodes: [node], padding: 0.35, duration: 260, maxZoom: 1.15 });
    });
  }, [flow]);

  const commandItems = useMemo<CanvasCommand[]>(() => {
    const actions: CanvasCommand[] = [
      { id: "add-prompt", label: "添加提示词", description: "在画布中创建提示词节点", group: "创建", keywords: ["文字", "prompt", "text"], icon: Type, run: () => addPromptNode(undefined, commandInsertPosition) },
      { id: "add-image-generator", label: "添加图片生成", description: "由连接的提示词和素材决定生成模式", group: "创建", keywords: ["生图", "image"], icon: ImageIcon, run: () => addGeneratorNode("image", commandInsertPosition) },
      { id: "add-video-generator", label: "添加视频生成", description: "选择模型并连接提示词或参考素材", group: "创建", keywords: ["生视频", "video"], icon: Film, run: () => addGeneratorNode("video", commandInsertPosition) },
      ...(isInternalCanvas ? [{ id: "upload-media", label: "上传图片或视频", description: "文件会同时进入画布和作品库", group: "创建", keywords: ["拖入", "导入素材", "upload"], icon: Upload, run: () => mediaInputRef.current?.click() } satisfies CanvasCommand] : []),
      { id: "open-library", label: "打开作品素材库", description: "搜索、批量添加和管理素材", group: "面板", keywords: ["素材", "作品", "library"], icon: FolderOpen, run: () => setLibraryOpen(true) },
      { id: "open-layers", label: "打开图层", description: "定位、隐藏、锁定或调整节点层级", group: "面板", keywords: ["layers", "锁定"], icon: Layers3, run: () => setLayersOpen(true) },
      ...(isInternalCanvas ? [{ id: "open-assistant", label: "打开智能助手", description: "只处理提示词、镜头和画布内容", group: "面板", keywords: ["AI", "agent", "助手"], icon: Bot, run: () => setAssistantOpen(true) } satisfies CanvasCommand] : []),
      { id: "open-settings", label: "打开画布设置", description: "主题、连接线、吸附和自动排列", group: "面板", keywords: ["主题", "线条", "设置"], icon: Settings2, run: () => setSettingsOpen(true) },
      { id: "open-shortcuts", label: "查看操作与快捷键", description: "鼠标、键盘和触屏操作总览", group: "面板", keywords: ["帮助", "快捷键", "help"], icon: Keyboard, shortcut: "?", run: openShortcuts },
      { id: "fit-selection", label: selectedNodes.length ? "适应选中节点" : "查看全部节点", description: selectedNodes.length ? `在视口中显示已选的 ${selectedNodes.length} 个节点` : "让全部画布内容进入视口", group: "视图", keywords: ["定位", "聚焦", "fit", "zoom"], icon: Maximize2, shortcut: ".", run: fitCanvasSelection },
      { id: "organize-flow", label: "流程排列", description: "按提示词、素材、生成和结果整理画布", group: "视图", keywords: ["自动布局", "layout", "arrange"], icon: AlignCenterHorizontal, run: () => organizeCanvas("flow") },
      { id: "organize-grid", label: "网格排列", description: "按规整网格重新摆放节点", group: "视图", keywords: ["自动布局", "grid", "arrange"], icon: AlignCenterVertical, run: () => organizeCanvas("grid") },
      { id: "select-all", label: "选择全部节点", group: "编辑", keywords: ["全选", "select all"], icon: MousePointer2, shortcut: "Ctrl A", run: selectAllVisibleNodes },
      ...(selectedNodes.length > 1 ? [{ id: "group-selection", label: "组合选中节点", description: `将 ${selectedNodes.length} 个节点放入分组`, group: "编辑", keywords: ["分组", "group"], icon: Layers3, shortcut: "Ctrl G", run: () => groupSelectedNodes() } satisfies CanvasCommand] : []),
      ...(selectedNodes.length ? [{ id: "duplicate-selection", label: "重复选中节点", description: `复制 ${selectedNodes.length} 个节点及内部连接`, group: "编辑", keywords: ["复制", "duplicate"], icon: CopyPlus, shortcut: "Ctrl D", run: duplicateSelectedNodes } satisfies CanvasCommand] : []),
      ...(historyState.undo ? [{ id: "undo", label: "撤销", group: "编辑", keywords: ["undo"], icon: Undo2, shortcut: "Ctrl Z", run: undoCanvas } satisfies CanvasCommand] : []),
      ...(historyState.redo ? [{ id: "redo", label: "重做", group: "编辑", keywords: ["redo"], icon: Redo2, shortcut: "Ctrl Y", run: redoCanvas } satisfies CanvasCommand] : []),
      { id: "save", label: "立即保存画布", group: "文件", keywords: ["save"], icon: Save, shortcut: "Ctrl S", run: () => { void saveNow(true); } },
      { id: "export-image", label: "导出画布图片", description: "将当前节点和连接导出为 PNG", group: "文件", keywords: ["PNG", "截图", "export"], icon: Download, shortcut: "Ctrl Shift E", run: exportCanvasImage },
    ];
    const nodeCommands = nodes.filter((node) => !node.hidden).map((node): CanvasCommand => ({
      id: `focus-node-${node.id}`,
      label: node.data.title || "未命名节点",
      description: node.data.kind === "prompt" ? String(node.data.prompt || "提示词节点").slice(0, 80) : node.data.kind === "generator" ? `${node.data.generationKind === "video" ? "视频" : "图片"}生成节点` : node.data.kind === "group" ? "画布分组" : `${node.data.mediaType === "video" ? "视频" : node.data.mediaType === "audio" ? "音频" : "图片"}素材`,
      group: "跳转到节点",
      keywords: [node.data.kind, String(node.data.prompt || ""), String(node.data.model || "")],
      icon: node.data.kind === "prompt" ? Type : node.data.kind === "generator" ? Sparkles : node.data.kind === "group" ? Layers3 : node.data.mediaType === "video" ? Film : ImageIcon,
      run: () => focusCanvasNode(node.id),
    }));
    return [...actions, ...nodeCommands];
  }, [addGeneratorNode, addPromptNode, commandInsertPosition, duplicateSelectedNodes, exportCanvasImage, fitCanvasSelection, focusCanvasNode, groupSelectedNodes, historyState.redo, historyState.undo, isInternalCanvas, nodes, openShortcuts, organizeCanvas, redoCanvas, saveNow, selectAllVisibleNodes, selectedNodes.length, undoCanvas]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.matches("input, textarea, select, [contenteditable='true']");
      const command = event.ctrlKey || event.metaKey;
      if (command && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (commandOpen) closeCommandPalette();
        else openCommandPalette();
      } else if (command && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveNow(true);
      } else if (command && event.key.toLowerCase() === "z" && !event.shiftKey && !typing) {
        event.preventDefault();
        undoCanvas();
      } else if (!typing && ((command && event.key.toLowerCase() === "y") || (command && event.shiftKey && event.key.toLowerCase() === "z"))) {
        event.preventDefault();
        redoCanvas();
      } else if (command && event.shiftKey && event.key.toLowerCase() === "e") {
        event.preventDefault();
        exportCanvasImage();
      } else if (command && event.key.toLowerCase() === "a" && !typing) {
        event.preventDefault();
        selectAllVisibleNodes();
      } else if (command && event.key.toLowerCase() === "d" && !typing) {
        event.preventDefault();
        duplicateSelectedNodes();
      } else if (command && event.key.toLowerCase() === "c" && !typing) {
        event.preventDefault();
        copySelectedNodes();
      } else if (command && event.key.toLowerCase() === "g" && !typing) {
        event.preventDefault();
        groupSelectedNodes();
      } else if (!typing && event.key === ".") {
        event.preventDefault();
        fitCanvasSelection();
      } else if (!typing && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
        event.preventDefault();
        const distance = event.shiftKey ? 10 : 1;
        nudgeSelectedNodes(
          event.key === "ArrowLeft" ? -distance : event.key === "ArrowRight" ? distance : 0,
          event.key === "ArrowUp" ? -distance : event.key === "ArrowDown" ? distance : 0,
        );
      } else if (!typing && (event.key === "Delete" || event.key === "Backspace")) {
        event.preventDefault();
        removeSelectedNodes();
      } else if (!typing && event.key === "?") {
        event.preventDefault();
        openShortcuts();
      } else if (event.key === "Escape") {
        setAssistantOpen(false);
        setShortcutsOpen(false);
        setInfoOpen(false);
        setLayersOpen(false);
        setSettingsOpen(false);
        setCommandOpen(false);
        setContextMenu(null);
        setNodes((current) => current.map((node) => ({ ...node, selected: false })));
        setEdges((current) => current.map((edge) => ({ ...edge, selected: false })));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeCommandPalette, commandOpen, copySelectedNodes, duplicateSelectedNodes, exportCanvasImage, fitCanvasSelection, groupSelectedNodes, nudgeSelectedNodes, openCommandPalette, openShortcuts, redoCanvas, removeSelectedNodes, saveNow, selectAllVisibleNodes, undoCanvas]);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      const stageBounds = stageRef.current?.getBoundingClientRect();
      const position = flow.screenToFlowPosition({
        x: stageBounds ? stageBounds.left + stageBounds.width / 2 : window.innerWidth / 2,
        y: stageBounds ? stageBounds.top + stageBounds.height / 2 : window.innerHeight / 2,
      });
      const files = Array.from(event.clipboardData?.files || []).filter(isSupportedCanvasDropFile);
      if (files.length) {
        event.preventDefault();
        void uploadCanvasMediaFiles(files, position);
        return;
      }
      if (clipboardRef.current?.nodes.length) {
        event.preventDefault();
        pasteCopiedNodes(position);
        return;
      }
      const text = event.clipboardData?.getData("text/plain").trim();
      if (!text) return;
      event.preventDefault();
      addPromptNode({ title: "粘贴文本", prompt: text.slice(0, 4_000) }, position);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [addPromptNode, flow, pasteCopiedNodes, uploadCanvasMediaFiles]);

  if (loading) {
    return <div className="canvas-loading"><LoaderCircle className="is-spinning" /><span>正在打开创作画布</span></div>;
  }

  return (
    <main
      className={cn("aohuang-canvas-page", presentation === "vozeb" && "canvas-v2-page")}
      data-canvas-theme={canvasTheme}
      data-canvas-presentation={presentation}
    >
      {presentation === "vozeb" ? (
        <CanvasVozebTopbar
          accountName={accountName}
          projects={projects}
          activeProjectId={activeProjectId}
          scope={isInternalCanvas ? canvasScope() : undefined}
          title={title}
          saveState={saveState}
          syncState={isInternalCanvas ? syncState : undefined}
          canvasTheme={canvasTheme}
          libraryOpen={libraryOpen}
          layersOpen={layersOpen}
          settingsOpen={settingsOpen}
          teamOpen={teamOpen}
          assistantOpen={assistantOpen}
          shortcutsOpen={shortcutsOpen}
          commandOpen={commandOpen}
          isTeamOwner={isTeamOwner}
          presenceMembers={canvasScope() === "shared" ? uniquePresenceMembers : []}
          presenceClientId={collaborationClientId}
          onTitleChange={(value) => { pushHistorySnapshot(); setTitle(value); markDirty(); }}
          onProjectChange={(id) => { void switchProject(id); }}
          onScopeChange={(scope) => {
            const url = new URL(window.location.href);
            url.searchParams.set("scope", scope);
            window.location.assign(url);
          }}
          onCreateProject={() => { void createProject(); }}
          onDeleteProject={() => { void deleteProject(); }}
          onSave={() => { void saveNow(true); }}
          onToggleLibrary={() => setLibraryOpen((value) => !value)}
          onToggleLayers={() => {
            setLayersOpen((value) => !value);
            setInfoOpen(false);
            setAssistantOpen(false);
            setShortcutsOpen(false);
            setSettingsOpen(false);
          }}
          onImport={triggerImport}
          onExport={exportCanvas}
          onSettings={() => {
            setSettingsOpen((value) => !value);
            setLayersOpen(false);
            setInfoOpen(false);
            setAssistantOpen(false);
            setShortcutsOpen(false);
          }}
          onToggleTeam={() => setTeamOpen((value) => !value)}
          onAssistant={() => {
            setLayersOpen(false);
            setInfoOpen(false);
            setSettingsOpen(false);
            setShortcutsOpen(false);
            if (isInternalCanvas) setAssistantOpen((value) => !value);
            else setNotice("智能助手仅供内部画布使用。");
          }}
          onShortcuts={toggleShortcuts}
          onCommand={() => commandOpen ? closeCommandPalette() : openCommandPalette()}
          onOrganize={() => organizeCanvas("flow")}
          onThemeCycle={() => setCanvasTheme((value) => value === "light" ? "midnight" : "light")}
        />
      ) : (
        <CanvasToolbar
        accountName={accountName}
        projects={projects}
        activeProjectId={activeProjectId}
        scope={isInternalCanvas ? canvasScope() : undefined}
        title={title}
        saveState={saveState}
        syncState={isInternalCanvas ? syncState : undefined}
        libraryOpen={libraryOpen}
        layersOpen={layersOpen}
        canUndo={historyState.undo > 0}
        canRedo={historyState.redo > 0}
        onTitleChange={(value) => { pushHistorySnapshot(); setTitle(value); markDirty(); }}
        onProjectChange={(id) => { void switchProject(id); }}
        onScopeChange={(scope) => {
          const url = new URL(window.location.href);
          url.searchParams.set("scope", scope);
          window.location.assign(url);
        }}
        onCreateProject={() => { void createProject(); }}
        onDeleteProject={() => { void deleteProject(); }}
        onSave={() => { void saveNow(true); }}
        onToggleLibrary={() => setLibraryOpen((value) => !value)}
        onToggleLayers={() => {
          setLayersOpen((value) => !value);
          setInfoOpen(false);
          setAssistantOpen(false);
          setShortcutsOpen(false);
          setSettingsOpen(false);
        }}
        onAddPrompt={addPromptNode}
        onAddImage={() => addGeneratorNode("image")}
        onAddVideo={() => addGeneratorNode("video")}
        onAddAudio={isInternalCanvas ? () => audioInputRef.current?.click() : undefined}
        onUndo={undoCanvas}
        onRedo={redoCanvas}
        onImport={triggerImport}
        onExport={exportCanvas}
        settingsOpen={settingsOpen}
        onSettings={() => {
          setSettingsOpen((value) => !value);
          setLayersOpen(false);
          setInfoOpen(false);
          setAssistantOpen(false);
          setShortcutsOpen(false);
        }}
        isTeamOwner={isTeamOwner}
        teamOpen={teamOpen}
        onToggleTeam={() => setTeamOpen((value) => !value)}
        assistantOpen={assistantOpen}
        shortcutsOpen={shortcutsOpen}
        onAssistant={() => {
          setLayersOpen(false);
          setInfoOpen(false);
          setSettingsOpen(false);
          setShortcutsOpen(false);
          if (isInternalCanvas) setAssistantOpen((value) => !value);
          else setNotice("智能助手仅供内部画布使用。");
        }}
          onShortcuts={toggleShortcuts}
        />
      )}
      <input
        ref={importInputRef}
        type="file"
        accept="application/json"
        className="canvas-import-input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          void file.text().then((text) => importCanvasFromText(text)).catch((error) => {
            setNotice(apiMessage(error, "Canvas import failed."));
          });
        }}
      />
      <input
        ref={audioInputRef}
        type="file"
        accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/x-wav,.mp3,.m4a,.wav"
        className="canvas-import-input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void addAudioReference(file);
        }}
      />
      <input
        ref={mediaInputRef}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp,video/mp4,video/webm,video/quicktime,audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/x-wav,.png,.jpg,.jpeg,.webp,.mp4,.webm,.mov,.mp3,.m4a,.wav"
        className="canvas-import-input"
        onChange={(event) => {
          const files = Array.from(event.target.files || []);
          event.target.value = "";
          if (files.length) void uploadCanvasMediaFiles(files);
        }}
      />

      <div className="canvas-workspace">
        {libraryOpen ? <button type="button" className="canvas-library-scrim" aria-label="关闭素材库" title="关闭素材库" onClick={() => setLibraryOpen(false)} /> : null}
        <LibraryPanel
          open={libraryOpen}
          items={filteredLibrary}
          filter={libraryFilter}
          search={librarySearch}
          onClose={() => setLibraryOpen(false)}
          onFilter={setLibraryFilter}
          onSearch={setLibrarySearch}
          onUpload={isInternalCanvas ? () => mediaInputRef.current?.click() : undefined}
          onAdd={addLibraryNode}
          onAddMany={addLibraryNodes}
          canReplace={selectedNode?.data.kind === "media"}
          onReplace={replaceSelectedMaterial}
          onRename={(item) => { void renameLibraryItem(item); }}
          onFavorite={(item) => { void toggleLibraryFavorite(item); }}
          onCopyLink={(item) => { void copyLibraryItemLink(item); }}
          onDownload={downloadLibraryItem}
          onTrim={(item) => setTrimmingLibraryItemId(item.id)}
          onPublish={(item) => setTikTokLibraryItemId(item.id)}
          onDelete={(item) => { void deleteLibraryItem(item); }}
        />
        <section
          ref={stageRef}
          className={cn("canvas-stage", assistantMentionMode && "is-assistant-mentioning")}
          aria-label="无限画布"
          onClickCapture={(event) => {
            if (!assistantOpen || !assistantMentionMode) return;
            const target = event.target instanceof Element ? event.target : null;
            const nodeId = target?.closest<HTMLElement>("[data-canvas-node-id]")?.dataset.canvasNodeId;
            const node = nodeId ? nodesRef.current.find((candidate) => candidate.id === nodeId) : null;
            if (!node || node.data.kind === "group") return;
            event.preventDefault();
            event.stopPropagation();
            setAssistantMentionSelection((current) => ({ nodeId: node.id, revision: (current?.revision || 0) + 1 }));
          }}
          onDoubleClickCapture={(event) => {
            const target = event.target instanceof Element ? event.target : null;
            if (!target || target.closest(".react-flow__node, .react-flow__edge, .react-flow__panel, .canvas-bottom-dock, aside, button, input, textarea, select, [role='dialog']")) return;
            openCommandPalette(flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
          }}
          onDragEnter={(event) => {
            if (!Array.from(event.dataTransfer.types).includes("Files")) return;
            fileDragDepthRef.current += 1;
            setFileDropActive(true);
          }}
          onDragLeave={(event) => {
            if (!Array.from(event.dataTransfer.types).includes("Files")) return;
            fileDragDepthRef.current = Math.max(0, fileDragDepthRef.current - 1);
            if (!fileDragDepthRef.current) setFileDropActive(false);
          }}
          onFocusCapture={(event) => {
            const target = event.target instanceof HTMLElement ? event.target : null;
            if (!target?.matches("textarea, input, select, [contenteditable='true']")) return;
            const nodeId = target.closest<HTMLElement>("[data-canvas-node-id]")?.dataset.canvasNodeId || "";
            focusedEditorNodeIdRef.current = nodeId;
            setPresenceEditingNodeId(nodeId);
          }}
          onBlurCapture={(event) => {
            const stage = event.currentTarget;
            window.requestAnimationFrame(() => {
              const active = document.activeElement;
              if (!(active instanceof HTMLElement) || !stage.contains(active) || !active.matches("textarea, input, select, [contenteditable='true']")) {
                focusedEditorNodeIdRef.current = "";
                setPresenceEditingNodeId("");
                return;
              }
              const nodeId = active.closest<HTMLElement>("[data-canvas-node-id]")?.dataset.canvasNodeId || "";
              focusedEditorNodeIdRef.current = nodeId;
              setPresenceEditingNodeId(nodeId);
            });
          }}
        >
          {selectedNodes.length > 1 ? (
            <CanvasBatchToolbar
              count={selectedNodes.length}
              style={selectionToolbarStyle}
              onConnect={connectSelectedNodes}
              onArrange={arrangeSelectedNodes}
              trimCount={isInternalCanvas ? selectedVideoTrimCount : 0}
              trimming={batchTrimming}
              onTrim={() => { void batchTrimSelectedVideos(); }}
              onGroup={groupSelectedNodes}
              onDuplicate={duplicateSelectedNodes}
              onDelete={removeSelectedNodes}
            />
          ) : null}
          <CanvasNodeActionsContext.Provider value={nodeActions}>
            <ReactFlow<CanvasFlowNode, Edge>
              nodes={nodes}
              edges={displayEdges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onSelectionChange={onSelectionChange}
              onConnect={onConnect}
              onConnectEnd={onConnectEnd}
              onReconnect={onReconnect}
              isValidConnection={isValidConnection}
              onPaneClick={() => setContextMenu(null)}
              onPaneContextMenu={(event) => openContextMenu(event, "pane")}
              onNodeContextMenu={(event, node) => openContextMenu(event, "node", node.id)}
              onNodeMouseEnter={(_, node) => setHoveredNodeId(node.id)}
              onNodeMouseLeave={(_, node) => setHoveredNodeId((current) => current === node.id ? "" : current)}
              onNodeClick={(event, node) => {
                if (!touchMultiSelect) return;
                event.preventDefault();
                const selected = Boolean(nodesRef.current.find((item) => item.id === node.id)?.selected);
                setNodes((current) => current.map((item) => item.id === node.id ? { ...item, selected: !selected } : item));
                setEdges((current) => current.map((edge) => ({ ...edge, selected: false })));
              }}
              onEdgeContextMenu={(event, edge) => openContextMenu(event, "edge", edge.id)}
              onMoveStart={() => {
                viewportInteractingRef.current = true;
                setContextMenu(null);
              }}
              onMoveEnd={(_, nextViewport) => {
                viewportRef.current = nextViewport;
                setViewportState(nextViewport);
                viewportInteractingRef.current = false;
                if (canvasScope() === "shared") {
                  if (activeProjectRef.current) writeSharedViewport(accountName, activeProjectRef.current.id, nextViewport);
                  window.requestAnimationFrame(flushDeferredCanvasSync);
                  return;
                }
                pushHistorySnapshot();
                markDirty();
                window.requestAnimationFrame(flushDeferredCanvasSync);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "copy";
              }}
              onDrop={(event) => {
                event.preventDefault();
                fileDragDepthRef.current = 0;
                setFileDropActive(false);
                const itemId = event.dataTransfer.getData(libraryDragType);
                const item = libraryRef.current.find((entry) => entry.id === itemId);
                const position = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
                if (item) {
                  addLibraryNode(item, position);
                  return;
                }
                const items = Array.from(event.dataTransfer.items || []);
                const fallbackFiles = Array.from(event.dataTransfer.files || []);
                if (items.length || fallbackFiles.length) {
                  void collectCanvasFolderDropFiles(items, fallbackFiles)
                    .then((result) => uploadCanvasMediaFiles(result.files, position, result.truncated))
                    .catch((error) => setNotice(apiMessage(error, "读取文件夹失败。")));
                }
              }}
              defaultEdgeOptions={{
                type: "canvas-edge",
                markerEnd: { type: MarkerType.ArrowClosed },
                style: { strokeWidth: 1.5 },
              }}
              connectionLineComponent={connectionLineComponents[connectionStyle]}
              connectionRadius={36}
              connectionDragThreshold={4}
              defaultViewport={viewport}
              minZoom={0.08}
              maxZoom={2.5}
              panOnScroll
              panOnDrag
              panActivationKeyCode="Space"
              snapToGrid={snapEnabled}
              snapGrid={[24, 24]}
              selectionOnDrag={false}
              selectionKeyCode={presentation === "vozeb" ? "Control" : "Shift"}
              selectionMode={SelectionMode.Partial}
              multiSelectionKeyCode={["Control", "Meta", "Shift"]}
              elementsSelectable={!touchMultiSelect}
              deleteKeyCode={null}
              proOptions={{ hideAttribution: true }}
            >
              <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} />
              <MiniMap pannable zoomable nodeColor={miniMapColor} />
              <Controls showInteractive={false} />
            </ReactFlow>
          </CanvasNodeActionsContext.Provider>
          {fileDropActive ? <div className="canvas-file-drop" role="status"><Upload /><strong>松开导入文件或文件夹</strong><span>支持图片和视频，上传后自动进入作品库</span></div> : null}
          {contextMenu ? (
            <CanvasContextMenu
              state={contextMenu}
              canPaste={clipboardHasNodes}
              canAddImage={contextCanAddImage}
              isGroup={Boolean(contextMenu.nodeId && nodes.find((node) => node.id === contextMenu.nodeId)?.data.kind === "group")}
              onAddPrompt={() => { addPromptNode(undefined, contextMenu.flowPosition); setContextMenu(null); }}
              onAddImage={() => addContextGenerator("image", contextMenu)}
              onAddVideo={() => addContextGenerator("video", contextMenu)}
              onAddAudio={isInternalCanvas ? () => { audioInputRef.current?.click(); setContextMenu(null); } : undefined}
              onCopy={copySelectedNodes}
              onPaste={() => pasteCopiedNodes(contextMenu.flowPosition)}
              onSelectAll={selectAllVisibleNodes}
              onInfo={() => { setInfoOpen(true); setContextMenu(null); }}
              onUngroup={ungroupSelectedNodes}
              onDelete={() => {
                if (contextMenu.edgeId) removeEdge(contextMenu.edgeId);
                else removeSelectedNodes();
              }}
              onFit={() => { void flow.fitView({ padding: 0.18, duration: 280 }); setContextMenu(null); }}
              onClose={() => setContextMenu(null)}
            />
          ) : null}
          <CanvasBottomDock
            variant={presentation}
            canUndo={historyState.undo > 0}
            canRedo={historyState.redo > 0}
            onDeselect={() => {
              setTouchMultiSelect(false);
              setNodes((current) => current.map((node) => ({ ...node, selected: false })));
              setEdges((current) => current.map((edge) => ({ ...edge, selected: false })));
            }}
            onAddPrompt={addPromptNode}
            onAddImage={() => addGeneratorNode("image")}
            onAddVideo={() => addGeneratorNode("video")}
            onAddAudio={isInternalCanvas ? () => audioInputRef.current?.click() : undefined}
            onOpenLibrary={() => setLibraryOpen(true)}
            onUndo={undoCanvas}
            onRedo={redoCanvas}
            onImport={triggerImport}
            onExport={exportCanvas}
            onLayers={() => {
              setLayersOpen((value) => !value);
              setInfoOpen(false);
              setAssistantOpen(false);
              setShortcutsOpen(false);
              setSettingsOpen(false);
            }}
            touchMultiSelect={touchMultiSelect}
            onTouchMultiSelect={() => setTouchMultiSelect((value) => !value)}
            onDelete={removeSelectedNodes}
            onClean={cleanCanvas}
            onOrganize={() => organizeCanvas("flow")}
            onSettings={() => {
              setSettingsOpen((value) => !value);
              setLayersOpen(false);
              setInfoOpen(false);
              setAssistantOpen(false);
              setShortcutsOpen(false);
            }}
            onZoomOut={() => { void flow.zoomOut(); }}
            onZoomIn={() => { void flow.zoomIn(); }}
            onFit={() => { void flow.fitView({ duration: 260, padding: 0.18 }); }}
            onShortcuts={toggleShortcuts}
          />
          {presentation === "classic" && selectionHintOpen && !shortcutsOpen ? <CanvasSelectionHint onOpen={openShortcuts} onDismiss={dismissSelectionHint} /> : null}
          {layersOpen ? (
            <CanvasLayersPanel
              nodes={nodes}
              onClose={() => setLayersOpen(false)}
              onSelect={(id) => {
                const node = nodesRef.current.find((item) => item.id === id);
                if (!node || node.hidden) return;
                setNodes((current) => current.map((item) => ({ ...item, selected: item.id === id })));
                setEdges((current) => current.map((edge) => ({ ...edge, selected: false })));
                setInfoOpen(false);
                void flow.setCenter(
                  node.position.x + (node.width || 340) / 2,
                  node.position.y + (node.height || 280) / 2,
                  { duration: 240, zoom: Math.max(flow.getZoom(), 0.7) },
                );
              }}
              onVisibility={(id, hidden) => updateNodeLayerState(id, { hidden })}
              onLock={(id, locked) => updateNodeLayerState(id, { locked })}
              onMove={moveNodeLayer}
            />
          ) : null}
          {infoOpen && selectedNode ? (
            <CanvasNodeInfoPanel
              key={selectedNode.id}
              node={selectedNode}
              sourceNodes={nodes.filter((node) => edges.some((edge) => edge.target === selectedNode.id && edge.source === node.id) || selectedNode.data.sourceNodeIds?.includes(node.id))}
              targetNodes={nodes.filter((node) => edges.some((edge) => edge.source === selectedNode.id && edge.target === node.id))}
              parentNode={nodes.find((node) => node.id === selectedNode.parentId)}
              childNodes={nodes.filter((node) => node.parentId === selectedNode.id)}
              libraryItem={library.find((item) => item.id === selectedNode.data.libraryItemId)}
              onClose={() => setInfoOpen(false)}
              onFocusText={focusSelectedText}
              onDownload={() => downloadCanvasMedia(selectedNode)}
              onCopyLink={() => copyCanvasMediaLink(selectedNode)}
              onOpenSource={() => openCanvasMedia(selectedNode)}
              onTrim={() => selectedNode.data.kind === "media" && selectedNode.data.mediaType === "video" && selectedNode.data.libraryItemId && setTrimmingLibraryItemId(selectedNode.data.libraryItemId)}
              onCreateImage={() => createGeneratorFromSelected(selectedNode, "image")}
              onCreateVideo={() => createGeneratorFromSelected(selectedNode, "video")}
              onGenerate={generateSelected}
              onSaveMetadata={(nextTitle, notes) => updateNodeData(selectedNode.id, { title: nextTitle, notes: notes || undefined })}
            />
          ) : null}
          {assistantOpen && isInternalCanvas ? (
            <CanvasAssistantPanel
              canvasTitle={title}
              scope={canvasScope()}
              nodes={assistantNodeContexts}
              mentionSelection={assistantMentionSelection}
              onMentionModeChange={handleAssistantMentionModeChange}
              onApply={applyAssistantActions}
              onClose={() => {
                setAssistantOpen(false);
                setAssistantMentionMode(false);
                setAssistantMentionSelection(null);
              }}
            />
          ) : null}
          {shortcutsOpen ? <CanvasShortcutsPanel onClose={() => setShortcutsOpen(false)} /> : null}
          {settingsOpen ? (
            <CanvasSettingsPanel
              theme={canvasTheme}
              connectionStyle={connectionStyle}
              snapEnabled={snapEnabled}
              onTheme={setCanvasTheme}
              onConnectionStyle={changeConnectionStyle}
              onSnapEnabled={setSnapEnabled}
              onOrganize={organizeCanvas}
              onClean={cleanCanvas}
              onExportImage={exportCanvasImage}
              onClose={() => setSettingsOpen(false)}
            />
          ) : null}
          {commandOpen ? <CanvasCommandPalette commands={commandItems} onClose={closeCommandPalette} /> : null}
        </section>
      </div>

      {isTeamOwner && teamOpen ? <TeamPanel onClose={() => setTeamOpen(false)} allowCreateMembers={!isInternalCanvas} /> : null}

      {editingNode?.data.mediaUrl ? (
        <CanvasImageEditor
          key={editingNode.id}
          imageUrl={editingNode.data.libraryItemId ? canvasLibraryMediaUrl(editingNode.data.libraryItemId) : editingNode.data.mediaUrl}
          title={editingNode.data.title}
          onSubmit={submitEditedImage}
          onClose={() => setEditingNodeId("")}
        />
      ) : null}

      {previewingNode?.data.mediaUrl ? (
        <CanvasMediaViewer imageUrl={previewingNode.data.mediaUrl} title={previewingNode.data.title} onClose={() => setPreviewingNodeId("")} />
      ) : null}

      {trimmingLibraryItem ? (
        <CanvasVideoTrimmer
          item={trimmingLibraryItem}
          videoUrl={canvasLibraryMediaUrl(trimmingLibraryItem.id)}
          scope={canvasScope()}
          onComplete={completeVideoTrim}
          onClose={() => setTrimmingLibraryItemId("")}
        />
      ) : null}

      {tiktokLibraryItem ? (
        <CanvasTikTokPublisher
          item={tiktokLibraryItem}
          scope={canvasScope()}
          initialCopy={tiktokCopyDrafts[`${canvasScope()}:${tiktokLibraryItem.id}`]}
          onCopyChange={rememberTikTokCopy}
          onDownload={() => downloadLibraryItem(tiktokLibraryItem)}
          onClose={() => setTikTokLibraryItemId("")}
        />
      ) : null}

      {notice ? (
        <div className="canvas-notice" role="status" aria-live="polite">
          <span>{notice}</span>
          <button type="button" aria-label="关闭提示" title="关闭提示" onClick={() => setNotice("")}><X /></button>
        </div>
      ) : null}
    </main>
  );
}

function CanvasToolbar({
  accountName,
  projects,
  activeProjectId,
  scope,
  title,
  saveState,
  syncState,
  libraryOpen,
  layersOpen,
  canUndo,
  canRedo,
  onTitleChange,
  onProjectChange,
  onScopeChange,
  onCreateProject,
  onDeleteProject,
  onSave,
  onToggleLibrary,
  onToggleLayers,
  onAddPrompt,
  onAddImage,
  onAddVideo,
  onAddAudio,
  onUndo,
  onRedo,
  onImport,
  onExport,
  settingsOpen,
  onSettings,
  isTeamOwner,
  teamOpen,
  onToggleTeam,
  assistantOpen,
  shortcutsOpen,
  onAssistant,
  onShortcuts,
}: {
  accountName: string;
  projects: CanvasProject[];
  activeProjectId: string;
  scope?: "personal" | "shared";
  title: string;
  saveState: SaveState;
  syncState?: "live" | "syncing" | "paused";
  libraryOpen: boolean;
  layersOpen: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onTitleChange: (value: string) => void;
  onProjectChange: (id: string) => void;
  onScopeChange: (scope: "personal" | "shared") => void;
  onCreateProject: () => void;
  onDeleteProject: () => void;
  onSave: () => void;
  onToggleLibrary: () => void;
  onToggleLayers: () => void;
  onAddPrompt: () => void;
  onAddImage: () => void;
  onAddVideo: () => void;
  onAddAudio?: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onImport: () => void;
  onExport: () => void;
  settingsOpen: boolean;
  onSettings: () => void;
  isTeamOwner: boolean;
  teamOpen: boolean;
  onToggleTeam: () => void;
  assistantOpen: boolean;
  shortcutsOpen: boolean;
  onAssistant: () => void;
  onShortcuts: () => void;
}) {
  return (
    <header className="canvas-toolbar">
      <div className="canvas-toolbar__brand">
        <Link href="/" className="canvas-icon-button" aria-label="返回奥皇 AI" title="返回奥皇 AI"><ArrowLeft /></Link>
        <BrandLogo />
        <span><strong>奥皇 AI</strong><small>创作画布</small></span>
      </div>
      <div className="canvas-toolbar__projects">
        {scope ? (
          <div className="canvas-scope-switch" role="tablist" aria-label="画布空间">
            <button type="button" role="tab" aria-selected={scope === "personal"} className={scope === "personal" ? "is-active" : undefined} onClick={() => onScopeChange("personal")}>个人</button>
            <button type="button" role="tab" aria-selected={scope === "shared"} className={scope === "shared" ? "is-active" : undefined} onClick={() => onScopeChange("shared")}>团队</button>
          </div>
        ) : null}
        {scope !== "shared" ? <select value={activeProjectId} aria-label="选择画布" onChange={(event) => onProjectChange(event.target.value)}>
          {projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}
        </select> : null}
        <input value={title} maxLength={120} aria-label="画布名称" onChange={(event) => onTitleChange(event.target.value)} />
        {scope !== "shared" ? <button type="button" className="canvas-icon-button" aria-label="新建画布" title="新建画布" onClick={onCreateProject}><Plus /></button> : null}
        {scope !== "shared" ? <button type="button" className="canvas-icon-button" aria-label="删除画布" title="删除画布" onClick={onDeleteProject}><Trash2 /></button> : null}
      </div>
      <div className="canvas-toolbar__tools" aria-label="画布工具">
        <button
          type="button"
          className={cn("canvas-tool-button", libraryOpen && "is-active")}
          aria-label={libraryOpen ? "关闭素材库" : "打开素材库"}
          title={libraryOpen ? "关闭素材库" : "打开素材库"}
          onClick={onToggleLibrary}
        >
          {libraryOpen ? <PanelLeftClose /> : <PanelLeftOpen />}<span>素材</span>
        </button>
        <button type="button" className={cn("canvas-tool-button", layersOpen && "is-active")} aria-label={layersOpen ? "关闭图层" : "打开图层"} title={layersOpen ? "关闭图层" : "打开图层"} onClick={onToggleLayers}><Layers3 /><span>图层</span></button>
        <button type="button" className="canvas-tool-button" aria-label="添加提示词节点" title="添加提示词节点" onClick={onAddPrompt}><Type /><span>提示词</span></button>
        <button type="button" className="canvas-tool-button" aria-label="添加图片生成节点" title="添加图片生成节点" onClick={onAddImage}><Sparkles /><span>生图</span></button>
        <button type="button" className="canvas-tool-button" aria-label="添加视频生成节点" title="添加视频生成节点" onClick={onAddVideo}><Film /><span>生视频</span></button>
        {onAddAudio ? <button type="button" className="canvas-tool-button" aria-label="添加音频参考" title="添加音频参考" onClick={onAddAudio}><Music /><span>音频</span></button> : null}
        <button type="button" className="canvas-icon-button" aria-label="撤销" title="撤销" disabled={!canUndo} onClick={onUndo}><Undo2 /></button>
        <button type="button" className="canvas-icon-button" aria-label="重做" title="重做" disabled={!canRedo} onClick={onRedo}><Redo2 /></button>
        <button type="button" className="canvas-icon-button" aria-label="导入画布" title="导入画布" onClick={onImport}><Upload /></button>
        <button type="button" className="canvas-icon-button" aria-label="导出画布" title="导出画布" onClick={onExport}><Download /></button>
        <button type="button" className={cn("canvas-icon-button", settingsOpen && "is-active")} aria-label="画布设置" title="画布设置" onClick={onSettings}><Settings2 /></button>
      </div>
      <div className="canvas-toolbar__account">
        {isTeamOwner ? <button type="button" className={cn("canvas-tool-button", teamOpen && "is-active")} aria-label="团队用量" title="团队用量" onClick={onToggleTeam}><UsersRound /><span>团队</span></button> : null}
        {syncState ? <span className={cn("canvas-sync-state", `is-${syncState}`)}>{syncState === "live" ? "实时同步" : syncState === "syncing" ? "同步中" : "等待同步"}</span> : null}
        <span className={cn("canvas-save-state", `is-${saveState}`)}>{saveStateLabel(saveState)}</span>
        <span className="canvas-toolbar__version">v0.0.1</span>
        <button type="button" className={cn("canvas-tool-button", assistantOpen && "is-active")} aria-label="智能助手" title="智能助手" onClick={onAssistant}><Bot /><span>助手</span></button>
        <button type="button" className={cn("canvas-tool-button", shortcutsOpen && "is-active")} aria-label="操作与快捷键" title="操作与快捷键 (?)" onClick={onShortcuts}><Keyboard /><span>快捷键</span></button>
        <button type="button" className="canvas-icon-button" aria-label="保存画布" title="保存画布" disabled={saveState === "saving"} onClick={onSave}>
          {saveState === "saving" ? <LoaderCircle className="is-spinning" /> : <Save />}
        </button>
        <strong title={accountName}>{accountName}</strong>
      </div>
    </header>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function CanvasSelectionToolbar({
  node,
  style,
  onInfo,
  onUngroup,
  onToggleGroup,
  onDelete,
  onEdit,
  onGenerate,
  onZoomOut,
  onZoomIn,
}: {
  node: CanvasFlowNode;
  style?: CSSProperties;
  onInfo: () => void;
  onUngroup: () => void;
  onToggleGroup: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onGenerate: () => void;
  onZoomOut: () => void;
  onZoomIn: () => void;
}) {
  const isPrompt = node.data.kind === "prompt";
  const isImage = node.data.kind === "media" && node.data.mediaType === "image";
  const isMedia = node.data.kind === "media";
  const isGenerator = node.data.kind === "generator";
  return (
    <div className="canvas-selection-toolbar" style={style} role="toolbar" aria-label="选中节点工具">
      <button type="button" onClick={onInfo} title="节点信息" aria-label="节点信息"><Info /><span>信息</span></button>
      {node.data.kind === "group" ? <button type="button" onClick={onToggleGroup} title={node.data.collapsed ? "展开分组" : "折叠分组"} aria-label={node.data.collapsed ? "展开选中分组" : "折叠选中分组"}><Layers3 /><span>{node.data.collapsed ? "展开" : "折叠"}</span></button> : null}
      {node.data.kind === "group" ? <button type="button" onClick={onUngroup} title="解除分组" aria-label="解除分组"><Ungroup /><span>解组</span></button> : null}
      <button type="button" onClick={onDelete} title="删除节点" aria-label="删除节点"><Trash2 /><span>删除</span></button>
      {isImage ? <button type="button" onClick={onEdit} title="裁剪、擦除或局部重绘" aria-label="图片编辑"><Sparkles /><span>图片编辑</span></button> : null}
      {isPrompt || isMedia ? <button type="button" onClick={onGenerate} title={isImage || isPrompt ? "引用当前节点生成图片" : "引用当前素材生成视频"} aria-label={isImage || isPrompt ? "生成图片" : "生成视频"}><ImageIcon /><span>{isImage || isPrompt ? "生图" : "生视频"}</span></button> : null}
      {isGenerator ? <button type="button" onClick={onGenerate} title="运行当前生成节点" aria-label="运行生成"><Sparkles /><span>运行</span></button> : null}
      <span className="canvas-selection-toolbar__divider" aria-hidden="true" />
      <button type="button" onClick={onZoomOut} title="缩小画布" aria-label="缩小画布"><ZoomOut /></button>
      <button type="button" onClick={onZoomIn} title="放大画布" aria-label="放大画布"><ZoomIn /></button>
    </div>
  );
}

function CanvasBatchToolbar({ count, trimCount, trimming, style, onConnect, onArrange, onTrim, onGroup, onDuplicate, onDelete }: {
  count: number;
  trimCount: number;
  trimming: boolean;
  style?: CSSProperties;
  onConnect: () => void;
  onArrange: (mode: CanvasBatchArrangeMode) => void;
  onTrim: () => void;
  onGroup: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="canvas-selection-toolbar canvas-selection-toolbar--batch" style={style} role="toolbar" aria-label="批量节点工具">
      <strong>{count} 个节点</strong>
      <button type="button" onClick={onConnect} title="按位置连接" aria-label="按位置连接"><Link2 /><span>连接</span></button>
      <details className="canvas-batch-menu">
        <summary role="button" aria-haspopup="menu" title="批量排列" aria-label="批量排列"><AlignCenterVertical /><span>排列</span></summary>
        <div className="canvas-batch-menu__popover" role="menu" aria-label="批量排列选项">
          <span className="canvas-batch-menu__label">对齐</span>
          <button type="button" role="menuitem" onClick={(event) => chooseBatchArrange(event, onArrange, "left")}><AlignStartVertical />左对齐</button>
          <button type="button" role="menuitem" onClick={(event) => chooseBatchArrange(event, onArrange, "horizontal-center")}><AlignCenterVertical />水平居中</button>
          <button type="button" role="menuitem" onClick={(event) => chooseBatchArrange(event, onArrange, "right")}><AlignEndVertical />右对齐</button>
          <button type="button" role="menuitem" onClick={(event) => chooseBatchArrange(event, onArrange, "top")}><AlignStartHorizontal />顶部对齐</button>
          <button type="button" role="menuitem" onClick={(event) => chooseBatchArrange(event, onArrange, "vertical-center")}><AlignCenterHorizontal />垂直居中</button>
          <button type="button" role="menuitem" onClick={(event) => chooseBatchArrange(event, onArrange, "bottom")}><AlignEndHorizontal />底部对齐</button>
          <span className="canvas-batch-menu__label">分布</span>
          <button type="button" role="menuitem" onClick={(event) => chooseBatchArrange(event, onArrange, "distribute-horizontal")}><AlignHorizontalSpaceBetween />水平分布</button>
          <button type="button" role="menuitem" onClick={(event) => chooseBatchArrange(event, onArrange, "distribute-vertical")}><AlignVerticalSpaceBetween />垂直分布</button>
        </div>
      </details>
      {trimCount ? <button type="button" disabled={trimming} onClick={onTrim} title="将选中的长视频依次裁剪为开头 14.9 秒" aria-label="批量裁剪视频"><Scissors />{trimming ? <span>裁剪中</span> : <span>裁剪 {trimCount}</span>}</button> : null}
      <button type="button" onClick={onGroup} title="建立节点分组" aria-label="建立节点分组"><Layers3 /><span>分组</span></button>
      <button type="button" onClick={onDuplicate} title="批量复制" aria-label="批量复制"><CopyPlus /><span>复制</span></button>
      <button type="button" onClick={onDelete} title="批量删除" aria-label="批量删除"><Trash2 /><span>删除</span></button>
    </div>
  );
}

function chooseBatchArrange(event: ReactMouseEvent<HTMLButtonElement>, onArrange: (mode: CanvasBatchArrangeMode) => void, mode: CanvasBatchArrangeMode) {
  onArrange(mode);
  event.currentTarget.closest("details")?.removeAttribute("open");
}

function CanvasContextMenu({
  state,
  canPaste,
  canAddImage,
  isGroup,
  onAddPrompt,
  onAddImage,
  onAddVideo,
  onAddAudio,
  onCopy,
  onPaste,
  onSelectAll,
  onInfo,
  onUngroup,
  onDelete,
  onFit,
  onClose,
}: {
  state: CanvasContextMenuState;
  canPaste: boolean;
  canAddImage: boolean;
  isGroup: boolean;
  onAddPrompt: () => void;
  onAddImage: () => void;
  onAddVideo: () => void;
  onAddAudio?: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onSelectAll: () => void;
  onInfo: () => void;
  onUngroup: () => void;
  onDelete: () => void;
  onFit: () => void;
  onClose: () => void;
}) {
  return (
    <div className={cn("canvas-context-menu", state.kind === "connection" && "is-connection-create")} style={{ left: state.left, top: state.top }} role="menu" aria-label={state.kind === "connection" ? "选择连接目标" : "画布快捷菜单"} onPointerDown={(event) => event.stopPropagation()}>
      {state.kind === "connection" ? (
        <>
          <div className="canvas-context-menu__heading"><span>引用该节点生成</span><button type="button" onClick={onClose} aria-label="关闭选择菜单" title="关闭"><X /></button></div>
          <button type="button" role="menuitem" className="canvas-context-menu__create-option" onClick={onAddImage} disabled={!canAddImage} title={canAddImage ? "创建图片生成节点" : "视频和音频素材不能连接图片生成节点"}><span><ImageIcon /></span><span><b>图片生成</b><small>使用提示词或参考图生成</small></span></button>
          <button type="button" role="menuitem" className="canvas-context-menu__create-option" onClick={onAddVideo}><span><Film /></span><span><b>视频生成</b><small>支持提示词、图片、视频和音频</small></span></button>
        </>
      ) : null}
      {state.kind === "pane" ? (
        <>
          <button type="button" role="menuitem" onClick={onAddPrompt}><Type /><span>添加提示词</span></button>
          <button type="button" role="menuitem" onClick={onAddImage}><ImageIcon /><span>添加生图节点</span></button>
          <button type="button" role="menuitem" onClick={onAddVideo}><Film /><span>添加视频节点</span></button>
          {onAddAudio ? <button type="button" role="menuitem" onClick={onAddAudio}><Music /><span>添加音频参考</span></button> : null}
          <button type="button" role="menuitem" onClick={onPaste} disabled={!canPaste}><CopyPlus /><span>粘贴节点</span><kbd>Ctrl V</kbd></button>
          <button type="button" role="menuitem" onClick={onSelectAll}><MousePointer2 /><span>全选节点</span><kbd>Ctrl A</kbd></button>
          <button type="button" role="menuitem" onClick={onFit}><Maximize2 /><span>查看全部</span></button>
        </>
      ) : null}
      {state.kind === "node" ? (
        <>
          <button type="button" role="menuitem" onClick={onInfo}><Info /><span>节点信息</span></button>
          {isGroup ? <button type="button" role="menuitem" onClick={onUngroup}><Ungroup /><span>解除分组</span></button> : null}
          <button type="button" role="menuitem" onClick={onCopy}><Copy /><span>复制节点</span><kbd>Ctrl C</kbd></button>
          <button type="button" role="menuitem" onClick={onDelete} className="is-danger"><Trash2 /><span>删除节点</span></button>
        </>
      ) : null}
      {state.kind === "edge" ? (
        <button type="button" role="menuitem" onClick={onDelete} className="is-danger"><Trash2 /><span>删除连线</span></button>
      ) : null}
    </div>
  );
}

function CanvasSettingsPanel({
  theme,
  connectionStyle,
  snapEnabled,
  onTheme,
  onConnectionStyle,
  onSnapEnabled,
  onOrganize,
  onClean,
  onExportImage,
  onClose,
}: {
  theme: CanvasTheme;
  connectionStyle: ConnectionStyle;
  snapEnabled: boolean;
  onTheme: (value: CanvasTheme) => void;
  onConnectionStyle: (value: ConnectionStyle) => void;
  onSnapEnabled: (value: boolean) => void;
  onOrganize: (layout: "flow" | "grid") => void;
  onClean: () => void;
  onExportImage: () => void;
  onClose: () => void;
}) {
  return (
    <aside className="canvas-settings" aria-label="画布设置">
      <header><div><Settings2 /><strong>画布设置</strong></div><button type="button" className="canvas-icon-button" onClick={onClose} title="关闭画布设置" aria-label="关闭画布设置"><X /></button></header>
      <section><strong><Palette />主题</strong><div className="canvas-settings__swatches">
        {(["midnight", "light"] as const).map((value) => <button key={value} type="button" className={cn(`is-${value}`, theme === value && "is-active")} onClick={() => onTheme(value)} aria-label={value === "midnight" ? "深色主题" : "亮色主题"} title={value === "midnight" ? "深色" : "亮色"} />)}
      </div></section>
      <section><strong>连接线</strong><div className="canvas-settings__segments"><button type="button" className={connectionStyle === "bezier" ? "is-active" : undefined} onClick={() => onConnectionStyle("bezier")}>弧线</button><button type="button" className={connectionStyle === "smoothstep" ? "is-active" : undefined} onClick={() => onConnectionStyle("smoothstep")}>折线</button><button type="button" className={connectionStyle === "straight" ? "is-active" : undefined} onClick={() => onConnectionStyle("straight")}>直线</button></div></section>
      <label className="canvas-settings__toggle"><input type="checkbox" checked={snapEnabled} onChange={(event) => onSnapEnabled(event.target.checked)} /><span>节点对齐网格</span></label>
      <section><strong>排列</strong><div className="canvas-settings__commands"><button type="button" onClick={() => onOrganize("flow")}>流程排列</button><button type="button" onClick={() => onOrganize("grid")}>网格排列</button></div></section>
      <div className="canvas-settings__commands"><button type="button" onClick={onExportImage}><Download />导出图片</button><button type="button" className="is-danger" onClick={onClean}><Eraser />清理节点</button></div>
    </aside>
  );
}

function CanvasBottomDock({
  variant,
  canUndo,
  canRedo,
  onDeselect,
  onAddPrompt,
  onAddImage,
  onAddVideo,
  onAddAudio,
  onOpenLibrary,
  onUndo,
  onRedo,
  onImport,
  onExport,
  onLayers,
  touchMultiSelect,
  onTouchMultiSelect,
  onClean,
  onOrganize,
  onSettings,
  onDelete,
  onZoomOut,
  onZoomIn,
  onFit,
  onShortcuts,
}: {
  variant: CanvasPresentation;
  canUndo: boolean;
  canRedo: boolean;
  onDeselect: () => void;
  onAddPrompt: () => void;
  onAddImage: () => void;
  onAddVideo: () => void;
  onAddAudio?: () => void;
  onOpenLibrary: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onImport: () => void;
  onExport: () => void;
  onLayers: () => void;
  touchMultiSelect: boolean;
  onTouchMultiSelect: () => void;
  onClean: () => void;
  onOrganize: () => void;
  onSettings: () => void;
  onDelete: () => void;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onFit: () => void;
  onShortcuts: () => void;
}) {
  if (variant === "vozeb") {
    return (
      <nav className="canvas-bottom-dock is-vozeb" aria-label="画布工具">
        <button type="button" onClick={onDeselect} title="移动/选择" aria-label="移动或清除选择"><MousePointer2 /></button>
        <span className="canvas-bottom-dock__divider" aria-hidden="true" />
        <button type="button" disabled={!canUndo} onClick={onUndo} title="撤销" aria-label="撤销"><Undo2 /></button>
        <button type="button" disabled={!canRedo} onClick={onRedo} title="重做" aria-label="重做"><Redo2 /></button>
        <span className="canvas-bottom-dock__divider" aria-hidden="true" />
        <button type="button" onClick={onAddPrompt} title="添加提示词" aria-label="添加提示词"><Type /></button>
        <button type="button" onClick={onAddImage} title="添加生图节点" aria-label="添加生图节点"><ImageIcon /></button>
        <button type="button" onClick={onAddVideo} title="添加生视频节点" aria-label="添加生视频节点"><Film /></button>
        {onAddAudio ? <button type="button" onClick={onAddAudio} title="添加音频参考" aria-label="添加音频参考"><Music /></button> : null}
        <button type="button" onClick={onSettings} title="生成与画布设置" aria-label="生成与画布设置"><Settings2 /></button>
        <button type="button" onClick={onOpenLibrary} title="素材库" aria-label="打开素材库"><FolderOpen /></button>
        <button type="button" onClick={onLayers} title="图层" aria-label="打开图层"><Layers3 /></button>
        <button type="button" onClick={onOrganize} title="一键整理画布" aria-label="一键整理画布"><LayoutDashboard /></button>
        <button type="button" onClick={onImport} title="导入画布" aria-label="导入画布"><Upload /></button>
        <button type="button" onClick={onExport} title="导出画布" aria-label="导出画布"><Download /></button>
        <button type="button" className={cn("canvas-touch-only", touchMultiSelect && "is-active")} aria-pressed={touchMultiSelect} onClick={onTouchMultiSelect} title="触控多选" aria-label="触控多选"><ListChecks /></button>
        <button type="button" onClick={onFit} title="查看全部节点" aria-label="查看全部节点"><Maximize2 /></button>
        <button type="button" onClick={onClean} title="清理画布" aria-label="清理画布"><Eraser /></button>
        <button type="button" className="is-danger" onClick={onDelete} title="删除选中节点" aria-label="删除选中节点"><Trash2 /></button>
        <button type="button" onClick={onShortcuts} title="操作与快捷键" aria-label="操作与快捷键"><CircleHelp /></button>
      </nav>
    );
  }

  return (
    <nav className="canvas-bottom-dock" aria-label="画布工具">
      <button type="button" onClick={onAddPrompt} title="添加提示词" aria-label="添加提示词"><Type /></button>
      <button type="button" onClick={onAddImage} title="添加生图节点" aria-label="添加生图节点"><ImageIcon /></button>
      <button type="button" onClick={onAddVideo} title="添加生视频节点" aria-label="添加生视频节点"><Film /></button>
      {onAddAudio ? <button type="button" onClick={onAddAudio} title="添加音频参考" aria-label="添加音频参考"><Music /></button> : null}
      <button type="button" onClick={onOpenLibrary} title="打开素材库" aria-label="打开素材库"><Upload /></button>
      <button type="button" onClick={onUndo} title="撤销" aria-label="撤销"><Undo2 /></button>
      <button type="button" onClick={onRedo} title="重做" aria-label="重做"><Redo2 /></button>
      <button type="button" onClick={onImport} title="导入画布" aria-label="导入画布"><Upload /></button>
      <button type="button" onClick={onExport} title="导出画布" aria-label="导出画布"><Download /></button>
      <button type="button" onClick={onLayers} title="打开图层" aria-label="打开图层"><Layers3 /></button>
      <button type="button" onClick={onOrganize} title="一键整理画布" aria-label="一键整理画布"><LayoutDashboard /></button>
      <button type="button" className={cn("canvas-touch-only", touchMultiSelect && "is-active")} aria-pressed={touchMultiSelect} onClick={onTouchMultiSelect} title="触控多选" aria-label="触控多选"><ListChecks /></button>
      <button type="button" onClick={onSettings} title="画布设置" aria-label="画布设置"><Settings2 /></button>
      <button type="button" onClick={onFit} title="查看全部节点" aria-label="查看全部节点"><Maximize2 /></button>
      <button type="button" onClick={onClean} title="清理节点" aria-label="清理节点"><Eraser /></button>
      <span className="canvas-bottom-dock__divider" aria-hidden="true" />
      <button type="button" onClick={onZoomOut} title="缩小" aria-label="缩小"><ZoomOut /></button>
      <button type="button" onClick={onZoomIn} title="放大" aria-label="放大"><ZoomIn /></button>
      <button type="button" className="is-danger" onClick={onDelete} title="删除选中节点" aria-label="删除选中节点"><Trash2 /></button>
      <button type="button" onClick={onShortcuts} title="操作与快捷键" aria-label="操作与快捷键"><CircleHelp /></button>
    </nav>
  );
}

function CanvasLayersPanel({
  nodes,
  onClose,
  onSelect,
  onVisibility,
  onLock,
  onMove,
}: {
  nodes: CanvasFlowNode[];
  onClose: () => void;
  onSelect: (id: string) => void;
  onVisibility: (id: string, hidden: boolean) => void;
  onLock: (id: string, locked: boolean) => void;
  onMove: (id: string, direction: "front" | "back") => void;
}) {
  const byLayer = (left: CanvasFlowNode, right: CanvasFlowNode) => (Number(right.data.zIndex) || 0) - (Number(left.data.zIndex) || 0);
  const topLevel = nodes.filter((node) => !node.parentId).sort(byLayer);
  const childIds = new Set<string>();
  const orderedNodes = topLevel.flatMap((node) => {
    const children = nodes.filter((child) => child.parentId === node.id).sort(byLayer);
    children.forEach((child) => childIds.add(child.id));
    return [node, ...children];
  });
  nodes.filter((node) => node.parentId && !childIds.has(node.id)).sort(byLayer).forEach((node) => orderedNodes.push(node));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  return (
    <aside className="canvas-layers" aria-label="画布图层">
      <header className="canvas-layers__header">
        <div><Layers3 /><span><strong>图层</strong><small>{nodes.length} 个节点</small></span></div>
        <button type="button" className="canvas-icon-button" aria-label="关闭图层" title="关闭图层" onClick={onClose}><X /></button>
      </header>
      <div className="canvas-layers__list">
        {orderedNodes.length ? orderedNodes.map((node) => {
          const inheritedHidden = Boolean(node.parentId && nodeById.get(node.parentId)?.hidden);
          const visible = !node.hidden;
          const kindLabel = node.data.kind === "prompt" ? "提示词" : node.data.kind === "media" ? (node.data.mediaType === "video" ? "视频" : node.data.mediaType === "audio" ? "音频" : "图片") : node.data.kind === "generator" ? (node.data.generationKind === "video" ? "视频生成" : "图片生成") : "分组";
          return (
            <div key={node.id} className={cn("canvas-layers__row", node.parentId && "is-child", node.selected && "is-selected", !visible && "is-hidden")}>
              <button type="button" className="canvas-layers__name" disabled={!visible} aria-label={`定位到${node.data.title}`} title={visible ? `定位到${node.data.title}` : "节点已隐藏，请先恢复显示"} onClick={() => onSelect(node.id)}>
                {node.data.kind === "group" ? <Layers3 /> : node.data.kind === "prompt" ? <Type /> : node.data.kind === "media" ? (node.data.mediaType === "video" ? <Film /> : node.data.mediaType === "audio" ? <Music /> : <ImageIcon />) : <Sparkles />}
                <span><strong>{node.data.title}</strong><small>{kindLabel}</small></span>
              </button>
              <div className="canvas-layers__actions">
                <button type="button" disabled={inheritedHidden} aria-label={node.data.hidden ? `显示${node.data.title}` : `隐藏${node.data.title}`} title={inheritedHidden ? "由上级分组隐藏" : node.data.hidden ? "显示节点" : "隐藏节点"} onClick={() => onVisibility(node.id, !node.data.hidden)}>{visible ? <Eye /> : <EyeOff />}</button>
                <button type="button" aria-label={node.data.locked ? `解锁${node.data.title}` : `锁定${node.data.title}`} title={node.data.locked ? "解锁节点" : "锁定节点"} onClick={() => onLock(node.id, !node.data.locked)}>{node.data.locked ? <Lock /> : <Unlock />}</button>
                <button type="button" aria-label={`上移${node.data.title}`} title="移到顶层" onClick={() => onMove(node.id, "front")}><ArrowUp /></button>
                <button type="button" aria-label={`下移${node.data.title}`} title="移到底层" onClick={() => onMove(node.id, "back")}><ArrowDown /></button>
              </div>
            </div>
          );
        }) : <p className="canvas-layers__empty">画布中暂无节点</p>}
      </div>
    </aside>
  );
}

function CanvasNodeInfoPanel({
  node,
  sourceNodes,
  targetNodes,
  parentNode,
  childNodes,
  libraryItem,
  onClose,
  onFocusText,
  onDownload,
  onCopyLink,
  onOpenSource,
  onTrim,
  onCreateImage,
  onCreateVideo,
  onGenerate,
  onSaveMetadata,
}: {
  node: CanvasFlowNode;
  sourceNodes: CanvasFlowNode[];
  targetNodes: CanvasFlowNode[];
  parentNode?: CanvasFlowNode;
  childNodes: CanvasFlowNode[];
  libraryItem?: LibraryItem;
  onClose: () => void;
  onFocusText: () => void;
  onDownload: () => void;
  onCopyLink: () => void;
  onOpenSource: () => void;
  onTrim: () => void;
  onCreateImage: () => void;
  onCreateVideo: () => void;
  onGenerate: () => void;
  onSaveMetadata: (title: string, notes: string) => void;
}) {
  const data = node.data;
  const isPrompt = data.kind === "prompt";
  const isMedia = data.kind === "media";
  const isGenerator = data.kind === "generator";
  const [draftTitle, setDraftTitle] = useState(data.title);
  const [draftNotes, setDraftNotes] = useState(data.notes || "");
  const normalizedTitle = draftTitle.trim().slice(0, 120);
  const normalizedNotes = draftNotes.trim().slice(0, 2_000);
  const metadataChanged = normalizedTitle !== data.title || normalizedNotes !== (data.notes || "");
  return (
    <aside className="canvas-node-info" aria-label="节点信息">
      <header className="canvas-node-info__header">
        <div>
          <Info />
          <strong>{data.title}</strong>
          <small>{isPrompt ? "提示词" : isMedia ? "素材" : isGenerator ? "生成节点" : "节点分组"}</small>
        </div>
        <button type="button" className="canvas-icon-button" aria-label="关闭节点信息" title="关闭节点信息" onClick={onClose}><X /></button>
      </header>
      <div className="canvas-node-info__body">
        <form className="canvas-node-info__metadata" onSubmit={(event) => {
          event.preventDefault();
          if (!normalizedTitle) return;
          onSaveMetadata(normalizedTitle, normalizedNotes);
          setDraftTitle(normalizedTitle);
          setDraftNotes(normalizedNotes);
        }}>
          <label><span>节点名称</span><input value={draftTitle} maxLength={120} required onChange={(event) => setDraftTitle(event.target.value)} /></label>
          <label><span>备注</span><textarea value={draftNotes} maxLength={2_000} placeholder="记录用途、修改要求或交付说明" onChange={(event) => setDraftNotes(event.target.value)} /></label>
          <button type="submit" disabled={!metadataChanged || !normalizedTitle}><Save />保存信息</button>
        </form>
        <dl className="canvas-node-info__grid">
          <div><dt>节点 ID</dt><dd title={node.id}>{node.id}</dd></div>
          <div><dt>类型</dt><dd>{data.kind}</dd></div>
          <div><dt>状态</dt><dd>{data.status || "idle"}</dd></div>
          <div><dt>位置</dt><dd>{Math.round(node.position.x)}, {Math.round(node.position.y)}</dd></div>
          <div><dt>尺寸</dt><dd>{Math.round(node.measured?.width || node.width || 0)} × {Math.round(node.measured?.height || node.height || 0)}</dd></div>
          <div><dt>来源</dt><dd>{isMedia ? data.mediaType : isGenerator ? data.providerId || "--" : "--"}</dd></div>
          <div><dt>链接</dt><dd>{isMedia ? (data.mediaUrl ? "可用" : "无") : "--"}</dd></div>
          <div><dt>模型</dt><dd>{data.model || libraryItem?.model || "--"}</dd></div>
          <div><dt>创建时间</dt><dd>{data.createdAt || libraryItem?.createdAt ? new Date(data.createdAt || libraryItem!.createdAt).toLocaleString("zh-CN") : "--"}</dd></div>
        </dl>
        {isPrompt ? (
          <div className="canvas-node-info__section">
            <strong>提示词</strong>
            <p>{data.prompt || "暂无内容"}</p>
          </div>
        ) : null}
        {isMedia ? (
          <div className="canvas-node-info__section">
            <strong>素材信息</strong>
            <ul>
              <li>素材 ID: {data.libraryItemId || "--"}</li>
              <li>媒体类型: {data.mediaType || "--"}</li>
              <li>错误: {data.error || "--"}</li>
            </ul>
          </div>
        ) : null}
        {isGenerator ? (
          <div className="canvas-node-info__section">
            <strong>生成参数</strong>
            <ul>
              <li>模式: {data.generationKind}</li>
              <li>数量: {data.count || 1}</li>
              <li>比例: {data.ratio || "--"}</li>
              <li>清晰度: {data.quality || "--"}</li>
              <li>时长: {data.duration || "--"}</li>
              <li>分辨率: {data.resolution || "--"}</li>
              <li>任务 ID: {data.jobId || "--"}</li>
              <li>结果节点: {data.outputNodeId || "--"}</li>
              <li>错误: {data.error || "--"}</li>
            </ul>
          </div>
        ) : null}
        <div className="canvas-node-info__section canvas-node-info__relations">
          <strong>节点关系</strong>
          <div><span>输入来源</span>{sourceNodes.length ? <ul>{sourceNodes.map((source) => <li key={source.id}>{source.data.title} · {source.data.kind}</li>)}</ul> : <p>无输入连接</p>}</div>
          <div><span>输出去向</span>{targetNodes.length ? <ul>{targetNodes.map((target) => <li key={target.id}>{target.data.title} · {target.data.kind}</li>)}</ul> : <p>无输出连接</p>}</div>
          {parentNode ? <div><span>所属分组</span><p>{parentNode.data.title}</p></div> : null}
          {childNodes.length ? <div><span>分组成员</span><ul>{childNodes.map((child) => <li key={child.id}>{child.data.title} · {child.data.kind}</li>)}</ul></div> : null}
        </div>
        <div className="canvas-node-info__actions">
          {isPrompt ? <button type="button" onClick={onFocusText}><Type />编辑文本</button> : null}
          {isMedia ? (
            <>
              <button type="button" disabled={!data.mediaUrl} onClick={onOpenSource}><Link2 />打开原图</button>
              <button type="button" disabled={!data.mediaUrl} onClick={onCopyLink}><Copy />复制链接</button>
              <button type="button" disabled={!data.mediaUrl} onClick={onDownload}><Download />下载</button>
              {data.mediaType === "video" && data.libraryItemId ? <button type="button" onClick={onTrim}><Scissors />裁剪视频</button> : null}
              <button type="button" onClick={onCreateImage}><Sparkles />图生图</button>
              <button type="button" onClick={onCreateVideo}><Film />生视频</button>
            </>
          ) : null}
          {isGenerator ? <button type="button" onClick={onGenerate}><Play />开始生成</button> : null}
        </div>
      </div>
    </aside>
  );
}

type TeamOverviewResponse = {
  members: Array<{
    localUserId: string;
    username: string;
    displayName: string;
    currentCredits: number | null;
    usage: { creditUnits: number; imageTasks: number; videoTasks: number };
  }>;
  totals: { creditUnits: number; imageTasks: number; videoTasks: number };
};

type InternalAccessAccount = {
  localUserId: string;
  email: string;
  username: string;
  displayName: string;
  status: string;
  role: "owner" | "member" | null;
  enabled: boolean;
};

function TeamPanel({ onClose, allowCreateMembers }: { onClose: () => void; allowCreateMembers: boolean }) {
  const [rangeDays, setRangeDays] = useState("30");
  const [data, setData] = useState<TeamOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({ email: "", username: "", displayName: "", password: "" });
  const [creating, setCreating] = useState(false);
  const [accessAccounts, setAccessAccounts] = useState<InternalAccessAccount[]>([]);
  const [accessQuery, setAccessQuery] = useState("");
  const [accessLoading, setAccessLoading] = useState(true);
  const [accessMessage, setAccessMessage] = useState("");
  const [accessBusy, setAccessBusy] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setMessage("");
    const to = new Date();
    const from = new Date(to.getTime() - Number(rangeDays) * 24 * 60 * 60 * 1000);
    try {
      setData(await fetchJson<TeamOverviewResponse>(`/api/account/team?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`));
    } catch (error) {
      setMessage(apiMessage(error, "团队用量加载失败。"));
    } finally {
      setLoading(false);
    }
  }, [rangeDays]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const loadAccess = useCallback(async () => {
    setAccessLoading(true);
    try {
      const result = await fetchJson<{ accounts: InternalAccessAccount[] }>(`/api/account/internal-access?query=${encodeURIComponent(accessQuery)}`);
      setAccessAccounts(result.accounts);
      setAccessMessage("");
    } catch (error) {
      setAccessAccounts([]);
      setAccessMessage(error instanceof ApiError && error.status === 403 ? "当前账号没有 CN 白名单管理权限" : apiMessage(error, "CN 白名单加载失败"));
    } finally {
      setAccessLoading(false);
    }
  }, [accessQuery]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadAccess(); }, 180);
    return () => window.clearTimeout(timer);
  }, [loadAccess]);

  async function toggleAccess(account: InternalAccessAccount) {
    if (account.role === "owner") return;
    setAccessBusy(account.localUserId);
    setAccessMessage("");
    try {
      await fetchJsonWithCsrf("/api/account/internal-access", {
        method: "PATCH",
        body: JSON.stringify({ localUserId: account.localUserId, enabled: !account.enabled }),
      });
      await loadAccess();
    } catch (error) {
      setAccessMessage(apiMessage(error, "CN 白名单更新失败"));
    } finally {
      setAccessBusy("");
    }
  }

  async function createMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setMessage("");
    try {
      await fetchJsonWithCsrf("/api/account/team", { method: "POST", body: JSON.stringify(form) });
      setForm({ email: "", username: "", displayName: "", password: "" });
      await load();
    } catch (error) {
      setMessage(apiMessage(error, "子账号创建失败。"));
    } finally {
      setCreating(false);
    }
  }

  return (
    <aside className="canvas-team-panel" aria-label="团队用量">
      <header className="canvas-team-panel__header">
        <div><UsersRound /><strong>团队用量</strong><small>主账号管理</small></div>
        <button type="button" className="canvas-icon-button" aria-label="关闭团队用量" title="关闭团队用量" onClick={onClose}><X /></button>
      </header>
      <div className="canvas-team-panel__body">
        <div className="canvas-team-panel__range">
          <span>统计周期</span>
          <select value={rangeDays} onChange={(event) => setRangeDays(event.target.value)} aria-label="统计周期">
            <option value="7">近 7 天</option>
            <option value="30">近 30 天</option>
            <option value="90">近 90 天</option>
          </select>
        </div>
        {loading ? <div className="canvas-team-panel__empty">正在读取团队数据</div> : null}
        {message ? <div className="canvas-team-panel__message" role="status">{message}</div> : null}
        {!loading && data ? (
          <>
            <div className="canvas-team-stats">
              <div><span>积分消耗</span><strong>{data.totals.creditUnits.toLocaleString()}</strong></div>
              <div><span>图片任务</span><strong>{data.totals.imageTasks}</strong></div>
              <div><span>视频任务</span><strong>{data.totals.videoTasks}</strong></div>
            </div>
            <div className="canvas-team-members">
              {data.members.map((member) => (
                <div className="canvas-team-member" key={member.localUserId}>
                  <div className="canvas-team-member__head"><strong>{member.displayName || member.username}</strong><span>{member.username}</span></div>
                  <div className="canvas-team-member__metrics"><span>余额 {member.currentCredits === null ? "--" : member.currentCredits.toLocaleString()}</span><span>积分 {member.usage.creditUnits.toLocaleString()}</span><span>图 {member.usage.imageTasks}</span><span>视频 {member.usage.videoTasks}</span></div>
                </div>
              ))}
              {!data.members.length ? <div className="canvas-team-panel__empty">暂无团队成员</div> : null}
            </div>
          </>
        ) : null}
        <section className="canvas-team-access" aria-label="CN 登录白名单">
          <div className="canvas-team-access__header">
            <strong>CN 登录白名单</strong>
            <small>只有已授权账号可以登录 aohuang888.cn</small>
          </div>
          <input
            className="canvas-team-access__search"
            value={accessQuery}
            placeholder="搜索已注册账号"
            onChange={(event) => setAccessQuery(event.target.value)}
          />
          {accessMessage ? <div className="canvas-team-panel__message" role="status">{accessMessage}</div> : null}
          {accessLoading ? <div className="canvas-team-panel__empty">正在读取登录权限</div> : (
            <div className="canvas-team-access__list">
              {accessAccounts.map((account) => (
                <div className="canvas-team-access__row" key={account.localUserId}>
                  <div>
                    <strong>{account.displayName || account.username}</strong>
                    <small>{account.email} · {account.role === "owner" ? "CN 所有者" : account.enabled ? "允许登录" : "未授权"}</small>
                  </div>
                  <button
                    type="button"
                    className={cn("canvas-access-toggle", account.enabled && "is-enabled")}
                    disabled={account.role === "owner" || accessBusy === account.localUserId || account.status !== "active"}
                    onClick={() => { void toggleAccess(account); }}
                    aria-label={`${account.enabled ? "关闭" : "开启"} ${account.email} 的 CN 登录`}
                  >
                    {account.role === "owner" ? "所有者" : account.enabled ? "已开启" : "开启"}
                  </button>
                </div>
              ))}
              {!accessAccounts.length && !accessMessage ? <div className="canvas-team-panel__empty">暂无匹配的已注册账号</div> : null}
            </div>
          )}
        </section>
        {allowCreateMembers ? <form className="canvas-team-form" onSubmit={createMember}>
          <strong>创建子账号</strong>
          <input required type="email" placeholder="员工邮箱" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} />
          <input required minLength={3} maxLength={6} placeholder="用户名（3-6 位）" value={form.username} onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))} />
          <input placeholder="显示名称" value={form.displayName} onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))} />
          <input required type="password" minLength={8} placeholder="初始密码（含大小写和数字）" value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} />
          <button type="submit" disabled={creating}>{creating ? "创建中" : "创建子账号"}</button>
        </form> : null}
      </div>
    </aside>
  );
}

function LibraryPanel({ open, items, filter, search, onClose, onFilter, onSearch, onUpload, onAdd, onAddMany, canReplace, onReplace, onRename, onFavorite, onCopyLink, onDownload, onTrim, onPublish, onDelete }: {
  open: boolean;
  items: LibraryItem[];
  filter: LibraryFilter;
  search: string;
  onClose: () => void;
  onFilter: (filter: LibraryFilter) => void;
  onSearch: (search: string) => void;
  onUpload?: () => void;
  onAdd: (item: LibraryItem) => void;
  onAddMany: (items: LibraryItem[]) => void;
  canReplace: boolean;
  onReplace: (item: LibraryItem) => void;
  onRename: (item: LibraryItem) => void;
  onFavorite: (item: LibraryItem) => void;
  onCopyLink: (item: LibraryItem) => void;
  onDownload: (item: LibraryItem) => void;
  onTrim: (item: LibraryItem) => void;
  onPublish: (item: LibraryItem) => void;
  onDelete: (item: LibraryItem) => void;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [page, setPage] = useState(0);
  const pageSize = 20;
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const visiblePage = Math.min(page, pageCount - 1);
  const pageItems = items.slice(visiblePage * pageSize, (visiblePage + 1) * pageSize);
  const selectedItems = items.filter((item) => selectedIds.has(item.id));
  return (
    <aside className={cn("canvas-library", open && "is-open")} aria-label="作品素材库" aria-hidden={!open} inert={open ? undefined : true}>
      <div className="canvas-library__header">
        <div><FolderOpen /><strong>作品素材</strong></div>
        <span className="canvas-library__header-actions">
          {onUpload ? <button type="button" className="canvas-icon-button" aria-label="上传图片或视频" title="上传图片或视频" onClick={onUpload}><Upload /></button> : null}
          <button type="button" className="canvas-icon-button" aria-label="关闭素材库" title="关闭素材库" onClick={onClose}><X /></button>
        </span>
      </div>
      <label className="canvas-library__search">
        <Search />
        <input value={search} placeholder="搜索作品" aria-label="搜索素材" onChange={(event) => { setPage(0); onSearch(event.target.value); }} />
      </label>
      <div className="canvas-library__tabs" role="tablist" aria-label="素材类型">
        {(["all", "image", "video"] as const).map((value) => (
          <button key={value} type="button" role="tab" aria-selected={filter === value} className={filter === value ? "is-active" : undefined} onClick={() => { setPage(0); onFilter(value); }}>
            {value === "all" ? "全部" : value === "image" ? "图片" : "视频"}
          </button>
        ))}
      </div>
      <div className="canvas-library__batch">
        <span>{selectedItems.length ? `已选 ${selectedItems.length} 项` : "批量选择素材"}</span>
        <button type="button" disabled={!selectedItems.length} onClick={() => { onAddMany(selectedItems); setSelectedIds(new Set()); }}><Plus />添加所选</button>
        <button type="button" disabled={!selectedIds.size} onClick={() => setSelectedIds(new Set())}>清除</button>
      </div>
      <div className="canvas-library__list">
        {pageItems.map((item) => (
          <div
            key={item.id}
            className={cn("canvas-library-item", selectedIds.has(item.id) && "is-selected")}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData(libraryDragType, item.id);
              event.dataTransfer.effectAllowed = "copy";
            }}
          >
            <label className="canvas-library-item__select"><input type="checkbox" checked={selectedIds.has(item.id)} aria-label={`选择${item.title}`} onChange={(event) => setSelectedIds((current) => {
              const next = new Set(current);
              if (event.target.checked) next.add(item.id);
              else next.delete(item.id);
              return next;
            })} /></label>
            <button type="button" className="canvas-library-item__main" onClick={() => onAdd(item)}>
              <span className="canvas-library-item__preview">
                {item.output?.url && item.type === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element -- authenticated runtime media is not a static Next image.
                  <img src={canvasLibraryThumbnailUrl(item)} alt="" draggable={false} loading="lazy" decoding="async" />
                ) : item.output?.url && item.type === "video" ? (
                  <CanvasVideoPreview src={item.output.url} muted playsInline decorative />
                ) : item.type === "video" ? <Film /> : <ImageIcon />}
              </span>
              <span className="canvas-library-item__copy">
                <strong title={item.title}>{item.title}</strong>
                <small>{item.status === "done" ? "已完成" : item.status === "failed" ? "失败" : "生成中"}</small>
              </span>
            </button>
            <details className="canvas-library-item__menu">
              <summary title="素材操作" aria-label={`${item.title}的操作`}><MoreHorizontal /></summary>
              <div className="canvas-library-item__actions">
                <button type="button" disabled={!canReplace} onClick={() => onReplace(item)}><RefreshCw /><span>替换节点</span></button>
                <button type="button" className={cn(Boolean(item.favorite || item.params.favorite) && "is-active")} onClick={() => onFavorite(item)}><Star /><span>收藏</span></button>
                <button type="button" onClick={() => onRename(item)}><Type /><span>重命名</span></button>
                <button type="button" disabled={!item.output?.url} onClick={() => onCopyLink(item)}><Copy /><span>复制链接</span></button>
                <button type="button" disabled={!item.output?.url} onClick={() => onDownload(item)}><Download /><span>下载</span></button>
                {item.type === "video" && item.status === "done" ? <button type="button" onClick={() => onTrim(item)}><Scissors /><span>裁剪</span></button> : null}
                {item.type === "video" && item.status === "done" ? <button type="button" onClick={() => onPublish(item)}><Send /><span>发布到 TikTok</span></button> : null}
                <button type="button" className="is-danger" onClick={() => onDelete(item)}><Trash2 /><span>删除</span></button>
              </div>
            </details>
          </div>
        ))}
        {!items.length ? <div className="canvas-library__empty"><FolderOpen /><span>暂无可用素材</span></div> : null}
      </div>
      {items.length ? (
        <div className="canvas-library__pagination" aria-label="素材分页">
          <button type="button" disabled={visiblePage === 0} onClick={() => setPage((value) => Math.max(0, value - 1))} aria-label="上一页" title="上一页"><ChevronLeft /></button>
          <span>{visiblePage + 1} / {pageCount}<small>共 {items.length} 项</small></span>
          <button type="button" disabled={visiblePage >= pageCount - 1} onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))} aria-label="下一页" title="下一页"><ChevronRight /></button>
        </div>
      ) : null}
    </aside>
  );
}

async function submitImageGeneration(
  generatorId: string,
  data: CanvasNodeData,
  provider: FrontendProvider,
  prompt: string,
  references: CanvasMediaReference[],
  addResultNode: (generatorId: string, item: LibraryItem, job?: JobRecord | null, resultIndex?: number, resultTotal?: number, existingNodeId?: string) => void,
  updateNodeData: (id: string, patch: Partial<CanvasNodeData>, persist?: boolean) => void,
  internalCanvas: boolean,
  pendingResultNodeIds: string[],
) {
  const files = await Promise.all(references.map(libraryItemFile));
  const mode = data.imageMode === "image-to-image" ? "image-to-image" as const : "text-to-image" as const;
  const operation = mode === "image-to-image" ? "cloud_image_edit" as const : "cloud_image_generation" as const;
  const requests = planCanvasImageRequests(Number(data.count), internalCanvas);
  const count = requests.reduce((total, requestCount) => total + requestCount, 0);
  const ratio = data.ratio || "1:1";
  const quality = data.quality || "1k";
  updateNodeData(generatorId, { status: "generating", progress: 35 });

  const requestOffsets = requests.map((_, index) => requests.slice(0, index).reduce((total, value) => total + value, 0));
  const errors: unknown[] = [];
  let nextRequestIndex = 0;
  let completedCount = 0;

  const runRequest = async (requestIndex: number) => {
    const canvasRequestedAt = new Date().toISOString();
    const requestCount = requests[requestIndex];
    const taskId = canvasId("canvas-image");
    const estimatedQuotaUnits = estimateImageGenerationTotalQuota({ quality, count: requestCount, model: provider.model });
    const requestFingerprint = generationBillingFingerprint({
      kind: "image",
      operation,
      providerId: provider.id,
      mode,
      ratio,
      quality,
      referenceImages: references.length,
      model: provider.model,
      taskId,
      estimatedQuotaUnits,
    });
    await fetchJsonWithCsrf("/api/quota/precheck", {
      method: "POST",
      body: JSON.stringify({
        operation,
        taskId,
        idempotencyKey: taskId,
        estimatedQuotaUnits,
        membershipEntitlementAmount: estimateImageGenerationEntitlementUnits({ quality, count: requestCount }),
        requestFingerprint,
      }),
    });
    const form = new FormData();
    form.set("providerId", provider.id);
    form.set("mode", mode);
    form.set("operation", operation);
    form.set("ratio", ratio);
    form.set("quality", quality);
    form.set("prompt", prompt);
    form.set("count", String(requestCount));
    form.set("taskId", taskId);
    form.set("idempotencyKey", taskId);
    form.set("estimatedQuotaUnits", String(estimatedQuotaUnits));
    if (internalCanvas) form.set("canvasScope", canvasScope());
    form.set("canvasRequestedAt", canvasRequestedAt);
    files.forEach((file) => form.append("files", file));
    const response = await fetchJsonWithCsrf<{ item: LibraryItem | null; items?: LibraryItem[] }>("/api/generate/image", { method: "POST", body: form });
    const items = response.items?.length ? response.items : response.item ? [response.item] : [];
    if (!items.length) throw new Error("图片生成未返回结果。");
    items.forEach((item, index) => {
      const resultIndex = requestOffsets[requestIndex] + index;
      addResultNode(generatorId, item, null, resultIndex, count, pendingResultNodeIds[resultIndex]);
    });
    completedCount += items.length;
    updateNodeData(generatorId, { progress: Math.min(95, 35 + Math.round((completedCount / count) * 60)) }, false);
  };

  const worker = async () => {
    while (nextRequestIndex < requests.length) {
      const requestIndex = nextRequestIndex;
      nextRequestIndex += 1;
      try {
        await runRequest(requestIndex);
      } catch (error) {
        errors.push(error);
      }
    }
  };
  const concurrency = internalCanvas ? INTERNAL_CANVAS_IMAGE_REQUEST_CONCURRENCY : 1;
  await Promise.all(Array.from({ length: Math.min(concurrency, requests.length) }, () => worker()));
  if (errors.length) throw errors[0];
  updateNodeData(generatorId, { status: "done", progress: 100, error: undefined });
}

async function submitVideoGeneration(
  generatorId: string,
  data: CanvasNodeData,
  provider: WorkspacePublicProvider,
  prompt: string,
  references: CanvasMediaReference[],
  addResultNode: (generatorId: string, item: LibraryItem, job?: JobRecord | null, resultIndex?: number, resultTotal?: number, existingNodeId?: string) => void,
  updateNodeData: (id: string, patch: Partial<CanvasNodeData>, persist?: boolean) => void,
  internalCanvas: boolean,
  pendingResultNodeId: string,
  taskId: string,
  canvasRequestedAt: string,
) {
  const images = references.filter((item) => item.type === "image");
  const videos = references.filter((item) => item.type === "video");
  const audios = references.filter((item) => item.type === "audio");
  const options = provider.videoOptions;
  if (images.length > (options?.maxReferenceImages ?? 1)) throw new Error(`当前模型最多支持 ${options?.maxReferenceImages ?? 1} 张参考图。`);
  if (videos.length > (options?.maxReferenceVideos ?? 0)) throw new Error("当前模型不支持这么多参考视频。");
  if (audios.length > (options?.maxReferenceAudios ?? 0)) throw new Error("当前模型不支持这么多参考音频。");
  if (options?.requiredReferenceMedia?.includes("image") && !images.length) throw new Error("当前模型需要参考图。");
  if (options?.requiredReferenceMedia?.includes("video") && !videos.length) throw new Error("当前模型需要参考视频。");
  if (options?.requiredReferenceMedia?.includes("audio") && !audios.length) throw new Error("当前模型需要参考音频。");
  if (options?.maxPromptCharacters && prompt.length > options.maxPromptCharacters) {
    throw new Error(`当前模型提示词最多 ${options.maxPromptCharacters} 个字符。`);
  }

  const imageFiles = await Promise.all(images.map(libraryItemFile));
  const videoFiles = await Promise.all(videos.map(libraryItemFile));
  const audioFiles = await Promise.all(audios.map(libraryItemFile));

  const mode = references.length ? "image-to-video" as const : "text-to-video" as const;
  const ratio = options?.ratios?.includes(data.ratio || "") ? data.ratio! : options?.ratios?.[0] || data.ratio || "16:9";
  const duration = options?.durations?.includes(data.duration || 0) ? data.duration! : options?.durations?.[0] || data.duration || 5;
  const configuredResolutions = options?.resolutions?.length ? options.resolutions : options?.resolution ? [options.resolution] : [];
  const resolution = configuredResolutions.includes(data.resolution || "") ? data.resolution! : configuredResolutions[0] || data.resolution || "720p";
  const estimatedQuotaUnits = estimateVideoGenerationQuota({
    mode,
    durationSeconds: duration,
    resolution,
    referenceImages: images.length,
    model: provider.model,
  });
  const requestFingerprint = generationBillingFingerprint({
    kind: "video",
    providerId: provider.id,
    mode,
    ratio,
    durationSeconds: duration,
    resolution,
    referenceImages: images.length,
    model: provider.model,
    taskId,
    estimatedQuotaUnits,
  });
  await fetchJsonWithCsrf("/api/quota/precheck", {
    method: "POST",
    body: JSON.stringify({
      operation: "cloud_video_generation",
      taskId,
      idempotencyKey: taskId,
      estimatedQuotaUnits,
      membershipEntitlementAmount: estimateVideoGenerationEntitlementUnits({ resolution, model: provider.model, durationSeconds: duration }),
      requestFingerprint,
    }),
  });
  const form = new FormData();
  form.set("providerId", provider.id);
  form.set("mode", mode);
  form.set("referenceMode", "single");
  form.set("ratio", ratio);
  form.set("duration", String(duration));
  form.set("resolution", resolution);
  form.set("prompt", prompt);
  form.set("taskId", taskId);
  form.set("idempotencyKey", taskId);
  form.set("estimatedQuotaUnits", String(estimatedQuotaUnits));
  if (internalCanvas) form.set("canvasScope", canvasScope());
  form.set("canvasRequestedAt", canvasRequestedAt);
  imageFiles.forEach((file) => form.append("referenceImages", file));
  videoFiles.forEach((file) => form.append("referenceVideos", file));
  audioFiles.forEach((file) => form.append("referenceAudios", file));
  const response = await fetchJsonWithCsrf<{ item: LibraryItem; job: JobRecord | null }>("/api/generate/video", { method: "POST", body: form });
  addResultNode(generatorId, response.item, response.job, 0, 1, pendingResultNodeId);
  updateNodeData(generatorId, {
    status: "idle",
    progress: 0,
    jobId: undefined,
    error: undefined,
    sequenceState: {
      ...(data.sequenceState || {}),
      accepted: response.job?.status === "done" || response.item.status === "done",
    },
  });
}

async function libraryItemFile(item: CanvasMediaReference) {
  const url = item.output?.url;
  if (!url) throw new Error(`素材“${item.title}”暂时没有可用文件。`);
  const response = await fetch(sameOriginProviderReferenceUrl(url), { credentials: "same-origin", cache: "no-store" });
  if (!response.ok) throw new Error(`无法读取素材“${item.title}”。`);
  const blob = await response.blob();
  const extension = item.type === "video" ? "mp4" : item.type === "audio" ? "mp3" : blob.type.includes("jpeg") ? "jpg" : "png";
  return new File([blob], `${item.id}.${extension}`, { type: blob.type || item.output?.mimeType || (item.type === "video" ? "video/mp4" : item.type === "audio" ? "audio/mpeg" : "image/png") });
}

function sameOriginProviderReferenceUrl(url: string) {
  try {
    const parsed = new URL(url, "https://canvas.invalid");
    if (parsed.pathname.startsWith("/api/provider-reference/")) return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    // Preserve malformed URLs so the existing request error remains visible to the user.
  }
  return url;
}

function serializeDocument(nodes: CanvasFlowNode[], edges: Edge[], viewport: Viewport): CanvasProjectDocument {
  const persistedNodes = nodes.filter((node) => !(
    node.data.kind === "media"
    && node.data.mediaOrigin === "upload"
    && !node.data.libraryItemId
    && (node.data.status === "queued" || node.data.status === "generating")
  ));
  const persistedNodeIds = new Set(persistedNodes.map((node) => node.id));
  return {
    nodes: persistedNodes.map((node) => {
      const data = { ...node.data };
      if (data.mediaType !== "audio") delete data.mediaUrl;
      return {
        id: node.id,
        type: node.data.kind === "group" ? "group" : "canvas",
        position: node.position,
        ...(node.width ? { width: node.width } : {}),
        ...(node.height ? { height: node.height } : {}),
        ...(node.parentId ? { parentId: node.parentId, extent: "parent" as const } : {}),
        data,
      };
    }),
    edges: edges.filter((edge) => persistedNodeIds.has(edge.source) && persistedNodeIds.has(edge.target)).map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      ...(edge.sourceHandle ? { sourceHandle: edge.sourceHandle } : {}),
      ...(edge.targetHandle ? { targetHandle: edge.targetHandle } : {}),
    })),
    viewport,
  };
}

function starterDocument(): CanvasProjectDocument {
  const promptId = canvasId("node");
  const generatorId = canvasId("node");
  return {
    nodes: [
      {
        id: promptId,
        type: "canvas",
        position: { x: 80, y: 120 },
        width: 320,
        height: 230,
        data: { kind: "prompt", title: "提示词", prompt: "" },
      },
      {
        id: generatorId,
        type: "canvas",
        position: { x: 540, y: 90 },
        width: 360,
        height: 370,
        data: {
          kind: "generator",
          title: "图片生成",
          generationKind: "image",
          providerId: "",
          count: 1,
          ratio: "1:1",
          quality: "1k",
          duration: 5,
          resolution: "720p",
          status: "idle",
          progress: 0,
        },
      },
    ],
    edges: [{ id: canvasId("edge"), source: promptId, sourceHandle: "output", target: generatorId, targetHandle: "input" }],
    viewport: { x: 60, y: 40, zoom: 0.9 },
  };
}

function libraryStatus(item: LibraryItem): CanvasNodeData["status"] {
  if (item.status === "done") return "done";
  if (item.status === "failed") return "failed";
  if (item.status === "queued") return "queued";
  return "generating";
}

function canvasMediaNodeMetadata(item: LibraryItem): Partial<CanvasNodeData> {
  const requestedAt = typeof item.params.canvasRequestedAt === "string" ? item.params.canvasRequestedAt : undefined;
  return {
    completedAt: item.completedAt,
    generationStartedAt: requestedAt,
    fileSize: item.output?.size,
    mediaOrigin: item.mode === "canvas-upload" ? "upload" : "generated",
  };
}

function canvasId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function slugifyCanvasTitle(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-").replace(/^-+|-+$/g, "") || "canvas";
}

function miniMapColor(node: CanvasFlowNode) {
  if (node.data.kind === "prompt") return "#a1a1aa";
  if (node.data.kind === "media") return node.data.mediaType === "video" ? "#f59e0b" : "#22d3ee";
  return "#ff2b88";
}

function saveStateLabel(state: SaveState) {
  if (state === "saving") return "保存中";
  if (state === "dirty") return "待保存";
  if (state === "error") return "保存失败";
  return "已保存";
}

function apiMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError || error instanceof Error) return error.message || fallback;
  return fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
