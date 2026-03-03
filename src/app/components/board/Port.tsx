import type { Port as PortType } from "@/shared/types/game";
import type { Resource } from "@/shared/types/game";
import { vertexToPixel } from "@/shared/utils/hexMath";
import {
  BrickPixel,
  LumberPixel,
  OrePixel,
  GrainPixel,
  WoolPixel,
} from "@/app/components/icons/PixelIcons";

interface Props {
  port: PortType;
  size: number;
}

const PORT_COLORS: Record<Resource, string> = {
  brick: "#C4522A",
  lumber: "#2E7D32",
  ore: "#607d8b",
  grain: "#EAB308",
  wool: "#8BC34A",
};

const PORT_ICONS: Record<Resource, React.FC<{ size?: number; color?: string }>> = {
  brick: BrickPixel,
  lumber: LumberPixel,
  ore: OrePixel,
  grain: GrainPixel,
  wool: WoolPixel,
};

export default function Port({ port, size }: Props) {
  const p1 = vertexToPixel(port.edgeVertices[0], size);
  const p2 = vertexToPixel(port.edgeVertices[1], size);

  // Midpoint of the two vertices
  const midX = (p1.x + p2.x) / 2;
  const midY = (p1.y + p2.y) / 2;

  // Push outward from origin
  const dist = Math.sqrt(midX * midX + midY * midY);
  const dirX = midX / dist;
  const dirY = midY / dist;
  const pushDist = size * 0.85;
  const portX = midX + dirX * pushDist;
  const portY = midY + dirY * pushDist;

  const isSpecific = port.type !== "any";
  const bgColor = isSpecific ? PORT_COLORS[port.type as Resource] : "#8b7355";

  const r = size * 0.28;
  const iconSize = r * 1.4;

  return (
    <g>
      {/* Lines to the two port vertices */}
      <line
        x1={portX} y1={portY}
        x2={p1.x} y2={p1.y}
        stroke={bgColor}
        strokeWidth={2}
        strokeLinecap="round"
        opacity={0.7}
      />
      <line
        x1={portX} y1={portY}
        x2={p2.x} y2={p2.y}
        stroke={bgColor}
        strokeWidth={2}
        strokeLinecap="round"
        opacity={0.7}
      />
      {/* Small circles at vertex ends */}
      <circle cx={p1.x} cy={p1.y} r={2.5} fill={bgColor} stroke="#000" strokeWidth={1} />
      <circle cx={p2.x} cy={p2.y} r={2.5} fill={bgColor} stroke="#000" strokeWidth={1} />

      {/* Port square shadow */}
      <rect
        x={portX - r + 1.5}
        y={portY - r + 1.5}
        width={r * 2}
        height={r * 2}
        fill="#000"
      />

      {/* Port square */}
      <rect
        x={portX - r}
        y={portY - r}
        width={r * 2}
        height={r * 2}
        fill={bgColor}
        stroke="#000"
        strokeWidth={2}
      />

      {isSpecific ? (
        /* Resource icon centered */
        <foreignObject
          x={portX - iconSize / 2}
          y={portY - iconSize / 2}
          width={iconSize}
          height={iconSize}
        >
          <div className="pixel-icon" style={{ width: iconSize, height: iconSize, display: "flex", alignItems: "center", justifyContent: "center" }}>
            {(() => {
              const Icon = PORT_ICONS[port.type as Resource];
              return <Icon size={iconSize * 0.85} color="white" />;
            })()}
          </div>
        </foreignObject>
      ) : (
        /* "?" icon for generic ports */
        <text
          x={portX}
          y={portY}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={r * 0.9}
          fontWeight="bold"
          fontFamily="var(--font-pixel), monospace"
          fill="white"
        >
          ?
        </text>
      )}
    </g>
  );
}
