"use client";

/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, Download, ImageUp, Loader2, RefreshCw, UploadCloud, Video, Wand2, X } from "lucide-react";

import { BeforeAfterImageCompare } from "@/components/before-after-image-compare";
import { ResultReveal } from "@/components/motion";
import { upscaleTargetLabel, videoUpscaleScaleLabel } from "@/components/studio/constants";
import { DotRippleLoader } from "@/components/studio/dot-ripple-loader";
import { MediaCard, libraryModelName, libraryStatusBadgeLabel } from "@/components/studio/media-card";
import { PreviewState } from "@/components/studio/shared";
import type { BusinessToolId, ImageGenerationProgressState, ImageUpscaleWorkspaceState, OutputItemState, OutputState, StudioErrorDiagnostic, VideoUpscaleWorkspaceState } from "@/components/studio/types";
import type { LibraryItem } from "@/lib/server/types";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import type { WorkspaceImageMode, WorkspaceVideoMode } from "@/lib/workspace-registry";

type ToolTutorialKind = "image" | "image-editor" | "video" | "image-upscale" | "video-upscale";

type TutorialLayer = {
  src: string;
  alt: string;
  className: string;
  type?: "image" | "video";
  poster?: string;
};

type TutorialOverlay = {
  text: string;
  className: string;
};

type TutorialSection = {
  title: string;
  description: string;
  mediaSide: "left" | "right";
  visualClassName?: string;
  layers: TutorialLayer[];
  bubbles?: TutorialOverlay[];
  tags?: TutorialOverlay[];
};

const toolTutorials: Record<ToolTutorialKind, {
  title: string;
  description: string;
  sections: TutorialSection[];
}> = {
  image: {
    title: "图片生成快速教程",
    description: "从想法到商品图片，按三个步骤完成生成。",
    sections: [
      {
        title: "输入你的想法",
        description: "输入提示词，也可以上传图像作为参考，快速生成适合商品展示的图片。",
        mediaSide: "left",
        visualClassName: "is-stack",
        layers: [
          { src: "/tutorials/image-generator/idea-left.svg", alt: "白底商品示意图", className: "is-back-left is-tilt-left" },
          { src: "/tutorials/image-generator/idea-right.svg", alt: "商品场景示意图", className: "is-back-right is-tilt-right" },
          { src: "/tutorials/image-generator/idea-main.svg", alt: "商品主图示意图", className: "is-main is-tilt-soft-right" },
        ],
        bubbles: [{ text: "+ 提示词", className: "is-top" }],
      },
      {
        title: "调整图片参数",
        description: "选择比例和清晰度，让图片适合不同商品展示场景。",
        mediaSide: "right",
        visualClassName: "is-ratio",
        layers: [
          { src: "/tutorials/image-generator/ratio-square.svg", alt: "一比一商品图", className: "is-ratio-left is-tilt-soft-left" },
          { src: "/tutorials/image-generator/ratio-wide.svg", alt: "四比三详情图", className: "is-ratio-right is-tilt-soft-right" },
          { src: "/tutorials/image-generator/ratio-vertical.svg", alt: "九比十六竖屏图", className: "is-ratio-center" },
        ],
        tags: [
          { text: "1:1", className: "is-bottom-left" },
          { text: "9:16", className: "is-bottom-center" },
          { text: "4:3", className: "is-bottom-right" },
          { text: "2K", className: "is-top-right" },
        ],
      },
      {
        title: "生成并继续完善",
        description: "生成完成后，可以下载图片、保存到作品库，或继续优化结果。",
        mediaSide: "left",
        visualClassName: "is-result-stack",
        layers: [
          { src: "/tutorials/image-generator/result-left.svg", alt: "海报版本结果图", className: "is-back-left is-tilt-left" },
          { src: "/tutorials/image-generator/result-right.svg", alt: "细节版本结果图", className: "is-back-right is-tilt-right" },
          { src: "/tutorials/image-generator/result-main.svg", alt: "生成结果主图", className: "is-main is-tilt-soft-right" },
        ],
        tags: [
          { text: "下载", className: "is-action-left" },
          { text: "保存作品", className: "is-action-right" },
        ],
      },
    ],
  },
  "image-editor": {
    title: "图片编辑快速教程",
    description: "上传原图，描述修改，再查看真实编辑结果。",
    sections: [
      {
        title: "上传需要编辑的图像",
        description: "选择一张图片作为编辑基础，保留主体并修改指定内容。",
        mediaSide: "left",
        visualClassName: "is-upload-stack",
        layers: [
          { src: "/tutorials/image-editor/upload.svg", alt: "上传图像示意框", className: "is-upload-base" },
          { src: "/tutorials/image-editor/source.svg", alt: "待编辑原图", className: "is-upload-front is-tilt-left" },
        ],
      },
      {
        title: "描述修改内容",
        description: "说明要修改什么，以及哪些内容必须保持不变。",
        mediaSide: "right",
        visualClassName: "is-edit-flow",
        layers: [
          { src: "/tutorials/image-editor/edit-source.svg", alt: "编辑前原图", className: "is-flow-left is-tilt-left" },
          { src: "/tutorials/image-editor/edit-result.svg", alt: "编辑后结果图", className: "is-flow-right is-tilt-right" },
        ],
        bubbles: [
          { text: "改为纯白背景", className: "is-center" },
          { text: "保留商品主体", className: "is-lower" },
        ],
      },
      {
        title: "查看编辑结果",
        description: "确认结果后下载，或继续调整提示词进行优化。",
        mediaSide: "left",
        visualClassName: "is-detail",
        layers: [
          { src: "/tutorials/image-editor/result-main.svg", alt: "编辑结果主图", className: "is-main" },
          { src: "/tutorials/image-editor/detail-one.svg", alt: "编辑结果局部细节一", className: "is-detail-left is-tilt-soft-left" },
          { src: "/tutorials/image-editor/detail-two.svg", alt: "编辑结果局部细节二", className: "is-detail-right is-tilt-soft-right" },
        ],
      },
    ],
  },
  video: {
    title: "视频生成快速教程",
    description: "从提示词或首帧开始，生成商品展示短视频。",
    sections: [
      {
        title: "输入视频内容",
        description: "填写提示词，也可以上传图像作为视频起点。",
        mediaSide: "left",
        visualClassName: "is-video-flow",
        layers: [
          { src: "/tutorials/video-generator/start-frame.svg", alt: "视频首帧示意", className: "is-flow-left is-tilt-left" },
          { src: "/tutorials/video-generator/end-frame.svg", alt: "视频末帧示意", className: "is-flow-right is-tilt-right" },
        ],
        bubbles: [{ text: "商品旋转展示，镜头缓慢推进", className: "is-center" }],
      },
      {
        title: "调整视频参数",
        description: "选择比例、时长和清晰度，让视频更适合展示场景。",
        mediaSide: "right",
        visualClassName: "is-video-stack",
        layers: [
          { src: "/tutorials/video-generator/frame-left.svg", alt: "视频后置镜头一", className: "is-back-left is-tilt-soft-left" },
          { src: "/tutorials/video-generator/frame-right.svg", alt: "视频后置镜头二", className: "is-back-right is-tilt-soft-right" },
          { src: "/tutorials/video-generator/cover-main.svg", alt: "视频主封面", className: "is-main" },
        ],
        tags: [
          { text: "5秒", className: "is-bottom-left" },
          { text: "720P", className: "is-bottom-center" },
          { text: "9:16", className: "is-bottom-right" },
        ],
      },
      {
        title: "生成并查看视频",
        description: "生成完成后，可以播放、下载，或继续完善视频效果。",
        mediaSide: "left",
        visualClassName: "is-video-result",
        layers: [
          { src: "/tutorials/video-generator/result-left.svg", alt: "视频结果后置帧一", className: "is-back-left is-tilt-soft-left" },
          { src: "/tutorials/video-generator/result-right.svg", alt: "视频结果后置帧二", className: "is-back-right is-tilt-soft-right" },
          {
            src: "/tutorials/video-generator/demo.webm",
            poster: "/tutorials/video-generator/demo-poster.svg",
            alt: "静音循环商品视频演示",
            className: "is-main-video",
            type: "video",
          },
        ],
      },
    ],
  },
  "image-upscale": {
    title: "图片高清快速教程",
    description: "上传图片，选择倍数，再下载高清结果。",
    sections: [
      {
        title: "上传图片",
        description: "选择需要提升清晰度的图片。",
        mediaSide: "left",
        visualClassName: "is-upload-stack",
        layers: [
          { src: "/tutorials/image-upscale/upload.svg", alt: "图片高清上传框", className: "is-upload-base" },
          { src: "/tutorials/image-upscale/source.svg", alt: "待高清处理原图", className: "is-upload-front is-tilt-left" },
        ],
      },
      {
        title: "选择放大倍数",
        description: "根据用途选择 2 倍或 4 倍增强。",
        mediaSide: "right",
        visualClassName: "is-detail",
        layers: [
          { src: "/tutorials/image-upscale/main.svg", alt: "图片高清主图", className: "is-main" },
          { src: "/tutorials/image-upscale/detail-low.svg", alt: "原始细节示意", className: "is-detail-left is-tilt-soft-left" },
          { src: "/tutorials/image-upscale/detail-high.svg", alt: "高清细节示意", className: "is-detail-right is-tilt-soft-right" },
        ],
        tags: [
          { text: "2K", className: "is-bottom-left" },
          { text: "4K", className: "is-bottom-right" },
        ],
      },
      {
        title: "查看高清结果",
        description: "对比处理前后效果并下载高清图片。",
        mediaSide: "left",
        visualClassName: "is-compare",
        layers: [
          { src: "/tutorials/image-upscale/compare.svg", alt: "高清前后对比图", className: "is-compare-main" },
        ],
        tags: [{ text: "800 x 800 -> 3200 x 3200", className: "is-bottom-center is-wide" }],
      },
    ],
  },
  "video-upscale": {
    title: "视频高清快速教程",
    description: "上传视频，选择规格，再播放和下载高清结果。",
    sections: [
      {
        title: "上传视频",
        description: "选择需要提升清晰度的视频。",
        mediaSide: "left",
        visualClassName: "is-upload-stack",
        layers: [
          { src: "/tutorials/video-upscale/upload.svg", alt: "视频高清上传框", className: "is-upload-base" },
          { src: "/tutorials/video-upscale/cover.svg", alt: "待处理视频封面", className: "is-upload-front is-tilt-left" },
        ],
        tags: [{ text: "播放", className: "is-action-left" }],
      },
      {
        title: "选择放大倍数",
        description: "根据输出需求选择增强规格。",
        mediaSide: "right",
        visualClassName: "is-video-compare",
        layers: [
          { src: "/tutorials/video-upscale/frame-low.svg", alt: "原始视频帧", className: "is-flow-left is-tilt-left" },
          { src: "/tutorials/video-upscale/frame-high.svg", alt: "高清视频帧", className: "is-flow-right is-tilt-right" },
        ],
        tags: [{ text: "1K / 2K / 4K", className: "is-center-tag" }],
      },
      {
        title: "播放高清结果",
        description: "确认清晰度后下载处理完成的视频。",
        mediaSide: "left",
        visualClassName: "is-video-result",
        layers: [
          {
            src: "/tutorials/video-upscale/result.webm",
            poster: "/tutorials/video-upscale/result-poster.svg",
            alt: "静音循环高清视频演示",
            className: "is-main-video",
            type: "video",
          },
        ],
        tags: [{ text: "640 x 360 -> 1280 x 720", className: "is-bottom-center is-wide" }],
      },
    ],
  },
};

