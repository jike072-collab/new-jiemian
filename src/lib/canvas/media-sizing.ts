const MEDIA_NODE_CHROME_HEIGHT = 75;
const MEDIA_NODE_HORIZONTAL_BORDER = 2;

export type CanvasMediaNodeSize = {
  width: number;
  height: number;
  frameWidth: number;
  frameHeight: number;
};

export function normalizeMediaDimensions(widthValue: unknown, heightValue: unknown) {
  const width = Math.round(Number(widthValue));
  const height = Math.round(Number(heightValue));
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return null;
  return {
    width: Math.min(width, 32_768),
    height: Math.min(height, 32_768),
  };
}

export function canvasMediaNodeSize(widthValue: unknown, heightValue: unknown): CanvasMediaNodeSize | null {
  const dimensions = normalizeMediaDimensions(widthValue, heightValue);
  if (!dimensions) return null;
  const ratio = dimensions.width / dimensions.height;
  let nodeWidth: number;
  let frameWidth: number;
  let frameHeight: number;

  if (ratio > 1.05) {
    nodeWidth = 420;
    frameWidth = nodeWidth - MEDIA_NODE_HORIZONTAL_BORDER;
    frameHeight = frameWidth / ratio;
  } else if (ratio < 0.95) {
    nodeWidth = 260;
    frameWidth = nodeWidth - MEDIA_NODE_HORIZONTAL_BORDER;
    frameHeight = frameWidth / ratio;
    if (frameHeight > 620) {
      frameHeight = 620;
      frameWidth = frameHeight * ratio;
      nodeWidth = frameWidth + MEDIA_NODE_HORIZONTAL_BORDER;
    }
  } else {
    nodeWidth = 360;
    frameWidth = nodeWidth - MEDIA_NODE_HORIZONTAL_BORDER;
    frameHeight = frameWidth / ratio;
  }

  nodeWidth = Math.round(nodeWidth);
  frameWidth = Math.round(frameWidth);
  frameHeight = Math.round(frameHeight);
  return {
    width: nodeWidth,
    height: frameHeight + MEDIA_NODE_CHROME_HEIGHT,
    frameWidth,
    frameHeight,
  };
}
