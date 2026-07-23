#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

const collectionRoute = read("src/app/api/canvas/projects/route.ts");
const projectRoute = read("src/app/api/canvas/projects/[id]/route.ts");
const collaborationRoute = read("src/app/api/canvas/projects/[id]/events/route.ts");
const workspace = read("src/components/canvas/canvas-workspace.tsx");
const canvasEdge = read("src/components/canvas/canvas-edge.tsx");
const canvasNode = read("src/components/canvas/canvas-node.tsx");
const canvasCss = read("src/app/canvas/canvas.css");
const assistantPanel = read("src/components/canvas/canvas-assistant-panel.tsx");
const imageEditor = read("src/components/canvas/canvas-image-editor.tsx");
const videoTrimmer = read("src/components/canvas/canvas-video-trimmer.tsx");
const mediaViewer = read("src/components/canvas/canvas-media-viewer.tsx");
const shortcutsPanel = read("src/components/canvas/canvas-shortcuts-panel.tsx");
const libraryRoute = read("src/app/api/library/route.ts");
const jobsRoute = read("src/app/api/jobs/[id]/route.ts");
const libraryMediaRoute = read("src/app/api/library/[id]/media/route.ts");
const filesRoute = read("src/app/api/files/[name]/route.ts");
const audioRoute = read("src/app/api/canvas/audio/route.ts");
const videoTrimRoute = read("src/app/api/canvas/video-trim/route.ts");
const videoTrimService = read("src/lib/server/video-trim.ts");
const workspaceAccess = read("src/lib/server/canvas-workspace-access.ts");
const repository = read("src/lib/server/canvas-projects.ts");
const collaboration = read("src/lib/server/canvas-collaboration.ts");
const merge = read("src/lib/canvas/merge.ts");
const migration = read("db/migrations/017_canvas_projects.sql");

