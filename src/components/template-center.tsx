"use client";

import Link from "next/link";
import { ArrowRight, Search } from "lucide-react";
import { useCallback, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { WorkbenchShell } from "@/components/workbench-shell";
import { cn } from "@/lib/utils";
import {
  imagePromptTemplates,
  templateCategories,
  templateCloneHref,
  templateScopeLabel,
  templateTabHref,
  type TemplateCategory,
  type TemplatePromptTemplate,
  videoPromptTemplates,
} from "@/lib/template-catalog";
import type { WorkspaceAction, WorkspaceToolId } from "@/lib/workspace-registry";

type TemplateScope = "image" | "video";

type TemplateRailProps = {
  title?: string;
  viewAllHref?: string;
  viewAllLabel?: string;
  templates: TemplatePromptTemplate[];
  activeTemplateId?: string;
  onSelect: (template: TemplatePromptTemplate) => void;
};

export function TemplateRail({
  title = "从模板开始",
  viewAllHref,
  viewAllLabel = "查看全部",
  templates,
  activeTemplateId,
  onSelect,
}: TemplateRailProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef({
    pointerId: -1,
    startX: 0,
    startScrollLeft: 0,
    dragging: false,
    suppressClick: false,
  });

  const releaseDrag = useCallback((pointerId: number) => {
    const scroll = scrollRef.current;
    const state = dragStateRef.current;
    if (scroll && scroll.hasPointerCapture(pointerId)) {
      scroll.releasePointerCapture(pointerId);
    }
    if (state.dragging) {
      scroll?.classList.remove("is-dragging");
    }
    state.pointerId = -1;
    state.dragging = false;
  }, []);

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const scroll = scrollRef.current;
    if (!scroll) return;
    const state = dragStateRef.current;
    state.pointerId = event.pointerId;
    state.startX = event.clientX;
    state.startScrollLeft = scroll.scrollLeft;
    state.dragging = false;
    state.suppressClick = false;
    scroll.setPointerCapture(event.pointerId);
  }, []);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const scroll = scrollRef.current;
    const state = dragStateRef.current;
    if (!scroll || state.pointerId !== event.pointerId) return;
    const delta = event.clientX - state.startX;
    if (!state.dragging && Math.abs(delta) > 6) {
      state.dragging = true;
      scroll.classList.add("is-dragging");
    }
    if (state.dragging) {
      event.preventDefault();
      scroll.scrollLeft = state.startScrollLeft - delta;
    }
  }, []);

  const handlePointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const state = dragStateRef.current;
    if (state.pointerId !== event.pointerId) return;
    state.suppressClick = state.dragging;
    releaseDrag(event.pointerId);
  }, [releaseDrag]);

  const handleClickCapture = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!dragStateRef.current.suppressClick) return;
    event.preventDefault();
    event.stopPropagation();
    dragStateRef.current.suppressClick = false;
  }, []);

  return (
    <section className="studio-template-section" aria-label={title}>
      <div className="studio-template-section__head">
        <div>
          <p className="shell-eyebrow">{title}</p>
          <p className="studio-template-section__desc">点击模板直接填充参数，不需要二次确认。</p>
        </div>
        {viewAllHref ? (
          <Link href={viewAllHref} className="studio-secondary-button studio-template-section__link">
            {viewAllLabel}
          </Link>
        ) : null}
      </div>

      <div
        ref={scrollRef}
        className="studio-template-scroll"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onClickCapture={handleClickCapture}
      >
        <div className="studio-template-track">
          {templates.map((template) => (
            <button
              key={template.id}
              type="button"
              className={cn("studio-template-card", activeTemplateId === template.id && "is-active")}
              onClick={() => onSelect(template)}
              aria-pressed={activeTemplateId === template.id}
            >
              <span className="studio-template-card__thumb">
                <img src={template.thumbnail} alt={template.label} loading="lazy" />
                <span className="studio-template-card__fade" aria-hidden="true" />
                <span className="studio-template-card__badge">{template.category}</span>
                <span className="studio-template-card__label">{template.label}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

export function TemplateCenterView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const scope: TemplateScope = searchParams.get("tab") === "video" ? "video" : "image";
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<TemplateCategory | "全部">("全部");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");

  const templates = scope === "image" ? imagePromptTemplates : videoPromptTemplates;

  const filteredTemplates = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return templates.filter((template) => {
      const matchesCategory = category === "全部" || template.category === category;
      const matchesSearch = !keyword
        || template.label.toLowerCase().includes(keyword)
        || template.summary.toLowerCase().includes(keyword)
        || template.category.toLowerCase().includes(keyword);
      return matchesCategory && matchesSearch;
    });
  }, [category, search, templates]);

  const effectiveSelectedTemplateId = useMemo(() => {
    if (filteredTemplates.some((template) => template.id === selectedTemplateId)) return selectedTemplateId;
    return filteredTemplates[0]?.id || templates[0]?.id || "";
  }, [filteredTemplates, selectedTemplateId, templates]);

  const selectedTemplate = useMemo(() => {
    return filteredTemplates.find((template) => template.id === effectiveSelectedTemplateId)
      || filteredTemplates[0]
      || templates[0]
      || null;
  }, [effectiveSelectedTemplateId, filteredTemplates, templates]);

  const handleToolAction = (action: WorkspaceAction, tool: WorkspaceToolId) => {
    if (action.kind === "route") {
      router.push(action.href);
      return;
    }
    router.push(`/?tool=${encodeURIComponent(tool)}`);
  };

  return (
    <WorkbenchShell
      state={{ activeToolId: "templates" }}
      onToolAction={handleToolAction}
      isAuthenticated={false}
      toolTitle="模板中心"
      toolDescription="中间选择模板，右侧查看详情，克隆后直接进入工作台。"
      parameterSlot={
        <TemplateCatalogPanel
          scope={scope}
          search={search}
          category={category}
          templates={filteredTemplates}
          selectedTemplateId={selectedTemplate?.id || ""}
          onScopeChange={(nextScope) => router.push(templateTabHref(nextScope), { scroll: false })}
          onSearchChange={setSearch}
          onCategoryChange={setCategory}
          onSelectTemplate={(template) => setSelectedTemplateId(template.id)}
        />
      }
      previewSlot={
        <TemplateDetailPanel
          template={selectedTemplate}
          scope={scope}
          totalCount={templates.length}
        />
      }
    />
  );
}

function TemplateCatalogPanel({
  scope,
  search,
  category,
  templates,
  selectedTemplateId,
  onScopeChange,
  onSearchChange,
  onCategoryChange,
  onSelectTemplate,
}: {
  scope: TemplateScope;
  search: string;
  category: TemplateCategory | "全部";
  templates: TemplatePromptTemplate[];
  selectedTemplateId: string;
  onScopeChange: (scope: TemplateScope) => void;
  onSearchChange: (value: string) => void;
  onCategoryChange: (value: TemplateCategory | "全部") => void;
  onSelectTemplate: (template: TemplatePromptTemplate) => void;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef({
    pointerId: -1,
    startX: 0,
    startScrollLeft: 0,
    dragging: false,
    suppressClick: false,
  });

  const releaseDrag = useCallback((pointerId: number) => {
    const list = listRef.current;
    const state = dragStateRef.current;
    if (list && list.hasPointerCapture(pointerId)) {
      list.releasePointerCapture(pointerId);
    }
    if (state.dragging) {
      list?.classList.remove("is-dragging");
    }
    state.pointerId = -1;
    state.dragging = false;
  }, []);

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const list = listRef.current;
    if (!list) return;
    const state = dragStateRef.current;
    state.pointerId = event.pointerId;
    state.startX = event.clientX;
    state.startScrollLeft = list.scrollLeft;
    state.dragging = false;
    state.suppressClick = false;
    list.setPointerCapture(event.pointerId);
  }, []);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const list = listRef.current;
    const state = dragStateRef.current;
    if (!list || state.pointerId !== event.pointerId) return;

    const delta = event.clientX - state.startX;
    if (!state.dragging && Math.abs(delta) > 6) {
      state.dragging = true;
      list.classList.add("is-dragging");
    }

    if (state.dragging) {
      event.preventDefault();
      list.scrollLeft = state.startScrollLeft - delta;
    }
  }, []);

  const handlePointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const state = dragStateRef.current;
    if (state.pointerId !== event.pointerId) return;
    state.suppressClick = state.dragging;
    releaseDrag(event.pointerId);
  }, [releaseDrag]);

  const handleClickCapture = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!dragStateRef.current.suppressClick) return;
    event.preventDefault();
    event.stopPropagation();
    dragStateRef.current.suppressClick = false;
  }, []);

  return (
    <div className="template-center-panel">
      <div className="template-center-tabs" role="tablist" aria-label="模板分类">
        <button
          type="button"
          className={cn("template-center-tab", scope === "image" && "is-active")}
          aria-pressed={scope === "image"}
          onClick={() => onScopeChange("image")}
        >
          图片模板
        </button>
        <button
          type="button"
          className={cn("template-center-tab", scope === "video" && "is-active")}
          aria-pressed={scope === "video"}
          onClick={() => onScopeChange("video")}
        >
          视频模板
        </button>
      </div>

      <label className="template-center-search">
        <Search className="size-4" aria-hidden="true" />
        <input
          className="studio-input"
          type="search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="搜索模板"
        />
      </label>

      <div className="template-center-categories" role="group" aria-label="场景筛选">
        {templateCategories.map((item) => (
          <button
            key={item}
            type="button"
            className={cn("template-center-category", category === item && "is-active")}
            onClick={() => onCategoryChange(item)}
            aria-pressed={category === item}
          >
            {item}
          </button>
        ))}
      </div>

      <div
        ref={listRef}
        className="template-center-list"
        aria-label="模板列表"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onClickCapture={handleClickCapture}
      >
        {templates.length ? templates.map((template) => (
          <button
            key={template.id}
            type="button"
            className={cn("template-center-item", selectedTemplateId === template.id && "is-active")}
            onClick={() => onSelectTemplate(template)}
            aria-pressed={selectedTemplateId === template.id}
          >
            <span className="template-center-item__thumb">
              <img src={template.thumbnail} alt={template.label} loading="lazy" />
              <span className="template-center-item__fade" aria-hidden="true" />
            </span>
            <span className="template-center-item__body">
              <strong>{template.label}</strong>
              <span>{template.category}</span>
              <small>{template.summary}</small>
            </span>
          </button>
        )) : (
          <div className="template-center-empty" role="status">
            <strong>没有找到模板</strong>
            <span>可以换一个关键词或分类再试。</span>
          </div>
        )}
      </div>
    </div>
  );
}

