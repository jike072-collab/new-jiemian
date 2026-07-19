"use client";

import { Download, Maximize2, Minus, Plus, X } from "lucide-react";
import { useState } from "react";

export function CanvasMediaViewer({ imageUrl, title, onClose }: {
  imageUrl: string;
  title: string;
  onClose: () => void;
}) {
  const [zoom, setZoom] = useState(1);
  return (
    <div className="canvas-media-viewer-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="canvas-media-viewer" role="dialog" aria-modal="true" aria-label="图片放大预览" onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}>
        <header>
          <strong title={title}>{title}</strong>
          <div role="toolbar" aria-label="图片预览工具">
            <button type="button" onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))} aria-label="缩小图片" title="缩小"><Minus /></button>
            <span>{Math.round(zoom * 100)}%</span>
            <button type="button" onClick={() => setZoom((value) => Math.min(3, value + 0.25))} aria-label="放大图片" title="放大"><Plus /></button>
            <button type="button" onClick={() => setZoom(1)} aria-label="适应窗口" title="适应窗口"><Maximize2 /></button>
            <a href={imageUrl} download target="_blank" rel="noreferrer" aria-label="下载图片" title="下载"><Download /></a>
            <button type="button" autoFocus onClick={onClose} aria-label="关闭图片预览" title="关闭"><X /></button>
          </div>
        </header>
        <div className="canvas-media-viewer__stage">
          {/* eslint-disable-next-line @next/next/no-img-element -- authenticated generated media cannot use static image optimization. */}
          <img src={imageUrl} alt={title} style={{ width: zoom === 1 ? "auto" : `${zoom * 100}%`, maxWidth: zoom === 1 ? "100%" : "none", maxHeight: zoom === 1 ? "100%" : "none" }} />
        </div>
      </section>
    </div>
  );
}
