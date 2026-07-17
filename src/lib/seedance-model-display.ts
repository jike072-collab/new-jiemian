export const seedanceVideoDisplayNames: Record<string, string> = {
  "video-2.0-fast-720P": "Fast 720P",
  "quanneng2.0-9tu": "9 图 首帧",
  "quanneng2.0": "线路 S",
  "sdquan-2-miao": "Pro",
  "Doubao-Seedance-2-0-260128-grid": "满血 933 不卡真人",
};

const seedanceLibraryShortNames: Record<string, string> = {
  ...Object.fromEntries(
    Object.entries(seedanceVideoDisplayNames).map(([model, displayName]) => [model.toLowerCase(), displayName]),
  ),
  "b-quannengship2.0": "线路 B",
  "doubao-seedance-2.0-fast-260128-grid": "Fast 933 不卡真人",
};

export function seedanceLibraryModelName(model: string) {
  const displayName = seedanceLibraryShortNames[model.trim().toLowerCase()];
  return displayName ? `Seedance 2.0 · ${displayName}` : undefined;
}