const recordedImageTutorialSrc = "/tutorials/image-generator/image-generation-tutorial.mp4";

function ImageGenerationTutorial() {
  const [recordedTutorialOpen, setRecordedTutorialOpen] = useState(false);

  useEffect(() => {
    if (!recordedTutorialOpen) return undefined;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setRecordedTutorialOpen(false);
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [recordedTutorialOpen]);

  return (
    <>
      <PreviewState
        eyebrow="快速教程"
        title="快速教程"
        description="输入描述，选择比例，即可生成图片。"
        action={(
          <button type="button" className="studio-secondary-button video-tutorial-recording-button" onClick={() => setRecordedTutorialOpen(true)}>
            <Video className="size-4" aria-hidden="true" />
            观看完整教程
          </button>
        )}
      >
        <div className="image-tutorial-simple">
          <div className="image-tutorial-simple__stage">
            <div className="image-tutorial-simple__image-shell">
              <img
                className="image-tutorial-simple__image"
                src="/tutorials/image-generator/perfume-result.webp"
                alt="新中式香水产品图，粉色牡丹花、香水瓶、大理石台面和中式窗棂背景"
                decoding="async"
              />
            </div>
            <div className="image-tutorial-simple__overlay image-tutorial-simple__overlay--prompt">
              <span>提示词</span>
              <p>新中式香水产品摄影，粉色牡丹花簇拥，香水瓶置于大理石台面，背景带有中式窗棂元素，光影柔和，画面干净高级，细节丰富，商业产品图风格。</p>
            </div>
            <div className="image-tutorial-simple__overlay image-tutorial-simple__overlay--ratio">
              <span>比例</span>
              <i aria-hidden="true" />
              <strong>16:9</strong>
            </div>
          </div>
        </div>
      </PreviewState>
      {recordedTutorialOpen ? (
        <div className="video-tutorial-recording-modal" role="presentation">
          <button
            type="button"
            className="video-tutorial-recording-modal__backdrop"
            aria-label="关闭图片生成完整教程"
            onClick={() => setRecordedTutorialOpen(false)}
          />
          <section className="video-tutorial-recording-modal__card" role="dialog" aria-modal="true" aria-labelledby="image-tutorial-recording-title">
            <header className="video-tutorial-recording-modal__head">
              <h4 id="image-tutorial-recording-title">图片生成完整教程</h4>
              <button
                type="button"
                className="video-tutorial-recording-modal__close"
                aria-label="关闭图片生成完整教程"
                onClick={() => setRecordedTutorialOpen(false)}
                autoFocus
              >
                <X className="size-5" aria-hidden="true" />
              </button>
            </header>
            <video controls playsInline preload="metadata">
              <source src={recordedImageTutorialSrc} type="video/mp4" />
              当前浏览器不支持播放此视频。
            </video>
          </section>
        </div>
      ) : null}
    </>
  );
}

const recordedImageEditorTutorialSrc = "/tutorials/image-editor/image-editing-tutorial.mp4";

function ImageEditorTutorial() {
  const [recordedTutorialOpen, setRecordedTutorialOpen] = useState(false);
  const [readyAssets, setReadyAssets] = useState<Set<string>>(() => new Set());
  const imageEditorAssetsReady = readyAssets.size >= 5;
  const markImageEditorAssetReady = useCallback((src: string) => {
    setReadyAssets((current) => {
      if (current.has(src)) return current;
      const next = new Set(current);
      next.add(src);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!recordedTutorialOpen) return undefined;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setRecordedTutorialOpen(false);
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [recordedTutorialOpen]);

  return (
    <>
      <PreviewState
        eyebrow="图片编辑示例"
        title="图片编辑示例"
        description="上传图片并描述修改要求，快速完成内容编辑与素材融合。"
        action={(
          <button type="button" className="studio-secondary-button video-tutorial-recording-button" onClick={() => setRecordedTutorialOpen(true)}>
            <Video className="size-4" aria-hidden="true" />
            观看完整教程
          </button>
        )}
      >
        <div className={cn("image-editor-tutorial", imageEditorAssetsReady && "is-ready")} aria-busy={!imageEditorAssetsReady}>
        <div className="image-editor-tutorial__canvas" aria-label="图片编辑器示例图片">
          <span className="image-editor-tutorial__loading" aria-hidden="true" />
          <svg className="image-editor-tutorial__path" viewBox="0 0 980 520" aria-hidden="true">
            <path className="image-editor-tutorial__dash" d="M18 425C98 190 238 330 365 265C487 202 575 262 690 170C750 122 810 82 862 52" />
            <g className="image-editor-plane-mark">
              <path d="M9 30 56 9 42 56 32 39 9 48 25 33 9 30Z" fill="none" stroke="currentColor" strokeWidth="4.6" strokeLinecap="round" strokeLinejoin="round" />
            </g>
          </svg>

          <figure className="image-editor-photo image-editor-photo--input image-editor-photo--single-source">
            <img src="/tutorials/image-editor/single-source.webp" alt="方形粉色香水瓶白底素材" loading="eager" decoding="async" fetchPriority="high" onLoad={() => markImageEditorAssetReady("/tutorials/image-editor/single-source.webp")} onError={() => markImageEditorAssetReady("/tutorials/image-editor/single-source.webp")} />
          </figure>
          <svg className="image-editor-arrow image-editor-arrow--single" viewBox="0 0 128 74" aria-hidden="true" focusable="false">
            <defs>
              <marker id="image-editor-arrow-tip-single" viewBox="0 0 22 22" refX="19" refY="11" markerWidth="5.4" markerHeight="5.4" orient="auto">
                <path className="image-editor-arrow__tip" d="M3 2.6 19 11 3 19.4 7.4 11Z" />
              </marker>
            </defs>
            <path className="image-editor-arrow__halo" pathLength={1} d="M7 50C37 21 84 18 111 36" />
            <path className="image-editor-arrow__path" pathLength={1} d="M7 50C37 21 84 18 111 36" markerEnd="url(#image-editor-arrow-tip-single)" />
            <path className="image-editor-arrow__shine" pathLength={1} d="M7 50C37 21 84 18 111 36" />
          </svg>
          <span className="image-editor-prompt image-editor-prompt--single">
            <span>+</span>
            <span>提示词</span>
          </span>
          <figure className="image-editor-photo image-editor-photo--result image-editor-photo--single-result">
            <img src="/tutorials/image-editor/single-result.webp" alt="女性手持同款香水瓶的编辑结果" loading="eager" decoding="async" fetchPriority="high" onLoad={() => markImageEditorAssetReady("/tutorials/image-editor/single-result.webp")} onError={() => markImageEditorAssetReady("/tutorials/image-editor/single-result.webp")} />
          </figure>

          <figure className="image-editor-photo image-editor-photo--input image-editor-photo--merge-product">
            <img src="/tutorials/image-editor/merge-product.webp" alt="椭圆形粉色香水瓶白底素材" loading="eager" decoding="async" fetchPriority="high" onLoad={() => markImageEditorAssetReady("/tutorials/image-editor/merge-product.webp")} onError={() => markImageEditorAssetReady("/tutorials/image-editor/merge-product.webp")} />
          </figure>
          <figure className="image-editor-photo image-editor-photo--input image-editor-photo--merge-scene">
            <img src="/tutorials/image-editor/merge-scene.webp" alt="新中式牡丹场景素材" loading="eager" decoding="async" fetchPriority="high" onLoad={() => markImageEditorAssetReady("/tutorials/image-editor/merge-scene.webp")} onError={() => markImageEditorAssetReady("/tutorials/image-editor/merge-scene.webp")} />
          </figure>
          <svg className="image-editor-arrow image-editor-arrow--merge" viewBox="0 0 128 74" aria-hidden="true" focusable="false">
            <defs>
              <marker id="image-editor-arrow-tip-merge" viewBox="0 0 22 22" refX="19" refY="11" markerWidth="5.4" markerHeight="5.4" orient="auto">
                <path className="image-editor-arrow__tip" d="M3 2.6 19 11 3 19.4 7.4 11Z" />
              </marker>
            </defs>
            <path className="image-editor-arrow__halo" pathLength={1} d="M7 50C37 21 84 18 111 36" />
            <path className="image-editor-arrow__path" pathLength={1} d="M7 50C37 21 84 18 111 36" markerEnd="url(#image-editor-arrow-tip-merge)" />
            <path className="image-editor-arrow__shine" pathLength={1} d="M7 50C37 21 84 18 111 36" />
          </svg>
          <span className="image-editor-prompt image-editor-prompt--merge">
            <span>+</span>
            <span>提示词</span>
          </span>
          <figure className="image-editor-photo image-editor-photo--result image-editor-photo--merge-result">
            <img src="/tutorials/image-editor/merge-result.webp" alt="香水瓶放入新中式牡丹场景后的融合结果" loading="eager" decoding="async" fetchPriority="high" onLoad={() => markImageEditorAssetReady("/tutorials/image-editor/merge-result.webp")} onError={() => markImageEditorAssetReady("/tutorials/image-editor/merge-result.webp")} />
          </figure>
        </div>
      </div>
      </PreviewState>
      {recordedTutorialOpen ? (
        <div className="video-tutorial-recording-modal" role="presentation">
          <button
            type="button"
            className="video-tutorial-recording-modal__backdrop"
            aria-label="关闭图片编辑完整教程"
            onClick={() => setRecordedTutorialOpen(false)}
          />
          <section className="video-tutorial-recording-modal__card" role="dialog" aria-modal="true" aria-labelledby="image-editor-tutorial-recording-title">
            <header className="video-tutorial-recording-modal__head">
              <h4 id="image-editor-tutorial-recording-title">图片编辑完整教程</h4>
              <button
                type="button"
                className="video-tutorial-recording-modal__close"
                aria-label="关闭图片编辑完整教程"
                onClick={() => setRecordedTutorialOpen(false)}
                autoFocus
              >
                <X className="size-5" aria-hidden="true" />
              </button>
            </header>
            <video controls playsInline preload="metadata">
              <source src={recordedImageEditorTutorialSrc} type="video/mp4" />
              当前浏览器不支持播放此视频。
            </video>
          </section>
        </div>
      ) : null}
    </>
  );
}

const videoTutorialPromptText = "雨天城市街头，女生撑透明雨伞缓慢向前行走，并自然回头看向镜头。";
const videoTutorialResultVideoSrc = "/tutorials/video-generator/demo-result.mp4";
const videoTutorialInputImageSrc = "/tutorials/video-generator/input-person.webp";
const videoTutorialResultPosterSrc = "/tutorials/video-generator/rain-umbrella.webp";
const recordedVideoTutorialSrc = "/tutorials/video-generator/video-generation-tutorial.mp4";

type VideoTutorialImagePhase = "hidden" | "dragging" | "landed";
type VideoTutorialPlaybackState =
  | "final"
  | "idle"
  | "image-entering"
  | "image-touching"
  | "image-covered"
  | "typing"
  | "arrow-to-parameters"
  | "parameters"
  | "arrow-to-result"
  | "result-preparing"
  | "result-entering"
  | "result-playing"
  | "complete"
  | "resetting"
  | "fading-out";

function createTutorialTimeline() {
  const timers: number[] = [];

  return {
    wait(callback: () => void, delay: number) {
      const timer = window.setTimeout(callback, delay);
      timers.push(timer);
      return timer;
    },
    clear() {
      timers.forEach((timer) => window.clearTimeout(timer));
      timers.length = 0;
    },
  };
}

function isVideoTutorialImageLandedState(playbackState: VideoTutorialPlaybackState) {
  return !["idle", "image-entering", "image-touching"].includes(playbackState);
}

function isVideoTutorialPromptVisibleState(playbackState: VideoTutorialPlaybackState) {
  return !["idle", "image-entering", "image-touching", "image-covered"].includes(playbackState);
}

function isVideoTutorialParameterVisibleState(playbackState: VideoTutorialPlaybackState) {
  return ["final", "parameters", "arrow-to-result", "result-preparing", "result-entering", "result-playing", "complete", "resetting", "fading-out"].includes(playbackState);
}

function isVideoTutorialResultVisibleState(playbackState: VideoTutorialPlaybackState) {
  return Boolean(playbackState);
}

function isVideoTutorialResultPlayingState(playbackState: VideoTutorialPlaybackState) {
  return ["result-preparing", "result-entering", "result-playing"].includes(playbackState);
}

function VideoTutorialInputDemo({
  playbackState,
  promptText,
}: {
  playbackState: VideoTutorialPlaybackState;
  promptText: string;
}) {
  const demoRef = useRef<HTMLDivElement | null>(null);
  const imagePhase: VideoTutorialImagePhase = isVideoTutorialImageLandedState(playbackState)
    ? "landed"
    : playbackState === "image-entering" || playbackState === "image-touching"
      ? "dragging"
      : "hidden";
  const targetState = imagePhase === "landed" ? "covered" : "idle";
  const promptBubbleVisible = isVideoTutorialPromptVisibleState(playbackState);

  return (
    <div ref={demoRef} className="video-tutorial-input-demo">
      <div className="tutorial-upload-placeholder">
        <UploadCloud aria-hidden="true" />
        <span>上传图片</span>
      </div>
      <span
        className={cn(
          "tutorial-upload-target-ring",
          targetState === "covered" && "is-covered",
        )}
        aria-hidden="true"
      />

      <img
        src={videoTutorialInputImageSrc}
        alt=""
        className={cn(
          "tutorial-source-image",
          imagePhase === "dragging" && "is-dragging",
          imagePhase === "landed" && "is-visible",
        )}
        loading="lazy"
        decoding="async"
      />

      <div className={cn("tutorial-prompt-bubble", promptBubbleVisible && "is-visible")}>
        {promptText}
        {promptBubbleVisible && playbackState === "typing" && promptText.length < videoTutorialPromptText.length ? <span className="typing-caret" /> : null}
      </div>
    </div>
  );
}

function VideoTutorialResultSlot({
  playbackState,
  paused,
}: {
  playbackState: VideoTutorialPlaybackState;
  paused: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const wasPlayingRef = useRef(false);
  const [videoReady, setVideoReady] = useState(Boolean(videoTutorialResultVideoSrc));
  const resultPreviewActive = Boolean(videoTutorialResultVideoSrc && !paused);
  const shouldPlay = Boolean(resultPreviewActive);

  const playResultVideo = useCallback(() => {
    const video = videoRef.current;
    if (!video || !shouldPlay) return;
    video.autoplay = true;
    video.defaultMuted = true;
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.setAttribute("autoplay", "");
    video.setAttribute("muted", "");
    video.setAttribute("loop", "");
    video.setAttribute("playsinline", "");
    void video.play().catch(() => undefined);
  }, [shouldPlay]);

  const markResultVideoReady = useCallback(() => {
    setVideoReady(true);
    playResultVideo();
  }, [playResultVideo]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (shouldPlay) {
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      if (!wasPlayingRef.current) {
        try {
          video.currentTime = Math.min(0.1, Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0.1);
        } catch {
          // Metadata may still be settling on first load; playback can still begin muted.
        }
        wasPlayingRef.current = true;
      }
      playResultVideo();
      return;
    }

    wasPlayingRef.current = false;
    video.pause();
  }, [playResultVideo, shouldPlay]);

  useEffect(() => {
    if (!shouldPlay) return undefined;
    const timer = window.setInterval(() => {
      const video = videoRef.current;
      if (!video || !video.paused) return;
      playResultVideo();
    }, 500);
    return () => window.clearInterval(timer);
  }, [playResultVideo, shouldPlay]);

  useEffect(() => {
    if (!shouldPlay) return undefined;
    const replay = () => playResultVideo();
    window.addEventListener("focus", replay);
    document.addEventListener("visibilitychange", replay);
    return () => {
      window.removeEventListener("focus", replay);
      document.removeEventListener("visibilitychange", replay);
    };
  }, [playResultVideo, shouldPlay]);

  return (
    <div className="video-tutorial-result-slot">
      <div className="video-tutorial-result-slot__backdrop" aria-hidden="true">
        <img src={videoTutorialInputImageSrc} alt="" loading="lazy" decoding="async" />
      </div>
      <div
          className={cn(
            "video-tutorial-result-slot__media",
            (resultPreviewActive || isVideoTutorialResultVisibleState(playbackState)) && "is-visible",
            (resultPreviewActive || isVideoTutorialResultPlayingState(playbackState)) && "is-playing",
            videoReady && "is-video-ready",
            playbackState === "complete" && "is-complete",
            playbackState === "resetting" && "is-resetting",
        )}
      >
        <img className="video-tutorial-result-slot__poster" src={videoTutorialResultPosterSrc} alt="" loading="eager" decoding="async" />
        {videoTutorialResultVideoSrc ? (
          <video
            ref={videoRef}
            src={videoTutorialResultVideoSrc}
            poster={videoTutorialResultPosterSrc}
            autoPlay
            loop
            muted
            playsInline
            preload="metadata"
            onLoadedMetadata={markResultVideoReady}
            onCanPlay={markResultVideoReady}
            onLoadedData={markResultVideoReady}
            onPlay={() => setVideoReady(true)}
            onPlaying={() => setVideoReady(true)}
            onPause={playResultVideo}
          />
        ) : (
          <video poster={videoTutorialInputImageSrc} muted playsInline preload="metadata" aria-label="视频结果预留位" />
        )}
      </div>
    </div>
  );
}

function VideoTutorialParameterDemo({
  playbackState,
}: {
  playbackState: VideoTutorialPlaybackState;
}) {
  const showParameters = isVideoTutorialParameterVisibleState(playbackState);

  return (
    <div className={cn("video-tutorial-parameter-demo", showParameters && "is-active")}>
      <div className="video-tutorial-parameter-demo__preview">
        <img src={videoTutorialResultPosterSrc} alt="" loading="lazy" decoding="async" />
      </div>
      <div className="video-tutorial-parameter-demo__assets" aria-label="示例参数">
        <span className="video-tutorial-parameter-demo__asset" aria-label="5 秒">
          <span className="video-tutorial-parameter-demo__asset-icon is-duration" aria-hidden="true" />
          <strong>5s</strong>
        </span>
        <span className="video-tutorial-parameter-demo__asset" aria-label="720P">
          <span className="video-tutorial-parameter-demo__asset-icon is-resolution" aria-hidden="true" />
          <strong>720P</strong>
        </span>
        <span className="video-tutorial-parameter-demo__asset" aria-label="4:3">
          <span className="video-tutorial-parameter-demo__asset-icon is-ratio" aria-hidden="true" />
          <strong>4:3</strong>
        </span>
      </div>
    </div>
  );
}

function VideoGenerationTutorial({ paused = false }: { paused?: boolean }) {
  const guideRef = useRef<HTMLDivElement | null>(null);
  const replayTimerRef = useRef<number | undefined>(undefined);
  const reducedMotion = useReducedMotion();
  const [recordedTutorialOpen, setRecordedTutorialOpen] = useState(false);
  const [playbackStateState, setPlaybackState] = useState<VideoTutorialPlaybackState>("idle");
  const [, setTypedText] = useState("");
  const [isInView, setIsInView] = useState(true);
  const [pageVisible, setPageVisible] = useState(true);
  const [cycle, setCycle] = useState(0);
  const [inputPlaybackStateState, setInputPlaybackState] = useState<VideoTutorialPlaybackState>("idle");
  const [inputTypedTextState, setInputTypedText] = useState("");
  const [inputCycle, setInputCycle] = useState(0);
  const shouldPause = paused || reducedMotion || !isInView || !pageVisible;
  const playbackState = reducedMotion ? "final" : playbackStateState;
  const inputPlaybackState = reducedMotion ? "final" : inputPlaybackStateState;
  const inputPromptText = reducedMotion ? videoTutorialPromptText : inputTypedTextState;

  const clearReplayTimer = useCallback(() => {
    if (replayTimerRef.current) {
      window.clearTimeout(replayTimerRef.current);
      replayTimerRef.current = undefined;
    }
  }, []);

  useEffect(() => {
    if (shouldPause || reducedMotion) return undefined;

    const timeline = createTutorialTimeline();
    let typingTimer: number | undefined;

    const stopTyping = () => {
      if (typingTimer) {
        window.clearInterval(typingTimer);
        typingTimer = undefined;
      }
    };

    timeline.wait(() => {
      setInputPlaybackState("idle");
      setInputTypedText("");
    }, 0);
    timeline.wait(() => setInputPlaybackState("image-entering"), 80);
    timeline.wait(() => setInputPlaybackState("image-touching"), 820);
    timeline.wait(() => setInputPlaybackState("image-covered"), 1540);
    timeline.wait(() => {
      setInputPlaybackState("typing");
      setInputTypedText(videoTutorialPromptText.slice(0, 1));

      let index = 1;
      typingTimer = window.setInterval(() => {
        index += 1;
        setInputTypedText(videoTutorialPromptText.slice(0, index));

        if (index >= videoTutorialPromptText.length) {
          stopTyping();
          setInputTypedText(videoTutorialPromptText);
          timeline.wait(() => setInputPlaybackState("fading-out"), 1700);
          timeline.wait(() => {
            setInputPlaybackState("idle");
            setInputTypedText("");
            setInputCycle((value) => value + 1);
          }, 2220);
        }
      }, 42);
    }, 1800);

    return () => {
      timeline.clear();
      stopTyping();
    };
  }, [inputCycle, reducedMotion, shouldPause]);

  const finishTutorialCycle = useCallback(() => {
    if (shouldPause || reducedMotion || playbackStateState !== "result-playing") return;

    clearReplayTimer();
    setPlaybackState("complete");
    setTypedText(videoTutorialPromptText);
    replayTimerRef.current = window.setTimeout(() => {
      setPlaybackState("resetting");
      replayTimerRef.current = window.setTimeout(() => {
        setPlaybackState("fading-out");
        replayTimerRef.current = window.setTimeout(() => {
          replayTimerRef.current = undefined;
          setPlaybackState("idle");
          setTypedText("");
          setCycle((value) => value + 1);
        }, 520);
      }, 760);
    }, 900);
  }, [clearReplayTimer, playbackStateState, reducedMotion, shouldPause]);

  useEffect(() => {
    if (shouldPause || reducedMotion || playbackStateState !== "result-playing") return undefined;

    const timer = window.setTimeout(() => {
      finishTutorialCycle();
    }, 5600);

    return () => window.clearTimeout(timer);
  }, [finishTutorialCycle, playbackStateState, reducedMotion, shouldPause]);

  useEffect(() => {
    const node = guideRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return undefined;

    const observer = new IntersectionObserver(([entry]) => {
      setIsInView(entry.isIntersecting);
    }, { threshold: 0.18 });

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const syncPageVisibility = () => setPageVisible(document.visibilityState === "visible");

    syncPageVisibility();
    document.addEventListener("visibilitychange", syncPageVisibility);
    return () => document.removeEventListener("visibilitychange", syncPageVisibility);
  }, []);

  useEffect(() => {
    if (shouldPause) {
      clearReplayTimer();
      return undefined;
    }

    let stopped = false;
    let typingTimer: number | undefined;
    const timeline = createTutorialTimeline();

    const stopTyping = () => {
      if (typingTimer) {
        window.clearInterval(typingTimer);
        typingTimer = undefined;
      }
    };

    const wait = (callback: () => void, delay: number) => {
      timeline.wait(() => {
        if (!stopped) callback();
      }, delay);
    };

    const play = () => {
      if (stopped) return;

      stopTyping();
      clearReplayTimer();
      setPlaybackState("idle");
      setTypedText("");

      wait(() => setPlaybackState("image-entering"), 360);
      wait(() => setPlaybackState("image-touching"), 1350);
      wait(() => setPlaybackState("image-covered"), 2700);
      wait(() => {
        setPlaybackState("typing");
        setTypedText(videoTutorialPromptText.slice(0, 1));

        let index = 1;
        typingTimer = window.setInterval(() => {
          index += 1;
          setTypedText(videoTutorialPromptText.slice(0, index));

          if (index >= videoTutorialPromptText.length) {
            stopTyping();
            setTypedText(videoTutorialPromptText);
            wait(() => setPlaybackState("arrow-to-parameters"), 260);
            wait(() => setPlaybackState("parameters"), 1160);
            wait(() => setPlaybackState("arrow-to-result"), 2140);
            wait(() => setPlaybackState("result-preparing"), 2960);
            wait(() => setPlaybackState("result-entering"), 3060);
            wait(() => setPlaybackState("result-playing"), 3240);
          }
        }, 54);
      }, 2880);
    };

    play();

    return () => {
      stopped = true;
      timeline.clear();
      clearReplayTimer();
      stopTyping();
    };
  }, [clearReplayTimer, cycle, shouldPause]);

  useEffect(() => () => clearReplayTimer(), [clearReplayTimer]);

  useEffect(() => {
    if (!recordedTutorialOpen) return undefined;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setRecordedTutorialOpen(false);
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [recordedTutorialOpen]);

  const steps = [
    {
      id: "upload",
      title: "输入内容并确认视频场景",
      description: "上传参考图后输入提示词，让视频围绕起始画面和动作描述生成。",
      visual: <VideoTutorialInputDemo key={`input-${inputCycle}`} playbackState={inputPlaybackState} promptText={inputPromptText} />,
      visualSide: "left",
    },
    {
      id: "prompt",
      title: "调整视频参数",
      description: "根据需要确认时长、清晰度和比例，让结果更贴近当前创意。",
      visual: <VideoTutorialParameterDemo playbackState={playbackState} />,
      visualSide: "right",
    },
    {
      id: "result",
      title: "生成视频并查看结果",
      description: "生成完成后在这里预览视频结果，需要时可以下载或重新生成。",
      visual: <VideoTutorialResultSlot playbackState={playbackState} paused={paused || reducedMotion || !pageVisible} />,
      visualSide: "left",
    },
  ];
  const firstArrowDrawing = playbackState === "arrow-to-parameters";
  const firstArrowDrawn = ["parameters", "arrow-to-result", "result-preparing", "result-entering", "result-playing", "complete", "resetting", "fading-out", "final"].includes(playbackState);
  const secondArrowDrawing = playbackState === "arrow-to-result";
  const secondArrowDrawn = ["result-preparing", "result-entering", "result-playing", "complete", "resetting", "fading-out", "final"].includes(playbackState);

  return (
    <>
      <PreviewState
        eyebrow="快速教程"
        title="视频生成快速教程"
        description="上传参考图，输入提示词，确认比例后生成视频。"
        action={(
          <button type="button" className="studio-secondary-button video-tutorial-recording-button" onClick={() => setRecordedTutorialOpen(true)}>
            <Video className="size-4" aria-hidden="true" />
            观看完整教程
          </button>
        )}
      >
      <div
        ref={guideRef}
        className={cn(
          "video-tutorial-guide",
          reducedMotion && "is-reduced-motion",
          firstArrowDrawing && "is-drawing-first-arrow",
          firstArrowDrawn && "is-first-arrow-drawn",
          secondArrowDrawing && "is-drawing-second-arrow",
          secondArrowDrawn && "is-second-arrow-drawn",
        )}
        data-playback-state={playbackState}
      >
        {steps.map((step, index) => (
          <article key={step.id} className={cn("video-tutorial-guide__section", step.visualSide === "right" && "is-visual-right")}>
            <div className="video-tutorial-guide__visual">
              {step.visual}
            </div>
            <div className="video-tutorial-guide__copy">
              <span>{String(index + 1).padStart(2, "0")}</span>
              <h4>{step.title}</h4>
              <p>{step.description}</p>
            </div>
            {index < steps.length - 1 ? (
              <svg className="video-tutorial-guide__arrow" viewBox="0 0 64 44" aria-hidden="true" focusable="false">
                <path className="video-tutorial-guide__arrow-path" d="M7 7C22 31 41 36 55 25" />
                <path className="video-tutorial-guide__arrow-head" d="M45 23L56 25L50 35" />
              </svg>
            ) : null}
          </article>
        ))}
      </div>
      </PreviewState>
      {recordedTutorialOpen ? (
        <div className="video-tutorial-recording-modal" role="presentation">
          <button
            type="button"
            className="video-tutorial-recording-modal__backdrop"
            aria-label="关闭完整视频教程"
            onClick={() => setRecordedTutorialOpen(false)}
          />
          <section className="video-tutorial-recording-modal__card" role="dialog" aria-modal="true" aria-labelledby="video-tutorial-recording-title">
            <header className="video-tutorial-recording-modal__head">
              <h4 id="video-tutorial-recording-title">视频生成完整教程</h4>
              <button
                type="button"
                className="video-tutorial-recording-modal__close"
                aria-label="关闭完整视频教程"
                onClick={() => setRecordedTutorialOpen(false)}
                autoFocus
              >
                <X className="size-5" aria-hidden="true" />
              </button>
            </header>
            <video controls playsInline preload="metadata">
              <source src={recordedVideoTutorialSrc} type="video/mp4" />
              当前浏览器不支持播放此视频。
            </video>
          </section>
        </div>
      ) : null}
    </>
  );
}

function ToolTutorial({ kind, paused = false }: { kind: ToolTutorialKind; paused?: boolean }) {
  useEffect(() => {
    warmPublicAssetCache(tutorialAssetUrls(kind));
  }, [kind]);

  if (kind === "image") {
    return <ImageGenerationTutorial />;
  }

  if (kind === "image-editor") {
    return <ImageEditorTutorial />;
  }

  if (kind === "video") {
    return <VideoGenerationTutorial paused={paused} />;
  }

  const tutorial = toolTutorials[kind];

  return (
    <PreviewState eyebrow="快速教程" title={tutorial.title} description={tutorial.description}>
      <div className="studio-walkthrough">
        {tutorial.sections.map((section, index) => (
          <article key={section.title} className={cn("studio-walkthrough__section", section.mediaSide === "right" && "is-media-right")}>
            <div className={cn("studio-walkthrough__visual", section.visualClassName)}>
              <div className="studio-walkthrough__canvas" aria-hidden="true">
                {section.layers.map((layer) => (
                  layer.type === "video" ? (
                    <div key={layer.src} className={cn("studio-walkthrough__layer", layer.className)}>
                      <video src={layer.src} poster={layer.poster} autoPlay muted loop playsInline preload="metadata" />
                      {layer.poster ? <img className="studio-walkthrough__video-poster" src={layer.poster} alt="" /> : null}
                    </div>
                  ) : (
                    <img key={layer.src} src={layer.src} alt={layer.alt} className={cn("studio-walkthrough__layer", layer.className)} />
                  )
                ))}
                {section.bubbles?.map((bubble) => (
                  <span key={bubble.text} className={cn("studio-walkthrough__bubble", bubble.className)}>{bubble.text}</span>
                ))}
                {section.tags?.map((tag) => (
                  <span key={tag.text} className={cn("studio-walkthrough__tag", tag.className)}>{tag.text}</span>
                ))}
                {(section.bubbles?.length || section.visualClassName?.includes("flow")) ? (
                  <span className="studio-walkthrough__arrow" />
                ) : null}
              </div>
            </div>
            <div className="studio-walkthrough__copy">
              <span>{String(index + 1).padStart(2, "0")}</span>
              <h4>{section.title}</h4>
              <p>{section.description}</p>
            </div>
          </article>
        ))}
      </div>
    </PreviewState>
  );
}

function taskStartMs(value?: string | null) {
  const parsed = value ? Number(new Date(value)) : NaN;
  return Number.isFinite(parsed) ? parsed : Date.now();
}

const publicAssetWarmupConcurrency = 2;

function warmPublicAssetCache(urls: string[]) {
  if (typeof window === "undefined") return;
  const uniqueUrls = Array.from(new Set(urls.filter(Boolean)));
  if (!uniqueUrls.length) return;

  const warm = () => {
    let nextIndex = 0;
    let activeCount = 0;

    const runNext = () => {
      while (activeCount < publicAssetWarmupConcurrency && nextIndex < uniqueUrls.length) {
        const url = uniqueUrls[nextIndex];
        nextIndex += 1;
        activeCount += 1;
        void fetch(url, { cache: "force-cache" }).catch(() => undefined).finally(() => {
          activeCount -= 1;
          runNext();
        });
      }
    };

    runNext();
  };

  const idleWindow = window as Window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  };
  if (idleWindow.requestIdleCallback) {
    idleWindow.requestIdleCallback(warm, { timeout: 1500 });
  } else {
    window.setTimeout(warm, 500);
  }
}

function tutorialAssetUrls(kind: ToolTutorialKind) {
  if (kind === "image") {
    return ["/tutorials/image-generator/perfume-result.webp"];
  }
  if (kind === "image-editor") {
    return [
      "/tutorials/image-editor/single-source.webp",
      "/tutorials/image-editor/single-result.webp",
      "/tutorials/image-editor/merge-product.webp",
      "/tutorials/image-editor/merge-scene.webp",
      "/tutorials/image-editor/merge-result.webp",
    ];
  }
  if (kind === "video") {
    return [videoTutorialInputImageSrc, videoTutorialResultPosterSrc, videoTutorialResultVideoSrc];
  }

  return toolTutorials[kind].sections.flatMap((section) => (
    section.layers.flatMap((layer) => layer.poster ? [layer.src, layer.poster] : [layer.src])
  ));
}

function ProcessingPreview({
  label,
  detail = "系统正在处理你的任务，可以继续准备其他创作。",
  progress = 62,
  startedAt,
}: {
  label: string;
  detail?: string;
  progress?: number;
  startedAt?: string | number | null;
}) {
  const [fallbackStartedAt] = useState(() => Date.now());
  const startedAtMs = typeof startedAt === "number" ? startedAt : startedAt ? taskStartMs(startedAt) : fallbackStartedAt;
  const [now, setNow] = useState(() => Date.now());
  const elapsedMs = Math.max(0, now - startedAtMs);
  const progressValue = Math.round(animatedTaskProgress(elapsedMs, Math.max(0, progress / 100), 0.94) * 100);
  const elapsedText = formatElapsedClock(elapsedMs);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <PreviewState eyebrow="处理中" title={label} description={detail} role="status" live>
      <div className="studio-processing-state studio-generation-pending">
        <DotRippleLoader fill expanded />
        <div className="studio-processing-state__copy">
          <p>{label}</p>
          <small>已等待 {elapsedText} · 进度 {progressValue}%</small>
        </div>
        <div className="studio-processing-state__track" aria-hidden="true">
          <span style={{ width: `${progressValue}%` }} />
        </div>
      </div>
    </PreviewState>
  );
}

function ErrorPreview({
  canRetry,
  onRetry,
  onReloadProviders,
}: {
  canRetry: boolean;
  onRetry: () => void;
  onReloadProviders?: () => Promise<void>;
}) {
  return (
    <PreviewState eyebrow="失败" title="生成失败" role="alert" hideHeader>
      <div className="studio-preview__empty studio-error-preview">
        <strong>生成失败</strong>
        <div className="studio-actions">
          {onReloadProviders ? (
            <button type="button" className="studio-secondary-button" onClick={() => void onReloadProviders()}>
              重新加载模型
            </button>
          ) : null}
          <button type="button" className="studio-secondary-button" onClick={onRetry} disabled={!canRetry}>
            重试
          </button>
        </div>
      </div>
    </PreviewState>
  );
}

function imageResultFacts(item: LibraryItem) {
  const facts: string[] = [];
  const ratio = typeof item.params.ratio === "string" ? item.params.ratio : "";
  const quality = typeof item.params.quality === "string" ? item.params.quality : "";
  const width = Number(item.params.outputWidth || item.params.sourceWidth || 0);
  const height = Number(item.params.outputHeight || item.params.sourceHeight || 0);
  if (ratio) facts.push(ratio);
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    facts.push(`${Math.round(width)} x ${Math.round(height)}`);
  }
  if (quality) facts.push(quality.toUpperCase());
  return facts;
}

function videoResultFacts(item: LibraryItem) {
  const facts: string[] = [];
  const ratio = typeof item.params.ratio === "string" ? item.params.ratio : "";
  const rawDuration = item.params.durationSeconds || item.params.duration || item.params.videoDuration;
  const duration = Number(rawDuration);
  const width = Number(item.params.outputWidth || item.params.sourceWidth || 0);
  const height = Number(item.params.outputHeight || item.params.sourceHeight || 0);
  if (ratio) facts.push(ratio);
  if (Number.isFinite(duration) && duration > 0) facts.push(`${Math.round(duration)} 秒`);
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    facts.push(`${Math.round(width)} x ${Math.round(height)}`);
  } else {
    facts.push("720P");
  }
  return facts;
}

