"use client";

/* eslint-disable @next/next/no-img-element */

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
  title = "模板",
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

  const categoryCounts = useMemo(() => {
    const allTemplates = [...imagePromptTemplates, ...videoPromptTemplates];
    return templateCategories.reduce<Record<TemplateCategory | "全部", number>>((result, item) => {
      result[item] = item === "全部"
        ? allTemplates.length
        : allTemplates.filter((template) => template.category === item).length;
      return result;
    }, {
      "全部": 0,
      "商品": 0,
      "背景": 0,
      "广告": 0,
      "创意": 0,
    });
  }, []);

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
      parameterSlot={
        <TemplateCategoryPanel
          category={category}
          counts={categoryCounts}
          onCategoryChange={setCategory}
        />
      }
      previewSlot={
        <TemplateBrowserPanel
          scope={scope}
          search={search}
          templates={filteredTemplates}
          totalCount={templates.length}
          onScopeChange={(nextScope) => router.push(templateTabHref(nextScope), { scroll: false })}
          onSearchChange={setSearch}
        />
      }
    />
  );
}

const templateCategoryMeta: Record<TemplateCategory | "全部", { title: string; description: string }> = {
  "全部": {
    title: "全部模板",
    description: "查看图片和视频的全部模板分类。",
  },
  "商品": {
    title: "电商模板",
    description: "商品主图、细节、展示和使用场景。",
  },
  "背景": {
    title: "背景模板",
    description: "纯白背景、场景背景和基础视觉整理。",
  },
  "广告": {
    title: "广告模板",
    description: "促销海报、短视频广告和转化素材。",
  },
  "创意": {
    title: "创意模板",
    description: "抠图、翻译、对比和更多创意玩法。",
  },
};

function TemplateCategoryPanel({
  category,
  counts,
  onCategoryChange,
}: {
  category: TemplateCategory | "全部";
  counts: Record<TemplateCategory | "全部", number>;
  onCategoryChange: (value: TemplateCategory | "全部") => void;
}) {
  return (
    <div className="template-center-panel">
      <div className="template-center-categories" role="group" aria-label="模板分类">
        {templateCategories.map((item) => {
          const meta = templateCategoryMeta[item];
          return (
            <button
              key={item}
              type="button"
              className={cn("template-center-category", category === item && "is-active")}
              onClick={() => onCategoryChange(item)}
              aria-pressed={category === item}
            >
              <span>
                <strong>{meta.title}</strong>
                <small>{meta.description}</small>
              </span>
              <em>{counts[item]}</em>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TemplateBrowserPanel({
  scope,
  search,
  templates,
  totalCount,
  onScopeChange,
  onSearchChange,
}: {
  scope: TemplateScope;
  search: string;
  templates: TemplatePromptTemplate[];
  totalCount: number;
  onScopeChange: (scope: TemplateScope) => void;
  onSearchChange: (value: string) => void;
}) {
  return (
    <div className="template-center-browser">
      <div className="template-center-browser__head">
        <div>
          <p className="shell-eyebrow">模板中心</p>
          <h3>{scope === "image" ? "AI 图片模板" : "AI 视频模板"}</h3>
        </div>
        <span className="shell-chip">{totalCount} 个模板</span>
      </div>

      <div className="template-center-tabs" role="tablist" aria-label="模板类型">
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

      <div className="template-center-grid" aria-label="模板列表">
        {templates.length ? templates.map((template) => (
          <article
            key={template.id}
            className="template-center-card"
          >
            <span className="template-center-card__thumb">
              <img src={template.thumbnail} alt={template.label} loading="lazy" />
              <span className="template-center-card__ratio">{template.aspectRatio}</span>
            </span>
            <span className="template-center-card__body">
              <strong>{template.label}</strong>
              <small>{template.summary}</small>
              <span className="template-center-card__meta">
                <span>{template.category}</span>
                <span>{template.scope === "image" ? template.quality.toUpperCase() : `${template.duration} 秒`}</span>
                <span>{template.requiresImage ? "需图像" : "无须图像"}</span>
              </span>
            </span>
            <Link href={templateCloneHref(template.id)} className="studio-secondary-button template-center-card__clone">
              克隆
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </article>
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
