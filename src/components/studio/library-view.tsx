"use client";

import { useRef, useState, type CSSProperties } from "react";
import { ArrowDownUp, ImageUp, Loader2, RefreshCw, Search, Trash2, X } from "lucide-react";

import { LibraryCardActions, MediaCard } from "@/components/studio/media-card";
import { CustomSelect } from "@/components/studio/shared";
import type { LibraryFilter, LibrarySort } from "@/components/studio/types";
import type { LibraryItem } from "@/lib/server/types";
import { cn } from "@/lib/utils";

export function LibraryWorkspace({
  items,
  totalCount,
  count,
  selectedItem,
  loading,
  error,
  isAuthenticated,
  filter,
  sort,
  search,
  deletingItemId,
  removingItemId,
  missingMediaIds,
  onFilterChange,
  onSortChange,
  onSearchChange,
  onSelectItem,
  onDelete,
  onRefresh,
  onMediaMissing,
  onLogin,
  onStartCreate,
}: {
  items: LibraryItem[];
  totalCount: number;
  count: { all: number; image: number; video: number };
  selectedItem: LibraryItem | null;
  loading: boolean;
  error: string;
  isAuthenticated: boolean;
  filter: LibraryFilter;
  sort: LibrarySort;
  search: string;
  deletingItemId: string | null;
  removingItemId: string | null;
  missingMediaIds: Set<string>;
  onFilterChange: (value: LibraryFilter) => void;
  onSortChange: (value: LibrarySort) => void;
  onSearchChange: (value: string) => void;
  onSelectItem: (id: string | null) => void;
  onDelete: (id: string) => Promise<void>;
  onRefresh: () => Promise<void>;
  onMediaMissing: (id: string) => void;
  onLogin: () => void;
  onStartCreate: () => void;
}) {
  const searchActive = Boolean(search.trim());
  const filteredEmpty = !items.length && (totalCount > 0 || searchActive);

  return (
    <div className="studio-library-page">
      <header className="studio-library-page__header">
        <div>
          <h2>作品库</h2>
          <p>作品仅保存24小时，请及时下载。</p>
        </div>
        <span className="studio-library-page__count">共 {totalCount} 件作品</span>
      </header>

      <div className="studio-library-page__controls">
        <LibraryKindTabs count={count} filter={filter} onFilterChange={onFilterChange} />
        <LibraryToolbar
          sort={sort}
          search={search}
          onSortChange={onSortChange}
          onSearchChange={onSearchChange}
        />
      </div>

      {loading ? (
        <div className="studio-library-skeleton-grid" role="status" aria-label="正在加载作品">
          {Array.from({ length: 8 }, (_, index) => (
            <div
              key={index}
              className="studio-library-skeleton-card"
              style={{ "--library-card-delay": `${index < 6 ? index * 28 : 0}ms` } as CSSProperties}
            >
              <span className="motion-skeleton-shimmer" />
              <strong className="motion-skeleton-shimmer" />
              <small className="motion-skeleton-shimmer" />
            </div>
          ))}
        </div>
      ) : error ? (
        <LibraryEmptyState
          tone="error"
          title="作品加载失败"
          description="请检查网络后重试"
          actionLabel="重新加载"
          onAction={() => void onRefresh()}
        />
      ) : !items.length ? (
        !isAuthenticated ? (
          <LibraryEmptyState
            title="登录后查看你的作品"
            description="你生成的图片和视频会自动保存在这里，方便随时预览、下载和继续创作。"
            actionLabel="登录查看作品"
            onAction={onLogin}
          />
        ) : filteredEmpty ? (
          <LibraryEmptyState
            title="没有匹配的作品"
            description={`当前${filter === "image" ? "图片" : "视频"}分类下没有找到符合条件的作品。`}
            actionLabel={searchActive ? "清空搜索" : undefined}
            onAction={searchActive ? () => onSearchChange("") : undefined}
            secondaryLabel="刷新作品库"
            onSecondary={() => void onRefresh()}
          />
        ) : (
          <LibraryEmptyState
            title="还没有生成作品"
            description="完成第一次图片或视频生成后，作品会自动出现在这里。"
            actionLabel="开始创作"
            onAction={onStartCreate}
            secondaryLabel="刷新作品库"
            onSecondary={() => void onRefresh()}
          />
        )
      ) : (
        <div className="studio-library-grid">
          {items.map((item, index) => (
            <div
              key={item.id}
              className={cn(
                "studio-library-tile",
                selectedItem?.id === item.id && "is-active",
                deletingItemId === item.id && "is-deleting",
                removingItemId === item.id && "is-removing",
              )}
              style={{ "--library-card-delay": `${index < 6 ? index * 28 : 0}ms` } as CSSProperties}
            >
              <button
                type="button"
                className="studio-library-tile__preview"
                onClick={() => onSelectItem(item.id)}
                aria-label={`预览作品 ${item.title}`}
              >
                <MediaCard
                  item={item}
                  mediaMissing={missingMediaIds.has(item.id) || item.fileAvailable === false}
                  onMediaMissing={() => onMediaMissing(item.id)}
                />
              </button>
              <LibraryCardActions
                item={item}
                mediaMissing={missingMediaIds.has(item.id) || item.fileAvailable === false}
                deleting={deletingItemId === item.id}
                onPreview={() => onSelectItem(item.id)}
                onDelete={() => void onDelete(item.id)}
              />
            </div>
          ))}
        </div>
      )}

      {selectedItem ? (
        <div className="studio-library-modal" role="dialog" aria-modal="true" aria-label={selectedItem.title}>
          <div className="studio-library-modal__backdrop" onClick={() => onSelectItem(null)} />
          <div className="studio-library-detail">
            <button type="button" className="studio-icon-button studio-library-detail__close" aria-label="关闭预览" onClick={() => onSelectItem(null)}>
              <X className="size-4" aria-hidden="true" />
            </button>
            <MediaCard
              item={selectedItem}
              large
              mediaMissing={missingMediaIds.has(selectedItem.id) || selectedItem.fileAvailable === false}
              onMediaMissing={() => onMediaMissing(selectedItem.id)}
            />
            <div className="studio-actions">
              <button
                type="button"
                className="studio-secondary-button"
                onClick={() => void onDelete(selectedItem.id)}
                disabled={deletingItemId === selectedItem.id}
              >
                {deletingItemId === selectedItem.id ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    删除中
                  </>
                ) : (
                  <>
                    <Trash2 className="size-4" aria-hidden="true" />
                    删除
                  </>
                )}
              </button>
              <button type="button" className="studio-secondary-button" onClick={() => void onRefresh()}>
                <RefreshCw className="size-4" aria-hidden="true" />
                刷新
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function LibraryDeleteConfirmDialog({
  item,
  deleting,
  onCancel,
  onConfirm,
}: {
  item: LibraryItem | null;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!item) return null;

  return (
    <div className="studio-library-confirm" role="dialog" aria-modal="true" aria-labelledby="library-delete-confirm-title">
      <button
        type="button"
        className="studio-library-confirm__backdrop"
        aria-label="取消删除"
        onClick={onCancel}
        disabled={deleting}
      />
      <section className="studio-library-confirm__card">
        <span className="studio-library-confirm__icon" aria-hidden="true">
          <Trash2 className="size-5" />
        </span>
        <div className="studio-library-confirm__copy">
          <p className="shell-eyebrow">删除作品</p>
          <h3 id="library-delete-confirm-title">确认删除这个作品？</h3>
          <p>
            作品「{item.title || "未命名作品"}」删除后会同步移除可删除的本地结果文件，操作完成后不能在作品库中恢复。
          </p>
        </div>
        <div className="studio-library-confirm__actions">
          <button type="button" className="studio-secondary-button" onClick={onCancel} disabled={deleting}>
            取消
          </button>
          <button type="button" className="studio-danger-button" onClick={onConfirm} disabled={deleting}>
            {deleting ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                删除中
              </>
            ) : (
              <>
                <Trash2 className="size-4" aria-hidden="true" />
                确认删除
              </>
            )}
          </button>
        </div>
      </section>
    </div>
  );
}

function LibraryKindTabs({
  count,
  filter,
  onFilterChange,
}: {
  count: { all: number; image: number; video: number };
  filter: LibraryFilter;
  onFilterChange: (value: LibraryFilter) => void;
}) {
  return (
    <div className="studio-library-kind-tabs" role="group" aria-label="作品类型">
      {([
        ["image", "图片", count.image],
        ["video", "视频", count.video],
      ] as const).map(([id, label, value]) => (
        <button
          key={id}
          type="button"
          aria-pressed={filter === id}
          className={cn("studio-library-kind-tab", filter === id && "is-active")}
          onClick={() => onFilterChange(id)}
        >
          <span>{label}</span>
          <strong>{value}</strong>
        </button>
      ))}
    </div>
  );
}

function LibraryToolbar({
  sort,
  search,
  onSortChange,
  onSearchChange,
}: {
  sort: LibrarySort;
  search: string;
  onSortChange: (value: LibrarySort) => void;
  onSearchChange: (value: string) => void;
}) {
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const searchVisible = mobileSearchOpen || Boolean(search.trim());

  const toggleMobileSearch = () => {
    setMobileSearchOpen((value) => {
      const next = !value;
      if (next) window.requestAnimationFrame(() => searchInputRef.current?.focus());
      return next;
    });
  };

  return (
    <div className={cn("studio-library-toolbar", searchVisible && "is-search-open")}>
      <button
        type="button"
        className={cn("studio-library-search-trigger", searchVisible && "is-active")}
        onClick={toggleMobileSearch}
        aria-label="搜索作品"
        aria-expanded={searchVisible}
      >
        <Search className="size-4" aria-hidden="true" />
      </button>
      <div className="studio-library-toolbar__search">
        <Search className="size-4" aria-hidden="true" />
        <label className="studio-sr-only" htmlFor="library-search">查找作品</label>
        <input
          ref={searchInputRef}
          id="library-search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="搜索作品"
          className="studio-input"
        />
      </div>
      <CustomSelect
        label="排序"
        value={sort}
        icon={<ArrowDownUp className="size-4" />}
        options={[
          { value: "recent", label: "最新" },
          { value: "title", label: "标题" },
        ]}
        onChange={(value) => onSortChange(value as LibrarySort)}
      />
    </div>
  );
}

function LibraryEmptyState({
  title,
  description,
  actionLabel,
  secondaryLabel,
  tone,
  onAction,
  onSecondary,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  secondaryLabel?: string;
  tone?: "error";
  onAction?: () => void;
  onSecondary?: () => void;
}) {
  return (
    <div className={cn("studio-library-empty-state", tone === "error" && "is-error")}>
      <div className="studio-library-empty-state__icon" aria-hidden="true">
        <ImageUp className="size-7" />
      </div>
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      {(actionLabel && onAction) || (secondaryLabel && onSecondary) ? (
        <div className="studio-library-empty-state__actions">
          {actionLabel && onAction ? (
            <button type="button" className="studio-primary-action studio-library-empty-state__primary" onClick={onAction}>
              {actionLabel}
            </button>
          ) : null}
          {secondaryLabel && onSecondary ? (
            <button type="button" className="studio-secondary-button" onClick={onSecondary}>
              {secondaryLabel}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
