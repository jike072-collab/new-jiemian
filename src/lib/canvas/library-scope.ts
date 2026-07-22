import type { LibraryItem } from "@/lib/server/types";

export type CanvasLibraryScope = "personal" | "shared";

export function normalizeCanvasLibraryScope(value: unknown): CanvasLibraryScope {
  return value === "shared" ? "shared" : "personal";
}

export function canvasLibraryItemScope(item: Pick<LibraryItem, "params">): CanvasLibraryScope {
  return item.params.canvasScope === "shared" ? "shared" : "personal";
}

export function isCanvasLibraryItemInScope(item: Pick<LibraryItem, "params">, scope: CanvasLibraryScope) {
  return canvasLibraryItemScope(item) === scope;
}

export function filterCanvasLibraryItems<T extends Pick<LibraryItem, "params">>(items: T[], scope: CanvasLibraryScope) {
  return items.filter((item) => isCanvasLibraryItemInScope(item, scope));
}
