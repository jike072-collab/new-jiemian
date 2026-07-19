"use client";

import Link from "next/link";
import {
  ArrowLeft,
  Film,
  FolderOpen,
  Image as ImageIcon,
  LoaderCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Save,
  Search,
  Sparkles,
  Trash2,
  Type,
  UsersRound,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
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
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange,
  type Viewport,
} from "@xyflow/react";

import { BrandLogo } from "@/components/brand-logo";
import {
  CanvasNode,
  CanvasNodeActionsContext,
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
  CanvasNodeData,
  CanvasProject,
  CanvasProjectDocument,
  CanvasStoredNode,
} from "@/lib/canvas/types";
import type { FrontendProvider, JobRecord, LibraryItem } from "@/lib/server/types";
import { cn } from "@/lib/utils";

type SaveState = "saved" | "dirty" | "saving" | "error";
type LibraryFilter = "all" | "image" | "video";

const nodeTypes = { canvas: CanvasNode };
const emptyProviders: EnabledProviders = { image: [], video: [] };
const defaultViewport: Viewport = { x: 0, y: 0, zoom: 1 };
const libraryDragType = "application/x-aohuang-library-item";

export function CanvasWorkspace({ accountName, isTeamOwner }: { accountName: string; isTeamOwner: boolean }) {
  return (
    <ReactFlowProvider>
      <CanvasWorkspaceInner accountName={accountName} isTeamOwner={isTeamOwner} />
    </ReactFlowProvider>
  );
}

