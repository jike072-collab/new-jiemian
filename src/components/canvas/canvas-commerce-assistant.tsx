"use client";

import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  CopyPlus,
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
  commerceDirectionLabel,
  commerceDirectionOptions,
  commerceDirectionRequiresHuman,
  cloneCommercePlanForReuse,
  newCommerceProductDraft,
  normalizeCommercePlanGeneration,
  normalizeCommercePublishingCopy,
  normalizeCommerceProductAnalysis,
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
  groupId: string;
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
  const [activeProductId, setActiveProductId] = useState(() => {
    const stored = window.localStorage.getItem(storageKey) || "";
    return normalizedState.products[stored] ? stored : Object.keys(normalizedState.products)[0] || "";
  });
  const [busy, setBusy] = useState<"" | "upload" | "product" | "plans" | "create">("");
  const [libraryImageId, setLibraryImageId] = useState("");
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

  const planProviders = Object.fromEntries(draft.plans.map((plan) => [plan.id, providerForPlan(plan, draft.sharedProviderId, compatibleProviders)]));
  const sharedOptions = compatibleProviders.filter((provider) => draft.selectedDirections.every((direction) => providerSupportsDirection(provider, direction)));
  const createCandidates = draft.plans.filter((plan) => plan.selected && !plan.createdGeneratorNodeId);
  const createdDirections = new Set(draft.plans.filter((plan) => plan.createdGeneratorNodeId).map((plan) => plan.direction));
  const uncreatedDirections = draft.selectedDirections.filter((direction) => !createdDirections.has(direction));
  const canCreate = createCandidates.length > 0 && createCandidates.every((plan) => Boolean(planProviders[plan.id]));

  function commit(nextDraft: CanvasCommerceProductDraft) {
    onStateChange({ products: { ...normalizedState.products, [nextDraft.id]: { ...nextDraft, updatedAt: new Date().toISOString() } } });
  }

  function patchDraft(patch: Partial<CanvasCommerceProductDraft>) {
    commit({ ...draft, ...patch });
  }

  function patchPlan(planId: string, patch: Partial<CanvasCommercePlan>) {
    patchDraft({ plans: draft.plans.map((plan) => plan.id === planId ? { ...plan, ...patch } : plan) });
  }

  function addProductImages(candidates: CanvasAssistantNodeContext[]) {
    const currentKeys = new Set(draft.images.flatMap((image) => [image.nodeId, image.libraryItemId].filter(Boolean)));
    const additions = candidates.flatMap((node) => {
      if (currentKeys.has(node.id) || (node.libraryItemId && currentKeys.has(node.libraryItemId))) return [];
      currentKeys.add(node.id);
      if (node.libraryItemId) currentKeys.add(node.libraryItemId);
      return [{ nodeId: node.id, libraryItemId: node.libraryItemId, title: node.title }];
    });
    patchDraft({ images: [...draft.images, ...additions].slice(0, 4), phase: "setup", error: undefined });
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
      patchDraft({
        images: [...draft.images, ...additions.filter((image) => !existing.has(image.nodeId) && (!image.libraryItemId || !existing.has(image.libraryItemId)))].slice(0, 4),
        phase: "setup",
        error: undefined,
      });
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
      const createdPlans = draft.plans.filter((plan) => plan.createdGeneratorNodeId);
      const selectedDirections = analysis.recommendedDirections.slice(0, 3);
      patchDraft({
        productName: draft.productName || analysis.suggestedName,
        sellingPoints: analysis.sellingPoints,
        visibleFacts: analysis.visibleFacts,
        recommendedDirections: analysis.recommendedDirections,
        selectedDirections,
        directionSellingPoints: Object.fromEntries(selectedDirections.map((direction, index) => [direction, analysis.sellingPoints[index % analysis.sellingPoints.length]])),
        plans: createdPlans,
        phase: "product-ready",
        error: undefined,
      });
    } catch (error) {
      patchDraft({ phase: "error", error: error instanceof Error ? error.message : "产品分析失败。" });
    } finally {
      setBusy("");
    }
  }

  function toggleDirection(direction: CanvasCommerceDirection) {
    const selected = draft.selectedDirections.includes(direction)
      ? draft.selectedDirections.filter((item) => item !== direction)
      : draft.selectedDirections.length < 3 ? [...draft.selectedDirections, direction] : draft.selectedDirections;
    const assignments = { ...draft.directionSellingPoints };
    selected.forEach((item, index) => { assignments[item] ||= draft.sellingPoints[index % draft.sellingPoints.length] || ""; });
    patchDraft({ selectedDirections: selected, directionSellingPoints: assignments });
  }

  async function generatePlans(targetDirections = uncreatedDirections) {
    if (!targetDirections.length || draft.sellingPoints.length < 4 || busy) return;
    setBusy("plans");
    patchDraft({ phase: "planning", error: undefined });
    try {
      const selectedIds = draft.images.map((image) => image.nodeId);
      const usedHookPatterns = draft.plans.flatMap((plan) => plan.hook ? [{
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
          message: "根据已确认资料生成独立的15秒马来西亚 TikTok Shop 鞋类带货提示词。",
          productDraftId: draft.id,
          productName: draft.productName,
          sellingPoints: draft.sellingPoints,
          visibleFacts: draft.visibleFacts,
          selectedDirections: targetDirections,
          directionSellingPoints: draft.directionSellingPoints,
          usedHookPatterns,
          extraRequirements: draft.extraRequirements,
          canvasTitle,
          scope,
          selectedNodeIds: selectedIds,
          nodes: nodes.map((node) => ({ ...node, selected: selectedIds.includes(node.id) })),
        }),
      });
      const generated = normalizeCommercePlanGeneration(response, targetDirections, {
        visibleFacts: draft.visibleFacts,
        imageCount: draft.images.length,
        usedHookPatterns,
      });
      const replacedDirections = new Set(targetDirections);
      const previousByDirection = new Map(draft.plans
        .filter((plan) => !plan.createdGeneratorNodeId && replacedDirections.has(plan.direction))
        .map((plan) => [plan.direction, plan]));
      const untouchedPlans = draft.plans.filter((plan) => plan.createdGeneratorNodeId || !replacedDirections.has(plan.direction));
      const now = Date.now();
      patchDraft({
        plans: [...untouchedPlans, ...generated.plans.map((plan, index) => {
          const previous = previousByDirection.get(plan.direction);
          return { ...plan, id: `plan-${now}-${index}`, providerId: previous?.providerId, selected: previous?.selected ?? true };
        })],
        phase: "plans-ready",
        error: undefined,
      });
    } catch (error) {
      patchDraft({ phase: "error", error: error instanceof Error ? error.message : "提示词方案生成失败。" });
    } finally {
      setBusy("");
    }
  }

  function createPlans() {
    if (!canCreate || busy) return;
    setBusy("create");
    try {
      const prepared = {
        ...draft,
        plans: draft.plans.map((plan) => {
          const provider = planProviders[plan.id];
          if (!provider || !createCandidates.some((candidate) => candidate.id === plan.id)) return plan;
          const publishingCopy = normalizeCommercePublishingCopy(plan.publishingCopy);
          if (!publishingCopy) throw new Error(`方案“${plan.title}”的发布标题、正文或标签不完整。`);
          return { ...plan, providerId: provider.id, publishingCopy };
        }),
      };
      const result = onCreatePlans(prepared, createCandidates.map((plan) => plan.id));
      const byPlan = new Map(result.map((item) => [item.planId, item]));
      patchDraft({
        plans: prepared.plans.map((plan) => {
          const created = byPlan.get(plan.id);
          return created ? {
            ...plan,
            selected: false,
            createdGroupId: created.groupId,
            createdPromptNodeId: created.promptNodeId,
            createdGeneratorNodeId: created.generatorNodeId,
          } : plan;
        }),
        phase: "plans-ready",
        error: undefined,
      });
    } catch (error) {
      patchDraft({ phase: "error", error: error instanceof Error ? error.message : "创建画布节点失败。" });
    } finally {
      setBusy("");
    }
  }

  function reuseCreatedPlan(plan: CanvasCommercePlan) {
    if (busy) return;
    const provider = providerForPlan(plan, draft.sharedProviderId, compatibleProviders);
    if (!provider) {
      patchDraft({ phase: "error", error: "原方案模型当前不可用，请重新选择模型后再复用。" });
      return;
    }
    setBusy("create");
    try {
      const clonedPlan = { ...cloneCommercePlanForReuse(plan), providerId: provider.id };
      const prepared = { ...draft, plans: [...draft.plans, clonedPlan] };
      const created = onCreatePlans(prepared, [clonedPlan.id])[0];
      if (!created) throw new Error("没有创建新的方案节点。");
      patchDraft({
        plans: [...draft.plans, {
          ...clonedPlan,
          selected: false,
          createdGroupId: created.groupId,
          createdPromptNodeId: created.promptNodeId,
          createdGeneratorNodeId: created.generatorNodeId,
        }],
        phase: "plans-ready",
        error: undefined,
      });
    } catch (error) {
      patchDraft({ phase: "error", error: error instanceof Error ? error.message : "复用方案失败。" });
    } finally {
      setBusy("");
    }
  }

  function startNewProduct() {
    const product = newCommerceProductDraft();
    onStateChange({ products: { ...normalizedState.products, [product.id]: product } });
    setActiveProductId(product.id);
  }

  return (
    <div className="canvas-assistant__commerce">
      <div className="canvas-assistant__product-switcher">
        <label>
          <span>产品方案</span>
          <span className="canvas-assistant__select-wrap"><select value={draft.id} onChange={(event) => setActiveProductId(event.target.value)}>{products.map((product) => <option key={product.id} value={product.id}>{product.productName || `未命名产品 · ${product.createdAt.slice(5, 10)}`}</option>)}</select><ChevronDown /></span>
        </label>
        <button type="button" className="canvas-icon-button" onClick={startNewProduct} aria-label="新建产品方案" title="新建产品方案"><Plus /></button>
      </div>

      <section className="canvas-assistant__workflow-section" aria-label="第一步 产品资料">
        <header><span>01</span><div><strong>产品资料</strong><small>1–4 张同款鞋，多角度效果更稳定</small></div></header>
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
              <button type="button" disabled={index === 0} onClick={() => patchDraft({ images: moveItem(draft.images, index, index - 1), phase: "setup" })} aria-label="图片上移" title="图片上移"><ArrowUp /></button>
              <button type="button" disabled={index === draft.images.length - 1} onClick={() => patchDraft({ images: moveItem(draft.images, index, index + 1), phase: "setup" })} aria-label="图片下移" title="图片下移"><ArrowDown /></button>
              <button type="button" onClick={() => patchDraft({ images: draft.images.filter((_, itemIndex) => itemIndex !== index), phase: "setup" })} aria-label="移除图片" title="移除图片"><Trash2 /></button>
            </div>
          </div>) : <p>还没有产品图片</p>}
        </div>
        <div className="canvas-assistant__locked-fields">
          <label><span>国家</span><input value="马来西亚" disabled /></label>
          <label><span>语言</span><input value="马来语" disabled /></label>
        </div>
        <button type="button" className="canvas-assistant__primary-action" disabled={!draft.images.length || Boolean(busy)} onClick={() => { void analyzeProduct(); }}>{busy === "product" ? <LoaderCircle className="is-spinning" /> : <Sparkles />}分析产品</button>
      </section>

      {draft.sellingPoints.length ? <section className="canvas-assistant__workflow-section" aria-label="产品分析结果">
        <header><span>02</span><div><strong>确认卖点</strong><small>只保留图片可核对的信息</small></div></header>
        <label className="canvas-assistant__text-field"><span>产品名称（可留空）</span><input value={draft.productName} maxLength={120} onChange={(event) => patchDraft({ productName: event.target.value })} /></label>
        <div className="canvas-assistant__selling-points">
          {draft.sellingPoints.map((point, index) => <div key={index}><input value={point} maxLength={160} onChange={(event) => patchDraft({ sellingPoints: draft.sellingPoints.map((item, itemIndex) => itemIndex === index ? event.target.value : item) })} /><button type="button" onClick={() => patchDraft({ sellingPoints: draft.sellingPoints.filter((_, itemIndex) => itemIndex !== index) })} aria-label="删除卖点" title="删除卖点"><Trash2 /></button></div>)}
          {draft.sellingPoints.length < 8 ? <button type="button" onClick={() => patchDraft({ sellingPoints: [...draft.sellingPoints, ""] })}><Plus />补充卖点</button> : null}
        </div>
      </section> : null}

      {draft.sellingPoints.length >= 4 ? <section className="canvas-assistant__workflow-section" aria-label="第二步 选择内容方向">
        <header><span>03</span><div><strong>内容方向</strong><small>选择 1–3 个，每个方向只讲一个卖点</small></div></header>
        <div className="canvas-assistant__direction-grid">{commerceDirectionOptions.map((direction) => {
          const active = draft.selectedDirections.includes(direction.id);
          const recommended = draft.recommendedDirections.includes(direction.id);
          return <button key={direction.id} type="button" className={active ? "is-active" : undefined} onClick={() => toggleDirection(direction.id)}><strong>{direction.label}{recommended ? <small>推荐</small> : null}</strong><span>{direction.detail}</span></button>;
        })}</div>
        {draft.selectedDirections.length ? <div className="canvas-assistant__direction-points">{draft.selectedDirections.map((direction) => <label key={direction}><span>{commerceDirectionLabel(direction)}</span><select value={draft.directionSellingPoints[direction] || ""} onChange={(event) => patchDraft({ directionSellingPoints: { ...draft.directionSellingPoints, [direction]: event.target.value } })}>{draft.sellingPoints.filter(Boolean).map((point) => <option key={point} value={point}>{point}</option>)}</select></label>)}</div> : null}
        <label className="canvas-assistant__text-field"><span>补充要求（可选）</span><textarea value={draft.extraRequirements} maxLength={1_200} onChange={(event) => patchDraft({ extraRequirements: event.target.value })} placeholder="例如：人物动作更自然、不要出现包装" /></label>
        <button type="button" className="canvas-assistant__primary-action" disabled={!uncreatedDirections.length || Boolean(busy)} onClick={() => { void generatePlans(); }}>{busy === "plans" ? <LoaderCircle className="is-spinning" /> : <Sparkles />}生成未创建方案</button>
      </section> : null}

      {draft.plans.length ? <section className="canvas-assistant__workflow-section" aria-label="第三步 确认方案和模型">
        <header><span>04</span><div><strong>确认方案与模型</strong><small>共用模型，也可为单个方案覆盖</small></div></header>
        <label className="canvas-assistant__model-field"><span>全部方案共用模型</span><select value={draft.sharedProviderId || ""} onChange={(event) => patchDraft({ sharedProviderId: event.target.value || undefined })}><option value="">请选择兼容模型</option>{sharedOptions.map((provider) => <option key={provider.id} value={provider.id}>{providerLabel(provider)}</option>)}</select></label>
        <div className="canvas-assistant__plan-list">{draft.plans.map((plan) => {
          const created = Boolean(plan.createdGeneratorNodeId);
          const options = compatibleProviders.filter((provider) => providerSupportsDirection(provider, plan.direction));
          const provider = planProviders[plan.id];
          const capacity = provider?.videoOptions?.maxReferenceImages || 0;
          return <article key={plan.id} className={created ? "is-created" : undefined}>
            <header><label><input type="checkbox" checked={created || plan.selected} disabled={created} onChange={(event) => patchPlan(plan.id, { selected: event.target.checked })} /><span>{commerceDirectionLabel(plan.direction)}</span></label><div>{created ? <><small><Check />已创建</small><button type="button" disabled={Boolean(busy)} onClick={() => reuseCreatedPlan(plan)}><CopyPlus />复用为新节点</button></> : <button type="button" disabled={Boolean(busy)} onClick={() => { void generatePlans([plan.direction]); }}><Sparkles />重新分析</button>}</div></header>
            <label><span>核心卖点</span><select value={plan.sellingPoint} disabled={created} onChange={(event) => patchDraft({ plans: draft.plans.map((item) => item.id === plan.id ? { ...item, sellingPoint: event.target.value } : item), directionSellingPoints: { ...draft.directionSellingPoints, [plan.direction]: event.target.value } })}>{draft.sellingPoints.filter(Boolean).map((point) => <option key={point} value={point}>{point}</option>)}</select></label>
            <label><span>模型</span><select value={plan.providerId || ""} disabled={created} onChange={(event) => patchPlan(plan.id, { providerId: event.target.value || undefined })}><option value="">跟随共用模型</option>{options.map((item) => <option key={item.id} value={item.id}>{providerLabel(item)}</option>)}</select></label>
            {plan.hook ? <div className="canvas-assistant__plan-hook">
              <div><strong>{plan.hook.title}</strong><span>{plan.hook.reason}</span></div>
              <dl>
                <div><dt>开头口播</dt><dd lang="ms">{plan.hook.hookLine}</dd></div>
                <div><dt>屏幕短字</dt><dd lang="ms">{plan.hook.onScreenText}</dd></div>
                <div><dt>首帧</dt><dd>{plan.hook.scene} · {plan.hook.visualBeat}</dd></div>
              </dl>
            </div> : null}
            {plan.production && plan.shots ? <details className="canvas-assistant__shot-plan">
              <summary><span>4 镜头分镜脚本</span><small>{plan.production.energy === "dynamic" ? "动感" : plan.production.energy === "balanced" ? "均衡" : "舒缓"} · {plan.production.emotionArc}</small></summary>
              <div className="canvas-assistant__production-note"><span>真实感</span><p>{plan.production.realismNotes}</p></div>
              <ol>{plan.shots.map((shot) => <li key={shot.timeRange}>
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
            <textarea value={plan.prompt} disabled={created} onChange={(event) => patchPlan(plan.id, { prompt: event.target.value })} aria-label={`${commerceDirectionLabel(plan.direction)}提示词`} />
            {plan.publishingCopy ? <div className="canvas-assistant__publishing-copy">
              <strong>马来语发布包</strong>
              <label><span>标题</span><input value={plan.publishingCopy.title} disabled={created} maxLength={80} onChange={(event) => patchPlan(plan.id, { publishingCopy: { ...plan.publishingCopy!, title: event.target.value } })} /></label>
              <label><span>正文</span><textarea value={plan.publishingCopy.caption} disabled={created} maxLength={1_200} onChange={(event) => patchPlan(plan.id, { publishingCopy: { ...plan.publishingCopy!, caption: event.target.value } })} /></label>
              <label><span>标签</span><input value={plan.publishingCopy.hashtags.join(" ")} disabled={created} onChange={(event) => patchPlan(plan.id, { publishingCopy: { ...plan.publishingCopy!, hashtags: event.target.value.split(/[\s,，]+/u).filter(Boolean).slice(0, 6) } })} /></label>
            </div> : null}
            {provider && capacity < draft.images.length ? <p>该模型接收 {capacity} 张图，将按当前顺序连接前 {capacity} 张，其余不连接。</p> : null}
          </article>;
        })}</div>
        <button type="button" className="canvas-assistant__primary-action" disabled={!canCreate || Boolean(busy)} onClick={createPlans}>{busy === "create" ? <LoaderCircle className="is-spinning" /> : <Check />}创建选中方案节点</button>
      </section> : null}

      {draft.error ? <p className="canvas-assistant__workflow-error" role="alert">{draft.error}</p> : null}
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
