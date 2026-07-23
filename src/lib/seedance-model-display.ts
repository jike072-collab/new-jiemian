export const seedanceVideoDisplayNames: Record<string, string> = {
  "video-2.0-fast-720P": "Fast 720P",
  "quanneng2.0-9tu": "9 图 首帧",
  "quanneng2.0": "线路 S",
  "sdquan-2-miao": "Pro",
  "Doubao-Seedance-2-0-260128-grid": "满血 933 不卡真人",
};

export const clmmSeedanceVideoDisplayNames: Record<string, string> = {
  "bb-seedance2.0 1080p-pro-gz-15s": "bb · Pro 1080P 15 秒",
  "bb-seedance2.0 720p-fast-gz-15s": "bb · Fast 15 秒",
  "bb-seedance2.0 720p-pro-gz-15s": "bb · Pro 15 秒",
  "mg-seedance2.0 -1080p": "mg · 1080P",
  "mg-seedance2.0 -720p fast": "mg · Fast",
  "mg-seedance2.0 -720p mini": "mg · Mini",
  "mg-seedance2.0 -720p pro": "mg · Pro",
  "mg-seedance2.0 -720p-gz-15s": "mg · 720P 15 秒",
  "mg-seedance2.0 720p-pro-gz-15s": "mg · Pro 15 秒",
  "oe-seedance-2.0-pro-720p-14s-gz": "oe · Pro 14 秒 不卡真人",
  "seedance2.0 720p-933-pro-gz-15s": "满血 933 不卡真人",
  "seedance2.0 720p-fast-gz-15s": "Fast 15 秒 不卡真人",
  "seedance2.0 720p-pro-gz-15s": "Pro 15 秒 不卡真人",
};

export function isDynamicClmmSeedance20Model(model: string | null | undefined) {
  const normalized = String(model || "").trim().toLowerCase();
  return /seedance[-_ ]*2(?:\.0)?/.test(normalized)
    && /(?:720|1080)\s*p/.test(normalized)
    && !/480\s*p|dark|black|暗黑/.test(normalized);
}

export function clmmSeedanceVideoDisplayName(model: string) {
  const normalized = model.trim().toLowerCase();
  const known = clmmSeedanceVideoDisplayNames[model] || clmmSeedanceVideoDisplayNames[normalized];
  if (known) return known;
  const channel = normalized.match(/^(.+?)[-_ ]+seedance/)?.[1]?.replaceAll("：", ":");
  const withChannel = (label: string) => channel ? `${channel} · ${label}` : label;
  const seconds = normalized.match(/(?:^|[-_ ])(\d+)s(?:$|[-_ ])/i)?.[1];
  const fixedLabel = seconds && normalized.includes("gz") ? `${seconds} 秒` : "";
  if (normalized.includes("933")) return withChannel("满血 933");
  if (normalized.includes("1080")) return withChannel(fixedLabel ? `Pro 1080P ${fixedLabel}` : "1080P");
  if (normalized.includes("mini")) return withChannel("Mini");
  if (normalized.includes("fast")) return withChannel(fixedLabel ? `Fast ${fixedLabel}` : "Fast");
  if (normalized.includes("pro")) return withChannel(fixedLabel ? `Pro ${fixedLabel}` : "Pro");
  return withChannel(fixedLabel ? `720P ${fixedLabel}` : "Seedance 2.0 720P");
}

const seedanceVideoModelIds = new Set(
  [...Object.keys(seedanceVideoDisplayNames), ...Object.keys(clmmSeedanceVideoDisplayNames)]
    .map((model) => model.toLowerCase()),
);

export function isSeedance20VideoModel(model: string | null | undefined) {
  return Boolean(model && (seedanceVideoModelIds.has(model.trim().toLowerCase()) || isDynamicClmmSeedance20Model(model)));
}

const seedanceLibraryShortNames: Record<string, string> = {
  ...Object.fromEntries(
    Object.entries(seedanceVideoDisplayNames).map(([model, displayName]) => [model.toLowerCase(), displayName]),
  ),
  "b-quannengship2.0": "线路 B",
  "doubao-seedance-2.0-fast-260128-grid": "Fast 933 不卡真人",
};

const clmmSeedanceLibraryShortNames = Object.fromEntries(
  Object.entries(clmmSeedanceVideoDisplayNames).map(([model, displayName]) => [model.toLowerCase(), displayName]),
);

export function seedanceLibraryModelName(model: string) {
  const normalized = model.trim().toLowerCase();
  const clmmDisplayName = clmmSeedanceLibraryShortNames[normalized];
  if (clmmDisplayName || isDynamicClmmSeedance20Model(model)) {
    return `Seedance 2.0 新 · ${clmmDisplayName || clmmSeedanceVideoDisplayName(model)}`;
  }
  const displayName = seedanceLibraryShortNames[normalized];
  return displayName ? `Seedance 2.0 · ${displayName}` : undefined;
}