function CanvasWorkspaceInner({ accountName, isTeamOwner }: { accountName: string; isTeamOwner: boolean }) {
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
  const [libraryOpen, setLibraryOpen] = useState(true);
  const [libraryFilter, setLibraryFilter] = useState<LibraryFilter>("all");
  const [librarySearch, setLibrarySearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [notice, setNotice] = useState("");
  const [teamOpen, setTeamOpen] = useState(false);

  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const projectsRef = useRef(projects);
  const libraryRef = useRef(library);
  const providersRef = useRef(providers);
  const titleRef = useRef(title);
  const viewportRef = useRef(viewport);
  const stageRef = useRef<HTMLElement | null>(null);
  const activeProjectRef = useRef<CanvasProject | null>(null);
  const loadedRef = useRef(false);
  const revisionRef = useRef(0);
  const savedRevisionRef = useRef(0);
  const saveTimerRef = useRef<number | null>(null);
  const savePromiseRef = useRef<Promise<boolean> | null>(null);
  const queuedSaveRef = useRef(false);
  const saveNowRef = useRef<(force?: boolean) => Promise<boolean>>(async () => true);

  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  useEffect(() => { edgesRef.current = edges; }, [edges]);
  useEffect(() => { projectsRef.current = projects; }, [projects]);
  useEffect(() => { libraryRef.current = library; }, [library]);
  useEffect(() => { providersRef.current = providers; }, [providers]);
  useEffect(() => { titleRef.current = title; }, [title]);
  useEffect(() => { viewportRef.current = viewport; }, [viewport]);
  useEffect(() => { flowRef.current = flow; }, [flow]);
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

  const hydrateMediaNodes = useCallback((sourceNodes: CanvasStoredNode[] | CanvasFlowNode[], items: LibraryItem[]) => {
    const itemMap = new Map(items.map((item) => [item.id, item]));
    return sourceNodes.map((node) => {
      if (node.data.kind !== "media" || !node.data.libraryItemId) return { ...node, type: "canvas" as const };
      const item = itemMap.get(node.data.libraryItemId);
      if (!item) return { ...node, type: "canvas" as const, data: { ...node.data, mediaUrl: undefined } };
      return {
        ...node,
        type: "canvas" as const,
        data: {
          ...node.data,
          title: item.title || node.data.title,
          mediaType: item.type,
          mediaUrl: item.output?.url,
          status: libraryStatus(item),
          error: item.error || undefined,
        },
      };
    }) as CanvasFlowNode[];
  }, []);

  const activateProject = useCallback((project: CanvasProject, items = libraryRef.current) => {
    loadedRef.current = false;
    activeProjectRef.current = project;
    setActiveProjectId(project.id);
    setTitle(project.title);
    setNodes(hydrateMediaNodes(project.document.nodes, items));
    setEdges(project.document.edges.map((edge) => ({ ...edge, type: "smoothstep" })));
    setViewportState(project.document.viewport);
    revisionRef.current = 0;
    savedRevisionRef.current = 0;
    setSaveState("saved");
    setNotice("");
    window.requestAnimationFrame(() => {
      void flowRef.current.setViewport(project.document.viewport, { duration: 0 });
      loadedRef.current = true;
    });
  }, [hydrateMediaNodes]);

  const refreshLibrary = useCallback(async () => {
    const data = await fetchJson<{ items: LibraryItem[] }>("/api/library");
    libraryRef.current = data.items;
    setLibrary(data.items);
    setNodes((current) => hydrateMediaNodes(current, data.items));
    return data.items;
  }, [hydrateMediaNodes]);

  useEffect(() => {
    let cancelled = false;
    async function loadWorkspace() {
      setLoading(true);
      try {
        const [projectData, providerData, libraryData] = await Promise.all([
          fetchJson<{ projects: CanvasProject[] }>("/api/canvas/projects"),
          fetchJson<{ providers: EnabledProviders }>("/api/providers/enabled"),
          fetchJson<{ items: LibraryItem[] }>("/api/library"),
        ]);
        if (cancelled) return;
        let nextProjects = projectData.projects;
        if (!nextProjects.length) {
          const created = await fetchJsonWithCsrf<{ project: CanvasProject }>("/api/canvas/projects", {
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
        activateProject(nextProjects[0], libraryData.items);
      } catch (error) {
        if (!cancelled) setNotice(apiMessage(error, "画布加载失败。"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadWorkspace();
    return () => { cancelled = true; };
  }, [activateProject]);

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
    setSaveState("saving");
    const savePromise = (async () => {
      try {
        const response = await fetchJsonWithCsrf<{ project: CanvasProject }>(`/api/canvas/projects/${encodeURIComponent(project.id)}`, {
          method: "PATCH",
          body: JSON.stringify({
            title: titleRef.current,
            document: serializeDocument(nodesRef.current, edgesRef.current, viewportRef.current),
            version: project.version,
          }),
        });
        activeProjectRef.current = response.project;
        setProjects((current) => current
          .map((item) => item.id === response.project.id ? response.project : item)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
        savedRevisionRef.current = snapshotRevision;
        if (revisionRef.current === snapshotRevision) {
          setSaveState("saved");
        } else {
          queuedSaveRef.current = true;
          setSaveState("dirty");
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
  }, [scheduleSave]);

  useEffect(() => { saveNowRef.current = saveNow; }, [saveNow]);
  useEffect(() => () => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
  }, []);

  const updateNodeData = useCallback((id: string, patch: Partial<CanvasNodeData>, persist = true) => {
    setNodes((current) => current.map((node) => node.id === id
      ? { ...node, data: { ...node.data, ...patch } }
      : node));
    if (persist) markDirty();
  }, [markDirty]);

  const removeNode = useCallback((id: string) => {
    setNodes((current) => current.filter((node) => node.id !== id));
    setEdges((current) => current.filter((edge) => edge.source !== id && edge.target !== id));
    markDirty();
  }, [markDirty]);

  const addNodeAtCenter = useCallback((data: CanvasNodeData, size: { width: number; height: number }) => {
    const stageBounds = stageRef.current?.getBoundingClientRect();
    const position = flow.screenToFlowPosition({
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
      position: availablePosition || {
        x: basePosition.x + nodesRef.current.length * 32,
        y: basePosition.y + nodesRef.current.length * 32,
      },
      width: size.width,
      height: size.height,
      data,
    };
    setNodes((current) => [...current, node]);
    markDirty();
    return node;
  }, [flow, markDirty]);

  const addPromptNode = useCallback(() => {
    addNodeAtCenter({ kind: "prompt", title: "提示词", prompt: "" }, { width: 320, height: 230 });
  }, [addNodeAtCenter]);

  const addGeneratorNode = useCallback((kind: "image" | "video") => {
    const available = kind === "image" ? providersRef.current.image : providersRef.current.video;
    const provider = available[0] as WorkspacePublicProvider | undefined;
    addNodeAtCenter({
      kind: "generator",
      title: kind === "image" ? "图片生成" : "视频生成",
      generationKind: kind,
      providerId: provider?.id || "",
      ratio: kind === "image" ? "1:1" : provider?.videoOptions?.ratios?.[0] || "16:9",
      quality: "1k",
      duration: provider?.videoOptions?.durations?.[0] || 5,
      resolution: provider?.videoOptions?.resolutions?.[0] || provider?.videoOptions?.resolution || "720p",
      status: "idle",
      progress: 0,
    }, { width: 340, height: kind === "image" ? 360 : 410 });
  }, [addNodeAtCenter]);

  const addLibraryNode = useCallback((item: LibraryItem, position?: { x: number; y: number }) => {
    const data: CanvasNodeData = {
      kind: "media",
      title: item.title || (item.type === "image" ? "图片素材" : "视频素材"),
      mediaType: item.type,
      libraryItemId: item.id,
      mediaUrl: item.output?.url,
      status: libraryStatus(item),
      progress: 0,
      error: item.error || undefined,
    };
    if (!position) {
      addNodeAtCenter(data, { width: 320, height: item.type === "image" ? 300 : 340 });
      return;
    }
    setNodes((current) => [...current, {
      id: canvasId("node"),
      type: "canvas",
      position,
      width: 320,
      height: item.type === "image" ? 300 : 340,
      data,
    }]);
    markDirty();
  }, [addNodeAtCenter, markDirty]);

  const addResultNode = useCallback((generatorId: string, item: LibraryItem, job?: JobRecord | null) => {
    const generator = nodesRef.current.find((node) => node.id === generatorId);
    if (!generator) return;
    const id = canvasId("node");
    const resultNode: CanvasFlowNode = {
      id,
      type: "canvas",
      position: { x: generator.position.x + (generator.width || 340) + 130, y: generator.position.y },
      width: 340,
      height: item.type === "image" ? 320 : 360,
      data: {
        kind: "media",
        title: item.title || (item.type === "image" ? "图片结果" : "视频结果"),
        mediaType: item.type,
        libraryItemId: item.id,
        mediaUrl: item.output?.url,
        status: libraryStatus(item),
        progress: job?.progress || 0,
        error: item.error || undefined,
      },
    };
    setNodes((current) => [
      ...current.map((node) => node.id === generatorId
        ? { ...node, data: { ...node.data, outputNodeId: id, jobId: job?.id || node.data.jobId } }
        : node),
      resultNode,
    ]);
    setEdges((current) => [...current, {
      id: canvasId("edge"),
      source: generatorId,
      sourceHandle: "output",
      target: id,
      targetHandle: "input",
      type: "smoothstep",
    }]);
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
      .filter((node) => node.data.kind === "media" && node.data.libraryItemId)
      .map((node) => libraryRef.current.find((item) => item.id === node.data.libraryItemId))
      .filter((item): item is LibraryItem => Boolean(item));
    const providerList = generator.data.generationKind === "image" ? providersRef.current.image : providersRef.current.video;
    const provider = providerList.find((item) => item.id === generator.data.providerId) || providerList[0];
    if (!provider) {
      updateNodeData(generatorId, { status: "failed", error: "当前没有可用模型。" });
      return;
    }

    updateNodeData(generatorId, { status: "queued", progress: 0, error: undefined, providerId: provider.id });
    setNotice("");
    try {
      if (generator.data.generationKind === "image") {
        if (mediaItems.some((item) => item.type !== "image")) throw new Error("图片生成节点只能连接图片素材。");
        await submitImageGeneration(generatorId, generator.data, provider, prompt, mediaItems, addResultNode, updateNodeData);
      } else {
        await submitVideoGeneration(generatorId, generator.data, provider as WorkspacePublicProvider, prompt, mediaItems, addResultNode, updateNodeData);
      }
      await refreshLibrary().catch(() => undefined);
    } catch (error) {
      const message = apiMessage(error, "生成失败。");
      updateNodeData(generatorId, { status: "failed", error: message });
      setNotice(message);
    }
  }, [addResultNode, refreshLibrary, updateNodeData]);

  const inputSummary = useMemo(() => {
    const summaries: Record<string, GeneratorInputSummary> = {};
    const nodeMap = new Map(nodes.map((node) => [node.id, node]));
    edges.forEach((edge) => {
      const target = nodeMap.get(edge.target);
      const source = nodeMap.get(edge.source);
      if (target?.data.kind !== "generator" || !source) return;
      const summary = summaries[target.id] || { prompts: 0, images: 0, videos: 0 };
      if (source.data.kind === "prompt" && String(source.data.prompt || "").trim()) summary.prompts += 1;
      if (source.data.kind === "media" && source.data.mediaType === "image") summary.images += 1;
      if (source.data.kind === "media" && source.data.mediaType === "video") summary.videos += 1;
      summaries[target.id] = summary;
    });
    return summaries;
  }, [edges, nodes]);

  const nodeActions = useMemo(() => ({
    providers,
    inputSummary,
    updateNodeData: (id: string, patch: Partial<CanvasNodeData>) => updateNodeData(id, patch),
    removeNode,
    runGenerator: (id: string) => { void executeGenerator(id); },
  }), [executeGenerator, inputSummary, providers, removeNode, updateNodeData]);

  const onNodesChange = useCallback((changes: NodeChange<CanvasFlowNode>[]) => {
    setNodes((current) => applyNodeChanges(changes, current));
    if (changes.some((change) => change.type !== "select")) markDirty();
  }, [markDirty]);

  const onEdgesChange = useCallback((changes: EdgeChange<Edge>[]) => {
    setEdges((current) => applyEdgeChanges(changes, current));
    if (changes.some((change) => change.type !== "select")) markDirty();
  }, [markDirty]);

  const isValidConnection = useCallback((connection: Connection | Edge) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return false;
    const source = nodesRef.current.find((node) => node.id === connection.source);
    const target = nodesRef.current.find((node) => node.id === connection.target);
    if (!source || target?.data.kind !== "generator") return false;
    if (source.data.kind !== "prompt" && source.data.kind !== "media") return false;
    return !edgesRef.current.some((edge) => edge.source === connection.source && edge.target === connection.target);
  }, []);

  const onConnect = useCallback((connection: Connection) => {
    if (!isValidConnection(connection)) return;
    setEdges((current) => addEdge({ ...connection, id: canvasId("edge"), type: "smoothstep" }, current));
    markDirty();
  }, [isValidConnection, markDirty]);

  const createProject = useCallback(async (skipCurrentSave = false) => {
    if (!skipCurrentSave && !(await saveNow(true))) return;
    try {
      const data = await fetchJsonWithCsrf<{ project: CanvasProject }>("/api/canvas/projects", {
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
    const project = activeProjectRef.current;
    if (!project || !window.confirm(`确定删除“${project.title}”？`)) return;
    const pendingSave = savePromiseRef.current;
    if (pendingSave && !(await pendingSave)) return;
    try {
      await fetchJsonWithCsrf(`/api/canvas/projects/${encodeURIComponent(project.id)}`, { method: "DELETE" });
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
  }, [activateProject, createProject]);

  const activeJobsKey = useMemo(() => nodes
    .filter((node) => node.data.kind === "generator" && node.data.jobId && (node.data.status === "queued" || node.data.status === "generating"))
    .map((node) => `${node.id}:${node.data.jobId}`)
    .sort()
    .join("|"), [nodes]);

  useEffect(() => {
    if (!activeJobsKey) return;
    let cancelled = false;
    let timer: number | null = null;
    const poll = async () => {
      const activeJobs = nodesRef.current.filter((node) => node.data.kind === "generator" && node.data.jobId && (node.data.status === "queued" || node.data.status === "generating"));
      let refreshNeeded = false;
      await Promise.all(activeJobs.map(async (node) => {
        try {
          const data = await fetchJson<{ job: JobRecord | null }>(`/api/jobs/${encodeURIComponent(node.data.jobId!)}`);
          if (cancelled || !data.job) return;
          const terminal = data.job.status === "done" || data.job.status === "failed";
          updateNodeData(node.id, {
            status: data.job.status === "done" ? "done" : data.job.status === "failed" ? "failed" : data.job.status === "queued" ? "queued" : "generating",
            progress: data.job.progress || 0,
            error: data.job.error || undefined,
          }, terminal);
          if (node.data.outputNodeId) {
            updateNodeData(node.data.outputNodeId, {
              status: data.job.status === "done" ? "done" : data.job.status === "failed" ? "failed" : data.job.status === "queued" ? "queued" : "generating",
              progress: data.job.progress || 0,
              error: data.job.error || undefined,
            }, terminal);
          }
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
      if (libraryFilter !== "all" && item.type !== libraryFilter) return false;
      return !query || item.title.toLowerCase().includes(query) || item.prompt.toLowerCase().includes(query);
    });
  }, [library, libraryFilter, librarySearch]);

  if (loading) {
    return <div className="canvas-loading"><LoaderCircle className="is-spinning" /><span>正在打开创作画布</span></div>;
  }

  return (
    <main className="aohuang-canvas-page">
      <CanvasToolbar
        accountName={accountName}
        projects={projects}
        activeProjectId={activeProjectId}
        title={title}
        saveState={saveState}
        libraryOpen={libraryOpen}
        onTitleChange={(value) => { setTitle(value); markDirty(); }}
        onProjectChange={(id) => { void switchProject(id); }}
        onCreateProject={() => { void createProject(); }}
        onDeleteProject={() => { void deleteProject(); }}
        onSave={() => { void saveNow(true); }}
        onToggleLibrary={() => setLibraryOpen((value) => !value)}
        onAddPrompt={addPromptNode}
        onAddImage={() => addGeneratorNode("image")}
        onAddVideo={() => addGeneratorNode("video")}
        isTeamOwner={isTeamOwner}
        teamOpen={teamOpen}
        onToggleTeam={() => setTeamOpen((value) => !value)}
      />

      <div className="canvas-workspace">
        <LibraryPanel
          open={libraryOpen}
          items={filteredLibrary}
          filter={libraryFilter}
          search={librarySearch}
          onClose={() => setLibraryOpen(false)}
          onFilter={setLibraryFilter}
          onSearch={setLibrarySearch}
          onAdd={addLibraryNode}
        />
        <section ref={stageRef} className="canvas-stage" aria-label="无限画布">
          <CanvasNodeActionsContext.Provider value={nodeActions}>
            <ReactFlow<CanvasFlowNode, Edge>
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              isValidConnection={isValidConnection}
              onMoveEnd={(_, nextViewport) => {
                setViewportState(nextViewport);
                markDirty();
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "copy";
              }}
              onDrop={(event) => {
                event.preventDefault();
                const itemId = event.dataTransfer.getData(libraryDragType);
                const item = libraryRef.current.find((entry) => entry.id === itemId);
                if (item) addLibraryNode(item, flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
              }}
              defaultEdgeOptions={{
                type: "smoothstep",
                markerEnd: { type: MarkerType.ArrowClosed },
                style: { strokeWidth: 1.5 },
              }}
              defaultViewport={viewport}
              minZoom={0.08}
              maxZoom={2.5}
              panOnScroll
              selectionOnDrag
              proOptions={{ hideAttribution: true }}
            >
              <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} />
              <MiniMap pannable zoomable nodeColor={miniMapColor} />
              <Controls showInteractive={false} />
            </ReactFlow>
          </CanvasNodeActionsContext.Provider>
        </section>
      </div>

      {isTeamOwner && teamOpen ? <TeamPanel onClose={() => setTeamOpen(false)} /> : null}

      {notice ? (
        <div className="canvas-notice" role="status">
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
  title,
  saveState,
  libraryOpen,
  onTitleChange,
  onProjectChange,
  onCreateProject,
  onDeleteProject,
  onSave,
  onToggleLibrary,
  onAddPrompt,
  onAddImage,
  onAddVideo,
  isTeamOwner,
  teamOpen,
  onToggleTeam,
}: {
  accountName: string;
  projects: CanvasProject[];
  activeProjectId: string;
  title: string;
  saveState: SaveState;
  libraryOpen: boolean;
  onTitleChange: (value: string) => void;
  onProjectChange: (id: string) => void;
  onCreateProject: () => void;
  onDeleteProject: () => void;
  onSave: () => void;
  onToggleLibrary: () => void;
  onAddPrompt: () => void;
  onAddImage: () => void;
  onAddVideo: () => void;
  isTeamOwner: boolean;
  teamOpen: boolean;
  onToggleTeam: () => void;
}) {
  return (
    <header className="canvas-toolbar">
      <div className="canvas-toolbar__brand">
        <Link href="/" className="canvas-icon-button" aria-label="返回奥皇 AI" title="返回奥皇 AI"><ArrowLeft /></Link>
        <BrandLogo />
        <span><strong>奥皇 AI</strong><small>创作画布</small></span>
      </div>
      <div className="canvas-toolbar__projects">
        <select value={activeProjectId} aria-label="选择画布" onChange={(event) => onProjectChange(event.target.value)}>
          {projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}
        </select>
        <input value={title} maxLength={120} aria-label="画布名称" onChange={(event) => onTitleChange(event.target.value)} />
        <button type="button" className="canvas-icon-button" aria-label="新建画布" title="新建画布" onClick={onCreateProject}><Plus /></button>
        <button type="button" className="canvas-icon-button" aria-label="删除画布" title="删除画布" onClick={onDeleteProject}><Trash2 /></button>
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
        <button type="button" className="canvas-tool-button" aria-label="添加提示词节点" title="添加提示词节点" onClick={onAddPrompt}><Type /><span>提示词</span></button>
        <button type="button" className="canvas-tool-button" aria-label="添加图片生成节点" title="添加图片生成节点" onClick={onAddImage}><Sparkles /><span>生图</span></button>
        <button type="button" className="canvas-tool-button" aria-label="添加视频生成节点" title="添加视频生成节点" onClick={onAddVideo}><Film /><span>生视频</span></button>
      </div>
      <div className="canvas-toolbar__account">
        {isTeamOwner ? <button type="button" className={cn("canvas-tool-button", teamOpen && "is-active")} aria-label="团队用量" title="团队用量" onClick={onToggleTeam}><UsersRound /><span>团队</span></button> : null}
        <span className={cn("canvas-save-state", `is-${saveState}`)}>{saveStateLabel(saveState)}</span>
        <button type="button" className="canvas-icon-button" aria-label="保存画布" title="保存画布" disabled={saveState === "saving"} onClick={onSave}>
          {saveState === "saving" ? <LoaderCircle className="is-spinning" /> : <Save />}
        </button>
        <strong title={accountName}>{accountName}</strong>
      </div>
    </header>
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

function TeamPanel({ onClose }: { onClose: () => void }) {
  const [rangeDays, setRangeDays] = useState("30");
  const [data, setData] = useState<TeamOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({ email: "", username: "", displayName: "", password: "" });
  const [creating, setCreating] = useState(false);

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

  useEffect(() => { void load(); }, [load]);

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
        <form className="canvas-team-form" onSubmit={createMember}>
          <strong>创建子账号</strong>
          <input required type="email" placeholder="员工邮箱" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} />
          <input required minLength={3} maxLength={6} placeholder="用户名（3-6 位）" value={form.username} onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))} />
          <input placeholder="显示名称" value={form.displayName} onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))} />
          <input required type="password" minLength={8} placeholder="初始密码（含大小写和数字）" value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} />
          <button type="submit" disabled={creating}>{creating ? "创建中" : "创建子账号"}</button>
        </form>
      </div>
    </aside>
  );
}

function LibraryPanel({ open, items, filter, search, onClose, onFilter, onSearch, onAdd }: {
  open: boolean;
  items: LibraryItem[];
  filter: LibraryFilter;
  search: string;
  onClose: () => void;
  onFilter: (filter: LibraryFilter) => void;
  onSearch: (search: string) => void;
  onAdd: (item: LibraryItem) => void;
}) {
  return (
    <aside className={cn("canvas-library", open && "is-open")} aria-hidden={!open}>
      <div className="canvas-library__header">
        <div><FolderOpen /><strong>作品素材</strong></div>
        <button type="button" className="canvas-icon-button" aria-label="关闭素材库" title="关闭素材库" onClick={onClose}><X /></button>
      </div>
      <label className="canvas-library__search">
        <Search />
        <input value={search} placeholder="搜索作品" onChange={(event) => onSearch(event.target.value)} />
      </label>
      <div className="canvas-library__tabs" role="tablist" aria-label="素材类型">
        {(["all", "image", "video"] as const).map((value) => (
          <button key={value} type="button" role="tab" aria-selected={filter === value} className={filter === value ? "is-active" : undefined} onClick={() => onFilter(value)}>
            {value === "all" ? "全部" : value === "image" ? "图片" : "视频"}
          </button>
        ))}
      </div>
      <div className="canvas-library__list">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className="canvas-library-item"
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData(libraryDragType, item.id);
              event.dataTransfer.effectAllowed = "copy";
            }}
            onClick={() => onAdd(item)}
          >
            <span className="canvas-library-item__preview">
              {item.output?.url && item.type === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element -- authenticated runtime media is not a static Next image.
                <img src={item.output.url} alt="" draggable={false} />
              ) : item.type === "video" ? <Film /> : <ImageIcon />}
            </span>
            <span className="canvas-library-item__copy">
              <strong title={item.title}>{item.title}</strong>
              <small>{item.status === "done" ? "已完成" : item.status === "failed" ? "失败" : "生成中"}</small>
            </span>
            <Plus />
          </button>
        ))}
        {!items.length ? <div className="canvas-library__empty"><FolderOpen /><span>暂无可用素材</span></div> : null}
      </div>
    </aside>
  );
}

async function submitImageGeneration(
  generatorId: string,
  data: CanvasNodeData,
  provider: FrontendProvider,
  prompt: string,
  references: LibraryItem[],
  addResultNode: (generatorId: string, item: LibraryItem, job?: JobRecord | null) => void,
  updateNodeData: (id: string, patch: Partial<CanvasNodeData>, persist?: boolean) => void,
) {
  const files = await Promise.all(references.map(libraryItemFile));
  const taskId = canvasId("canvas-image");
  const mode = references.length ? "image-to-image" as const : "text-to-image" as const;
  const operation = references.length ? "cloud_image_edit" as const : "cloud_image_generation" as const;
  const ratio = data.ratio || "1:1";
  const quality = data.quality || "1k";
  const estimatedQuotaUnits = estimateImageGenerationTotalQuota({ quality, count: 1, model: provider.model });
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
      membershipEntitlementAmount: estimateImageGenerationEntitlementUnits({ quality }),
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
  form.set("count", "1");
  form.set("taskId", taskId);
  form.set("idempotencyKey", taskId);
  form.set("estimatedQuotaUnits", String(estimatedQuotaUnits));
  files.forEach((file) => form.append("files", file));
  updateNodeData(generatorId, { status: "generating", progress: 35 });
  const response = await fetchJsonWithCsrf<{ item: LibraryItem | null; items?: LibraryItem[] }>("/api/generate/image", { method: "POST", body: form });
  const item = response.items?.[0] || response.item;
  if (!item) throw new Error("图片生成未返回结果。");
  addResultNode(generatorId, item);
  updateNodeData(generatorId, { status: "done", progress: 100, error: undefined });
}

async function submitVideoGeneration(
  generatorId: string,
  data: CanvasNodeData,
  provider: WorkspacePublicProvider,
  prompt: string,
  references: LibraryItem[],
  addResultNode: (generatorId: string, item: LibraryItem, job?: JobRecord | null) => void,
  updateNodeData: (id: string, patch: Partial<CanvasNodeData>, persist?: boolean) => void,
) {
  const images = references.filter((item) => item.type === "image");
  const videos = references.filter((item) => item.type === "video");
  const options = provider.videoOptions;
  if (images.length > (options?.maxReferenceImages ?? 1)) throw new Error(`当前模型最多支持 ${options?.maxReferenceImages ?? 1} 张参考图。`);
  if (videos.length > (options?.maxReferenceVideos ?? 0)) throw new Error("当前模型不支持这么多参考视频。");
  if (options?.requiredReferenceMedia?.includes("image") && !images.length) throw new Error("当前模型需要参考图。");
  if (options?.requiredReferenceMedia?.includes("video") && !videos.length) throw new Error("当前模型需要参考视频。");
  if (options?.requiredReferenceMedia?.includes("audio")) throw new Error("当前画布暂不支持必填音频素材，请在主工作台使用该模型。");
  if (options?.maxPromptCharacters && prompt.length > options.maxPromptCharacters) {
    throw new Error(`当前模型提示词最多 ${options.maxPromptCharacters} 个字符。`);
  }

  const imageFiles = await Promise.all(images.map(libraryItemFile));
  const videoFiles = await Promise.all(videos.map(libraryItemFile));

  const taskId = canvasId("canvas-video");
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
  imageFiles.forEach((file) => form.append("referenceImages", file));
  videoFiles.forEach((file) => form.append("referenceVideos", file));
  const response = await fetchJsonWithCsrf<{ item: LibraryItem; job: JobRecord | null }>("/api/generate/video", { method: "POST", body: form });
  addResultNode(generatorId, response.item, response.job);
  updateNodeData(generatorId, {
    status: response.job?.status === "done" || response.item.status === "done" ? "done" : response.job?.status === "failed" || response.item.status === "failed" ? "failed" : response.job?.status === "queued" ? "queued" : "generating",
    progress: response.job?.progress || 0,
    jobId: response.job?.id,
    error: response.job?.error || response.item.error || undefined,
  });
}

async function libraryItemFile(item: LibraryItem) {
  const url = item.output?.url;
  if (!url) throw new Error(`素材“${item.title}”暂时没有可用文件。`);
  const response = await fetch(url, { credentials: "same-origin", cache: "no-store" });
  if (!response.ok) throw new Error(`无法读取素材“${item.title}”。`);
  const blob = await response.blob();
  const extension = item.type === "video" ? "mp4" : blob.type.includes("jpeg") ? "jpg" : "png";
  return new File([blob], `${item.id}.${extension}`, { type: blob.type || item.output?.mimeType || (item.type === "video" ? "video/mp4" : "image/png") });
}

function serializeDocument(nodes: CanvasFlowNode[], edges: Edge[], viewport: Viewport): CanvasProjectDocument {
  return {
    nodes: nodes.map((node) => {
      const data = { ...node.data };
      delete data.mediaUrl;
      return {
        id: node.id,
        type: "canvas",
        position: node.position,
        ...(node.width ? { width: node.width } : {}),
        ...(node.height ? { height: node.height } : {}),
        data,
      };
    }),
    edges: edges.map((edge) => ({
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
        width: 340,
        height: 360,
        data: {
          kind: "generator",
          title: "图片生成",
          generationKind: "image",
          providerId: "",
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

function canvasId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
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
