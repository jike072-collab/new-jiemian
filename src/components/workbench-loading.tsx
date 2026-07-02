"use client";

import { BrandLogo } from "@/components/brand-logo";
import { SkeletonShimmer } from "@/components/motion";
import { PreviewState } from "@/components/studio/shared";
import { cn } from "@/lib/utils";

type WorkbenchLoadingShellProps = {
  toolTitle?: string;
  previewTitle?: string;
};

export function WorkbenchLoadingShell({
  toolTitle = "图片生成",
  previewTitle = "创作预览",
}: WorkbenchLoadingShellProps) {
  return (
    <div className="shell-root shell-root--tool-image workbench-loading-shell min-h-[100dvh] overflow-hidden bg-[var(--background)] text-[var(--foreground)]">
      <header className="shell-header relative">
        <div className="shell-header__brand">
          <div className="shell-brand" aria-hidden="true">
            <BrandLogo className="shell-brand__logo" />
            <span className="shell-brand__text">奥皇 AI</span>
          </div>
        </div>
        <div className="shell-header__actions">
          <div className="workspace-account-chip hidden items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/68 md:flex">
            <SkeletonShimmer className="workbench-loading-shell__chip" />
            <span className="text-white/38">/</span>
            <SkeletonShimmer className="workbench-loading-shell__points" />
          </div>
          <div className="shell-account" aria-hidden="true">
            <span className="shell-account__avatar">AI</span>
            <span className="shell-account__meta">
              <SkeletonShimmer className="workbench-loading-shell__account-name" />
              <SkeletonShimmer className="workbench-loading-shell__account-points" />
            </span>
          </div>
        </div>
      </header>

      <main className="shell-main">
        <div className="shell-grid">
          <aside className="shell-nav" aria-hidden="true">
            <div className="shell-nav__brand">
              <BrandLogo className="shell-nav__brand-logo" />
              <span className="shell-nav__brand-copy">
                <strong>奥皇 AI</strong>
                <small>AI VISUAL STUDIO</small>
              </span>
            </div>
            <div className="shell-nav__scroll">
              <div className="shell-nav__groups">
                {Array.from({ length: 7 }).map((_, index) => (
                  <div key={index} className={cn("workbench-loading-shell__nav-item", index === 0 && "is-active")}>
                    <SkeletonShimmer className="workbench-loading-shell__nav-icon" />
                    <div className="workbench-loading-shell__nav-copy">
                      <SkeletonShimmer className="workbench-loading-shell__nav-title" />
                      <SkeletonShimmer className="workbench-loading-shell__nav-subtitle" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </aside>

          <section className="shell-panel shell-panel--controls">
            <div className="shell-panel__header shell-panel__header--tool">
              <div>
                <h2 className="shell-title">{toolTitle}</h2>
              </div>
            </div>
            <div className="shell-panel__body">
              <FormPanelLoadingFallback />
            </div>
          </section>

          <section className="shell-panel shell-panel--preview">
            <div className="shell-panel__body shell-panel__body--preview">
              <PreviewPanelLoadingFallback title={previewTitle} />
            </div>
          </section>
        </div>
      </main>

      <div className="shell-mobile-space" />
    </div>
  );
}

export function FormPanelLoadingFallback({
  compact = false,
}: {
  compact?: boolean;
}) {
  return (
    <div className={cn("studio-form-panel workbench-loading-form", compact && "is-compact")}>
      <div className="studio-form-panel__content">
        {Array.from({ length: compact ? 4 : 6 }).map((_, index) => (
          <section key={index} className="workbench-loading-form__field" aria-hidden="true">
            <div className="workbench-loading-form__head">
              <SkeletonShimmer className="workbench-loading-form__label" />
              <SkeletonShimmer className="workbench-loading-form__meta" />
            </div>
            <SkeletonShimmer className={cn("workbench-loading-form__control", index === 2 && !compact && "is-tall")} />
          </section>
        ))}
        <div className="workbench-loading-form__footer" aria-hidden="true">
          <SkeletonShimmer className="workbench-loading-form__button" />
        </div>
      </div>
    </div>
  );
}

export function PreviewPanelLoadingFallback({
  title = "创作预览",
}: {
  title?: string;
}) {
  return (
    <PreviewState eyebrow="创作预览" title={title} description="正在准备工作区">
      <div className="workbench-loading-preview" aria-hidden="true">
        <SkeletonShimmer className="workbench-loading-preview__media" />
        <div className="workbench-loading-preview__lines">
          <SkeletonShimmer className="workbench-loading-preview__line is-wide" />
          <SkeletonShimmer className="workbench-loading-preview__line" />
          <SkeletonShimmer className="workbench-loading-preview__line is-short" />
        </div>
      </div>
    </PreviewState>
  );
}

export function LibraryWorkspaceLoadingFallback() {
  return (
    <div className="studio-library-page" aria-busy="true">
      <header className="studio-library-page__header">
        <div>
          <h2>作品库</h2>
          <p>正在同步你的最近作品</p>
        </div>
        <span className="studio-library-page__count">加载中</span>
      </header>
      <div className="studio-library-page__controls">
        <div className="workbench-loading-library__tabs" aria-hidden="true">
          <SkeletonShimmer className="workbench-loading-library__tab" />
          <SkeletonShimmer className="workbench-loading-library__tab" />
        </div>
        <div className="workbench-loading-library__toolbar" aria-hidden="true">
          <SkeletonShimmer className="workbench-loading-library__search" />
          <SkeletonShimmer className="workbench-loading-library__sort" />
        </div>
      </div>
      <div className="studio-library-skeleton-grid" role="status" aria-label="正在加载作品">
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className="studio-library-skeleton-card">
            <span className="motion-skeleton-shimmer" />
            <strong className="motion-skeleton-shimmer" />
            <small className="motion-skeleton-shimmer" />
          </div>
        ))}
      </div>
    </div>
  );
}
