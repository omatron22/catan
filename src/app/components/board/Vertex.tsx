"use client";

import type { Building } from "@/shared/types/game";
import type { VertexKey } from "@/shared/types/coordinates";
import type { BuildingStyle } from "@/shared/types/config";
import { vertexToPixel } from "@/shared/utils/hexMath";
import { PLAYER_COLOR_HEX } from "@/shared/constants";
import { STYLE_DEFS } from "@/shared/buildingStyles";

interface Props {
  vertexKey: VertexKey;
  building: Building | null;
  size: number;
  onClick?: () => void;
  highlighted?: boolean;
  playerColors?: Record<number, string>;
  buildingStyles?: Record<number, BuildingStyle>;
}

const PLAYER_COLORS_ORDERED = ["red", "blue", "white", "orange", "green", "purple", "pink", "teal", "yellow", "brown"] as const;

export default function Vertex({
  vertexKey: vk,
  building,
  size,
  onClick,
  highlighted,
  playerColors,
  buildingStyles,
}: Props) {
  const pos = vertexToPixel(vk, size);
  const r = size * 0.15;

  if (!building && !highlighted) return null;

  if (!building && highlighted) {
    return (
      <g className="cursor-pointer" onClick={onClick}>
        {/* Invisible larger hit target */}
        <circle
          cx={pos.x}
          cy={pos.y}
          r={r * 2.5}
          fill="transparent"
        />
        {/* Visible highlight */}
        <circle
          cx={pos.x}
          cy={pos.y}
          r={r * 1.2}
          fill="rgba(255,255,255,0.4)"
          stroke="#000"
          strokeWidth={2}
          strokeDasharray="3 3"
          className="animate-pulse"
        />
      </g>
    );
  }

  const color = building
    ? (playerColors?.[building.playerIndex] ?? PLAYER_COLOR_HEX[PLAYER_COLORS_ORDERED[building.playerIndex]] ?? "#fff")
    : "#fff";

  if (building) {
    const style = buildingStyles?.[building.playerIndex] ?? "classic";
    const def = STYLE_DEFS[style];
    const path = def[building.type](pos, r);

    return (
      <path
        d={path}
        fill={color}
        stroke="#000"
        strokeWidth={2}
        onClick={onClick}
        className={onClick ? "cursor-pointer" : ""}
      />
    );
  }

  return null;
}