function JobStatusPreview({
  title,
  detail,
  facts,
  badge,
}: {
  title: string;
  detail: string;
  facts: string[];
  badge?: string;
}) {
  return (
    <PreviewState eyebrow="结果" title={title} description={detail} badge={badge} role="status" live>
      <div className="studio-job-status-card studio-generation-pending" aria-live="polite">
        <DotRippleLoader fill expanded />
        <div className="studio-job-status-card__copy">
          <strong>{title}</strong>
          <p>{detail}</p>
        </div>
        {facts.length ? (
          <div className="studio-result-facts" aria-label="任务参数">
            {facts.map((fact) => <span key={fact}>{fact}</span>)}
          </div>
        ) : null}
      </div>
    </PreviewState>
  );
}

function UpscaleUnavailablePreview({ message }: { message?: string }) {
  return (
    <PreviewState eyebrow="暂不可用" title="高清处理暂时不可用" description={message || "高清处理暂时不可用，请稍后重试"} role="alert">
      <div className="studio-preview__empty">
        <p>{message || "请稍后重试。"}</p>
      </div>
    </PreviewState>
  );
}

const recordedImageUpscaleTutorialSrc = "/tutorials/image-upscale/image-upscale-tutorial.mp4";
const recordedVideoUpscaleTutorialSrc = "/tutorials/video-upscale/video-upscale-tutorial.mp4";