for (const source of [collectionRoute, projectRoute]) {
  assert.match(source, /requireAuthSession/);
}
assert.match(collectionRoute, /requireCsrf/);
assert.match(projectRoute, /requireCsrf/);
assert.match(collaborationRoute, /requireAuthSession/);
assert.match(collaborationRoute, /text\/event-stream/);
assert.match(collaborationRoute, /subscribeCanvasProjectEvents/);
assert.match(collaborationRoute, /X-Accel-Buffering/);
assert.match(jobsRoute, /isInternalCanvasHostname/);
assert.match(jobsRoute, /getInternalCanvasWorkspaceMemberIds/);
assert.match(jobsRoute, /refreshVideoJob\(id, session\.user\.local_user_id, allowedOwnerIds\)/);
assert.match(libraryRoute, /ownerIds\.map\(\(ownerId\) => refreshPendingVideoJobsForOwner\(ownerId\)\)/);
assert.match(workspace, /canvasJobUrl\(node\.data\.jobId!\)/);
assert.match(workspace, /const refreshProviders = useCallback/);
assert.match(workspace, /Promise\.all\(\[refreshLibrary\(\), refreshProviders\(\)\]\)/);
assert.ok(
  collaborationRoute.indexOf("subscribeCanvasProjectEvents(id") < collaborationRoute.indexOf("const latestProject = await getCanvasProject"),
  "collaboration stream must subscribe before re-reading the latest project",
);
assert.match(collaboration, /listen canvas_project_events/);
assert.match(collaboration, /__aohuangCanvasCollaboration/);
assert.match(repository, /CANVAS_PROJECT_CONFLICT/);
assert.match(repository, /pg_notify\('canvas_project_events'/);
assert.match(repository, /type: "deleted", projectId: id, sourceId/);
assert.match(repository, /mergeCanvasWorkspace/);
assert.match(projectRoute, /baseDocument: body\.baseDocument/);
assert.match(merge, /conflictCount/);

for (const endpoint of [
  "/api/providers/enabled",
  "/api/library",
  "/api/quota/precheck",
  "/api/generate/image",
  "/api/generate/video",
  "/api/jobs/",
]) {
  assert.ok(workspace.includes(endpoint), `canvas workspace missing existing API reuse: ${endpoint}`);
}

assert.doesNotMatch(workspace, /apiKey|api_key|authorization\s*:/i);
assert.match(repository, /where id = \$1 and user_id = \$2 and workspace_scope = \$3 and version = \$7/);
assert.match(repository, /workspace_scope/);
assert.match(repository, /workspaceScope === "shared" \? "limit 1"/);
assert.match(repository, /团队画布固定为一个/);
assert.match(repository, /团队画布固定保留/);
assert.match(migration, /user_id uuid not null references app_users\(local_user_id\) on delete cascade/);
assert.match(migration, /document jsonb not null/);
assert.match(migration, /canvas_projects_user_updated_idx/);

const imageSubmission = workspace.slice(
  workspace.indexOf("async function submitImageGeneration"),
  workspace.indexOf("async function submitVideoGeneration"),
);
const videoSubmission = workspace.slice(workspace.indexOf("async function submitVideoGeneration"));
for (const source of [imageSubmission, videoSubmission]) {
  assert.ok(
    source.indexOf("libraryItemFile") < source.indexOf('fetchJsonWithCsrf("/api/quota/precheck"'),
    "canvas must resolve reusable media before reserving quota",
  );
}
assert.match(workspace, /const savePromiseRef = useRef<Promise<boolean> \| null>\(null\)/);
assert.match(workspace, /const pendingSave = savePromiseRef\.current;[\s\S]+await pendingSave[\s\S]+saveNowRef\.current\(force\)/);
assert.match(workspace, /const flowRef = useRef\(flow\)/);
assert.match(workspace, /flowRef\.current\.setViewport/);
assert.match(workspace, /defaultViewport=\{viewport\}/);
assert.doesNotMatch(workspace, /\sfitView\s/);
assert.match(imageSubmission, /planCanvasImageRequests\(Number\(data\.count\), internalCanvas\)/);
assert.match(imageSubmission, /form\.set\("count", String\(requestCount\)\)/);
assert.match(imageSubmission, /estimateImageGenerationTotalQuota\(\{ quality, count: requestCount,/);
assert.match(imageSubmission, /INTERNAL_CANVAS_IMAGE_REQUEST_CONCURRENCY/);
assert.match(imageSubmission, /pendingResultNodeIds\[resultIndex\]/);
assert.match(imageSubmission, /addResultNode\(generatorId, item, null, resultIndex, count, pendingResultNodeIds\[resultIndex\]\)/);
assert.match(workspace, /const imageMode = mediaItems\.length \? "image-to-image" as const : "text-to-image" as const/);
const generatorExecution = workspace.slice(workspace.indexOf("const executeGenerator"), workspace.indexOf("const inputSummary"));
assert.ok(generatorExecution.indexOf("createPendingVideoResultNode(generatorId)") < generatorExecution.indexOf("await submitVideoGeneration("));
assert.match(generatorExecution, /updateNodeData\(pendingVideoResultId, \{ status: "failed"/);
assert.match(workspace, /event\.key\.toLowerCase\(\) === "z" && !event\.shiftKey && !typing/);
assert.match(workspace, /historyPastRef/);
assert.match(workspace, /undoCanvas/);
assert.match(workspace, /redoCanvas/);
assert.match(workspace, /importCanvasFromText/);
assert.match(workspace, /exportCanvas/);
assert.match(workspace, /CanvasNodeInfoPanel/);
assert.match(workspace, /onSaveMetadata/);
assert.match(workspace, /节点关系/);
assert.match(canvasNode, /inputPreviews/);
assert.match(canvasNode, /promptReferences/);
assert.match(canvasNode, /canvas-prompt-reference-menu/);
assert.match(canvasNode, /ArrowDown/);
assert.match(canvasNode, /insertReference/);
assert.match(canvasNode, /pendingPromptSelectionRef/);
assert.match(canvasNode, /useLayoutEffect/);
assert.match(canvasNode, /promptUndoRef/);
assert.match(canvasNode, /restorePromptEdit\(event\.shiftKey \? "redo" : "undo"\)/);
assert.match(canvasNode, /canvas-node__preview-strip/);
assert.match(canvasNode, /CanvasMediaType/);
assert.match(canvasNode, /Music/);
assert.match(canvasCss, /canvas-node-info/);
assert.match(canvasCss, /canvas-node__reference-bindings/);
assert.match(canvasCss, /canvas-node-info__metadata/);
assert.match(canvasCss, /canvas-node__preview-strip/);
assert.match(canvasCss, /canvas-prompt-reference-menu/);
assert.match(canvasCss, /canvas-node__mention-trigger/);
assert.match(canvasCss, /grid-template-rows: minmax\(0, 1fr\) 26px/);
assert.match(canvasCss, /\.canvas-node__prompt-footer \{ position: relative;/);
assert.match(workspace, /selectedNodes/);
assert.match(workspace, /panOnDrag/);
assert.match(workspace, /\s+panOnDrag\s+/);
assert.match(workspace, /selectionOnDrag=\{false\}/);
assert.match(workspace, /selectionKeyCode=\{presentation === "vozeb" \? "Control" : "Shift"\}/);
assert.match(workspace, /selectionMode=\{SelectionMode\.Partial\}/);
assert.match(workspace, /onlyRenderVisibleElements/);
assert.match(workspace, /multiSelectionKeyCode=\{\["Control", "Meta", "Shift"\]\}/);
assert.doesNotMatch(workspace, /panMode|aria-label="框选节点"|aria-label="移动画布"/);
assert.match(workspace, /duplicateSelectedNodes/);
assert.match(workspace, /copySelectedNodes/);
assert.match(workspace, /pasteCopiedNodes/);
assert.match(workspace, /onPaneContextMenu/);
assert.match(workspace, /onNodeContextMenu/);
assert.match(workspace, /onEdgeContextMenu/);
assert.match(workspace, /onReconnect=\{onReconnect\}/);
assert.match(workspace, /reconnectEdge\(oldEdge, connection, current\)/);
assert.match(workspace, /onConnectEnd=\{onConnectEnd\}/);
assert.match(workspace, /document\.elementFromPoint\(event\.clientX, event\.clientY\)/);
assert.match(workspace, /dropTarget\.closest\("\.react-flow__node, \.react-flow__edge, \.react-flow__panel, \.canvas-bottom-dock"\)/);
assert.match(workspace, /kind: "connection"/);
assert.match(workspace, /sourceNodeId: sourceId/);
assert.match(workspace, /引用该节点生成/);
assert.match(workspace, /edgeTypes=\{edgeTypes\}/);
assert.match(workspace, /connectionLineComponent=\{connectionLineComponents\[connectionStyle\]\}/);
assert.match(workspace, /connectionRadius=\{36\}/);
assert.match(workspace, /connectionDragThreshold=\{4\}/);
assert.match(workspace, /decorateCanvasEdge/);
assert.match(canvasEdge, /BaseEdge/);
assert.match(canvasEdge, /getBezierPath/);
assert.match(canvasEdge, /curvature: 0\.5/);
assert.match(canvasEdge, /connectionStatus === "invalid"/);
assert.doesNotMatch(canvasEdge, /EdgeToolbar|props\.data\?\.label/);
assert.doesNotMatch(canvasNode, /图片生成模式|文生图<\/button>|图生图<\/button>/);
assert.match(workspace, /\["midnight", "light"\] as const/);
assert.match(workspace, /\["bezier", "smoothstep", "straight"\] as const/);
assert.match(workspace, /aohuang-canvas-v2-settings/);
assert.match(workspace, /displayEdges/);
assert.match(workspace, /groupSelectedNodes/);
assert.match(workspace, /toggleGroupCollapsed/);
assert.match(workspace, /applyCanvasNodePresentation/);
assert.match(workspace, /hidden: hiddenNodes\.has\(edge\.source\)/);
assert.match(workspace, /function CanvasLayersPanel/);
assert.match(workspace, /updateNodeLayerState/);
assert.match(workspace, /moveNodeLayer/);
assert.match(workspace, /draggable: !node\.data\.locked/);
assert.match(canvasCss, /canvas-layers__actions/);
assert.match(canvasNode, /展开分组/);
assert.match(canvasNode, /折叠分组/);
assert.match(canvasCss, /canvas-node-group\.is-collapsed/);
assert.match(workspace, /dragHandle: canvasNodeDragHandle\(data\.kind\)/);
assert.match(workspace, /dragHandle: "\.canvas-node-group__header"/);
assert.match(canvasCss, /\.canvas-node__header[\s\S]+cursor: grab/);
assert.match(workspace, /ungroupSelectedNodes/);
assert.match(workspace, /parentId: groupId/);
assert.match(workspace, /type: node\.data\.kind === "group" \? "group" : "canvas"/);
assert.match(canvasNode, /CanvasGroupNode/);
assert.match(canvasCss, /canvas-node-group/);
assert.match(canvasCss, /canvas-context-menu/);
assert.match(workspace, /connectSelectedNodes/);
assert.match(workspace, /cleanCanvas/);
assert.match(workspace, /exportCanvasImage/);
assert.match(workspace, /canvas\.toBlob/);
assert.match(workspace, /\.png`/);
assert.match(workspace, /已导入为新画布/);
assert.match(workspace, /\(导入\)/);
assert.match(workspace, /window\.addEventListener\("keydown"/);
assert.match(workspace, /selectAllVisibleNodes/);
assert.match(workspace, /nudgeSelectedNodes/);
assert.match(workspace, /arrangeSelectedNodes/);
assert.match(workspace, /distribute-horizontal/);
assert.match(workspace, /请选择同一分组层级中的节点进行排列/);
assert.match(canvasCss, /canvas-batch-menu__popover/);
assert.match(workspace, /event\.key === "ArrowLeft"/);
assert.match(workspace, /<span>全选节点<\/span>/);
assert.match(workspace, /new EventSource\(canvasProjectEventsUrl/);
assert.match(workspace, /baseDocument: project\.document/);
assert.match(workspace, /mergeCanvasWorkspace\(submitted, snapshotWorkspace\(\), response\.project\)/);
assert.doesNotMatch(workspace, /BroadcastChannel\("aohuang-internal-canvas"\)/);
assert.doesNotMatch(workspace, /}, 2_500\)/);
assert.match(workspace, /scope=\$\{canvasScope\(\)\}/);
assert.match(workspace, /form\.set\("canvasScope", canvasScope\(\)\)/);
assert.match(workspace, /writeSharedViewport\(accountName, activeProjectRef\.current\.id, nextViewport\)/);
assert.match(workspace, /document\.viewport = activeProjectRef\.current\.document\.viewport/);
assert.match(libraryRoute, /filterCanvasLibraryItems\(await readLibraryMetadataForOwners\(ownerIds\), "shared"\)/);
assert.match(libraryRoute, /filterCanvasLibraryItems\(await readLibraryMetadataForOwner\(session\.user\.local_user_id\), "personal"\)/);
assert.match(libraryMediaRoute, /resolveLibraryMediaForOwners[\s\S]+"shared"/);
assert.match(filesRoute, /resolveStoredFileForOwners[\s\S]+"shared"/);
assert.match(canvasNode, /canvas-node__media-metadata/);
assert.match(canvasNode, /等待 \{metadata\.wait\}/);
assert.match(workspace, /removeUnavailableLibraryItemsFromCanvasDocument/);
assert.match(workspace, /已自动清理.*过期或已删除的素材节点/);
assert.match(workspace, /setInterval\(refreshWhenVisible, 60_000\)/);
assert.match(workspace, /visibilitychange/);
assert.match(workspaceAccess, /scope.*personal/);
assert.match(assistantPanel, /\/api\/canvas\/assistant/);
assert.match(imageEditor, /destination-out/);
assert.match(imageEditor, /cropToAspect/);
assert.match(imageEditor, /futureRef/);
assert.match(imageEditor, /updateMaskPreview/);
assert.match(imageEditor, /fitViewport/);
assert.match(imageEditor, /canvas-image-editor__error/);
assert.match(imageEditor, /setLoadAttempt/);
assert.match(videoTrimmer, /\/api\/canvas\/video-trim/);
assert.match(videoTrimmer, /MAX_CLIP_SECONDS = 15/);
assert.match(videoTrimmer, /onLoadedMetadata/);
assert.match(videoTrimmer, /预览片段/);
assert.doesNotMatch(videoTrimmer, /MediaRecorder|getDisplayMedia|getUserMedia/);
assert.match(videoTrimRoute, /requireCsrf/);
assert.match(videoTrimRoute, /requireAuthSession/);
assert.match(videoTrimRoute, /isInternalCanvasHostname/);
assert.match(videoTrimRoute, /getInternalCanvasWorkspaceMemberIds/);
assert.match(videoTrimRoute, /scope === "shared"/);
assert.match(videoTrimRoute, /mode: "video-trim"/);
assert.match(videoTrimRoute, /sourceLibraryItemId/);
assert.match(videoTrimService, /MAX_VIDEO_TRIM_SECONDS = 15/);
assert.match(videoTrimService, /spawn\("ffmpeg", args, \{ shell: false/);
assert.match(videoTrimService, /spawn\("ffprobe", args, \{ shell: false/);
assert.match(videoTrimService, /"-c:v", "libx264"/);
assert.doesNotMatch(videoTrimService, /exec\(|shell: true/);
assert.match(workspace, /<CanvasVideoTrimmer/);
assert.match(workspace, /onTrim=\{\(item\) => setTrimmingLibraryItemId\(item\.id\)\}/);
assert.match(canvasNode, /actions\.trimVideo\(id\)/);
assert.match(mediaViewer, /aria-label="图片放大预览"/);
assert.match(mediaViewer, /setZoom/);
assert.match(canvasNode, /groupVideoProviders/);
assert.match(canvasNode, /<optgroup/);
assert.match(canvasNode, /providerOptionLabel/);
assert.match(canvasNode, /providerParameterSummary/);
assert.match(canvasCss, /canvas-node__model-summary/);
assert.match(canvasCss, /\.canvas-node__handle\s*\{[\s\S]+width: 32px !important;[\s\S]+height: 32px !important;/);
assert.match(canvasCss, /\.canvas-node__handle::after/);
assert.match(canvasCss, /\.canvas-node__handle\.connectingfrom::after/);
assert.doesNotMatch(canvasCss, /\.canvas-node__handle\.connectionindicator::after/);
assert.match(canvasCss, /@media \(pointer: coarse\)[\s\S]+\.canvas-stage \.canvas-node__handle \{ width: 40px !important; height: 40px !important; \}/);
assert.doesNotMatch(workspace, /<CanvasSelectionToolbar/);
assert.match(canvasNode, /Seedance 2\.0 新/);
assert.match(canvasNode, /previewMedia\(id\)/);
assert.match(workspace, /createPendingImageResultNodes/);
assert.match(workspace, /updatePendingImageResults/);
assert.match(workspace, /图片生成中/);
assert.ok(workspace.indexOf("createPendingImageResultNodes(generatorId") < workspace.indexOf("await submitImageGeneration(generatorId"), "pending image nodes must appear before image submission");
assert.match(workspace, /canvasLibraryMediaUrl\(editingNode\.data\.libraryItemId\)/);
assert.match(canvasNode, /loading="lazy" decoding="async"/);
assert.match(canvasNode, /naturalWidth/);
assert.match(canvasNode, /naturalHeight/);
assert.match(canvasNode, /videoWidth/);
assert.match(canvasNode, /videoHeight/);
assert.match(canvasNode, /registerMediaDimensions/);
assert.match(canvasNode, /keepAspectRatio/);
assert.match(workspace, /canvasMediaNodeSize/);
assert.match(workspace, /intrinsicWidth: undefined/);
assert.match(workspace, /const pageSize = 20/);
assert.match(workspace, /canvas-library__pagination/);
assert.match(workspace, /const isPrompt = node\.data\.kind === "prompt"/);
assert.match(workspace, /const isImage = node\.data\.kind === "media"/);
assert.doesNotMatch(workspace, /<span>存素材<\/span>/);
assert.match(shortcutsPanel, /框选多个节点.*Ctrl.*左键拖动空白处/);
assert.match(shortcutsPanel, /移动画布.*鼠标左键.*拖动空白处/);
assert.match(shortcutsPanel, /从节点上移动画布.*Space.*拖动/);
assert.match(workspace, /addLibraryNodes/);
assert.match(workspace, /addStoryboardNodes/);
assert.match(workspace, /annotate_references/);
assert.match(workspace, /referenceAudios/);
assert.match(workspace, /onAddAudio/);
assert.match(workspace, /replaceSelectedMaterial/);
assert.match(workspace, /跳过.*重复项/);
assert.match(canvasCss, /canvas-library__batch/);
assert.match(workspace, /canvas-library-scrim/);
assert.match(canvasCss, /@media \(pointer: coarse\)/);
assert.match(canvasCss, /safe-area-inset-bottom/);
assert.match(workspace, /touchMultiSelect/);
assert.match(workspace, /elementsSelectable=\{!touchMultiSelect\}/);
assert.match(workspace, /aria-live="polite"/);
assert.match(workspace, /aria-label="作品素材库"/);
assert.match(imageEditor, /aria-label="蒙版画笔大小"/);
assert.match(canvasCss, /:focus-visible/);
assert.match(libraryRoute, /export async function PATCH/);
assert.match(libraryRoute, /requireCsrf/);
assert.match(audioRoute, /isInternalCanvasHostname/);
assert.match(audioRoute, /requireCsrf/);
assert.match(audioRoute, /uploadedMediaFromForm/);
assert.match(audioRoute, /storeProviderReference/);
assert.match(canvasCss, /\.canvas-node__body--generator[^}]+overflow: visible/s);
assert.match(canvasCss, /\.react-flow__node-canvas:has\(\.canvas-node--generator\)/);
assert.match(canvasCss, /canvas-image-editor/);
assert.match(canvasCss, /react-flow__selection/);
assert.match(canvasCss, /data-canvas-theme="light"/);

console.log(JSON.stringify({
  ok: true,
  authenticatedRoutes: 4,
  reusedGenerationEndpoints: 6,
  generationSubmitted: false,
  databaseWritten: false,
}));