function TemplateDetailPanel({
  template,
  scope,
  totalCount,
}: {
  template: TemplatePromptTemplate | null;
  scope: TemplateScope;
  totalCount: number;
}) {
  if (!template) {
    return (
      <div className="template-center-detail">
        <div className="template-center-detail__empty" role="status">
          <p className="shell-eyebrow">模板详情</p>
          <strong>还没有选中模板</strong>
          <span>在中间栏点一个模板，右侧会显示完整信息。</span>
        </div>
      </div>
    );
  }

  return (
    <div className="template-center-detail">
      <article className="template-center-detail__card">
        <div className="template-center-detail__hero">
          <img src={template.thumbnail} alt={template.label} loading="lazy" />
          <span className="template-center-detail__scope">{templateScopeLabel(template.scope)}</span>
        </div>

        <div className="template-center-detail__body">
          <div className="template-center-detail__head">
            <div>
              <p className="shell-eyebrow">模板详情</p>
              <h1>{template.label}</h1>
            </div>
            <span className="shell-chip">{scope === "image" ? `${imagePromptTemplates.length} 个图片模板` : `${videoPromptTemplates.length} 个视频模板`}</span>
          </div>

          <p className="template-center-detail__summary">{template.summary}</p>

          <div className="template-center-detail__chips" aria-label="模板信息">
            <span className="shell-chip">{template.category}</span>
            <span className="shell-chip">{template.aspectRatio}</span>
            <span className="shell-chip">{template.scope === "image" ? template.quality : `${template.duration} 秒`}</span>
            <span className="shell-chip">{template.requiresImage ? "需要图像" : "无需图像"}</span>
          </div>

          <div className="template-center-detail__prompt">
            <strong>模板提示词</strong>
            <p>{template.prompt}</p>
          </div>

          <div className="template-center-detail__actions">
            <Link href={templateCloneHref(template.id)} className="studio-primary-action">
              <ArrowRight className="size-4" aria-hidden="true" />
              克隆到工作台
            </Link>
            <Link href={templateTabHref(scope)} className="studio-secondary-button">
              返回模板列表
            </Link>
          </div>
        </div>
      </article>

      <div className="template-center-detail__note">
        <p className="shell-eyebrow">浏览中</p>
        <strong>{totalCount} 个模板</strong>
        <span>选中后，右侧会保留完整预览和参数信息。</span>
      </div>
    </div>
  );
}