function TutorialRecordingDialog({
  title,
  src,
  onClose,
}: {
  title: string;
  src: string;
  onClose: () => void;
}) {
  const titleId = `${title}-tutorial-recording-title`;
  return (
    <div className="video-tutorial-recording-modal" role="presentation">
      <button
        type="button"
        className="video-tutorial-recording-modal__backdrop"
        aria-label={`关闭${title}`}
        onClick={onClose}
      />
      <section className="video-tutorial-recording-modal__card" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="video-tutorial-recording-modal__head">
          <h4 id={titleId}>{title}</h4>
          <button type="button" className="video-tutorial-recording-modal__close" aria-label={`关闭${title}`} onClick={onClose} autoFocus>
            <X className="size-5" aria-hidden="true" />
          </button>
        </header>
        <video controls playsInline preload="metadata">
          <source src={src} type="video/mp4" />
          当前浏览器不支持播放此视频。
        </video>
      </section>
    </div>
  );
}

function ImageUpscaleCompareTutorial() {
  const [recordedTutorialOpen, setRecordedTutorialOpen] = useState(false);

  useEffect(() => {
    warmPublicAssetCache([
      "/tutorial/image-upscaler/image-before.jpg",
      "/tutorial/image-upscaler/image-after.png",
    ]);
  }, []);

  useEffect(() => {
    if (!recordedTutorialOpen) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setRecordedTutorialOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [recordedTutorialOpen]);

  return (
    <>
      <PreviewState
        eyebrow="图片细节对比"
        title="图片细节对比"
        description="拖动分割线，查看高清前后的清晰度和细节变化。"
        action={(
          <button type="button" className="studio-secondary-button video-tutorial-recording-button" onClick={() => setRecordedTutorialOpen(true)}>
            <Video className="size-4" aria-hidden="true" />
            观看完整教程
          </button>
        )}
      >
        <BeforeAfterImageCompare
          beforeSrc="/tutorial/image-upscaler/image-before.jpg"
          afterSrc="/tutorial/image-upscaler/image-after.png"
          beforeLabel="高清前"
          afterLabel="高清后"
          beforeAlt="高清前示例图"
          afterAlt="高清后示例图"
        />
      </PreviewState>
      {recordedTutorialOpen ? <TutorialRecordingDialog title="图片高清完整教程" src={recordedImageUpscaleTutorialSrc} onClose={() => setRecordedTutorialOpen(false)} /> : null}
    </>
  );
}

function VideoUpscaleCompareTutorial() {
  const [recordedTutorialOpen, setRecordedTutorialOpen] = useState(false);

  useEffect(() => {
    warmPublicAssetCache([
      "/tutorial/video-upscaler/video-before.mp4",
      "/tutorial/video-upscaler/video-after.mp4",
    ]);
  }, []);

  useEffect(() => {
    if (!recordedTutorialOpen) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setRecordedTutorialOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [recordedTutorialOpen]);

  return (
    <>
      <PreviewState
        eyebrow="视频细节对比"
        title="视频细节对比"
        description="拖动分割线，查看高清前后的视频清晰度和细节变化。"
        action={(
          <button type="button" className="studio-secondary-button video-tutorial-recording-button" onClick={() => setRecordedTutorialOpen(true)}>
            <Video className="size-4" aria-hidden="true" />
            观看完整教程
          </button>
        )}
      >
        <BeforeAfterImageCompare
          beforeSrc="/tutorial/video-upscaler/video-before.mp4"
          afterSrc="/tutorial/video-upscaler/video-after.mp4"
          beforeLabel="高清前"
          afterLabel="高清后"
          beforeAlt="高清前示例视频"
          afterAlt="高清后示例视频"
          mediaType="video"
          beforeEffect="blur"
          autoPlayVideo
          videoPreload="metadata"
        />
      </PreviewState>
      {recordedTutorialOpen ? <TutorialRecordingDialog title="视频放大完整教程" src={recordedVideoUpscaleTutorialSrc} onClose={() => setRecordedTutorialOpen(false)} /> : null}
    </>
  );
}

export function ImageUpscalePreviewPanel({
  state,
  output,
  canSubmit,
  onSubmit,
}: {
  state: ImageUpscaleWorkspaceState;
  output: OutputState;
  canSubmit: boolean;
  onSubmit: () => void;
}) {
  const source = state.file;

  if (state.loading) {
    return <ProcessingPreview label="正在处理" detail="高清增强正在处理，完成后会显示对比和下载入口。" progress={54} />;
  }

  if (state.submitError) {
    return <ErrorPreview canRetry={canSubmit} onRetry={onSubmit} />;
  }

  if (!state.checked || state.statusLoading || (!state.availability?.ready && !state.statusError)) {
    return state.statusLoading ? <ProcessingPreview label="正在检查高清服务" detail="正在确认当前高清增强服务是否可用。" progress={34} /> : <ImageUpscaleCompareTutorial />;
  }

  if (!state.availability?.ready) {
    return <UpscaleUnavailablePreview message={state.availability?.detail || state.statusError} />;
  }

  if (output?.item.output?.url) {
    const params = output.item.params;
    const sourceSize = typeof params.sourceWidth === "number" && typeof params.sourceHeight === "number"
      ? `${params.sourceWidth} x ${params.sourceHeight}`
      : "未记录";
    const outputSize = typeof params.outputWidth === "number" && typeof params.outputHeight === "number"
      ? `${params.outputWidth} x ${params.outputHeight}`
      : "未记录";
    const resultScale = typeof params.scale === "number" ? upscaleTargetLabel(String(params.scale)) : upscaleTargetLabel(state.scale);
    return (
      <PreviewState eyebrow="结果" title="高清结果" description={`${upscaleTargetLabel(state.scale)} 高清处理完成。`} badge={libraryStatusBadgeLabel(output.item.status)} role="status" live>
        <ResultReveal className="studio-result-reveal">
          {source ? (
            <BeforeAfterImageCompare
              beforeSrc={source.previewUrl}
              afterSrc={output.item.output.url}
              beforeLabel="高清前"
              afterLabel="高清后"
              beforeAlt={source.file.name}
              afterAlt={output.item.title}
            />
          ) : (
            <figure className="studio-upscale-preview__figure">
              <span className="studio-upscale-preview__label">高清结果</span>
              <img src={output.item.output.url} alt={output.item.title} />
            </figure>
          )}
          <dl className="studio-upscale-stats" aria-label="图片高清结果信息">
            <div>
              <dt>原图尺寸</dt>
              <dd>{sourceSize}</dd>
            </div>
            <div>
              <dt>输出尺寸</dt>
              <dd>{outputSize}</dd>
            </div>
            <div>
              <dt>当前倍数</dt>
              <dd>{resultScale}</dd>
            </div>
          </dl>
          <div className="studio-actions">
            <a className="studio-secondary-button" href={output.item.output.url} download>
              下载结果图片
            </a>
            <button type="button" className="studio-secondary-button" onClick={onSubmit} disabled={!canSubmit}>
              再次增强
            </button>
          </div>
        </ResultReveal>
      </PreviewState>
    );
  }

  return <ImageUpscaleCompareTutorial />;
}

export function VideoUpscalePreviewPanel({
  state,
  output,
  canSubmit,
  onSubmit,
}: {
  state: VideoUpscaleWorkspaceState;
  output: OutputState;
  canSubmit: boolean;
  onSubmit: () => void;
}) {
  const source = state.file;

  if (state.loading || state.job?.status === "generating" || state.job?.status === "queued") {
    return <ProcessingPreview label="正在处理视频" detail="视频高清增强需要排队处理，完成后会自动刷新结果。" progress={42} startedAt={state.job?.createdAt} />;
  }

  if (state.submitError) {
    return <ErrorPreview canRetry={canSubmit} onRetry={onSubmit} />;
  }

  if (!state.checked || state.statusLoading || (!state.availability?.ready && !state.statusError)) {
    return state.statusLoading ? <ProcessingPreview label="正在检查高清服务" detail="正在确认当前视频高清服务是否可用。" progress={34} /> : <VideoUpscaleCompareTutorial />;
  }

  if (!state.availability?.ready) {
    return <UpscaleUnavailablePreview message={state.availability?.detail || state.statusError} />;
  }

  if (output?.item.output?.url) {
    const params = output.item.params;
    const sourceSize = typeof params.sourceWidth === "number" && typeof params.sourceHeight === "number"
      ? `${params.sourceWidth} x ${params.sourceHeight}`
      : "未记录";
    const outputSize = typeof params.outputWidth === "number" && typeof params.outputHeight === "number"
      ? `${params.outputWidth} x ${params.outputHeight}`
      : "未记录";
    const resultScale = videoUpscaleScaleLabel(typeof params.scale === "number" ? String(params.scale) : state.scale);
    return (
      <PreviewState eyebrow="结果" title="高清结果" description={`${videoUpscaleScaleLabel(state.scale)} 高清处理完成。`} badge={libraryStatusBadgeLabel(output.item.status)} role="status" live>
        <ResultReveal className="studio-result-reveal">
          {source ? (
            <BeforeAfterImageCompare
              beforeSrc={source.previewUrl}
              afterSrc={output.item.output.url}
              beforeLabel="高清前"
              afterLabel="高清后"
              beforeAlt={source.file.name}
              afterAlt={output.item.title}
              mediaType="video"
              autoPlayVideo
              videoPreload="auto"
            />
          ) : (
            <figure className="studio-upscale-preview__figure">
              <span className="studio-upscale-preview__label">高清结果</span>
              <video src={output.item.output.url} controls />
            </figure>
          )}
          <dl className="studio-upscale-stats" aria-label="视频高清结果信息">
            <div>
              <dt>原视频分辨率</dt>
              <dd>{sourceSize}</dd>
            </div>
            <div>
              <dt>输出分辨率</dt>
              <dd>{outputSize}</dd>
            </div>
            <div>
              <dt>当前倍数</dt>
              <dd>{resultScale}</dd>
            </div>
          </dl>
          <div className="studio-actions">
            <a className="studio-secondary-button" href={output.item.output.url} download>
              下载结果视频
            </a>
            <button type="button" className="studio-secondary-button" onClick={onSubmit} disabled={!canSubmit}>
              再次增强
            </button>
          </div>
        </ResultReveal>
      </PreviewState>
    );
  }

  return <VideoUpscaleCompareTutorial />;
}

export function ImagePreviewPanel({
  cacheOwnerId,
  mode,
  output,
  outputs = output ? [output] : [],
  loading,
  pendingCount = 0,
  activeBatchId,
  canSubmit,
  submitError,
  isEditor,
  promptFilled,
  hasProvider,
  hasFiles,
  onSubmit,
  onRetry,
  onRetryItem,
  onReloadProviders,
  onUpscale,
  onCreateVideo,
  onEdit,
  onDismiss,
}: {
  cacheOwnerId?: string | null;
  mode: WorkspaceImageMode;
  output: OutputState;
  outputs?: OutputItemState[];
  loading: boolean;
  pendingCount?: number;
  activeBatchId?: string | null;
  canSubmit: boolean;
  submitError: string;
  submitDiagnostic?: StudioErrorDiagnostic | null;
  isEditor: boolean;
  promptFilled: boolean;
  hasProvider: boolean;
  hasFiles: boolean;
  onSubmit: () => void;
  onRetry: () => void;
  onRetryItem?: (item: LibraryItem) => void;
  onReloadProviders: () => Promise<void>;
  onUpscale: (item: LibraryItem) => void;
  onCreateVideo: (item: LibraryItem) => void;
  onEdit: (item: LibraryItem) => void;
  onDismiss: (itemId: string) => void;
}) {
  const canRetry = canSubmit && hasProvider && promptFilled && (mode === "text-to-image" || hasFiles);
  const resultOutputs = outputs.length ? outputs : output ? [output] : [];

  if (loading && !resultOutputs.length) {
    return (
      <PreviewState eyebrow="结果" title="正在生成图片" description="完成的图片会立即替换对应位置。" badge="生成中" role="status" live>
        <ImageResultGrid cacheOwnerId={cacheOwnerId} outputs={[]} pendingCount={pendingCount} activeBatchId={activeBatchId} canRetry={false} loading onRetry={onRetry} onRetryItem={onRetryItem} onUpscale={onUpscale} onCreateVideo={onCreateVideo} onEdit={onEdit} onDismiss={onDismiss} />
      </PreviewState>
    );
  }

  if (submitError && !resultOutputs.length) {
    return (
      <ErrorPreview
        canRetry={canRetry}
        onRetry={onSubmit}
        onReloadProviders={!hasProvider ? onReloadProviders : undefined}
      />
    );
  }

  if (resultOutputs.length) {
    const resultContent = (
        <ImageResultGrid
          cacheOwnerId={cacheOwnerId}
          outputs={resultOutputs}
          pendingCount={pendingCount}
          activeBatchId={activeBatchId}
          canRetry={canRetry}
        loading={loading}
        onRetry={onRetry}
        onRetryItem={onRetryItem}
        onUpscale={onUpscale}
          onCreateVideo={onCreateVideo}
          onEdit={onEdit}
          onDismiss={onDismiss}
      />
    );

    return (
      <PreviewState
        eyebrow="结果"
        title={resultOutputs.length > 1 ? `已生成 ${resultOutputs.length} 张` : "结果"}
        description={loading ? "还有图片在生成中，已完成的结果可以先操作。" : undefined}
        badge={loading ? "生成中" : libraryStatusBadgeLabel(resultOutputs[resultOutputs.length - 1].item.status)}
        role="status"
        live
      >
        {isEditor ? resultContent : <ResultReveal className="studio-result-reveal">{resultContent}</ResultReveal>}
      </PreviewState>
    );
  }

  return <ToolTutorial kind={isEditor ? "image-editor" : "image"} />;
}

function ImageResultGrid({
  cacheOwnerId,
  outputs,
  pendingCount,
  activeBatchId,
  canRetry,
  loading,
  onRetry,
  onRetryItem,
  onUpscale,
  onCreateVideo,
  onEdit,
  onDismiss,
}: {
  cacheOwnerId?: string | null;
  outputs: OutputItemState[];
  pendingCount: number;
  activeBatchId?: string | null;
  canRetry: boolean;
  loading: boolean;
  onRetry: () => void;
  onRetryItem?: (item: LibraryItem) => void;
  onUpscale: (item: LibraryItem) => void;
  onCreateVideo: (item: LibraryItem) => void;
  onEdit: (item: LibraryItem) => void;
  onDismiss: (itemId: string) => void;
}) {
  const currentOutputs = activeBatchId
    ? outputs.filter((output) => output.item.params?.imageBatchId === activeBatchId)
    : outputs;
  const historicOutputs = activeBatchId
    ? outputs.filter((output) => output.item.params?.imageBatchId !== activeBatchId)
    : [];
  const orderedCurrentOutputs = [...currentOutputs].sort((left, right) => (
    Number(left.item.params?.imagePageIndex || left.item.params?.imageBatchIndex || 0)
    - Number(right.item.params?.imagePageIndex || right.item.params?.imageBatchIndex || 0)
  ));
  return (
    <div className={cn("studio-image-results", `is-count-${Math.min(Math.max(pendingCount + outputs.length, 1), 4)}`)}>
      {[...orderedCurrentOutputs, ...historicOutputs].map((output, index) => (
        <article key={output.item.id} className={cn("studio-image-result-card", activeBatchId && output.item.params?.imageBatchId !== activeBatchId && "is-historic")}>
          <div className="studio-image-result-card__media">
            <MediaCard cacheOwnerId={cacheOwnerId} item={output.item} large compact smoothReveal />
            <div className="studio-image-result-card__overlay" aria-label={`图片 ${index + 1} 参数`}>
              <span className="studio-image-result-card__label">{libraryModelName(output.item) || "Image"} · 图片 {Number(output.item.params?.imagePageIndex || index + 1)}</span>
              {imageResultFacts(output.item).map((fact) => <span key={`${output.item.id}-${fact}`}>{fact}</span>)}
              {libraryStatusBadgeLabel(output.item.status) ? <strong>{libraryStatusBadgeLabel(output.item.status)}</strong> : null}
            </div>
            <button type="button" className="studio-icon-button studio-image-result-card__close" aria-label={`关闭图片 ${index + 1}`} onClick={() => onDismiss(output.item.id)}>
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
          <div className="studio-image-result-card__actions">
            <button type="button" className="studio-secondary-button" onClick={() => onRetryItem ? onRetryItem(output.item) : onRetry} disabled={!canRetry || loading}>
              <RefreshCw className="size-4" aria-hidden="true" />
              重做
            </button>
            <button type="button" className="studio-secondary-button" onClick={() => onUpscale(output.item)}>
              <ImageUp className="size-4" aria-hidden="true" />
              高清
            </button>
            <button type="button" className="studio-secondary-button" onClick={() => onCreateVideo(output.item)}>
              <Video className="size-4" aria-hidden="true" />
              做视频
            </button>
            <button type="button" className="studio-secondary-button" onClick={() => onEdit(output.item)}>
              <Wand2 className="size-4" aria-hidden="true" />
              编辑
            </button>
            {output.item.output?.url ? (
              <a className="studio-secondary-button" href={output.item.output.url} download>
                <Download className="size-4" aria-hidden="true" />
                下载
              </a>
            ) : null}
          </div>
        </article>
      ))}
      {Array.from({ length: pendingCount }).map((_, index) => (
        <article key={`pending-${index}`} className="studio-image-result-card studio-image-result-card--pending studio-generation-pending" aria-live="polite">
          <DotRippleLoader fill expanded={pendingCount === 1} />
          <p>{loading ? "图片生成中" : "图片未生成"}</p>
          <small>完成后会自动补到这里。</small>
        </article>
      ))}
    </div>
  );
}

export function VideoPreviewPanel({
  mode,
  output,
  loading,
  canSubmit,
  submitError,
  promptFilled,
  hasProvider,
  hasFiles,
  onSubmit,
  onReloadProviders,
  onUpscale,
}: {
  mode: WorkspaceVideoMode;
  output: OutputState;
  loading: boolean;
  canSubmit: boolean;
  submitError: string;
  submitDiagnostic?: StudioErrorDiagnostic | null;
  promptFilled: boolean;
  hasProvider: boolean;
  hasFiles: boolean;
  onSubmit: () => void;
  onReloadProviders: () => Promise<void>;
  onUpscale: (item: LibraryItem) => void;
}) {
  const canRetry = canSubmit && hasProvider && promptFilled && (mode === "text-to-video" || hasFiles);
  const outputFacts = output ? videoResultFacts(output.item) : [];
  const statusLabel = output?.job?.status || output?.item.status;

  if (loading && !output) {
    return (
      <JobStatusPreview
        title="视频任务提交中"
        detail="任务提交后会自动刷新到这里。"
        facts={[]}
        badge="提交中"
      />
    );
  }

  if (submitError && !output) {
    return (
      <ErrorPreview
        canRetry={canRetry}
        onRetry={onSubmit}
        onReloadProviders={!hasProvider ? onReloadProviders : undefined}
      />
    );
  }
  if (output && statusLabel === "failed") {
    return (
      <ErrorPreview
        canRetry={canRetry}
        onRetry={onSubmit}
        onReloadProviders={!hasProvider ? onReloadProviders : undefined}
      />
    );
  }

  if (output && (statusLabel === "queued" || statusLabel === "generating")) {
    return (
      <JobStatusPreview
        title={statusLabel === "queued" ? "视频任务排队中" : "视频正在生成"}
        detail={statusLabel === "queued" ? "任务已提交到上游，生成完成后会自动刷新到这里。" : "视频生成时间会更久一些，你可以继续切换到图片工具创作。"}
        facts={outputFacts}
        badge={libraryStatusBadgeLabel(output.item.status)}
      />
    );
  }

  if (output) {
    return (
      <PreviewState eyebrow="结果" title="视频结果" badge={libraryStatusBadgeLabel(output.item.status)} role="status" live>
        <ResultReveal className="studio-result-reveal">
          <MediaCard item={output.item} large compact />
          {outputFacts.length ? (
            <div className="studio-result-facts" aria-label="任务参数">
              {outputFacts.map((fact) => <span key={`${output.item.id}-${fact}`}>{fact}</span>)}
            </div>
          ) : null}
          <div className="studio-image-result-card__actions studio-video-result-actions">
            <button type="button" className="studio-secondary-button" onClick={onSubmit} disabled={!canRetry}>
              <RefreshCw className="size-4" aria-hidden="true" />
              重做
            </button>
            <button type="button" className="studio-secondary-button" onClick={() => onUpscale(output.item)}>
              <ImageUp className="size-4" aria-hidden="true" />
              高清
            </button>
            {output.item.output?.url ? (
              <a className="studio-secondary-button" href={output.item.output.url} download>
                <Download className="size-4" aria-hidden="true" />
                下载
              </a>
            ) : null}
          </div>
        </ResultReveal>
      </PreviewState>
    );
  }

  return <ToolTutorial kind="video" paused={false} />;
}

export function OutputPanel({
  tool,
  output,
  libraryCount,
}: {
  tool: BusinessToolId;
  output: OutputState;
  libraryCount: number;
}) {
  const content = previewContent[tool];

  if (!output) {
    return (
      <PreviewState eyebrow="创作预览" title="创作预览" description={content.desc} badge={`${libraryCount} 条作品`}>
        <div className="studio-preview__media is-example">
          <span className="studio-example-badge">示例效果</span>
          <img src={content.image} alt={content.title} />
        </div>
        <div className="studio-steps">
          {content.notes.map((note, index) => (
            <div key={note} className="studio-step">
              <span>{index + 1}</span>
              <p>{note}</p>
            </div>
          ))}
        </div>
      </PreviewState>
    );
  }

  return (
    <PreviewState eyebrow="结果" title="结果" badge={libraryStatusBadgeLabel(output.item.status)}>
      <MediaCard item={output.item} large />
    </PreviewState>
  );
}

function formatElapsedClock(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function animatedTaskProgress(elapsedMs: number, baseRatio = 0, ceiling = 0.94) {
  const safeBase = Math.min(Math.max(baseRatio, 0), ceiling);
  const safeElapsed = Math.max(0, elapsedMs);
  const ramp = 1 - Math.exp(-safeElapsed / 18000);
  return Math.min(ceiling, safeBase + (ceiling - safeBase) * ramp);
}

export function ImageGenerationProgressToast({
  progress,
  tick,
  stacked,
  onClose,
}: {
  progress: ImageGenerationProgressState;
  tick: number;
  stacked?: boolean;
  onClose: (id: string) => void;
}) {
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => new Set());
  const visibleProgress = useMemo(
    () => [...progress]
      .filter((item) => !dismissedIds.has(item.id))
      .sort((a, b) => Number(b.status === "running") - Number(a.status === "running") || b.startedAt - a.startedAt)
      .slice(0, 3),
    [dismissedIds, progress],
  );

  useEffect(() => {
    const terminalIds = progress.filter((item) => item.status !== "running").map((item) => item.id);
    if (!terminalIds.length) return undefined;
    const timer = window.setTimeout(() => terminalIds.forEach(onClose), 3900);
    return () => window.clearTimeout(timer);
  }, [onClose, progress]);

  const baseBottom = stacked ? 122 : 26;

  return visibleProgress.map((item, index) => (
    <ImageGenerationProgressItem
      key={item.id}
      item={item}
      tick={tick}
      bottom={baseBottom + index * 116}
      onClose={(id) => setDismissedIds((current) => new Set(current).add(id))}
    />
  ));
}

function ImageGenerationProgressItem({
  item,
  tick,
  bottom,
  onClose,
}: {
  item: ImageGenerationProgressState[number];
  tick: number;
  bottom: number;
  onClose: (id: string) => void;
}) {
  const [leaving, setLeaving] = useState(false);
  const [smoothedVideoProgress, setSmoothedVideoProgress] = useState(() => (
    Number.isFinite(item.providerProgress)
      ? Math.min(Math.max(Number(item.providerProgress) / 100, 0), 0.98)
      : 0
  ));

  useEffect(() => {
    if (item.status !== "done") return undefined;
    const fadeTimer = window.setTimeout(() => setLeaving(true), 3200);
    return () => window.clearTimeout(fadeTimer);
  }, [item.status]);

  useEffect(() => {
    if (item.scope !== "video" || item.status !== "running") return undefined;
    const providerRatio = Number.isFinite(item.providerProgress)
      ? Math.min(Math.max(Number(item.providerProgress) / 100, 0), 0.98)
      : 0;
    const ceiling = providerRatio >= 0.85 ? 0.98 : 0.84;
    const timer = window.setInterval(() => {
      setSmoothedVideoProgress((current) => Math.min(
        ceiling,
        Math.max(current, providerRatio) + 0.001,
      ));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [item.providerProgress, item.scope, item.status]);

    const total = Math.max(item.total, 1);
    const completed = Math.min(Math.max(item.current, 0), total);
    const activeIndex = item.status === "running" ? Math.min(completed + 1, total) : completed;
    const elapsedMs = (item.completedAt ?? tick) - item.startedAt;
    const isVideo = item.scope === "video";
    const providerProgressRatio = isVideo && Number.isFinite(item.providerProgress)
      ? Math.min(Math.max(Number(item.providerProgress) / 100, 0), 1)
      : null;
    const progressRatio = item.status === "done"
      ? 1
      : item.status === "failed"
        ? Math.min(Math.max(completed / total, 0), 1)
        : isVideo && providerProgressRatio !== null
          ? smoothedVideoProgress
          : animatedTaskProgress(elapsedMs, completed / total, 0.94);
    const progressPercent = Math.round(progressRatio * 100);
    const title = item.status === "done"
      ? isVideo ? "视频生成完成" : "生成已完成"
      : item.status === "failed"
        ? "生成失败"
        : isVideo ? "视频生成中" : "图片生成中";
    const statusText = item.status === "running"
      ? isVideo ? "视频任务进行中" : `第 ${activeIndex} / ${total} 张`
      : item.status === "done"
        ? isVideo ? "视频已完成" : `已完成 ${total} 张`
        : isVideo ? "视频生成失败" : `已完成 ${completed} / ${total} 张`;

    return (
      <div
        className={cn("image-generation-progress", `is-${item.status}`, leaving && "is-leaving")}
        role="status"
        aria-live="polite"
        onClick={item.status === "running" ? undefined : () => onClose(item.id)}
        style={{ bottom: `${bottom}px` }}
      >
        <span className="image-generation-progress__icon" aria-hidden="true">
          {item.status === "done" ? <Check className="size-4" /> : null}
          {item.status === "failed" ? <AlertTriangle className="size-4" /> : null}
          {item.status === "running" ? <Loader2 className="size-4" /> : null}
        </span>
        <span className="image-generation-progress__body">
          <span className="image-generation-progress__head">
            <strong>{title}</strong>
            <button type="button" aria-label="关闭生成进度" onClick={(event) => {
              event.stopPropagation();
              onClose(item.id);
            }}>
              <X className="size-3.5" aria-hidden="true" />
            </button>
          </span>
          <small>{item.message || statusText}</small>
          <span className="image-generation-progress__meta">
            <span>{statusText}</span>
            <span>进度 {progressPercent}% · 用时 {formatElapsedClock(elapsedMs)}</span>
          </span>
          <span className="image-generation-progress__track" aria-hidden="true">
            <span style={{ width: `${progressRatio * 100}%` }} />
          </span>
        </span>
      </div>
    );
}

export function Toast({ message, tone = "error", onClose }: { message: string; tone?: "error" | "success"; onClose: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onClose, 4500);
    return () => window.clearTimeout(timer);
  }, [onClose]);

  return (
    <div className={cn("studio-toast", tone === "success" && "is-success")} role="status" aria-live="polite">
      <span className="studio-toast__icon" aria-hidden="true">
        {tone === "success" ? <Check className="size-4" /> : <AlertTriangle className="size-4" />}
      </span>
      <span className="studio-toast__body">
        <strong>{message}</strong>
      </span>
    </div>
  );
}

const previewContent: Record<
  BusinessToolId,
  { title: string; desc: string; image: string; notes: string[] }
> = {
  image: {
    title: "AI 图像生成器",
    desc: "输入提示词并选择模型，生成结果会在这里显示。",
    image: "/images/reference/hero-cover.png",
    notes: ["填写提示词", "选择参考图或比例", "结果会保存在作品库"],
  },
  video: {
    title: "AI 视频生成器",
    desc: "输入视频描述，生成任务完成后会在这里显示。",
    image: "/images/reference/sample-1.png",
    notes: ["填写视频描述", "选择比例和时长", "轮询任务后展示结果"],
  },
  "image-upscale": {
    title: "图片高清",
    desc: "上传图像后选择倍数，结果会在这里显示。",
    image: "/images/reference/sample-2.png",
    notes: ["上传图像", "选择 1K / 2K / 4K", "处理后进入作品库"],
  },
  "video-upscale": {
    title: "视频高清",
    desc: "上传视频后选择倍数，结果会在这里播放。",
    image: "/images/reference/sample-3.png",
    notes: ["上传视频", "选择 1K / 2K / 4K", "处理后刷新作品库"],
  },
  library: {
    title: "作品库",
    desc: "历史结果、下载和删除逻辑保持不变。",
    image: "/images/reference/hero-cover.png",
    notes: ["查看历史", "下载结果", "删除不需要的作品"],
  },
};
