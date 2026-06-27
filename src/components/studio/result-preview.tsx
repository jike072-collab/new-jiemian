"use client";

/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Loader2, UploadCloud, X } from "lucide-react";

import { BeforeAfterImageCompare } from "@/components/before-after-image-compare";
import { ResultReveal } from "@/components/motion";
import { upscaleTargetLabel, videoUpscaleScaleLabel } from "@/components/studio/constants";
import { MediaCard, libraryStatusBadgeLabel } from "@/components/studio/media-card";
import { PreviewState, StudioErrorAlert } from "@/components/studio/shared";
import type { BusinessToolId, ImageGenerationProgressState, ImageUpscaleWorkspaceState, OutputState, StudioErrorDiagnostic, VideoUpscaleWorkspaceState } from "@/components/studio/types";
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

function ImageGenerationTutorial() {
  return (
    <PreviewState eyebrow="快速教程" title="快速教程" description="输入描述，选择比例，即可生成图片。">
      <div className="image-tutorial-simple">
        <div className="image-tutorial-simple__stage">
          <div className="image-tutorial-simple__image-shell">
            <img
              className="image-tutorial-simple__image"
              src="/tutorials/image-generator/perfume-result.png"
              alt="新中式香水产品图，粉色牡丹花、香水瓶、大理石台面和中式窗棂背景"
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
  );
}

function ImageEditorTutorial() {
  return (
    <PreviewState eyebrow="图片编辑示例" title="图片编辑示例" description="上传图片并描述修改要求，快速完成内容编辑与素材融合。">
      <div className="image-editor-tutorial">
        <div className="image-editor-tutorial__canvas" aria-label="图片编辑器示例图片">
          <svg className="image-editor-tutorial__path" viewBox="0 0 980 520" aria-hidden="true">
            <path className="image-editor-tutorial__dash" d="M18 425C98 190 238 330 365 265C487 202 575 262 690 170C750 122 810 82 862 52" />
            <g className="image-editor-plane-mark">
              <path d="M9 30 56 9 42 56 32 39 9 48 25 33 9 30Z" fill="none" stroke="currentColor" strokeWidth="4.6" strokeLinecap="round" strokeLinejoin="round" />
            </g>
          </svg>

          <figure className="image-editor-photo image-editor-photo--input image-editor-photo--single-source">
            <img src="/tutorials/image-editor/single-source.png" alt="方形粉色香水瓶白底素材" />
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
            <img src="/tutorials/image-editor/single-result.png" alt="女性手持同款香水瓶的编辑结果" />
          </figure>

          <figure className="image-editor-photo image-editor-photo--input image-editor-photo--merge-product">
            <img src="/tutorials/image-editor/merge-product.png" alt="椭圆形粉色香水瓶白底素材" />
          </figure>
          <figure className="image-editor-photo image-editor-photo--input image-editor-photo--merge-scene">
            <img src="/tutorials/image-editor/merge-scene.png" alt="新中式牡丹场景素材" />
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
            <img src="/tutorials/image-editor/merge-result.png" alt="香水瓶放入新中式牡丹场景后的融合结果" />
          </figure>
        </div>
      </div>
    </PreviewState>
  );
}

