"use client";

import { Trash2 } from "lucide-react";
import { createContext, useContext } from "react";
import {
  BaseEdge,
  EdgeToolbar,
  getSmoothStepPath,
  getStraightPath,
  type ConnectionLineComponentProps,
  type Edge,
  type EdgeProps,
} from "@xyflow/react";

export type CanvasEdgeData = Record<string, unknown> & {
  routing: "smoothstep" | "straight";
  label: string;
};

export type CanvasFlowEdge = Edge<CanvasEdgeData, "canvas-edge">;

export const CanvasEdgeActionsContext = createContext<{ removeEdge: (id: string) => void } | null>(null);

export function CanvasEdge(props: EdgeProps<CanvasFlowEdge>) {
  const actions = useContext(CanvasEdgeActionsContext);
  const [path, labelX, labelY] = props.data?.routing === "straight"
    ? getStraightPath(props)
    : getSmoothStepPath(props);

  return (
    <>
      <BaseEdge id={props.id} path={path} markerEnd={props.markerEnd} style={props.style} interactionWidth={24} />
      <EdgeToolbar edgeId={props.id} x={labelX} y={labelY} isVisible className="canvas-edge-toolbar">
        <span>{props.data?.label || "输入"}</span>
        {props.selected ? (
          <button type="button" onClick={() => actions?.removeEdge(props.id)} title="删除连线" aria-label="删除连线"><Trash2 /></button>
        ) : null}
      </EdgeToolbar>
    </>
  );
}

export function CanvasConnectionLine({ fromX, fromY, toX, toY, connectionStatus }: ConnectionLineComponentProps) {
  const stroke = connectionStatus === "invalid" ? "#fb7185" : connectionStatus === "valid" ? "var(--primary)" : "#a1a1aa";
  const path = "M" + fromX + "," + fromY + " C" + (fromX + 80) + "," + fromY + " " + (toX - 80) + "," + toY + " " + toX + "," + toY;
  return (
    <>
      <path className="canvas-connection-line" d={path} fill="none" stroke={stroke} strokeWidth={2} />
      <circle cx={toX} cy={toY} r={4} fill={stroke} />
    </>
  );
}
