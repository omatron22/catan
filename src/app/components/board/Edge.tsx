"use client";

import type { Road } from "@/shared/types/game";
import type { EdgeKey } from "@/shared/types/coordinates";
import { edgeEndpoints, vertexToPixel } from "@/shared/utils/hexMath";
import { PLAYER_COLOR_HEX } from "@/shared/constants";

interface Props {
  edgeKey: EdgeKey;
  road: Road | null;
  size: number;
  onClick?: () => void;
  highlighted?: boolean;
  layer?: "outline" | "fill";
  playerColors?: Record<number, string>;
}

const PLAYER_COLORS_ORDERED = ["red", "blue", "white", "orange", "green", "purple", "pink", "teal", "yellow", "brown", "navy", "lime", "coral", "crimson", "sky", "lavender", "maroon", "gold", "cyan", "charcoal"] as const;

export default function Edge({ edgeKey: ek, road, size, onClick, highlighted, layer, playerColors }: Props) {
  const [v1, v2] = edgeEndpoints(ek);
  const p1 = vertexToPixel(v1, size);
  const p2 = vertexToPixel(v2, size);

  if (!road && !highlighted) return null;

  if (!road && highlighted) {
    // Only render highlights in fill pass (or when no layer specified)
    if (layer === "outline") return null;
    return (
      <g className="cursor-pointer" onClick={onClick}>
        {/* Invisible wide hit target */}
        <line
          x1={p1.x}
          y1={p1.y}
          x2={p2.x}
          y2={p2.y}
          stroke="transparent"
          strokeWidth={size * 0.35}
          strokeLinecap="round"
        />
        {/* Visible dashed line */}
        <line
          x1={p1.x}
          y1={p1.y}
          x2={p2.x}
          y2={p2.y}
          stroke="rgba(255,255,255,0.5)"
          strokeWidth={size * 0.1}
          strokeDasharray="5 5"
          strokeLinecap="round"
        />
      </g>
    );
  }

  const color = road
    ? (playerColors?.[road.playerIndex] ?? PLAYER_COLOR_HEX[PLAYER_COLORS_ORDERED[road.playerIndex]] ?? "#fff")
    : "#fff";

  // Outline pass — dark border only
  if (layer === "outline") {
    return (
      <line
        x1={p1.x}
        y1={p1.y}
        x2={p2.x}
        y2={p2.y}
        stroke="#2c1810"
        strokeWidth={size * 0.14}
        strokeLinecap="square"
      />
    );
  }

  // Fill pass — player color only
  if (layer === "fill") {
    return (
      <g onClick={onClick} className={onClick ? "cursor-pointer" : ""}>
        <line
          x1={p1.x}
          y1={p1.y}
          x2={p2.x}
          y2={p2.y}
          stroke={color}
          strokeWidth={size * 0.1}
          strokeLinecap="square"
        />
      </g>
    );
  }

  // No layer specified — render both (backwards compat)
  return (
    <g onClick={onClick} className={onClick ? "cursor-pointer" : ""}>
      <line
        x1={p1.x}
        y1={p1.y}
        x2={p2.x}
        y2={p2.y}
        stroke="#2c1810"
        strokeWidth={size * 0.14}
        strokeLinecap="square"
      />
      <line
        x1={p1.x}
        y1={p1.y}
        x2={p2.x}
        y2={p2.y}
        stroke={color}
        strokeWidth={size * 0.1}
        strokeLinecap="square"
      />
    </g>
  );
}
