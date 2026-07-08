"use client";

import { LibraryDeleteConfirmDialog, LibraryWorkspace } from "@/components/studio/library-view";
import type { LibraryFilter, LibrarySort } from "@/components/studio/types";
import type { LibraryItem } from "@/lib/server/types";

export function LibraryPane({
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
  deleteConfirmItem,
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
  onCancelDelete,
  onConfirmDelete,
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
  deleteConfirmItem: LibraryItem | null;
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
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}) {
  return (
    <>
      <LibraryWorkspace
        items={items}
        totalCount={totalCount}
        count={count}
        selectedItem={selectedItem}
        loading={loading}
        error={error}
        isAuthenticated={isAuthenticated}
        filter={filter}
        sort={sort}
        search={search}
        deletingItemId={deletingItemId}
        bulkDeleting={bulkDeleting}
        removingItemId={removingItemId}
        missingMediaIds={missingMediaIds}
        onFilterChange={onFilterChange}
        onSortChange={onSortChange}
        onSearchChange={onSearchChange}
        onSelectItem={onSelectItem}
        onDelete={onDelete}
        onDeleteMany={onDeleteMany}
        onRegenerate={onRegenerate}
        onUpscale={onUpscale}
        onCreateVideo={onCreateVideo}
        onEditImage={onEditImage}
        onRefresh={onRefresh}
        onMediaMissing={onMediaMissing}
        onLogin={onLogin}
        onStartCreate={onStartCreate}
      />
      <LibraryDeleteConfirmDialog
        item={deleteConfirmItem}
        deleting={Boolean(deleteConfirmItem && deletingItemId === deleteConfirmItem.id)}
        onCancel={onCancelDelete}
        onConfirm={onConfirmDelete}
      />
    </>
  );
}
