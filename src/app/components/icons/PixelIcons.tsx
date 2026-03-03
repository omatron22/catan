import type { Resource } from "@/shared/types/game";

/** Renders an 8x8 pixel grid from a pattern string. '#' = filled pixel. */
function renderPixels(pattern: string, color: string, size: number) {
  const rows = pattern.trim().split("\n").map((r) => r.trim());
  const grid = rows.length;
  const px = size / grid;
  const rects: React.ReactElement[] = [];
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      if (rows[y][x] === "#") {
        rects.push(
          <rect key={`${x}-${y}`} x={x * px} y={y * px} width={px + 0.5} height={px + 0.5} fill={color} />
        );
      }
    }
  }
  return rects;
}

interface PxProps {
  size?: number;
  color?: string;
}

// ── RESOURCE ICONS ──

const BRICK_PATTERN = `
........
.###.##.
.###.##.
........
.##.###.
.##.###.
........
........
`;

const LUMBER_PATTERN = `
...##...
..####..
.######.
..####..
.######.
########
...##...
...##...
`;

const ORE_PATTERN = `
........
...##...
..####..
.######.
########
########
.######.
........
`;

const GRAIN_PATTERN = `
.#.#.#..
.#.#.#..
.#.#.#..
.#.#.#..
.#.#.#..
.#.#.#..
.#.#.#..
........
`;

const WOOL_PATTERN = `
........
......##
.#######
.######.
.######.
..#..#..
..#..#..
........
`;

export function BrickPixel({ size = 24, color = "white" }: PxProps) {
  return <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="pixel-icon">{renderPixels(BRICK_PATTERN, color, size)}</svg>;
}

export function LumberPixel({ size = 24, color = "white" }: PxProps) {
  return <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="pixel-icon">{renderPixels(LUMBER_PATTERN, color, size)}</svg>;
}

export function OrePixel({ size = 24, color = "white" }: PxProps) {
  return <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="pixel-icon">{renderPixels(ORE_PATTERN, color, size)}</svg>;
}

export function GrainPixel({ size = 24, color = "white" }: PxProps) {
  return <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="pixel-icon">{renderPixels(GRAIN_PATTERN, color, size)}</svg>;
}

export function WoolPixel({ size = 24, color = "white" }: PxProps) {
  return <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="pixel-icon">{renderPixels(WOOL_PATTERN, color, size)}</svg>;
}

const RESOURCE_PIXEL_MAP: Record<Resource, React.FC<PxProps>> = {
  brick: BrickPixel,
  lumber: LumberPixel,
  ore: OrePixel,
  grain: GrainPixel,
  wool: WoolPixel,
};

export function ResourcePixel({ resource, size = 24, color = "white" }: { resource: Resource; size?: number; color?: string }) {
  const Icon = RESOURCE_PIXEL_MAP[resource];
  return <Icon size={size} color={color} />;
}

// ── GAME ICONS ──

const GHOST_PATTERN = `
..####..
.######.
.#.##.#.
.######.
.######.
.######.
.#.##.#.
........
`;

const SWORD_PATTERN = `
...##...
...##...
...##...
.######.
.######.
...##...
...##...
...##...
`;

const SCROLL_PATTERN = `
.######.
##....##
#.####.#
#.####.#
#.####.#
#.####.#
##....##
.######.
`;

const CROWN_PATTERN = `
........
........
.#.##.#.
.######.
.######.
.######.
........
........
`;

const HOUSE_PATTERN = `
...##...
..####..
.######.
########
.######.
.#.##.#.
.#.##.#.
........
`;

const CITY_PATTERN = `
.....##.
....####
....####
########
########
##.##.##
##.##.##
########
`;

const ROAD_PATTERN = `
........
........
..####..
.#....#.
#......#
........
........
........
`;

const END_TURN_PATTERN = `
........
.#..#...
.##..#..
.###..#.
.###..#.
.##..#..
.#..#...
........
`;

export function GhostPixel({ size = 24, color = "#2d1b4e" }: PxProps) {
  return <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="pixel-icon">{renderPixels(GHOST_PATTERN, color, size)}</svg>;
}

export function SwordPixel({ size = 24, color = "#6b21a8" }: PxProps) {
  return <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="pixel-icon">{renderPixels(SWORD_PATTERN, color, size)}</svg>;
}

export function ScrollPixel({ size = 24, color = "#6b21a8" }: PxProps) {
  return <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="pixel-icon">{renderPixels(SCROLL_PATTERN, color, size)}</svg>;
}

export function CrownPixel({ size = 24, color = "#d97706" }: PxProps) {
  return <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="pixel-icon">{renderPixels(CROWN_PATTERN, color, size)}</svg>;
}

export function HousePixel({ size = 24, color = "#666" }: PxProps) {
  return <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="pixel-icon">{renderPixels(HOUSE_PATTERN, color, size)}</svg>;
}

export function CityPixel({ size = 24, color = "#666" }: PxProps) {
  return <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="pixel-icon">{renderPixels(CITY_PATTERN, color, size)}</svg>;
}

export function RoadPixel({ size = 24, color = "#666" }: PxProps) {
  return <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="pixel-icon">{renderPixels(ROAD_PATTERN, color, size)}</svg>;
}

export function EndTurnPixel({ size = 24, color = "white" }: PxProps) {
  return <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="pixel-icon">{renderPixels(END_TURN_PATTERN, color, size)}</svg>;
}
