const MEDIA_NODE_CHROME_HEIGHT = 70;

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
  let frameWidth: number;
  let frameHeight: number;

  if (ratio > 1.05) {
    frameWidth = 420;
    frameHeight = frameWidth / ratio;
  } else if (ratio < 0.95) {
    frameWidth = 260;
    frameHeight = frameWidth / ratio;
    if (frameHeight > 620) {
      frameHeight = 620;
      frameWidth = frameHeight * ratio;
    }
  } else {
    frameWidth = 360;
    frameHeight = frameWidth / ratio;
  }

  frameWidth = Math.round(frameWidth);
  frameHeight = Math.round(frameHeight);
  return {
    width: frameWidth,
    height: frameHeight + MEDIA_NODE_CHROME_HEIGHT,
    frameWidth,
    frameHeight,
  };
}
