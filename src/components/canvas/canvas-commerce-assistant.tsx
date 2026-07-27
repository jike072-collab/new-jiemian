"use client";

import {
  ArrowDown,
  ArrowUp,
  Check,
  ImagePlus,
  LoaderCircle,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { CanvasAssistantNodeContext } from "@/components/canvas/canvas-assistant-panel";
import type { EnabledProviders, WorkspacePublicProvider } from "@/components/studio/types";
import { fetchJsonWithCsrf } from "@/lib/client/api";
import {
  archiveCommercePromptPlans,
  cloneCommercePlanForReuse,
  commerceDirectionLabel,
  commerceDirectionRequiresHuman,
  newCommerceProductDraft,
  normalizeCommercePlanGeneration,
  normalizeCommercePublishingCopy,
  normalizeCommerceProductAnalysis,
  resetCommerceDraftForImages,
} from "@/lib/canvas/commerce-assistant";
import type {
  CanvasCommerceAssistantState,
  CanvasCommerceDirection,
  CanvasCommercePlan,
  CanvasCommerceProductDraft,
} from "@/lib/canvas/types";
import { isSeedance20VideoModel } from "@/lib/seedance-model-display";

export type CanvasCommerceLibraryImage = {
  id: string;
  title: string;
};

export type CanvasCommerceCreateResult = {
  planId: string;
  groupId?: string;
  promptNodeId: string;
  generatorNodeId: string;
};

export function CanvasCommerceAssistant({
  projectId,
  canvasTitle,
  scope,
  nodes,
  providers,
  state,
  libraryImages,
  onStateChange,
  onUploadImages,
  onAddLibraryImage,
  onCreatePlans,
}: {
  projectId: string;
  canvasTitle: string;
  scope: "personal" | "shared";
  nodes: CanvasAssistantNodeContext[];
  providers: EnabledProviders;
  state?: CanvasCommerceAssistantState;
  libraryImages: CanvasCommerceLibraryImage[];
  onStateChange: (state: CanvasCommerceAssistantState) => void;
  onUploadImages: (files: File[]) => Promise<string[]>;
  onAddLibraryImage: (libraryItemId: string) => string | undefined;
  onCreatePlans: (draft: CanvasCommerceProductDraft, planIds: string[]) => CanvasCommerceCreateResult[];
}) {
  const storageKey = `aohuang-canvas-commerce-product:${projectId}`;
  const [initialProduct] = useState(newCommerceProductDraft);
  const normalizedState = useMemo(() => state && Object.keys(state.products).length
    ? state
    : { products: { [initialProduct.id]: initialProduct } }, [initialProduct, state]);
  const [activeProductId] = useState(() => {
    const stored = window.localStorage.getItem(storageKey) || "";
    return normalizedState.products[stored] ? stored : Object.keys(normalizedState.products)[0] || "";
  });
  const [busy, setBusy] = useState<"" | "upload" | "product" | "plans" | "create">("");
  const [libraryImageId, setLibraryImageId] = useState("");
  const [promptLibraryId, setPromptLibraryId] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const products = useMemo(() => Object.values(normalizedState.products).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)), [normalizedState.products]);
  const draft = normalizedState.products[activeProductId] || products[0];
  const selectedCanvasImages = useMemo(() => nodes.filter((node) => node.selected && node.kind === "media" && node.mediaType === "image"), [nodes]);
  const compatibleProviders = useMemo(() => providers.video.filter(isCommerceProvider), [providers.video]);

  useEffect(() => {
    if (state && Object.keys(state.products).length) return;
    onStateChange(normalizedState);
  }, [normalizedState, onStateChange, state]);

  useEffect(() => {
    if (!activeProductId) return;
    window.localStorage.setItem(storageKey, activeProductId);
  }, [activeProductId, storageKey]);

  if (!draft) return <div className="canvas-assistant__commerce-loading"><LoaderCircle className="is-spinning" />正在建立产品资料</div>;

  const requestedActivePlan = draft.plans.find((plan) => plan.id === draft.activePlanId);
  const activePlan = requestedActivePlan?.createdGeneratorNodeId && (draft.phase === "setup" || draft.phase === "error")
    ? [...draft.plans].reverse().find((plan) => !plan.createdGeneratorNodeId)
    : requestedActivePlan
    || [...draft.plans].reverse().find((plan) => !plan.createdGeneratorNodeId);
  const activeProviderOptions = activePlan ? compatibleProviders.filter((provider) => providerSupportsDirection(provider, activePlan.direction)) : [];
  const activeProvider = activePlan ? providerForPlan(activePlan, draft.sharedProviderId, compatibleProviders) : undefined;
  const canCreate = Boolean(activePlan && !activePlan.createdGeneratorNodeId && activeProvider);
  const unusedPromptPlans = [
    ...draft.plans.filter((plan) => !plan.createdGeneratorNodeId).map((plan) => ({ id: `current:${plan.id}`, plan, current: true })),
    ...(draft.promptLibrary || []).filter((plan) => !draft.plans.some((current) => current.id === plan.id)).map((plan) => ({ id: `library:${plan.id}`, plan, current: false })),
  ];
  const visibleError = draft.error === "助手暂时不可用，请稍后重试。" && activePlan?.createdGeneratorNodeId
    ? undefined
    : draft.error;

  function commit(nextDraft: CanvasCommerceProductDraft) {
    onStateChange({ products: { ...normalizedState.products, [nextDraft.id]: { ...nextDraft, updatedAt: new Date().toISOString() } } });
  }

  function patchDraft(patch: Partial<CanvasCommerceProductDraft>) {
    commit({ ...draft, ...patch });
  }

  function patchPlan(planId: string, patch: Partial<CanvasCommercePlan>) {
    patchDraft({ plans: draft.plans.map((plan) => plan.id === planId ? { ...plan, ...patch } : plan) });
  }

  function replaceProductImages(images: CanvasCommerceProductDraft["images"]) {
    commit(resetCommerceDraftForImages(draft, images));
  }

  function reusePromptPlan() {
    const selected = unusedPromptPlans.find((item) => item.id === promptLibraryId);
    if (!selected || busy) return;
    if (selected.current) {
      patchDraft({ activePlanId: selected.plan.id, phase: "plans-ready", error: undefined });
      return;
    }
    const plan = cloneCommercePlanForReuse(selected.plan, generatedPlanId(draft.plans.length));
    patchDraft({
      plans: [...draft.plans, plan],
      promptLibrary: (draft.promptLibrary || []).filter((item) => item.id !== selected.plan.id),
      activePlanId: plan.id,
      phase: "plans-ready",
      error: undefined,
    });
    setPromptLibraryId("");
  }

  function addProductImages(candidates: CanvasAssistantNodeContext[]) {
    const currentKeys = new Set(draft.images.flatMap((image) => [image.nodeId, image.libraryItemId].filter(Boolean)));
    const additions = candidates.flatMap((node) => {
      if (currentKeys.has(node.id) || (node.libraryItemId && currentKeys.has(node.libraryItemId))) return [];
      currentKeys.add(node.id);
      if (node.libraryItemId) currentKeys.add(node.libraryItemId);
      return [{ nodeId: node.id, libraryItemId: node.libraryItemId, title: node.title }];
    });
    if (!additions.length) return;
    replaceProductImages([...draft.images, ...additions].slice(0, 4));
  }

  async function upload(files: File[]) {
    const images = files.filter((file) => file.type.startsWith("image/")).slice(0, Math.max(0, 4 - draft.images.length));
    if (!images.length) return;
    setBusy("upload");
    try {
      const nodeIds = await onUploadImages(images);
      const additions = nodeIds.map((nodeId, index) => {
        const node = nodes.find((candidate) => candidate.id === nodeId);
        return { nodeId, libraryItemId: node?.libraryItemId, title: node?.title || images[index]?.name || "产品图片" };
      });
      const existing = new Set(draft.images.flatMap((image) => [image.nodeId, image.libraryItemId].filter(Boolean)));
      const uniqueAdditions = additions.filter((image) => !existing.has(image.nodeId) && (!image.libraryItemId || !existing.has(image.libraryItemId)));
      if (uniqueAdditions.length) replaceProductImages([...draft.images, ...uniqueAdditions].slice(0, 4));
    } catch (error) {
      patchDraft({ phase: "error", error: error instanceof Error ? error.message : "产品图片上传失败。" });
    } finally {
      setBusy("");
    }
  }

  function addLibraryImage() {
    const item = libraryImages.find((candidate) => candidate.id === libraryImageId);
    if (!item) return;
    const nodeId = onAddLibraryImage(item.id);
    if (!nodeId) return;
    addProductImages([{ id: nodeId, kind: "media", title: item.title, mediaType: "image", libraryItemId: item.id }]);
    setLibraryImageId("");
  }

  async function analyzeProduct() {
    if (!draft.images.length || busy) return;
    setBusy("product");
    patchDraft({ phase: "planning", error: undefined });
    let workingDraft = draft;
    try {
      const selectedIds = draft.images.map((image) => image.nodeId);
      const response = await fetchJsonWithCsrf<unknown>("/api/canvas/assistant", {
        method: "POST",
        body: JSON.stringify({
          workflow: "commerce-product-analysis",
          message: "分析明确选择的鞋类产品图片，建立马来西亚带货产品资料。",
          productDraftId: draft.id,
          canvasTitle,
          scope,
          selectedNodeIds: selectedIds,
          nodes: nodes.map((node) => ({ ...node, selected: selectedIds.includes(node.id) })),
        }),
      });
      const analysis = normalizeCommerceProductAnalysis(response);
      if (!analysis.sameProduct) {
        patchDraft({ phase: "error", error: analysis.conflictMessage || "所选图片疑似不是同一款鞋，请重新选择。" });
        return;
      }
      const selectedDirections = analysis.recommendedDirections.slice(0, 1);
      const direction = selectedDirections[0];
      if (!direction) throw new Error("产品分析没有返回可用的视频方向。");
      const createdPlans = draft.plans.filter((plan) => plan.createdGeneratorNodeId);
      const unusedPlans = draft.plans.filter((plan) => !plan.createdGeneratorNodeId);
      workingDraft = {
        ...draft,
        productName: draft.productName || analysis.suggestedName,
        sellingPoints: analysis.sellingPoints,
        visibleFacts: analysis.visibleFacts,
        recommendedDirections: analysis.recommendedDirections,
        selectedDirections,
        directionSellingPoints: { [direction]: analysis.sellingPoints[0] },
        plans: createdPlans,
        promptLibrary: archiveCommercePromptPlans(draft.promptLibrary, unusedPlans),
        phase: "planning",
        error: undefined,
      };
      commit(workingDraft);
      const generated = await requestPlanGeneration(workingDraft, selectedDirections);
      workingDraft = { ...workingDraft, ...mergeGeneratedPlans(workingDraft, selectedDirections, generated.plans), phase: "plans-ready", error: undefined };
      commit(workingDraft);
    } catch (error) {
      commit({ ...workingDraft, phase: "error", error: error instanceof Error ? error.message : "产品分析或提示词生成失败。" });
    } finally {
      setBusy("");
    }
  }

  async function requestPlanGeneration(
    sourceDraft: CanvasCommerceProductDraft,
    targetDirections: CanvasCommerceDirection[],
    refinement?: { plan: CanvasCommercePlan; request: string },
  ) {
    const selectedIds = sourceDraft.images.map((image) => image.nodeId);
    const usedHookPatterns = sourceDraft.plans.flatMap((plan) => plan.id !== refinement?.plan.id && plan.hook ? [{
        direction: plan.direction,
        visualPatternId: plan.hook.visualPatternId,
        copyPatternId: plan.hook.copyPatternId,
        scenePatternId: plan.production?.scenePatternId,
        shotPatternId: plan.production?.shotPatternId,
        performancePatternId: plan.production?.performancePatternId,
      }] : []);
    const response = await fetchJsonWithCsrf<unknown>("/api/canvas/assistant", {
      method: "POST",
      body: JSON.stringify({
        workflow: "commerce-plan-generation",
        message: "自动选择最适合当前产品的反差、冲突、意外、悬念或动作钩子，生成一段完整的15秒马来西亚 TikTok Shop 鞋类带货提示词。",
        productDraftId: sourceDraft.id,
        productName: sourceDraft.productName,
        sellingPoints: sourceDraft.sellingPoints,
        visibleFacts: sourceDraft.visibleFacts,
        selectedDirections: targetDirections,
        directionSellingPoints: sourceDraft.directionSellingPoints,
        usedHookPatterns,
        extraRequirements: refinement ? undefined : sourceDraft.extraRequirements,
        basePlanId: refinement?.plan.id,
        basePrompt: refinement?.plan.prompt,
        refinementRequest: refinement?.request,
        canvasTitle,
        scope,
        selectedNodeIds: selectedIds,
        nodes: nodes.map((node) => ({ ...node, selected: selectedIds.includes(node.id) })),
      }),
    });
    return normalizeCommercePlanGeneration(response, targetDirections, {
      visibleFacts: sourceDraft.visibleFacts,
      imageCount: sourceDraft.images.length,
      usedHookPatterns,
    });
  }

  function mergeGeneratedPlans(sourceDraft: CanvasCommerceProductDraft, targetDirections: CanvasCommerceDirection[], plans: CanvasCommercePlan[]) {
    const replacedDirections = new Set(targetDirections);
    const previousByDirection = new Map(sourceDraft.plans
      .filter((plan) => !plan.createdGeneratorNodeId && replacedDirections.has(plan.direction))
      .map((plan) => [plan.direction, plan]));
    const archivedPlans = sourceDraft.plans.filter((plan) => !plan.createdGeneratorNodeId && replacedDirections.has(plan.direction));
    const untouchedPlans = sourceDraft.plans.filter((plan) => plan.createdGeneratorNodeId || !replacedDirections.has(plan.direction));
    const generatedPlans = plans.map((plan, index) => {
      const previous = previousByDirection.get(plan.direction);
      const previousProvider = previous?.providerId && compatibleProviders.some((provider) => provider.id === previous.providerId && providerSupportsDirection(provider, plan.direction))
        ? previous.providerId
        : undefined;
      const sharedProvider = sourceDraft.sharedProviderId && compatibleProviders.some((provider) => provider.id === sourceDraft.sharedProviderId && providerSupportsDirection(provider, plan.direction))
        ? sourceDraft.sharedProviderId
        : undefined;
      const providerId = previousProvider || sharedProvider || compatibleProviders.find((provider) => providerSupportsDirection(provider, plan.direction))?.id;
      return { ...plan, id: generatedPlanId(index), providerId, selected: true };
    });
    return {
      plans: [...untouchedPlans, ...generatedPlans],
      promptLibrary: archiveCommercePromptPlans(sourceDraft.promptLibrary, archivedPlans),
      activePlanId: generatedPlans.at(-1)?.id,
    };
  }

  async function generatePlans(targetDirections = draft.selectedDirections.slice(0, 1)) {
    if (!targetDirections.length || draft.sellingPoints.length < 4 || busy) return;
    setBusy("plans");
    patchDraft({ phase: "planning", error: undefined });
    try {
      const generated = await requestPlanGeneration(draft, targetDirections);
      patchDraft({ ...mergeGeneratedPlans(draft, targetDirections, generated.plans), phase: "plans-ready", error: undefined });
    } catch (error) {
      patchDraft({ phase: "error", error: error instanceof Error ? error.message : "提示词方案生成失败。" });
    } finally {
      setBusy("");
    }
  }

  async function refinePlan() {
    const request = draft.extraRequirements.trim();
    if (!activePlan || activePlan.createdGeneratorNodeId || !request || busy) return;
    setBusy("plans");
    patchDraft({ phase: "planning", error: undefined });
    try {
      const generated = await requestPlanGeneration(draft, [activePlan.direction], { plan: activePlan, request });
      const refined = generated.plans[0];
      if (!refined) throw new Error("助手没有返回优化后的提示词。");
      patchDraft({
        plans: draft.plans.map((plan) => plan.id === activePlan.id ? {
          ...refined,
          id: activePlan.id,
          providerId: activePlan.providerId,
          selected: true,
        } : plan),
        promptLibrary: archiveCommercePromptPlans(draft.promptLibrary, [cloneCommercePlanForReuse(activePlan, `library-${activePlan.id}-${Date.now()}`)]),
        activePlanId: activePlan.id,
        extraRequirements: "",
        phase: "plans-ready",
        error: undefined,
      });
    } catch (error) {
      patchDraft({ phase: "error", error: error instanceof Error ? error.message : "提示词优化失败。" });
    } finally {
      setBusy("");
    }
  }

  function createPlans() {
    if (!canCreate || !activePlan || !activeProvider || busy) return;
    setBusy("create");
    try {
      const publishingCopy = normalizeCommercePublishingCopy(activePlan.publishingCopy);
      if (!publishingCopy) throw new Error("提示词的发布文案不完整，请重新分析。");
      const preparedPlan = { ...activePlan, providerId: activeProvider.id, publishingCopy };
      const prepared = { ...draft, plans: draft.plans.map((plan) => plan.id === activePlan.id ? preparedPlan : plan) };
      const created = onCreatePlans(prepared, [activePlan.id])[0];
      if (!created) throw new Error("没有创建新的画布节点。");
      patchDraft({
        plans: prepared.plans.map((plan) => plan.id === activePlan.id ? {
            ...plan,
            selected: false,
            ...(created.groupId ? { createdGroupId: created.groupId } : {}),
            createdPromptNodeId: created.promptNodeId,
            createdGeneratorNodeId: created.generatorNodeId,
          } : plan),
        activePlanId: activePlan.id,
        phase: "plans-ready",
        error: undefined,
      });
    } catch (error) {
      patchDraft({ phase: "error", error: error instanceof Error ? error.message : "创建画布节点失败。" });
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="canvas-assistant__commerce">
      <section className="canvas-assistant__workflow-section" aria-label="产品图片">
        <header><span>01</span><div><strong>产品图片</strong><small>1–4 张同款鞋</small></div><div className="canvas-assistant__prompt-library"><select value={promptLibraryId} onChange={(event) => setPromptLibraryId(event.target.value)} aria-label="未使用提示词素材库"><option value="">未使用提示词（{unusedPromptPlans.length}）</option>{unusedPromptPlans.map((item) => <option key={item.id} value={item.id}>{item.plan.title || item.plan.hook?.title || "15秒提示词"}</option>)}</select><button type="button" disabled={!promptLibraryId || Boolean(busy)} onClick={reusePromptPlan}>调用</button></div></header>
        <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(event) => { void upload(Array.from(event.target.files || [])); event.currentTarget.value = ""; }} />
        <div className="canvas-assistant__image-actions">
          <button type="button" onClick={() => fileInputRef.current?.click()} disabled={busy === "upload" || draft.images.length >= 4}><ImagePlus />上传图片</button>
          <button type="button" onClick={() => addProductImages(selectedCanvasImages)} disabled={!selectedCanvasImages.length || draft.images.length >= 4}><Check />添加画布已选</button>
        </div>
        <div className="canvas-assistant__library-picker">
          <select value={libraryImageId} onChange={(event) => setLibraryImageId(event.target.value)}><option value="">从素材库选择图片</option>{libraryImages.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select>
          <button type="button" onClick={addLibraryImage} disabled={!libraryImageId || draft.images.length >= 4} aria-label="添加素材库图片" title="添加素材库图片"><Plus /></button>
        </div>
        <div className="canvas-assistant__product-images">
          {draft.images.length ? draft.images.map((image, index) => <div key={`${image.nodeId}-${index}`}>
            <span>{index === 0 ? "主图" : `角度 ${index + 1}`}</span><strong>{nodes.find((node) => node.id === image.nodeId)?.title || image.title}</strong>
            <div>
              <button type="button" disabled={index === 0} onClick={() => replaceProductImages(moveItem(draft.images, index, index - 1))} aria-label="图片上移" title="图片上移"><ArrowUp /></button>
              <button type="button" disabled={index === draft.images.length - 1} onClick={() => replaceProductImages(moveItem(draft.images, index, index + 1))} aria-label="图片下移" title="图片下移"><ArrowDown /></button>
              <button type="button" onClick={() => replaceProductImages(draft.images.filter((_, itemIndex) => itemIndex !== index))} aria-label="移除图片" title="移除图片"><Trash2 /></button>
            </div>
          </div>) : <p>还没有产品图片</p>}
        </div>
        <button type="button" className="canvas-assistant__primary-action" disabled={!draft.images.length || Boolean(busy)} onClick={() => { void analyzeProduct(); }}>{busy === "product" ? <><LoaderCircle className="is-spinning" />分析并生成中</> : <><Sparkles />生成15秒提示词</>}</button>
      </section>

      {activePlan ? <section className="canvas-assistant__workflow-section" aria-label="15秒提示词结果">
        <header><span>02</span><div><strong>15秒提示词</strong><small>{commerceDirectionLabel(activePlan.direction)}</small></div></header>
        <div className="canvas-assistant__plan-list"><article className={activePlan.createdGeneratorNodeId ? "is-created" : undefined}>
            <header><span className="canvas-assistant__created-plan-label">{activePlan.createdGeneratorNodeId ? <Check /> : <Sparkles />}{activePlan.createdGeneratorNodeId ? "已创建方案" : "当前方案"}</span><div><button type="button" disabled={Boolean(busy)} onClick={() => { void generatePlans([activePlan.direction]); }}><Sparkles />重新生成一段</button></div></header>
            <label><span>视频模型</span><select value={activePlan.providerId || activeProvider?.id || ""} disabled={Boolean(activePlan.createdGeneratorNodeId)} onChange={(event) => patchPlan(activePlan.id, { providerId: event.target.value || undefined })}><option value="">没有兼容模型</option>{activeProviderOptions.map((item) => <option key={item.id} value={item.id}>{providerLabel(item)}</option>)}</select></label>
            {activePlan.hook ? <div className="canvas-assistant__plan-hook">
              <div><strong>{activePlan.hook.title}</strong><span>{activePlan.hook.reason}</span></div>
              <dl>
                <div><dt>开头口播</dt><dd lang="ms">{activePlan.hook.hookLine}</dd></div>
                <div><dt>屏幕短字</dt><dd lang="ms">{activePlan.hook.onScreenText}</dd></div>
                <div><dt>首帧</dt><dd>{activePlan.hook.scene} · {activePlan.hook.visualBeat}</dd></div>
              </dl>
            </div> : null}
            {activePlan.production && activePlan.shots ? <details className="canvas-assistant__shot-plan">
              <summary><span>4 镜头分镜脚本</span><small>{activePlan.production.energy === "dynamic" ? "动感" : activePlan.production.energy === "balanced" ? "均衡" : "舒缓"} · {activePlan.production.emotionArc}</small></summary>
              <div className="canvas-assistant__production-note"><span>真实感</span><p>{activePlan.production.realismNotes}</p></div>
              <ol>{activePlan.shots.map((shot) => <li key={shot.timeRange}>
                <header><strong>{shot.timeRange}</strong><span>{shot.shotSize}</span></header>
                <p><b>动作</b>{shot.action}</p>
                <p><b>表演</b>{shot.performance}</p>
                <p><b>产品</b>{shot.productState}</p>
                <p><b>运镜</b>{shot.camera}</p>
                <p><b>台词</b><span lang="ms">{shot.dialogue}</span></p>
                <p><b>字幕</b><span lang="ms">{shot.onScreenText || "无"}</span></p>
                <p><b>声音</b>{shot.sound}</p>
                <p><b>转场</b>{shot.transition}</p>
              </li>)}</ol>
            </details> : null}
            <textarea value={activePlan.prompt} disabled={Boolean(activePlan.createdGeneratorNodeId)} onChange={(event) => patchPlan(activePlan.id, { prompt: event.target.value })} aria-label="可编辑15秒提示词" />
            {!activePlan.createdGeneratorNodeId ? <div className="canvas-assistant__refine">
              <textarea value={draft.extraRequirements} maxLength={1_200} onChange={(event) => patchDraft({ extraRequirements: event.target.value })} placeholder="例如：只加强前两秒冲突，口播更像马来西亚本地人" aria-label="提示词优化要求" />
              <button type="button" disabled={!draft.extraRequirements.trim() || Boolean(busy)} onClick={() => { void refinePlan(); }}>{busy === "plans" ? <LoaderCircle className="is-spinning" /> : <Sparkles />}按要求优化</button>
            </div> : null}
            {activeProvider && (activeProvider.videoOptions?.maxReferenceImages || 0) < draft.images.length ? <p>该模型接收 {activeProvider.videoOptions?.maxReferenceImages || 0} 张图，将按当前顺序连接前 {activeProvider.videoOptions?.maxReferenceImages || 0} 张，其余不连接。</p> : null}
          </article></div>
        {!activePlan.createdGeneratorNodeId ? <button type="button" className="canvas-assistant__primary-action" disabled={!canCreate || Boolean(busy)} onClick={createPlans}>{busy === "create" ? <LoaderCircle className="is-spinning" /> : <Check />}创建提示词和视频节点</button> : null}
      </section> : null}

      {visibleError ? <p className="canvas-assistant__workflow-error" role="alert">{visibleError}</p> : null}
      <small className="canvas-assistant__scope">只创建产品分组、提示词和视频节点，不会自动提交视频生成。</small>
    </div>
  );
}