const videoTutorialPromptText = "雨天城市街头，女生撑透明雨伞缓慢向前行走，并自然回头看向镜头。";
const videoTutorialResultVideoSrc = "/tutorials/video-generator/demo-result.mp4";

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
  const targetState = playbackState === "image-touching" ? "touching" : imagePhase === "landed" ? "covered" : "idle";
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
          targetState === "touching" && "is-touching",
          targetState === "covered" && "is-covered",
        )}
        aria-hidden="true"
      />

      <img
        src="/tutorials/video-generator/input-person.png"
        alt=""
        className={cn(
          "tutorial-source-image",
          imagePhase === "dragging" && "is-dragging",
          imagePhase === "landed" && "is-visible",
        )}
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
  onPlaybackEnd,
}: {
  playbackState: VideoTutorialPlaybackState;
  paused: boolean;
  onPlaybackEnd: () => void;
}) {
  const mediaRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const wasPlayingRef = useRef(false);
  const [isInView, setIsInView] = useState(typeof IntersectionObserver === "undefined");
  const shouldPlay = Boolean(videoTutorialResultVideoSrc && !paused && isVideoTutorialResultPlayingState(playbackState) && isInView);

  useEffect(() => {
    const node = mediaRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return undefined;

    const observer = new IntersectionObserver(([entry]) => {
      setIsInView(entry.isIntersecting);
    }, { threshold: 0.36 });

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (shouldPlay) {
      if (!wasPlayingRef.current) {
        try {
          video.currentTime = Math.min(0.1, Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0.1);
        } catch {
          // Metadata may still be settling on first load; playback can still begin muted.
        }
        wasPlayingRef.current = true;
      }
      void video.play().catch(() => undefined);
      return;
    }

    wasPlayingRef.current = false;
    video.pause();
  }, [shouldPlay]);

  return (
    <div className="video-tutorial-result-slot">
      <div className="video-tutorial-result-slot__backdrop" aria-hidden="true">
        <img src="/tutorials/video-generator/input-person.png" alt="" />
      </div>
      <div
        ref={mediaRef}
        className={cn(
          "video-tutorial-result-slot__media",
          isVideoTutorialResultVisibleState(playbackState) && "is-visible",
          isVideoTutorialResultPlayingState(playbackState) && "is-playing",
          playbackState === "complete" && "is-complete",
          playbackState === "resetting" && "is-resetting",
        )}
      >
        {videoTutorialResultVideoSrc ? (
          <video
            ref={videoRef}
            src={videoTutorialResultVideoSrc}
            poster="/tutorials/video-generator/rain-umbrella.png"
            muted
            playsInline
            preload="auto"
            onEnded={onPlaybackEnd}
            onError={onPlaybackEnd}
          />
        ) : (
          <video poster="/tutorials/video-generator/input-person.png" muted playsInline preload="metadata" aria-label="视频结果预留位" />
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
        <img src="/tutorials/video-generator/rain-umbrella.png" alt="" />
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
  const [playbackStateState, setPlaybackState] = useState<VideoTutorialPlaybackState>("idle");
  const [typedTextState, setTypedText] = useState("");
  const [isInView, setIsInView] = useState(true);
  const [pageVisible, setPageVisible] = useState(true);
  const [cycle, setCycle] = useState(0);
  const shouldPause = paused || reducedMotion || !isInView || !pageVisible;
  const playbackState = reducedMotion ? "final" : playbackStateState;
  const typedText = reducedMotion ? videoTutorialPromptText : typedTextState;
  const promptText = reducedMotion ? videoTutorialPromptText : typedText;

  const clearReplayTimer = useCallback(() => {
    if (replayTimerRef.current) {
      window.clearTimeout(replayTimerRef.current);
      replayTimerRef.current = undefined;
    }
  }, []);

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
    if (playbackStateState !== "resetting") return undefined;

    const timer = window.setTimeout(() => {
      const video = guideRef.current?.querySelector<HTMLVideoElement>(".video-tutorial-result-slot__media video");
      if (!video) return;
      try {
        video.pause();
        video.currentTime = 0.1;
      } catch {
        // The video may already be unloading between tutorial loops.
      }
    }, 260);

    return () => window.clearTimeout(timer);
  }, [playbackStateState]);

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

  const steps = [
    {
      id: "upload",
      title: "输入内容并确认视频场景",
      description: "上传参考图后输入提示词，让视频围绕起始画面和动作描述生成。",
      visual: <VideoTutorialInputDemo key={`input-${cycle}`} playbackState={playbackState} promptText={promptText} />,
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
      visual: <VideoTutorialResultSlot playbackState={playbackState} paused={shouldPause} onPlaybackEnd={finishTutorialCycle} />,
      visualSide: "left",
    },
  ];
  const firstArrowDrawing = playbackState === "arrow-to-parameters";
  const firstArrowDrawn = ["parameters", "arrow-to-result", "result-preparing", "result-entering", "result-playing", "complete", "resetting", "fading-out", "final"].includes(playbackState);
  const secondArrowDrawing = playbackState === "arrow-to-result";
  const secondArrowDrawn = ["result-preparing", "result-entering", "result-playing", "complete", "resetting", "fading-out", "final"].includes(playbackState);

  return (
    <PreviewState eyebrow="快速教程" title="视频生成快速教程" description="上传参考图，输入提示词，确认比例后生成视频。">
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
  );
}

function ToolTutorial({ kind, paused = false }: { kind: ToolTutorialKind; paused?: boolean }) {
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

function ProcessingPreview({ label }: { label: string }) {
  return (
    <PreviewState eyebrow="处理中" title={label} role="status" live>
      <div className="studio-processing-state">
        <div className="studio-processing-orbit" aria-hidden="true">
          <span />
          <span />
          <Loader2 className="size-6" />
        </div>
        <p>{label}</p>
      </div>
    </PreviewState>
  );
}

function ErrorPreview({
  canRetry,
  onRetry,
  onReloadProviders,
  message,
  diagnostic,
}: {
  canRetry: boolean;
  onRetry: () => void;
  onReloadProviders?: () => Promise<void>;
  message?: string;
  diagnostic?: StudioErrorDiagnostic | null;
}) {
  return (
    <PreviewState eyebrow="失败" title="生成失败" description="生成失败，请检查设置后重试" role="alert">
      <div className="studio-preview__empty">
        <StudioErrorAlert message={message} diagnostic={diagnostic} />
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

function UpscaleUnavailablePreview() {
  return (
    <PreviewState eyebrow="暂不可用" title="高清处理暂时不可用" description="高清处理暂时不可用，请稍后重试" role="alert">
      <div className="studio-preview__empty">
        <p>请稍后重试。</p>
      </div>
    </PreviewState>
  );
}

function ImageUpscaleCompareTutorial() {
  return (
    <PreviewState eyebrow="图片细节对比" title="图片细节对比" description="拖动分割线，查看高清前后的清晰度和细节变化。">
      <BeforeAfterImageCompare
        beforeSrc="/tutorial/image-upscaler/image-before.jpg"
        afterSrc="/tutorial/image-upscaler/image-after.png"
        beforeLabel="高清前"
        afterLabel="高清后"
        beforeAlt="高清前示例图"
        afterAlt="高清后示例图"
      />
    </PreviewState>
  );
}

function VideoUpscaleCompareTutorial() {
  return (
    <PreviewState eyebrow="视频细节对比" title="视频细节对比" description="拖动分割线，查看高清前后的视频清晰度和细节变化。">
      <BeforeAfterImageCompare
        beforeSrc="/tutorial/video-upscaler/video-after.mp4"
        afterSrc="/tutorial/video-upscaler/video-after.mp4"
        beforeLabel="高清前"
        afterLabel="高清后"
        beforeAlt="高清前示例视频"
        afterAlt="高清后示例视频"
        mediaType="video"
        beforeEffect="blur"
      />
    </PreviewState>
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
    return <ProcessingPreview label="正在处理" />;
  }

  if (state.submitError) {
    return <ErrorPreview canRetry={canSubmit} onRetry={onSubmit} message={state.submitError} diagnostic={state.submitDiagnostic} />;
  }

  if (!state.checked || state.statusLoading || (!state.availability?.ready && !state.statusError)) {
    return state.statusLoading ? <ProcessingPreview label="正在处理" /> : <ImageUpscaleCompareTutorial />;
  }

  if (!state.availability?.ready) {
    return <UpscaleUnavailablePreview />;
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
    return <ProcessingPreview label="正在处理" />;
  }

  if (state.submitError) {
    return <ErrorPreview canRetry={canSubmit} onRetry={onSubmit} message={state.submitError} diagnostic={state.submitDiagnostic} />;
  }

  if (!state.checked || state.statusLoading || (!state.availability?.ready && !state.statusError)) {
    return state.statusLoading ? <ProcessingPreview label="正在处理" /> : <VideoUpscaleCompareTutorial />;
  }

  if (!state.availability?.ready) {
    return <UpscaleUnavailablePreview />;
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
        {source ? (
          <BeforeAfterImageCompare
            beforeSrc={source.previewUrl}
            afterSrc={output.item.output.url}
            beforeLabel="高清前"
            afterLabel="高清后"
            beforeAlt={source.file.name}
            afterAlt={output.item.title}
            mediaType="video"
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
      </PreviewState>
    );
  }

  return <VideoUpscaleCompareTutorial />;
}

export function ImagePreviewPanel({
  mode,
  output,
  loading,
  submitError,
  submitDiagnostic,
  isEditor,
  promptFilled,
  hasProvider,
  hasFiles,
  onSubmit,
  onReloadProviders,
  onUpscale,
}: {
  mode: WorkspaceImageMode;
  output: OutputState;
  loading: boolean;
  submitError: string;
  submitDiagnostic?: StudioErrorDiagnostic | null;
  isEditor: boolean;
  promptFilled: boolean;
  hasProvider: boolean;
  hasFiles: boolean;
  onSubmit: () => void;
  onReloadProviders: () => Promise<void>;
  onUpscale: (item: LibraryItem) => void;
}) {
  const canRetry = hasProvider && promptFilled && (mode === "text-to-image" || hasFiles) && !loading;

  if (loading) {
    return <ProcessingPreview label="正在生成图片" />;
  }

  if (submitError) {
    return (
      <ErrorPreview
        canRetry={canRetry}
        onRetry={onSubmit}
        onReloadProviders={!hasProvider ? onReloadProviders : undefined}
        message={submitError}
        diagnostic={submitDiagnostic}
      />
    );
  }

  if (output) {
    const resultContent = (
      <>
        <MediaCard item={output.item} large compact />
        <div className="studio-actions studio-actions--result">
          {output.item.output?.url ? (
            <a className="studio-secondary-button" href={output.item.output.url} download>
              下载图片
            </a>
          ) : null}
          <button
            type="button"
            className="studio-secondary-button"
            onClick={onSubmit}
            disabled={!canRetry}
          >
            再次生成
          </button>
          <button type="button" className="studio-secondary-button studio-secondary-button--accent" onClick={() => onUpscale(output.item)}>
            放大
          </button>
        </div>
      </>
    );

    return (
      <PreviewState eyebrow="结果" title="结果" badge={libraryStatusBadgeLabel(output.item.status)} role="status" live>
        {isEditor ? resultContent : <ResultReveal className="studio-result-reveal">{resultContent}</ResultReveal>}
      </PreviewState>
    );
  }

  return <ToolTutorial kind={isEditor ? "image-editor" : "image"} />;
}

export function VideoPreviewPanel({
  mode,
  output,
  loading,
  submitError,
  submitDiagnostic,
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
  submitError: string;
  submitDiagnostic?: StudioErrorDiagnostic | null;
  promptFilled: boolean;
  hasProvider: boolean;
  hasFiles: boolean;
  onSubmit: () => void;
  onReloadProviders: () => Promise<void>;
  onUpscale: (item: LibraryItem) => void;
}) {
  const canRetry = hasProvider && promptFilled && (mode === "text-to-video" || hasFiles) && !loading;

  if (loading) {
    return <ProcessingPreview label="正在生成视频" />;
  }

  if (submitError) {
    return (
      <ErrorPreview
        canRetry={canRetry}
        onRetry={onSubmit}
        onReloadProviders={!hasProvider ? onReloadProviders : undefined}
        message={submitError}
        diagnostic={submitDiagnostic}
      />
    );
  }

  if (output) {
    return (
      <PreviewState eyebrow="结果" title="结果" badge={libraryStatusBadgeLabel(output.item.status)} role="status" live>
        <MediaCard item={output.item} large compact />
        <div className="studio-actions studio-actions--result">
          {output.item.output?.url ? (
            <a className="studio-secondary-button" href={output.item.output.url} download>
              下载视频
            </a>
          ) : null}
          <button type="button" className="studio-secondary-button" onClick={onSubmit} disabled={!canRetry}>
            再次生成
          </button>
          <button type="button" className="studio-secondary-button studio-secondary-button--accent" onClick={() => onUpscale(output.item)}>
            放大
          </button>
        </div>
      </PreviewState>
    );
  }

  return <ToolTutorial kind="video" paused={loading} />;
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

export function ImageGenerationProgressToast({
  progress,
  tick,
  stacked,
  onClose,
}: {
  progress: NonNullable<ImageGenerationProgressState>;
  tick: number;
  stacked?: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    if (progress.status === "running") return undefined;
    const timer = window.setTimeout(onClose, 5200);
    return () => window.clearTimeout(timer);
  }, [onClose, progress.status]);

  const total = Math.max(progress.total, 1);
  const completed = Math.min(Math.max(progress.current, 0), total);
  const activeIndex = progress.status === "running" ? Math.min(completed + 1, total) : completed;
  const elapsedMs = (progress.completedAt ?? tick) - progress.startedAt;
  const progressRatio = progress.status === "done"
    ? 1
    : Math.min(Math.max(completed / total, 0), 1);
  const title = progress.status === "done"
    ? "生成已完成"
    : progress.status === "failed"
      ? "生成失败"
      : "图片生成中";
  const statusText = progress.status === "running"
    ? `第 ${activeIndex} / ${total} 张`
    : progress.status === "done"
      ? `已完成 ${total} 张`
      : `已完成 ${completed} / ${total} 张`;

  return (
    <div
      className={cn(
        "image-generation-progress",
        `is-${progress.status}`,
        stacked && "is-stacked",
      )}
      role="status"
      aria-live="polite"
    >
      <span className="image-generation-progress__icon" aria-hidden="true">
        {progress.status === "done" ? <Check className="size-4" /> : null}
        {progress.status === "failed" ? <AlertTriangle className="size-4" /> : null}
        {progress.status === "running" ? <Loader2 className="size-4" /> : null}
      </span>
      <span className="image-generation-progress__body">
        <span className="image-generation-progress__head">
          <strong>{title}</strong>
          <button type="button" aria-label="关闭生成进度" onClick={onClose}>
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </span>
        <small>{progress.message || statusText}</small>
        <span className="image-generation-progress__meta">
          <span>{statusText}</span>
          <span>用时 {formatElapsedClock(elapsedMs)}</span>
        </span>
        <span className="image-generation-progress__track" aria-hidden="true">
          <span style={{ width: `${Math.round(progressRatio * 100)}%` }} />
        </span>
      </span>
    </div>
  );
}

export function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onClose, 4500);
    return () => window.clearTimeout(timer);
  }, [onClose]);

  return (
    <div className="studio-toast" role="status" aria-live="polite">
      <span className="studio-toast__icon" aria-hidden="true">
        <AlertTriangle className="size-4" />
      </span>
      <span className="studio-toast__body">
        <strong>{message}</strong>
        <small>请根据提示处理当前操作，必要时稍后再试。</small>
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
