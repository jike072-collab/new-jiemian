"use client";

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { ArrowLeft, ArrowRight, ChevronDown, ChevronUp, Search, SlidersHorizontal, Star } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { WorkbenchShell } from "@/components/workbench-shell";
import { WorkspaceAccountPanel } from "@/components/workspace-account-panel";
import { getPlanStatusDisplay, type CheckInStatus, type PlanStatus } from "@/lib/account-status";
import {
  clearCachedAccountSnapshot,
  readAnyCachedAccountSnapshot,
  readCachedAccountSnapshot,
  writeCachedAccountSnapshot,
} from "@/lib/client/account-snapshot-cache";
import { fetchJson, fetchJsonWithCsrf } from "@/lib/client/api";
import type { PublicAuthUser } from "@/lib/server/auth";
import type { QuotaSnapshot } from "@/lib/server/quota";
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
type TemplateFilter = TemplateCategory | "全部" | "收藏";

type MembershipStatusResponse = {
  ok: true;
  plans: Array<{
    id: string;
    name: string;
  }>;
  membership: {
    active: { plan_id: string; ends_at: string } | null;
    entitlements: Record<"prompt_optimize" | "image_generation" | "video_generation", {
      remaining: number;
      granted: number;
      used: number;
    }>;
  };
};

type CheckInResponse = {
  ok: true;
  checkIn: { status: "available" | "checked" | string };
};

type AccountSummaryResponse = {
  ok: true;
  user: PublicAuthUser;
  quota: QuotaSnapshot | null;
  membership: MembershipStatusResponse;
  checkIn: CheckInResponse;
};

const templateRailDragThreshold = 12;
const templateRailLongPressDelay = 180;
const templatePageSize = 12;
const favoriteTemplateStorageKey = "aohuang-template-favorites";
const templateThumbnailWarmupConcurrency = 3;
const defaultTemplateCategoryIds: TemplateFilter[] = [
  "全部",
  "收藏",
  "商品美食",
  "电商详情",
  "海报品牌",
  "社媒内容",
  "图片编辑",
];

function getWebpThumbnail(thumbnail: string) {
  return thumbnail.endsWith(".png") ? thumbnail.replace(/\.png$/, ".webp") : thumbnail;
}

function warmTemplateThumbnailCache(templates: TemplatePromptTemplate[]) {
  if (typeof window === "undefined") return;

  const urls = Array.from(new Set(templates.map((template) => getWebpThumbnail(template.thumbnail))));
  if (!urls.length) return;

  const warm = () => {
    let nextIndex = 0;
    let activeCount = 0;

    const runNext = () => {
      while (activeCount < templateThumbnailWarmupConcurrency && nextIndex < urls.length) {
        const url = urls[nextIndex];
        nextIndex += 1;
        activeCount += 1;
        void fetch(url, { cache: "force-cache" }).catch(() => undefined).finally(() => {
          activeCount -= 1;
          runNext();
        });
      }
    };

    runNext();
  };

  const idleWindow = window as Window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  };
  if (idleWindow.requestIdleCallback) {
    idleWindow.requestIdleCallback(warm, { timeout: 1500 });
  } else {
    window.setTimeout(warm, 500);
  }
}