function isCommerceProvider(provider: WorkspacePublicProvider) {
  const options = provider.videoOptions;
  if (!provider.enabled || !isSeedance20VideoModel(provider.model) || !options) return false;
  if (!provider.id.startsWith("video-main::model::") && !provider.id.startsWith("video-seedance-new::model::")) return false;
  if (!options.durations?.includes(15) || !options.ratios?.includes("9:16") || (options.maxReferenceImages || 0) < 1) return false;
  const resolutions = options.resolutions?.length ? options.resolutions : [options.resolution || "720p"];
  return resolutions.some((resolution) => resolutionNumber(resolution) >= 720);
}

function providerSupportsDirection(provider: WorkspacePublicProvider, direction: CanvasCommerceDirection) {
  return !commerceDirectionRequiresHuman(direction) || provider.videoOptions?.humanReferencePolicy === "allowed";
}

function providerForPlan(plan: CanvasCommercePlan, sharedProviderId: string | undefined, providers: WorkspacePublicProvider[]) {
  const id = plan.providerId || sharedProviderId;
  const provider = providers.find((item) => item.id === id);
  return provider && providerSupportsDirection(provider, plan.direction) ? provider : undefined;
}

function providerLabel(provider: WorkspacePublicProvider) {
  const options = provider.videoOptions;
  const human = options?.humanReferencePolicy === "allowed" ? " · 过真人" : options?.humanReferencePolicy === "blocked" ? " · 卡真人" : "";
  const capacity = options?.maxReferenceImages ? ` · ${options.maxReferenceImages}图` : "";
  return `${provider.displayName}${capacity}${human}`;
}

function resolutionNumber(value: string) {
  if (value.toLowerCase() === "4k") return 2160;
  return Number(value.match(/\d+/)?.[0] || 0);
}

function moveItem<T>(items: T[], from: number, to: number) {
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function generatedPlanId(index: number) {
  return `plan-${Date.now()}-${index}`;
}
