"use client";

import { Crop, Download, Eraser, Eye, EyeOff, LoaderCircle, Maximize2, Redo2, RotateCcw, Send, Undo2, X, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

export function CanvasImageEditor({ imageUrl, title, onSubmit, onClose }: {
  imageUrl: string;
  title: string;
  onSubmit: (file: File, prompt: string) => Promise<void>;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const maskRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const originalRef = useRef<ImageBitmap | null>(null);
  const historyRef = useRef<ImageData[]>([]);
  const futureRef = useRef<ImageData[]>([]);
  const drawingRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [brushSize, setBrushSize] = useState(42);
  const [prompt, setPrompt] = useState("");
  const [historyCount, setHistoryCount] = useState(0);
  const [redoCount, setRedoCount] = useState(0);
  const [showMask, setShowMask] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [canvasSize, setCanvasSize] = useState({ width: 1, height: 1 });

  const fitViewport = useCallback(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;
    const scale = Math.min(1, Math.max(0.1, (stage.clientWidth - 28) / canvas.width), Math.max(0.1, (stage.clientHeight - 28) / canvas.height));
    setZoom(scale);
  }, []);

  const updateMaskPreview = useCallback(() => {
    const canvas = canvasRef.current;
    const mask = maskRef.current;
    const context = canvas?.getContext("2d");
    const maskContext = mask?.getContext("2d");
    if (!canvas || !mask || !context || !maskContext) return;
    mask.width = canvas.width;
    mask.height = canvas.height;
    const source = context.getImageData(0, 0, canvas.width, canvas.height);
    const overlay = maskContext.createImageData(canvas.width, canvas.height);
    for (let index = 0; index < source.data.length; index += 4) {
      const erased = 255 - source.data[index + 3];
      overlay.data[index] = 244;
      overlay.data[index + 1] = 63;
      overlay.data[index + 2] = 140;
      overlay.data[index + 3] = Math.round(erased * 0.62);
    }
    maskContext.putImageData(overlay, 0, 0);
  }, []);

  const drawOriginal = useCallback((bitmap: ImageBitmap, clearHistory = true) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const maxSide = 1_600;
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    context?.clearRect(0, 0, canvas.width, canvas.height);
    context?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    if (clearHistory) {
      historyRef.current = [];
      futureRef.current = [];
      setHistoryCount(0);
      setRedoCount(0);
    }
    setCanvasSize({ width: canvas.width, height: canvas.height });
    updateMaskPreview();
    window.requestAnimationFrame(fitViewport);
  }, [fitViewport, updateMaskPreview]);

  useEffect(() => {
    let cancelled = false;
    void fetch(imageUrl, { credentials: "same-origin" })
      .then((response) => {
        if (!response.ok) throw new Error("图片读取失败");
        return response.blob();
      })
      .then((blob) => createImageBitmap(blob))
      .then((bitmap) => {
        if (cancelled) return bitmap.close();
        originalRef.current = bitmap;
        drawOriginal(bitmap);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => {
      cancelled = true;
      originalRef.current?.close();
    };
  }, [drawOriginal, imageUrl]);

  function pushHistory() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    historyRef.current.push(context.getImageData(0, 0, canvas.width, canvas.height));
    if (historyRef.current.length > 20) historyRef.current.shift();
    futureRef.current = [];
    setHistoryCount(historyRef.current.length);
    setRedoCount(0);
  }

  function eraseAt(clientX: number, clientY: number) {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const bounds = canvas.getBoundingClientRect();
    const x = (clientX - bounds.left) * (canvas.width / bounds.width);
    const y = (clientY - bounds.top) * (canvas.height / bounds.height);
    const radius = brushSize * (canvas.width / bounds.width);
    context.save();
    context.globalCompositeOperation = "destination-out";
    context.beginPath();
    context.arc(x, y, radius / 2, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  function cropToAspect(ratio: number) {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    pushHistory();
    let width = canvas.width;
    let height = Math.round(width / ratio);
    if (height > canvas.height) {
      height = canvas.height;
      width = Math.round(height * ratio);
    }
    const x = Math.round((canvas.width - width) / 2);
    const y = Math.round((canvas.height - height) / 2);
    const image = context.getImageData(x, y, width, height);
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")?.putImageData(image, 0, 0);
    setCanvasSize({ width, height });
    updateMaskPreview();
    window.requestAnimationFrame(fitViewport);
  }

  function undoEdit() {
    const image = historyRef.current.pop();
    const canvas = canvasRef.current;
    if (!image || !canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    futureRef.current.push(context.getImageData(0, 0, canvas.width, canvas.height));
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.getContext("2d")?.putImageData(image, 0, 0);
    setHistoryCount(historyRef.current.length);
    setRedoCount(futureRef.current.length);
    setCanvasSize({ width: image.width, height: image.height });
    updateMaskPreview();
  }

  function redoEdit() {
    const image = futureRef.current.pop();
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!image || !canvas || !context) return;
    historyRef.current.push(context.getImageData(0, 0, canvas.width, canvas.height));
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.getContext("2d")?.putImageData(image, 0, 0);
    setHistoryCount(historyRef.current.length);
    setRedoCount(futureRef.current.length);
    setCanvasSize({ width: image.width, height: image.height });
    updateMaskPreview();
  }

  function resetEdit() {
    if (!originalRef.current) return;
    pushHistory();
    drawOriginal(originalRef.current, false);
  }

  function downloadEdit() {
    canvasRef.current?.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${title || "edited"}.png`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    }, "image/png");
  }

  async function submitEdit() {
    const canvas = canvasRef.current;
    const instruction = prompt.trim();
    if (!canvas || !instruction || busy) return;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) return;
    setBusy(true);
    try {
      await onSubmit(new File([blob], "canvas-edit.png", { type: "image/png" }), instruction);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="canvas-editor-backdrop" role="presentation">
      <section className="canvas-image-editor" role="dialog" aria-modal="true" aria-label="图片局部编辑器" onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
        <header><div><Eraser /><span><strong>图片编辑</strong><small>裁剪、擦除与局部重绘</small></span></div><button type="button" className="canvas-icon-button" autoFocus onClick={onClose} title="关闭图片编辑" aria-label="关闭图片编辑"><X /></button></header>
        <div className="canvas-image-editor__tools" role="toolbar" aria-label="编辑工具">
          <button type="button" onClick={() => cropToAspect(1)}><Crop />1:1</button>
          <button type="button" onClick={() => cropToAspect(4 / 3)}><Crop />4:3</button>
          <button type="button" onClick={() => cropToAspect(16 / 9)}><Crop />16:9</button>
          <label><Eraser /><input type="range" min="12" max="120" value={brushSize} aria-label="蒙版画笔大小" onChange={(event) => setBrushSize(Number(event.target.value))} /><span>{brushSize}px</span></label>
          <button type="button" className={showMask ? "is-active" : undefined} aria-pressed={showMask} onClick={() => setShowMask((value) => !value)}>{showMask ? <Eye /> : <EyeOff />}蒙版</button>
          <button type="button" disabled={!historyCount} onClick={undoEdit}><Undo2 />撤销编辑</button>
          <button type="button" disabled={!redoCount} onClick={redoEdit}><Redo2 />重做编辑</button>
          <button type="button" onClick={resetEdit}><RotateCcw />重置</button>
          <button type="button" onClick={() => setZoom((value) => Math.max(0.1, value / 1.25))} title="缩小图片" aria-label="缩小图片"><ZoomOut /></button>
          <span className="canvas-image-editor__zoom">{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={() => setZoom((value) => Math.min(3, value * 1.25))} title="放大图片" aria-label="放大图片"><ZoomIn /></button>
          <button type="button" onClick={fitViewport} title="适配视口" aria-label="适配视口"><Maximize2 /></button>
          <button type="button" onClick={downloadEdit}><Download />下载</button>
        </div>
        <div ref={stageRef} className="canvas-image-editor__stage">
          {loading ? <LoaderCircle className="is-spinning" /> : null}
          <div className="canvas-image-editor__viewport" style={{ width: Math.max(canvasSize.width * zoom + 28, 1), height: Math.max(canvasSize.height * zoom + 28, 1) }}>
            <canvas
              ref={canvasRef}
              className="canvas-image-editor__canvas"
              style={{ width: canvasSize.width * zoom, height: canvasSize.height * zoom }}
              onPointerDown={(event) => { pushHistory(); drawingRef.current = true; event.currentTarget.setPointerCapture(event.pointerId); eraseAt(event.clientX, event.clientY); }}
              onPointerMove={(event) => { if (drawingRef.current) eraseAt(event.clientX, event.clientY); }}
              onPointerUp={(event) => { drawingRef.current = false; event.currentTarget.releasePointerCapture(event.pointerId); updateMaskPreview(); }}
              onPointerCancel={() => { drawingRef.current = false; updateMaskPreview(); }}
            />
            <canvas ref={maskRef} className="canvas-image-editor__mask" hidden={!showMask} style={{ width: canvasSize.width * zoom, height: canvasSize.height * zoom }} aria-hidden="true" />
          </div>
        </div>
        <footer><textarea value={prompt} maxLength={2_000} onChange={(event) => setPrompt(event.target.value)} placeholder="描述透明/擦除区域需要生成的内容，未擦除区域将作为保留参考" aria-label="局部重绘要求" /><button type="button" disabled={busy || !prompt.trim()} onClick={() => { void submitEdit(); }}>{busy ? <LoaderCircle className="is-spinning" /> : <Send />}局部重绘</button></footer>
      </section>
    </div>
  );
}
