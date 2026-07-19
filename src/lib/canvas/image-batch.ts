export const PUBLIC_CANVAS_IMAGE_MAX_COUNT = 4;
export const INTERNAL_CANVAS_IMAGE_MAX_COUNT = 15;
export const CANVAS_IMAGE_REQUEST_MAX_COUNT = 4;
export const INTERNAL_CANVAS_IMAGE_REQUEST_MAX_COUNT = 1;
export const INTERNAL_CANVAS_IMAGE_REQUEST_CONCURRENCY = 15;

export function canvasImageCountLimit(internalCanvas: boolean) {
  return internalCanvas ? INTERNAL_CANVAS_IMAGE_MAX_COUNT : PUBLIC_CANVAS_IMAGE_MAX_COUNT;
}

export function planCanvasImageRequests(requestedCount: number, internalCanvas: boolean) {
  const count = Math.min(
    Math.max(Math.round(Number(requestedCount) || 1), 1),
    canvasImageCountLimit(internalCanvas),
  );
  const requests: number[] = [];
  const requestLimit = internalCanvas ? INTERNAL_CANVAS_IMAGE_REQUEST_MAX_COUNT : CANVAS_IMAGE_REQUEST_MAX_COUNT;
  let remaining = count;
  while (remaining > 0) {
    const requestCount = Math.min(remaining, requestLimit);
    requests.push(requestCount);
    remaining -= requestCount;
  }
  return requests;
}

export function canvasImageResultGrid(resultIndex: number, resultTotal: number) {
  const total = Math.max(1, Math.round(Number(resultTotal) || 1));
  const index = Math.min(Math.max(Math.round(Number(resultIndex) || 0), 0), total - 1);
  const columnCount = Math.min(4, Math.ceil(Math.sqrt(total)));
  return {
    column: index % columnCount,
    row: Math.floor(index / columnCount),
    rowCount: Math.ceil(total / columnCount),
  };
}
