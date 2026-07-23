export const MAX_CANVAS_FOLDER_FILES = 100;

type CanvasDropEntry = {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  file?: (success: (file: File) => void, failure?: (error: DOMException) => void) => void;
  createReader?: () => {
    readEntries: (success: (entries: CanvasDropEntry[]) => void, failure?: (error: DOMException) => void) => void;
  };
};

type CanvasDropItem = {
  kind?: string;
  webkitGetAsEntry?: () => CanvasDropEntry | null;
};

export type CanvasFolderDropResult = {
  files: File[];
  directoryCount: number;
  skippedCount: number;
  truncated: boolean;
};

const supportedMediaExtension = /\.(?:png|jpe?g|webp|mp4|webm|mov)$/i;
const supportedMediaMime = /^(?:image\/(?:png|jpeg|webp)|video\/(?:mp4|webm|quicktime))$/i;

export function isSupportedCanvasDropFile(file: Pick<File, "name" | "type">) {
  return supportedMediaMime.test(file.type) || supportedMediaExtension.test(file.name);
}

export async function collectCanvasFolderDropFiles(
  items: readonly CanvasDropItem[],
  fallbackFiles: readonly File[],
  limit = MAX_CANVAS_FOLDER_FILES,
): Promise<CanvasFolderDropResult> {
  const maxFiles = Math.max(1, Math.floor(limit));
  const entries = items
    .filter((item) => !item.kind || item.kind === "file")
    .map((item) => item.webkitGetAsEntry?.())
    .filter((entry): entry is CanvasDropEntry => Boolean(entry));

  if (!entries.length) {
    const supported = fallbackFiles.filter(isSupportedCanvasDropFile);
    return {
      files: supported.slice(0, maxFiles),
      directoryCount: 0,
      skippedCount: fallbackFiles.length - supported.length,
      truncated: supported.length > maxFiles,
    };
  }

  const files: File[] = [];
  let directoryCount = 0;
  let skippedCount = 0;
  let truncated = false;

  const visit = async (entry: CanvasDropEntry): Promise<void> => {
    if (entry.name.startsWith(".")) {
      skippedCount += 1;
      return;
    }
    if (files.length >= maxFiles) {
      truncated = true;
      return;
    }
    if (entry.isFile) {
      if (!supportedMediaExtension.test(entry.name)) {
        skippedCount += 1;
        return;
      }
      const file = await readFileEntry(entry);
      if (isSupportedCanvasDropFile(file)) files.push(file);
      else skippedCount += 1;
      return;
    }
    if (!entry.isDirectory || !entry.createReader) {
      skippedCount += 1;
      return;
    }
    directoryCount += 1;
    const children = await readDirectoryEntries(entry);
    for (const child of children.sort((left, right) => left.name.localeCompare(right.name))) {
      await visit(child);
    }
  };

  for (const entry of entries) await visit(entry);
  return { files, directoryCount, skippedCount, truncated };
}

function readFileEntry(entry: CanvasDropEntry) {
  return new Promise<File>((resolve, reject) => {
    if (!entry.file) {
      reject(new Error("Folder entry could not be read."));
      return;
    }
    entry.file(resolve, reject);
  });
}

async function readDirectoryEntries(entry: CanvasDropEntry) {
  const reader = entry.createReader?.();
  if (!reader) return [];
  const entries: CanvasDropEntry[] = [];
  while (true) {
    const batch = await new Promise<CanvasDropEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (!batch.length) return entries;
    entries.push(...batch);
  }
}
