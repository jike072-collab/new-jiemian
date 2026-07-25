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

export type CanvasDropMediaType = "image" | "video" | "audio";

const imageExtension = /\.(?:png|jpe?g|webp)$/i;
const videoExtension = /\.(?:mp4|webm|mov)$/i;
const audioExtension = /\.(?:mp3|m4a|wav)$/i;
const imageMime = /^image\/(?:png|jpeg|webp)$/i;
const videoMime = /^video\/(?:mp4|webm|quicktime)$/i;
const audioMime = /^audio\/(?:mpeg|mp4|x-m4a|wav|x-wav)$/i;

export function canvasDropMediaType(file: Pick<File, "name" | "type">): CanvasDropMediaType | null {
  if (imageMime.test(file.type) || imageExtension.test(file.name)) return "image";
  if (videoMime.test(file.type) || videoExtension.test(file.name)) return "video";
  if (audioMime.test(file.type) || audioExtension.test(file.name)) return "audio";
  return null;
}

export function isSupportedCanvasDropFile(file: Pick<File, "name" | "type">) {
  return canvasDropMediaType(file) !== null;
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
      if (!canvasDropMediaType({ name: entry.name, type: "" })) {
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
