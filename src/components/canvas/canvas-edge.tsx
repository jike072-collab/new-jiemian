"use client";

import {
  BaseEdge,
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
  type ConnectionLineComponentProps,
  type Edge,
  type EdgeProps,
} from "@xyflow/react";

export type CanvasEdgeData = Record<string, unknown> & {
  routing: "bezier" | "smoothstep" | "straight";
  active?: boolean;
};

export type CanvasFlowEdge = Edge<CanvasEdgeData, "canvas-edge">;

export function CanvasEdge(props: EdgeProps<CanvasFlowEdge>) {
  const routing = props.data?.routing || "bezier";
  const [path] = routing === "straight"
    ? getStraightPath(props)
    : routing === "smoothstep"
      ? getSmoothStepPath(props)
      : getBezierPath({ ...props, curvature: 0.5 });

  const active = props.selected || props.data?.active;
  const style = active
    ? { ...props.style, opacity: 1, stroke: "var(--canvas-active-stroke)", filter: "drop-shadow(0 0 5px color-mix(in srgb, var(--canvas-active-stroke) 35%, transparent))", transition: "opacity 140ms ease, stroke 140ms ease" }
    : { ...props.style, opacity: 0.38, transition: "opacity 140ms ease, stroke 140ms ease" };
  return <BaseEdge id={props.id} path={path} markerEnd={props.markerEnd} style={style} interactionWidth={24} />;
}

function CanvasConnectionLine({ fromX, fromY, fromPosition, toX, toY, toPosition, connectionStatus, routing }: ConnectionLineComponentProps & { routing: CanvasEdgeData["routing"] }) {
  const stroke = connectionStatus === "invalid" ? "#fb7185" : connectionStatus === "valid" ? "var(--primary)" : "#a1a1aa";
  const pathOptions = {
    sourceX: fromX,
    sourceY: fromY,
    sourcePosition: fromPosition,
    targetX: toX,
    targetY: toY,
    targetPosition: toPosition,
  };
  const [path] = routing === "straight"
    ? getStraightPath(pathOptions)
    : routing === "smoothstep"
      ? getSmoothStepPath(pathOptions)
      : getBezierPath({ ...pathOptions, curvature: 0.5 });
  return (
    <>
      <path className="canvas-connection-line" d={path} fill="none" stroke={stroke} strokeWidth={2} />
      <circle cx={toX} cy={toY} r={4} fill={stroke} />
    </>
  );
}

export function CanvasBezierConnectionLine(props: ConnectionLineComponentProps) {
  return <CanvasConnectionLine {...props} routing="bezier" />;
}

export function CanvasSmoothStepConnectionLine(props: ConnectionLineComponentProps) {
  return <CanvasConnectionLine {...props} routing="smoothstep" />;
}

export function CanvasStraightConnectionLine(props: ConnectionLineComponentProps) {
  return <CanvasConnectionLine {...props} routing="straight" />;
}
