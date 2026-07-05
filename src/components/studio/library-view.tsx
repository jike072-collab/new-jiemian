"use client";

import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ArrowDownUp, Download, ImageUp, Loader2, RefreshCw, Search, Trash2, Video, Wand2, X } from "lucide-react";

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
  onRegenerate,
  onUpscale,
  onCreateVideo,
  onEditImage,
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
  onRegenerate: (item: LibraryItem) => void;
  onUpscale: (item: LibraryItem) => void;
  onCreateVideo: (item: LibraryItem) => void;
  onEditImage: (item: LibraryItem) => void;
  onRefresh: () => Promise<void>;
  onMediaMissing: (id: string) => void;
  onLogin: () => void;
  onStartCreate: () => void;
}) {
  const searchActive = Boolean(search.trim());
  const filteredEmpty = !items.length && (totalCount > 0 || searchActive);
  const displayEntries = useMemo(() => buildLibraryDisplayEntries(items), [items]);
  const selectedMediaMissing = selectedItem ? missingMediaIds.has(selectedItem.id) || selectedItem.fileAvailable === false : false;
  const selectedEntry = selectedItem
    ? displayEntries.find((entry) => entry.items.some((item) => item.id === selectedItem.id)) || null
    : null;
  const selectedCanUseOutput = Boolean(selectedItem?.output?.url && !selectedMediaMissing && !selectedItem.expired);
  const selectedCanDownloadStoredFile = Boolean(selectedItem?.output?.url && selectedItem.output.storedName && !selectedMediaMissing);

  const openItemFromKeyboard = (event: KeyboardEvent<HTMLElement>, id: string) => {
    if (event.target !== event.currentTarget) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onSelectItem(id);
  };

  return (
    <div className="studio-library-page">
      <header className="studio-library-page__header">
        <div>
          <h2>作品库</h2>
          <p>作品文件仅保存 24 小时，请及时下载保存。</p>
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
          {displayEntries.map((entry) => {
            const item = entry.item;
            const isVideo = item.type === "video";
            const entryActive = selectedItem ? entry.items.some((entryItem) => entryItem.id === selectedItem.id) : false;
            const entryDeleting = entry.items.some((entryItem) => deletingItemId === entryItem.id);
            const entryRemoving = entry.items.some((entryItem) => removingItemId === entryItem.id);
            const itemMissing = missingMediaIds.has(item.id) || item.fileAvailable === false;
            return (
              <div
                key={entry.id}
                className={cn(
                  "studio-library-tile",
                  entry.items.length > 1 && "is-group",
                  entryActive && "is-active",
                  entryDeleting && "is-deleting",
                  entryRemoving && "is-removing",
                )}
              >
                {isVideo ? (
                  <div
                    className="studio-library-tile__preview"
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelectItem(item.id)}
                    onKeyDown={(event) => openItemFromKeyboard(event, item.id)}
                    aria-label={`预览作品 ${item.title}`}
                  >
                    <MediaCard
                      item={item}
                      mediaMissing={itemMissing}
                      onMediaMissing={() => onMediaMissing(item.id)}
                    />
                  </div>
                ) : (
                  <button
                    type="button"
                    className="studio-library-tile__preview"
                    onClick={() => onSelectItem(item.id)}
                    aria-label={`预览作品 ${item.title}`}
                  >
                    <MediaCard
                      item={item}
                      groupItems={entry.items}
                      mediaMissing={itemMissing}
                      onMediaMissing={() => onMediaMissing(item.id)}
                    />
                  </button>
                )}
                <LibraryCardActions
                  item={item}
                  mediaMissing={itemMissing}
                  deleting={entryDeleting}
                  onDelete={() => void onDelete(item.id)}
                  onRegenerate={() => onRegenerate(item)}
                  onUpscale={() => onUpscale(item)}
                  onCreateVideo={() => onCreateVideo(item)}
                  onEditImage={() => onEditImage(item)}
                />
              </div>
            );
          })}
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
              groupItems={selectedEntry?.items}
              large
              mediaMissing={selectedMediaMissing}
              onMediaMissing={() => onMediaMissing(selectedItem.id)}
            />
            <div className="studio-library-detail__actions" aria-label="作品操作">
              <button type="button" className="studio-library-detail__action" onClick={() => onRegenerate(selectedItem)}>
                <RefreshCw className="size-4" aria-hidden="true" />
                重新生成
              </button>
              <button
                type="button"
                className="studio-library-detail__action"
                onClick={() => onUpscale(selectedItem)}
                disabled={!selectedCanUseOutput}
              >
                <ImageUp className="size-4" aria-hidden="true" />
                {selectedItem.type === "image" ? "放大" : "视频放大"}
              </button>
              {selectedItem.type === "image" ? (
                <>
                  <button
                    type="button"
                    className="studio-library-detail__action"
                    onClick={() => onCreateVideo(selectedItem)}
                    disabled={!selectedCanUseOutput}
                  >
                    <Video className="size-4" aria-hidden="true" />
                    生成视频
                  </button>
                  <button
                    type="button"
                    className="studio-library-detail__action"
                    onClick={() => onEditImage(selectedItem)}
                    disabled={!selectedCanUseOutput}
                  >
                    <Wand2 className="size-4" aria-hidden="true" />
                    图片编辑
                  </button>
                </>
              ) : null}
              {selectedCanDownloadStoredFile ? (
                <a className="studio-library-detail__action" href={selectedItem.output?.url} download>
                  <Download className="size-4" aria-hidden="true" />
                  下载
                </a>
              ) : null}
              <button type="button" className="studio-library-detail__action" onClick={() => void onRefresh()}>
                <RefreshCw className="size-4" aria-hidden="true" />
                刷新
              </button>
              <button
                type="button"
                className="studio-library-detail__action is-danger"
                onClick={() => void onDelete(selectedItem.id)}
                disabled={deletingItemId === selectedItem.id}
              >
                {deletingItemId === selectedItem.id ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Trash2 className="size-4" aria-hidden="true" />}
                {deletingItemId === selectedItem.id ? "删除中" : "删除"}
              </button>
            </div>
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

type LibraryDisplayEntry = {
  id: string;
  item: LibraryItem;
  items: LibraryItem[];
  key: string | null;
  stableBatch: boolean;
};

function buildLibraryDisplayEntries(items: LibraryItem[]): LibraryDisplayEntry[] {
  const entries: LibraryDisplayEntry[] = [];
  for (const item of items) {
    const batch = imageBatchIdentity(item);
    if (!batch) {
      entries.push({ id: item.id, item, items: [item], key: null, stableBatch: false });
      continue;
    }

    const target = entries.find((entry) => (
      entry.key === batch.key
      && entry.items.length < 4
      && (batch.stable || withinLegacyImageBatchWindow(entry.items[0], item))
    ));
    if (!target) {
      entries.push({ id: batch.stable ? batch.key : item.id, item, items: [item], key: batch.key, stableBatch: batch.stable });
      continue;
    }
    target.items.push(item);
  }
  return entries;
}

function imageBatchIdentity(item: LibraryItem): { key: string; stable: boolean } | null {
  if (item.type !== "image" || item.status !== "done" || !item.output?.url) return null;
  const batchId = typeof item.params.imageBatchId === "string" ? item.params.imageBatchId.trim() : "";
  if (batchId) return { key: `batch:${batchId}`, stable: true };
  if (item.mode !== "text-to-image" && item.mode !== "image-to-image") return null;
  return {
    key: [
      "legacy-image",
      item.mode,
      item.prompt.trim(),
      item.providerId,
      item.model,
      String(item.params.ratio || ""),
      String(item.params.quality || ""),
      String(item.params.referenceImages || ""),
    ].join("\u001f"),
    stable: false,
  };
}

function withinLegacyImageBatchWindow(first: LibraryItem, next: LibraryItem) {
  const firstTime = Number(new Date(first.createdAt));
  const nextTime = Number(new Date(next.createdAt));
  if (!Number.isFinite(firstTime) || !Number.isFinite(nextTime)) return false;
  return Math.abs(firstTime - nextTime) <= 5 * 60 * 1000;
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
