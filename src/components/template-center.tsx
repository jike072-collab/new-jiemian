"use client";

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { ArrowRight, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { WorkbenchShell } from "@/components/workbench-shell";
import { fetchJson } from "@/lib/client/api";
import type { PublicAuthUser } from "@/lib/server/auth";
import { cn } from "@/lib/utils";
import {
  imagePromptTemplates,
  templateCategories,
  templateTabHref,
  type TemplateCategory,
  type TemplatePromptTemplate,
  videoPromptTemplates,
} from "@/lib/template-catalog";
import type { WorkspaceAction, WorkspaceToolId } from "@/lib/workspace-registry";

type TemplateScope = "image" | "video";

type AuthSessionResponse =
  | { ok: true; user: PublicAuthUser; mappingStatus: string | null }
  | { ok: false; code: string; uiState: string; message: string; retryAfterSeconds?: number };

type QuotaResponse = {
  ok: true;
  quota: { available_quota_units: number };
};

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
  const previewMode = searchParams.get("preview") === "1";
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<TemplateCategory | "全部">("全部");
  const [sessionUser, setSessionUser] = useState<PublicAuthUser | null>(null);
  const [quotaLabel, setQuotaLabel] = useState<string | null>(null);

  const templates = scope === "image" ? imagePromptTemplates : videoPromptTemplates;
  const totalTemplateCount = templates.length;

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
    return templateCategories.reduce<Record<TemplateCategory | "全部", number>>((result, item) => {
      result[item] = item === "全部"
        ? templates.length
        : templates.filter((template) => template.category === item).length;
      return result;
    }, Object.fromEntries(templateCategories.map((item) => [item, 0])) as Record<TemplateCategory | "全部", number>);
  }, [templates]);

  const handleToolAction = (action: WorkspaceAction, tool: WorkspaceToolId) => {
    if (action.kind === "route") {
      router.push(withPreviewParam(action.href, previewMode));
      return;
    }
    const params = new URLSearchParams({ tool });
    if (previewMode) params.set("preview", "1");
    router.push(`/?${params.toString()}`);
  };

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const session = await fetchJson<AuthSessionResponse>("/api/auth/session");
        if (cancelled) return;
        if ("ok" in session && session.ok) {
          setSessionUser(session.user);
          try {
            const quotaData = await fetchJson<QuotaResponse>("/api/quota");
            if (!cancelled) setQuotaLabel(String(quotaData.quota.available_quota_units));
          } catch {
            if (!cancelled) setQuotaLabel(null);
          }
          return;
        }
        setSessionUser(null);
        setQuotaLabel(null);
      } catch {
        if (!cancelled) {
          setSessionUser(null);
          setQuotaLabel(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <WorkbenchShell
      state={{ activeToolId: "templates" }}
      onToolAction={handleToolAction}
      isAuthenticated={Boolean(sessionUser)}
      canAccessAdmin={sessionUser?.role === "admin"}
      accountName={sessionUser?.display_name || sessionUser?.username || null}
      accountQuotaLabel={quotaLabel}
      toolTitle="模板中心"
      parameterSlot={null}
      previewSlot={
        <TemplateBrowserPanel
          scope={scope}
          previewMode={previewMode}
          search={search}
          category={category}
          counts={categoryCounts}
          templates={filteredTemplates}
          totalCount={totalTemplateCount}
          onScopeChange={(nextScope) => {
            setCategory("全部");
            router.push(`${templateTabHref(nextScope)}${previewMode ? "&preview=1" : ""}`, { scroll: false });
          }}
          onSearchChange={setSearch}
          onCategoryChange={setCategory}
        />
      }
    />
  );
}

function withPreviewParam(href: string, previewMode: boolean) {
  if (!previewMode || href.includes("preview=1")) return href;
  return `${href}${href.includes("?") ? "&" : "?"}preview=1`;
}

const templateCategoryMeta: Record<TemplateCategory | "全部", { title: string; description: string }> = {
  "全部": {
    title: "全部",
    description: "查看图片和视频的全部模板分类。",
  },
  "商品美食": {
    title: "商品美食",
    description: "商品图、美食、服装和商业展示。",
  },
  "海报品牌": {
    title: "海报品牌",
    description: "促销海报、活动主视觉和品牌系统。",
  },
  "摄影人像": {
    title: "摄影人像",
    description: "人像、街拍、空间和旅行纪实。",
  },
  "插画风格": {
    title: "插画风格",
    description: "动漫、水彩、国风和像素风格。",
  },
  "图文科普": {
    title: "图文科普",
    description: "信息图、论文图、数据图表和图鉴。",
  },
  "界面设计": {
    title: "界面设计",
    description: "手机界面、工作台、落地页和图标。",
  },
  "图片编辑": {
    title: "图片编辑",
    description: "翻译、抠图、换背景和清理画面。",
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
        {templateCategories.filter((item) => item === "全部" || counts[item] > 0).map((item) => {
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
  previewMode,
  search,
  category,
  counts,
  templates,
  totalCount,
  onScopeChange,
  onSearchChange,
  onCategoryChange,
}: {
  scope: TemplateScope;
  previewMode: boolean;
  search: string;
  category: TemplateCategory | "全部";
  counts: Record<TemplateCategory | "全部", number>;
  templates: TemplatePromptTemplate[];
  totalCount: number;
  onScopeChange: (scope: TemplateScope) => void;
  onSearchChange: (value: string) => void;
  onCategoryChange: (value: TemplateCategory | "全部") => void;
}) {
  const gridRef = useRef<HTMLDivElement | null>(null);

  const handleCategoryChange = (value: TemplateCategory | "全部") => {
    onCategoryChange(value);
    gridRef.current?.scrollIntoView({ block: "nearest" });
  };

  const cloneHref = (id: string) => {
    const params = new URLSearchParams({ template: id });
    if (previewMode) params.set("preview", "1");
    return `/?${params.toString()}`;
  };

  return (
    <div className="template-center-browser">
      <div className="template-center-browser__head">
        <div>
          <h3>模板中心</h3>
          <p>发现适合商品、海报、摄影、插画、图文和界面的常用模板</p>
        </div>
        <span className="shell-chip">共 {totalCount} 个模板</span>
      </div>

      <div className="template-center-toolbar">
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

        <TemplateCategoryPanel
          category={category}
          counts={counts}
          onCategoryChange={handleCategoryChange}
        />
      </div>

      <div ref={gridRef} className="template-center-grid" aria-label="模板列表">
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
            <Link href={cloneHref(template.id)} className="studio-primary-action template-center-card__clone">
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