function TemplateThumbnail({
  template,
  loading = "lazy",
  fetchPriority = "low",
}: {
  template: TemplatePromptTemplate;
  loading?: "eager" | "lazy";
  fetchPriority?: "high" | "low" | "auto";
}) {
  const thumbnail = getWebpThumbnail(template.thumbnail);
  return (
    <img src={thumbnail} alt={template.label} loading={loading} decoding="async" fetchPriority={fetchPriority} />
  );
}

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
    dragReady: false,
    dragging: false,
    longPressTimer: null as number | null,
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
    if (state.longPressTimer) {
      window.clearTimeout(state.longPressTimer);
      state.longPressTimer = null;
    }
    state.pointerId = -1;
    state.dragReady = false;
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
    state.dragReady = false;
    state.dragging = false;
    state.suppressClick = false;
    if (state.longPressTimer) {
      window.clearTimeout(state.longPressTimer);
    }
    state.longPressTimer = window.setTimeout(() => {
      if (dragStateRef.current.pointerId === event.pointerId) {
        dragStateRef.current.dragReady = true;
      }
    }, templateRailLongPressDelay);
  }, []);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const scroll = scrollRef.current;
    const state = dragStateRef.current;
    if (!scroll || state.pointerId !== event.pointerId) return;
    const delta = event.clientX - state.startX;
    if (!state.dragging && state.dragReady && Math.abs(delta) > templateRailDragThreshold) {
      state.dragging = true;
      scroll.classList.add("is-dragging");
      if (!scroll.hasPointerCapture(event.pointerId)) {
        scroll.setPointerCapture(event.pointerId);
      }
    }
    if (state.dragging) {
      event.preventDefault();
      scroll.scrollLeft = state.startScrollLeft - delta;
    }
  }, []);

  const handlePointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const state = dragStateRef.current;
    if (state.pointerId !== event.pointerId) return;
    const scroll = scrollRef.current;
    const didScroll = Boolean(scroll && Math.abs(scroll.scrollLeft - state.startScrollLeft) > 1);
    state.suppressClick = state.dragging || didScroll;
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
          {templates.map((template, index) => (
            <button
              key={template.id}
              type="button"
              className={cn("studio-template-card", activeTemplateId === template.id && "is-active")}
              onClick={() => onSelect(template)}
              aria-pressed={activeTemplateId === template.id}
            >
              <span className="studio-template-card__thumb">
                <TemplateThumbnail template={template} loading={index < 6 ? "eager" : "lazy"} fetchPriority={index < 6 ? "auto" : "low"} />
                <span className="studio-template-card__fade" aria-hidden="true" />
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
  const [category, setCategory] = useState<TemplateFilter>("全部");
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(() => new Set());
  const [sessionUser, setSessionUser] = useState<PublicAuthUser | null>(null);
  const [quotaSnapshot, setQuotaSnapshot] = useState<QuotaSnapshot | null>(null);
  const [quotaLabel, setQuotaLabel] = useState<string | null>(null);
  const [membershipSnapshot, setMembershipSnapshot] = useState<MembershipStatusResponse | null>(null);
  const [accountLoading, setAccountLoading] = useState(false);
  const [checkInStatus, setCheckInStatus] = useState<CheckInStatus>("unavailable");

  const applyCachedAccountSnapshot = useCallback((userId: string | null | undefined) => {
    const cached = readCachedAccountSnapshot(userId);
    if (!cached) return false;

    setQuotaSnapshot(cached.quota);
    setQuotaLabel(cached.quota ? `${new Intl.NumberFormat("zh-CN").format(cached.quota.quota_units)} ✦` : null);
    setMembershipSnapshot(cached.membership as MembershipStatusResponse | null);
    if (cached.checkInStatus === "available" || cached.checkInStatus === "checked") {
      setCheckInStatus(cached.checkInStatus);
    }
    return true;
  }, []);

  useEffect(() => {
    const userId = sessionUser?.local_user_id || null;
    if (!userId || (!quotaSnapshot && !membershipSnapshot)) return;

    writeCachedAccountSnapshot({
      userId,
      user: sessionUser,
      quota: quotaSnapshot,
      membership: membershipSnapshot,
      checkInStatus,
    });
  }, [checkInStatus, membershipSnapshot, quotaSnapshot, sessionUser, sessionUser?.local_user_id]);

  const templates = scope === "image" ? imagePromptTemplates : videoPromptTemplates;
  const totalTemplateCount = templates.length;

  const filteredTemplates = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return templates.filter((template) => {
      const matchesCategory = category === "全部"
        || (category === "收藏" ? favoriteIds.has(template.id) : template.category === category);
      const matchesSearch = !keyword
        || template.label.toLowerCase().includes(keyword)
        || template.summary.toLowerCase().includes(keyword)
        || template.category.toLowerCase().includes(keyword);
      return matchesCategory && matchesSearch;
    });
  }, [category, favoriteIds, search, templates]);

  const categoryCounts = useMemo(() => {
    return templateCategories.reduce<Record<TemplateFilter, number>>((result, item) => {
      result[item] = item === "全部"
        ? templates.length
        : templates.filter((template) => template.category === item).length;
      return result;
    }, {
      ...Object.fromEntries(templateCategories.map((item) => [item, 0])),
      "收藏": templates.filter((template) => favoriteIds.has(template.id)).length,
    } as Record<TemplateFilter, number>);
  }, [favoriteIds, templates]);

  useEffect(() => {
    warmTemplateThumbnailCache([...imagePromptTemplates, ...videoPromptTemplates]);
  }, []);

  const handleFavoriteToggle = (id: string) => {
    setFavoriteIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      window.localStorage.setItem(favoriteTemplateStorageKey, JSON.stringify(Array.from(next)));
      return next;
    });
  };

  const handleToolAction = (action: WorkspaceAction, tool: WorkspaceToolId) => {
    if (action.kind === "route") {
      router.push(withPreviewParam(action.href, previewMode));
      return;
    }
    const params = new URLSearchParams({ tool });
    if (previewMode) params.set("preview", "1");
    router.push(`/?${params.toString()}`);
  };

  const handleOpenAccountCenter = () => {
    router.push(`/?account=center${previewMode ? "&preview=1" : ""}`);
  };

  const handleOpenRechargeCenter = () => {
    router.push(`/?account=recharge${previewMode ? "&preview=1" : ""}`);
  };

  const applyAccountSummary = useCallback((summary: AccountSummaryResponse) => {
    setSessionUser(summary.user);
    setQuotaSnapshot(summary.quota);
    setQuotaLabel(summary.quota ? `${new Intl.NumberFormat("zh-CN").format(summary.quota.quota_units)} ✦` : null);
    setMembershipSnapshot(summary.membership);
    setCheckInStatus(summary.checkIn.checkIn.status === "checked" ? "checked" : "available");
  }, []);

  const refreshAccountSnapshot = useCallback(async (user: PublicAuthUser | null) => {
    if (!user) {
      clearCachedAccountSnapshot();
      setQuotaSnapshot(null);
      setQuotaLabel(null);
      setMembershipSnapshot(null);
      setCheckInStatus("unavailable");
      return;
    }

    setAccountLoading(true);
    setCheckInStatus("loading");
    try {
      const summary = await fetchJson<AccountSummaryResponse>("/api/account/summary");
      applyAccountSummary(summary);
    } finally {
      setAccountLoading(false);
    }
  }, [applyAccountSummary]);

  const accountPlanStatus = useMemo<PlanStatus>(() => {
    if (!sessionUser) return { status: "unavailable" };
    if (accountLoading && !membershipSnapshot) return { status: "loading" };
    const activeMembership = membershipSnapshot?.membership.active;
    if (!activeMembership) return { status: "none" };
    const activePlan = membershipSnapshot?.plans.find((plan) => plan.id === activeMembership.plan_id);
    return { status: "active", name: activePlan?.name || "会员" };
  }, [accountLoading, membershipSnapshot, sessionUser]);
  const accountDisplayLoading = accountLoading && !quotaSnapshot && !membershipSnapshot;

  const handleLogout = useCallback(async () => {
    try {
      await fetchJsonWithCsrf("/api/auth/logout", { method: "POST" });
    } finally {
      setSessionUser(null);
      clearCachedAccountSnapshot();
      setQuotaSnapshot(null);
      setQuotaLabel(null);
      setMembershipSnapshot(null);
      setCheckInStatus("unavailable");
      router.replace("/login");
    }
  }, [router]);

  const handleCheckIn = useCallback(async () => {
    if (!sessionUser || checkInStatus === "checked" || checkInStatus === "submitting") return;
    setCheckInStatus("submitting");
    try {
      const result = await fetchJsonWithCsrf<CheckInResponse>("/api/check-in", { method: "POST" });
      setCheckInStatus(result.checkIn.status === "checked" ? "checked" : "available");
      await refreshAccountSnapshot(sessionUser);
    } catch {
      setCheckInStatus("error");
    }
  }, [checkInStatus, refreshAccountSnapshot, sessionUser]);

  useEffect(() => {
    let cancelled = false;
    const cached = readAnyCachedAccountSnapshot();
    if (cached?.user) {
      setSessionUser(cached.user);
      applyCachedAccountSnapshot(cached.user.local_user_id);
    }

    void (async () => {
      try {
        const summary = await fetchJson<AccountSummaryResponse>("/api/account/summary");
        if (cancelled) return;
        if ("ok" in summary && summary.ok) {
          applyCachedAccountSnapshot(summary.user.local_user_id);
          applyAccountSummary(summary);
          return;
        }
        setSessionUser(null);
        clearCachedAccountSnapshot();
        setQuotaSnapshot(null);
        setQuotaLabel(null);
        setMembershipSnapshot(null);
        setCheckInStatus("unavailable");
      } catch {
        if (!cancelled) {
          setSessionUser(null);
          clearCachedAccountSnapshot();
          setQuotaSnapshot(null);
          setQuotaLabel(null);
          setMembershipSnapshot(null);
          setCheckInStatus("unavailable");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [applyAccountSummary, applyCachedAccountSnapshot]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const raw = window.localStorage.getItem(favoriteTemplateStorageKey);
        const ids = raw ? JSON.parse(raw) : [];
        if (Array.isArray(ids)) {
          setFavoriteIds(new Set(ids.filter((id): id is string => typeof id === "string")));
        }
      } catch {
        setFavoriteIds(new Set());
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <WorkbenchShell
      state={{ activeToolId: "templates" }}
      onToolAction={handleToolAction}
      isAuthenticated={Boolean(sessionUser)}
      canAccessAdmin={sessionUser?.role === "admin"}
      accountName={sessionUser?.display_name || sessionUser?.username || null}
      accountPointsLabel={quotaLabel}
      accountPlanLabel={accountDisplayLoading ? "会员加载中" : getPlanStatusDisplay(accountPlanStatus).label}
      onOpenAccountCenter={handleOpenAccountCenter}
      onOpenAccountRecharge={handleOpenRechargeCenter}
      accountSlot={(
        <WorkspaceAccountPanel
          user={sessionUser}
          quota={quotaSnapshot}
          membershipEntitlements={membershipSnapshot?.membership.entitlements ?? null}
          loading={accountDisplayLoading}
          planStatus={accountPlanStatus}
          membershipEndsAt={membershipSnapshot?.membership.active?.ends_at ?? null}
          checkInStatus={checkInStatus}
          onRefresh={() => void refreshAccountSnapshot(sessionUser)}
          onLogout={() => void handleLogout()}
          onOpenCenter={handleOpenAccountCenter}
          onOpenRecharge={handleOpenRechargeCenter}
          onOpenUsage={() => router.push(`/?account=usage${previewMode ? "&preview=1" : ""}`)}
          onOpenOrders={() => router.push(`/?account=orders${previewMode ? "&preview=1" : ""}`)}
          onCheckInUnavailable={() => void handleCheckIn()}
        />
      )}
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
          favoriteIds={favoriteIds}
          onScopeChange={(nextScope) => {
            setCategory("全部");
            router.push(`${templateTabHref(nextScope)}${previewMode ? "&preview=1" : ""}`, { scroll: false });
          }}
          onSearchChange={setSearch}
          onCategoryChange={setCategory}
          onFavoriteToggle={handleFavoriteToggle}
        />
      }
    />
  );
}

function withPreviewParam(href: string, previewMode: boolean) {
  if (!previewMode || href.includes("preview=1")) return href;
  return `${href}${href.includes("?") ? "&" : "?"}preview=1`;
}

const templateCategoryMeta: Record<TemplateFilter, { title: string; description: string }> = {
  "全部": {
    title: "全部",
    description: "查看图片和视频的全部模板分类。",
  },
  "收藏": {
    title: "收藏",
    description: "查看自己收藏的常用模板。",
  },
  "商品美食": {
    title: "商品美食",
    description: "商品图、美食、服装和商业展示。",
  },
  "电商详情": {
    title: "电商详情",
    description: "详情页、卖点拆解、对比图和长图。",
  },
  "海报品牌": {
    title: "海报品牌",
    description: "促销海报、活动主视觉和品牌系统。",
  },
  "社媒内容": {
    title: "社媒内容",
    description: "短视频封面、UGC 种草、口播和笔记。",
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
  className,
}: {
  category: TemplateFilter;
  counts: Record<TemplateFilter, number>;
  onCategoryChange: (value: TemplateFilter) => void;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [desktopCategoriesExpanded, setDesktopCategoriesExpanded] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 1200px)");
    const sync = () => setDesktopCategoriesExpanded(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  const availableCategories = (["收藏", ...templateCategories] as TemplateFilter[]).filter((item) => {
    return item === "全部" || item === "收藏" || counts[item] > 0 || item === category;
  });
  const categoriesExpanded = expanded || desktopCategoriesExpanded;
  const visibleCategories = categoriesExpanded
    ? availableCategories
    : availableCategories.filter((item) => defaultTemplateCategoryIds.includes(item) || item === category);
  const hiddenCount = Math.max(0, availableCategories.length - visibleCategories.length);

  return (
    <div className={cn("template-center-panel", className)}>
      <div className="template-center-categories" role="group" aria-label="模板分类">
        {visibleCategories.map((item) => {
          const meta = templateCategoryMeta[item] || {
            title: item,
            description: "",
          };
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
        {!desktopCategoriesExpanded && (hiddenCount > 0 || expanded) ? (
          <button
            type="button"
            className="template-center-category template-center-category--more"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
          >
            <span>
              <strong>{expanded ? "收起分类" : `展开 ${hiddenCount} 个`}</strong>
            </span>
            {expanded ? <ChevronUp className="size-4" aria-hidden="true" /> : <ChevronDown className="size-4" aria-hidden="true" />}
          </button>
        ) : null}
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
  favoriteIds,
  onScopeChange,
  onSearchChange,
  onCategoryChange,
  onFavoriteToggle,
}: {
  scope: TemplateScope;
  previewMode: boolean;
  search: string;
  category: TemplateFilter;
  counts: Record<TemplateFilter, number>;
  templates: TemplatePromptTemplate[];
  totalCount: number;
  favoriteIds: Set<string>;
  onScopeChange: (scope: TemplateScope) => void;
  onSearchChange: (value: string) => void;
  onCategoryChange: (value: TemplateFilter) => void;
  onFavoriteToggle: (id: string) => void;
}) {
  const gridMotionKey = `${scope}:${category}:${search.trim().toLowerCase()}`;
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [mobileCategoryOpen, setMobileCategoryOpen] = useState(false);
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(templates.length / templatePageSize));
  const safePage = Math.min(page, pageCount);
  const visibleTemplates = templates.slice((safePage - 1) * templatePageSize, safePage * templatePageSize);
  const placeholderCount = visibleTemplates.length ? Math.max(0, templatePageSize - visibleTemplates.length) : 0;
  const pageNumbers = Array.from({ length: pageCount }, (_, index) => index + 1);

  const handleCategoryChange = (value: TemplateFilter) => {
    setPage(1);
    onCategoryChange(value);
    setMobileCategoryOpen(false);
  };

  const handleScopeChange = (value: TemplateScope) => {
    setPage(1);
    onScopeChange(value);
  };

  const handleSearchChange = (value: string) => {
    setPage(1);
    onSearchChange(value);
  };

  const openMobileSearch = () => {
    setMobileSearchOpen((value) => {
      const next = !value;
      if (next) window.requestAnimationFrame(() => searchInputRef.current?.focus());
      return next;
    });
  };

  const openMobileCategories = () => {
    setMobileCategoryOpen((value) => !value);
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
        </div>
        <span className="shell-chip">共 {totalCount} 个模板</span>
      </div>

      <div
        className={cn(
          "template-center-toolbar",
          (mobileSearchOpen || search.trim()) && "is-search-open",
          (mobileCategoryOpen || category !== "全部") && "is-filter-open",
        )}
      >
        <div className="template-center-tabs" role="tablist" aria-label="模板类型">
          <button
            type="button"
            className={cn("template-center-tab", scope === "image" && "is-active")}
            aria-pressed={scope === "image"}
            onClick={() => handleScopeChange("image")}
          >
            图片模板
          </button>
          <button
            type="button"
            className={cn("template-center-tab", scope === "video" && "is-active")}
            aria-pressed={scope === "video"}
            onClick={() => handleScopeChange("video")}
          >
            视频模板
          </button>
        </div>

        <button
          type="button"
          className="template-center-search-trigger"
          onClick={openMobileSearch}
          aria-label="搜索模板"
          aria-expanded={mobileSearchOpen || Boolean(search.trim())}
        >
          <Search className="size-4" aria-hidden="true" />
        </button>

        <button
          type="button"
          className={cn("template-center-filter-trigger", (mobileCategoryOpen || category !== "全部") && "is-active")}
          onClick={openMobileCategories}
          aria-label="筛选模板分类"
          aria-expanded={mobileCategoryOpen || category !== "全部"}
        >
          <SlidersHorizontal className="size-4" aria-hidden="true" />
        </button>

        <label className="template-center-search">
          <Search className="size-4" aria-hidden="true" />
          <input
            ref={searchInputRef}
            className="studio-input"
            type="search"
            value={search}
            onChange={(event) => handleSearchChange(event.target.value)}
            placeholder="搜索模板"
          />
        </label>

        <TemplateCategoryPanel
          category={category}
          counts={counts}
          onCategoryChange={handleCategoryChange}
          className={cn(mobileCategoryOpen && "is-open is-popover")}
        />
      </div>

      <div key={gridMotionKey} className="template-center-grid" aria-label="模板列表">
        {visibleTemplates.length ? (
          <>
            {visibleTemplates.map((template, index) => (
              <article
                key={template.id}
                className="template-center-card"
              >
                <span className="template-center-card__thumb">
                  <TemplateThumbnail template={template} loading={index < 12 ? "eager" : "lazy"} fetchPriority={index < 12 ? "auto" : "low"} />
                  <button
                    type="button"
                    className={cn("template-center-card__favorite", favoriteIds.has(template.id) && "is-active")}
                    onClick={() => onFavoriteToggle(template.id)}
                    aria-pressed={favoriteIds.has(template.id)}
                    aria-label={favoriteIds.has(template.id) ? "取消收藏模板" : "收藏模板"}
                  >
                    <Star className="size-4" aria-hidden="true" />
                  </button>
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
                  使用模板
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
              </article>
            ))}
            {Array.from({ length: placeholderCount }, (_, index) => (
              <span key={`template-placeholder-${index}`} className="template-center-card template-center-card--placeholder" aria-hidden="true" />
            ))}
          </>
        ) : (
          <div className="template-center-empty" role="status">
            <strong>没有找到模板</strong>
            <span>可以换一个关键词或分类再试。</span>
          </div>
        )}
      </div>

      {templates.length > templatePageSize ? (
        <div className="template-center-pagination" aria-label="模板分页">
          <button
            type="button"
            className="template-center-page-button"
            onClick={() => setPage((value) => Math.max(1, value - 1))}
            disabled={safePage <= 1}
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            上一页
          </button>
          <span className="template-center-page-status" aria-label={`当前第 ${safePage} 页，共 ${pageCount} 页`}>
            {pageNumbers.map((pageNumber) => (
              <button
                key={pageNumber}
                type="button"
                className={cn("template-center-page-number", safePage === pageNumber && "is-active")}
                onClick={() => setPage(pageNumber)}
                aria-current={safePage === pageNumber ? "page" : undefined}
              >
                {pageNumber}
              </button>
            ))}
          </span>
          <button
            type="button"
            className="template-center-page-button"
            onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
            disabled={safePage >= pageCount}
          >
            下一页
            <ArrowRight className="size-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
