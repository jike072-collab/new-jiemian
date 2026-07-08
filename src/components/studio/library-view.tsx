"use client";

import { useEffect, useMemo, useState, type KeyboardEvent, type MouseEvent } from "react";
import { ArrowDownUp, ArrowLeft, ArrowRight, Check, Download, ImageUp, Loader2, RefreshCw, Trash2, Video, Wand2, X } from "lucide-react";

import { MediaCard } from "@/components/studio/media-card";
import type { LibraryFilter, LibrarySort } from "@/components/studio/types";
import type { LibraryItem } from "@/lib/server/types";
import { cn } from "@/lib/utils";

const libraryPageSize = 18;

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
  bulkDeleting,
  removingItemId,
  missingMediaIds,
  onFilterChange,
  onSortChange,
  onSearchChange,
  onSelectItem,
  onDelete,
  onDeleteMany,
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
  bulkDeleting: boolean;
  removingItemId: string | null;
  missingMediaIds: Set<string>;
  onFilterChange: (value: LibraryFilter) => void;
  onSortChange: (value: LibrarySort) => void;
  onSearchChange: (value: string) => void;
  onSelectItem: (id: string | null) => void;
  onDelete: (id: string) => Promise<void>;
  onDeleteMany: (ids: string[]) => Promise<void>;
  onRegenerate: (item: LibraryItem) => void;
  onUpscale: (item: LibraryItem) => void;
  onCreateVideo: (item: LibraryItem) => void;
  onEditImage: (item: LibraryItem) => void;
  onRefresh: () => Promise<void>;
  onMediaMissing: (id: string) => void;
  onLogin: () => void;
  onStartCreate: () => void;
}) {
  const filteredEmpty = !items.length && totalCount > 0;
  const displayEntries = useMemo(() => buildLibraryDisplayEntries(items), [items]);
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(displayEntries.length / libraryPageSize));
  const safePage = Math.min(page, pageCount);
  const visibleEntries = useMemo(
    () => displayEntries.slice((safePage - 1) * libraryPageSize, safePage * libraryPageSize),
    [displayEntries, safePage],
  );
  const pageNumbers = useMemo(() => Array.from({ length: pageCount }, (_, index) => index + 1), [pageCount]);
  const selectedMediaMissing = selectedItem ? missingMediaIds.has(selectedItem.id) || selectedItem.fileAvailable === false : false;
  const selectedEntry = selectedItem
    ? displayEntries.find((entry) => entry.items.some((item) => item.id === selectedItem.id)) || null
    : null;
  const selectedCanUseOutput = Boolean(selectedItem?.output?.url && !selectedMediaMissing && !selectedItem.expired);
  const selectedCanDownloadStoredFile = Boolean(selectedItem?.output?.url && selectedItem.output.storedName && !selectedMediaMissing);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const visibleItemIds = useMemo(
    () => Array.from(new Set(visibleEntries.flatMap((entry) => entry.items.map((item) => item.id)))),
    [visibleEntries],
  );
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedVisibleCount = useMemo(
    () => visibleItemIds.filter((id) => selectedIdSet.has(id)).length,
    [selectedIdSet, visibleItemIds],
  );
  const allVisibleSelected = visibleItemIds.length > 0 && visibleItemIds.every((id) => selectedIdSet.has(id));
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);

  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => visibleItemIds.includes(id)));
  }, [visibleItemIds]);

  useEffect(() => {
    setPage(1);
  }, [filter, sort]);

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);

  useEffect(() => {
    if (search.trim()) onSearchChange("");
  }, [onSearchChange, search]);

  const openItemFromKeyboard = (event: KeyboardEvent<HTMLElement>, id: string) => {
    if (event.target !== event.currentTarget) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onSelectItem(id);
  };

  const toggleEntrySelection = (entryIds: string[], event?: MouseEvent<HTMLButtonElement>) => {
    event?.preventDefault();
    event?.stopPropagation();
    setSelectedIds((current) => {
      const currentSet = new Set(current);
      const fullySelected = entryIds.every((id) => currentSet.has(id));
      for (const id of entryIds) {
        if (fullySelected) currentSet.delete(id);
        else currentSet.add(id);
      }
      return Array.from(currentSet);
    });
  };

  const handleSelectAll = () => {
    setSelectedIds((current) => {
      const visibleSet = new Set(visibleItemIds);
      if (allVisibleSelected) return current.filter((id) => !visibleSet.has(id));
      return Array.from(new Set([...current.filter((id) => !visibleSet.has(id)), ...visibleItemIds]));
    });
  };

  const handleBulkDelete = async () => {
    const ids = visibleItemIds.filter((id) => selectedIdSet.has(id));
    if (!ids.length || bulkDeleting) return;
    await onDeleteMany(ids);
    setBulkDeleteConfirmOpen(false);
    setSelectedIds((current) => current.filter((id) => !ids.includes(id)));
    if (selectedItem && ids.includes(selectedItem.id)) onSelectItem(null);
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
          selectedCount={selectedVisibleCount}
          allSelected={allVisibleSelected}
          deleting={bulkDeleting}
          onSortChange={onSortChange}
          onToggleSelectAll={handleSelectAll}
          onDeleteSelected={() => setBulkDeleteConfirmOpen(true)}
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
          {visibleEntries.map((entry) => {
            const item = entry.item;
            const isVideo = item.type === "video";
            const entryItemIds = entry.items.map((entryItem) => entryItem.id);
            const entrySelected = entryItemIds.every((id) => selectedIdSet.has(id));
            const entryActive = selectedItem ? entry.items.some((entryItem) => entryItem.id === selectedItem.id) : false;
            const entryRemoving = entry.items.some((entryItem) => removingItemId === entryItem.id);
            const itemMissing = missingMediaIds.has(item.id) || item.fileAvailable === false;
            return (
              <div
                key={entry.id}
                className={cn(
                  "studio-library-tile",
                  entry.items.length > 1 && "is-group",
                  entryActive && "is-active",
                  entrySelected && "is-selected",
                  entryRemoving && "is-removing",
                )}
              >
                <button
                  type="button"
                  className={cn("studio-library-tile__select", entrySelected && "is-selected")}
                  onClick={(event) => toggleEntrySelection(entryItemIds, event)}
                  disabled={bulkDeleting}
                  aria-label={entrySelected ? "取消选择作品" : "选择作品"}
                  aria-pressed={entrySelected}
                >
                  {entrySelected ? <Check className="size-4" aria-hidden="true" /> : null}
                </button>
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
              </div>
            );
          })}
        </div>
      )}

      {displayEntries.length > libraryPageSize ? (
        <div className="studio-library-pagination" aria-label="作品分页">
          <button
            type="button"
            className="studio-library-page-button"
            onClick={() => setPage((value) => Math.max(1, value - 1))}
            disabled={safePage <= 1}
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            上一页
          </button>
          <span className="studio-library-page-status" aria-label={`当前第 ${safePage} 页，共 ${pageCount} 页`}>
            {pageNumbers.map((pageNumber) => (
              <button
                key={pageNumber}
                type="button"
                className={cn("studio-library-page-number", safePage === pageNumber && "is-active")}
                onClick={() => setPage(pageNumber)}
                aria-current={safePage === pageNumber ? "page" : undefined}
              >
                {pageNumber}
              </button>
            ))}
          </span>
          <button
            type="button"
            className="studio-library-page-button"
            onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
            disabled={safePage >= pageCount}
          >
            下一页
            <ArrowRight className="size-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}

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
              showDetailFacts
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
          </div>
        </div>
      ) : null}
      {bulkDeleteConfirmOpen ? (
        <div className="studio-library-confirm" role="dialog" aria-modal="true" aria-labelledby="library-bulk-delete-confirm-title">
          <button
            type="button"
            className="studio-library-confirm__backdrop"
            aria-label="取消批量删除"
            onClick={() => setBulkDeleteConfirmOpen(false)}
            disabled={bulkDeleting}
          />
          <section className="studio-library-confirm__card studio-library-confirm__card--bulk">
            <span className="studio-library-confirm__icon" aria-hidden="true">
              <Trash2 className="size-5" />
            </span>
            <div className="studio-library-confirm__copy">
              <p className="shell-eyebrow">批量删除</p>
              <h3 id="library-bulk-delete-confirm-title">确认删除已选 {selectedVisibleCount} 项作品？</h3>
              <p>已选作品删除后会从当前作品库中移除，并同步清理对应的可删除文件。</p>
            </div>
            <div className="studio-library-confirm__actions">
              <button
                type="button"
                className="studio-secondary-button"
                onClick={() => setBulkDeleteConfirmOpen(false)}
                disabled={bulkDeleting}
              >
                取消
              </button>
              <button
                type="button"
                className="studio-danger-button"
                onClick={() => void handleBulkDelete()}
                disabled={!selectedVisibleCount || bulkDeleting}
              >
                {bulkDeleting ? (
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
  selectedCount,
  allSelected,
  deleting,
  onSortChange,
  onToggleSelectAll,
  onDeleteSelected,
}: {
  sort: LibrarySort;
  selectedCount: number;
  allSelected: boolean;
  deleting: boolean;
  onSortChange: (value: LibrarySort) => void;
  onToggleSelectAll: () => void;
  onDeleteSelected: () => void;
}) {
  const timeSort = sort === "created-asc" ? "created-asc" : "created-desc";
  const sizeSort = sort === "size-asc" ? "size-asc" : "size-desc";

  return (
    <div className="studio-library-toolbar">
      <div className="studio-library-toolbar__actions">
        <button type="button" className="studio-secondary-button" onClick={onToggleSelectAll} disabled={deleting}>
          <Check className="size-4" aria-hidden="true" />
          {allSelected ? "取消全选" : "全选"}
        </button>
        <button
          type="button"
          className="studio-secondary-button studio-secondary-button--danger"
          onClick={onDeleteSelected}
          disabled={!selectedCount || deleting}
        >
          {deleting ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              删除中
            </>
          ) : (
            <>
              <Trash2 className="size-4" aria-hidden="true" />
              {selectedCount ? `删除已选 (${selectedCount})` : "删除已选"}
            </>
          )}
        </button>
      </div>
      <div className="studio-library-toolbar__sorts" role="group" aria-label="作品排序">
        <button
          type="button"
          className={cn("studio-library-toolbar__sort", sort.startsWith("created") && "is-active")}
          onClick={() => onSortChange(timeSort === "created-desc" ? "created-asc" : "created-desc")}
          aria-pressed={sort.startsWith("created")}
        >
          <ArrowDownUp className="size-4" aria-hidden="true" />
          {timeSort === "created-desc" ? "时间 最新" : "时间 最久"}
        </button>
        <button
          type="button"
          className={cn("studio-library-toolbar__sort", sort.startsWith("size") && "is-active")}
          onClick={() => onSortChange(sizeSort === "size-desc" ? "size-asc" : "size-desc")}
          aria-pressed={sort.startsWith("size")}
        >
          <ArrowDownUp className="size-4" aria-hidden="true" />
          {sizeSort === "size-desc" ? "文件大小 最大" : "文件大小 最小"}
        </button>
      </div>
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
