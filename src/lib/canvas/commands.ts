export type CanvasCommandSearchItem = {
  id: string;
  label: string;
  description?: string;
  group: string;
  keywords?: string[];
};

function normalizeCommandSearch(value: string) {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

export function filterCanvasCommands<T extends CanvasCommandSearchItem>(items: T[], query: string, limit = 40) {
  const tokens = normalizeCommandSearch(query).split(" ").filter(Boolean);
  if (!tokens.length) return items.slice(0, limit);
  return items.filter((item) => {
    const searchable = normalizeCommandSearch([
      item.label,
      item.description,
      item.group,
      ...(item.keywords || []),
    ].filter(Boolean).join(" "));
    return tokens.every((token) => searchable.includes(token));
  }).slice(0, limit);
}
