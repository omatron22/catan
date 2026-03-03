import type { Terrain } from "@/shared/types/game";
import {
  BrickPixel,
  LumberPixel,
  OrePixel,
  GrainPixel,
  WoolPixel,
} from "@/app/components/icons/PixelIcons";

interface Props {
  terrain: Terrain;
  cx: number;
  cy: number;
  size: number;
  clipId: string;
}

/** Embeds a pixel icon inside SVG via foreignObject */
function IconInSvg({
  cx,
  cy,
  size,
  icon: Icon,
  color,
}: {
  cx: number;
  cy: number;
  size: number;
  icon: React.FC<{ size?: number; color?: string }>;
  color: string;
}) {
  const iconSize = size * 0.38;
  const y = cy - size * 0.52;
  return (
    <foreignObject
      x={cx - iconSize / 2}
      y={y - iconSize / 2}
      width={iconSize}
      height={iconSize}
    >
      <div
        className="pixel-icon"
        style={{
          width: iconSize,
          height: iconSize,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon size={iconSize * 0.85} color={color} />
      </div>
    </foreignObject>
  );
}

const TERRAIN_ICONS: Record<
  Terrain,
  { icon: React.FC<{ size?: number; color?: string }>; color: string } | null
> = {
  pasture: { icon: WoolPixel, color: "#2d5a1e" },
  fields: { icon: GrainPixel, color: "#7a6318" },
  forest: { icon: LumberPixel, color: "#1B5E20" },
  mountains: { icon: OrePixel, color: "#556070" },
  hills: { icon: BrickPixel, color: "#7a2e14" },
  desert: null,
};

export default function TerrainIllustration({ terrain, cx, cy, size, clipId }: Props) {
  const config = TERRAIN_ICONS[terrain];
  if (!config) return null;

  return (
    <g clipPath={`url(#${clipId})`}>
      <IconInSvg cx={cx} cy={cy} size={size} icon={config.icon} color={config.color} />
    </g>
  );
}
