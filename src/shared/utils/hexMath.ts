import type { CubeCoord, VertexCoord, EdgeCoord, VertexKey, EdgeKey, HexKey } from "../types/coordinates";

// === Key serialization ===

export function hexKey(c: CubeCoord): HexKey {
  return `${c.q},${c.r},${c.s}`;
}

export function parseHexKey(key: HexKey): CubeCoord {
  const [q, r, s] = key.split(",").map(Number);
  return { q, r, s };
}

export function vertexKey(v: VertexCoord): VertexKey {
  return `${v.hex.q},${v.hex.r},${v.hex.s}:${v.direction}`;
}

export function parseVertexKey(key: VertexKey): VertexCoord {
  const [coordPart, direction] = key.split(":");
  const [q, r, s] = coordPart.split(",").map(Number);
  return { hex: { q, r, s }, direction: direction as "N" | "S" };
}

export function edgeKey(e: EdgeCoord): EdgeKey {
  return `${e.hex.q},${e.hex.r},${e.hex.s}:${e.direction}`;
}

export function parseEdgeKey(key: EdgeKey): EdgeCoord {
  const [coordPart, direction] = key.split(":");
  const [q, r, s] = coordPart.split(",").map(Number);
  return { hex: { q, r, s }, direction: direction as "NE" | "E" | "SE" };
}

// === Cube coordinate arithmetic ===

export function cubeAdd(a: CubeCoord, b: CubeCoord): CubeCoord {
  return { q: a.q + b.q, r: a.r + b.r, s: a.s + b.s };
}

export function cubeEqual(a: CubeCoord, b: CubeCoord): boolean {
  return a.q === b.q && a.r === b.r && a.s === b.s;
}

export function cubeDistance(a: CubeCoord, b: CubeCoord): number {
  return Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(a.s - b.s));
}

/** The 6 hex directions: NE=0, E=1, SE=2, SW=3, W=4, NW=5 */
export const CUBE_DIRECTIONS: CubeCoord[] = [
  { q: 1, r: -1, s: 0 },  // 0: NE
  { q: 1, r: 0, s: -1 },  // 1: E
  { q: 0, r: 1, s: -1 },  // 2: SE
  { q: -1, r: 1, s: 0 },  // 3: SW
  { q: -1, r: 0, s: 1 },  // 4: W
  { q: 0, r: -1, s: 1 },  // 5: NW
];

export function hexNeighbors(c: CubeCoord): CubeCoord[] {
  return CUBE_DIRECTIONS.map((d) => cubeAdd(c, d));
}

// === Vertex representation ===
// Pointy-top hexes: each hex has 6 vertices at clock positions.
// We use only N (12 o'clock) and S (6 o'clock) per hex.
// Other positions map to a neighbor's N or S:
//   NE (2 o'clock) = NE_neighbor.S
//   SE (4 o'clock) = SE_neighbor.N
//   SW (8 o'clock) = SW_neighbor.N
//   NW (10 o'clock) = NW_neighbor.S
// This gives each physical vertex exactly ONE (hex, N|S) representation.

/**
 * Convert a hex's 6-position vertex index to its canonical (hex, N|S) representation.
 * position: 0=N, 1=NE, 2=SE, 3=S, 4=SW, 5=NW (clockwise from top)
 */
export function canonicalVertex(hex: CubeCoord, position: number): VertexCoord {
  switch (position) {
    case 0: return { hex, direction: "N" };
    case 1: return { hex: cubeAdd(hex, CUBE_DIRECTIONS[0]), direction: "S" }; // NE neighbor's S
    case 2: return { hex: cubeAdd(hex, CUBE_DIRECTIONS[2]), direction: "N" }; // SE neighbor's N
    case 3: return { hex, direction: "S" };
    case 4: return { hex: cubeAdd(hex, CUBE_DIRECTIONS[3]), direction: "N" }; // SW neighbor's N
    case 5: return { hex: cubeAdd(hex, CUBE_DIRECTIONS[5]), direction: "S" }; // NW neighbor's S
    default: throw new Error(`Invalid vertex position: ${position}`);
  }
}

export function canonicalVertexKey(v: VertexCoord): VertexKey {
  // Already in canonical N/S form
  return vertexKey(v);
}

// === Canonical edge representation ===
// We use NE(0), E(1), SE(2) as canonical directions for hex edges.
// The other 3 edges (SW, W, NW) are the same edge as a neighbor's NE, E, or SE.

export function canonicalEdge(hex: CubeCoord, dirIndex: number): EdgeCoord {
  if (dirIndex <= 2) {
    return { hex, direction: (["NE", "E", "SE"] as const)[dirIndex] };
  }
  const neighbor = cubeAdd(hex, CUBE_DIRECTIONS[dirIndex]);
  const oppositeDir = dirIndex - 3;
  return { hex: neighbor, direction: (["NE", "E", "SE"] as const)[oppositeDir] };
}

export function canonicalEdgeKey(hex: CubeCoord, dirIndex: number): EdgeKey {
  return edgeKey(canonicalEdge(hex, dirIndex));
}

// === Vertex adjacency ===
// In a pointy-top hex grid, each vertex connects to exactly 3 neighbors via edges.
//
// For hex.N (top vertex, position 0):
//   Adjacent vertices are the other ends of the 3 edges meeting at this point:
//   - hex.NW (position 5) = NW_neighbor.S — via the NW edge (dirIndex=5)
//   - hex.NE (position 1) = NE_neighbor.S — via the NE edge (dirIndex=0)
//   - The vertex above = the N vertex of NW_neighbor, or equivalently NE_neighbor.NW
//     Computed: NW_neighbor(hex+dir[5]).N — via the edge between NE and NW neighbors
//
// For hex.S (bottom vertex, position 3):
//   - hex.SW (position 4) = SW_neighbor.N — via the SW edge (dirIndex=3)
//   - hex.SE (position 2) = SE_neighbor.N — via the SE edge (dirIndex=2)
//   - The vertex below = SW_neighbor.S? No...
//     SE_neighbor.SW = SE_neighbor + dir[3] = hex + dir[2] + dir[3] = hex + {-1,2,-1}
//     SW_neighbor.SE = SW_neighbor + dir[2] = hex + dir[3] + dir[2] = hex + {-1,2,-1}
//     This vertex = {hex + (-1,2,-1)}.N
//     Or equivalently: SW_neighbor.S at position 3 of SW_neighbor.
//     SW_neighbor(hex+dir[3]).S? Let me verify with pixel coords.
//
//     hex.S at (0, 1) for hex(0,0,0) with size 1.
//     hex.SW (pos 4) = SW_neighbor(dir[3]).N. SW_neighbor = (-1,1,0), center=(-√3/2, 3/2), N=(-√3/2, 1/2). ✓
//     hex.SE (pos 2) = SE_neighbor(dir[2]).N. SE_neighbor = (0,1,-1), center=(√3/2, 3/2), N=(√3/2, 1/2). ✓
//     Third vertex: below hex.S. Must be at (0, 2).
//     Which hex has N or S at (0,2)?
//     hex(0,2,-2): center=(0+√3/2*2, 3/2*2)=(√3, 3). N=(√3, 2). Not (0,2).
//     hex(-1,2,-1): center=(-√3+√3, 3)=(0,3). N=(0,2). ✓!
//     So third vertex = {hex+(-1,2,-1)}.N = cubeAdd(cubeAdd(hex, dir[2]), dir[3]).N?
//     dir[2]+dir[3] = (0,1,-1)+(-1,1,0) = (-1,2,-1). ✓
//
//   Similarly for hex.N, the third vertex above is:
//     hex(0,0,0).N at (0,-1). Third neighbor at (0,-2).
//     hex(1,-2,1): center=(√3-√3, -3)=(0,-3). N=(0,-4). S=(0,-2). ✓!
//     But wait, can it be someone's N at (0,-2)?
//     hex(q,r,s).N at (√3q+√3r/2, 3r/2-1). For this to equal (0,-2):
//       √3q+√3r/2=0 → q=-r/2 and 3r/2-1=-2 → r=-2/3. Not integer.
//     hex(q,r,s).S at (√3q+√3r/2, 3r/2+1). For (0,-2): 3r/2+1=-2 → r=-2. q=1, s=1.
//     (1,-2,1).S = (0,-2). ✓
//     And (1,-2,1) = cubeAdd(dir[0], dir[5]) added to hex: (1,-1,0)+(0,-1,1)=(1,-2,1). ✓

export function adjacentVertices(vk: VertexKey): VertexKey[] {
  const v = parseVertexKey(vk);
  const { hex, direction } = v;

  if (direction === "N") {
    return [
      // hex.NE (pos 1) = NE_neighbor.S
      vertexKey({ hex: cubeAdd(hex, CUBE_DIRECTIONS[0]), direction: "S" }),
      // hex.NW (pos 5) = NW_neighbor.S
      vertexKey({ hex: cubeAdd(hex, CUBE_DIRECTIONS[5]), direction: "S" }),
      // Vertex above = (hex+dir[0]+dir[5]).S
      vertexKey({
        hex: cubeAdd(cubeAdd(hex, CUBE_DIRECTIONS[0]), CUBE_DIRECTIONS[5]),
        direction: "S",
      }),
    ];
  } else {
    return [
      // hex.SE (pos 2) = SE_neighbor.N
      vertexKey({ hex: cubeAdd(hex, CUBE_DIRECTIONS[2]), direction: "N" }),
      // hex.SW (pos 4) = SW_neighbor.N
      vertexKey({ hex: cubeAdd(hex, CUBE_DIRECTIONS[3]), direction: "N" }),
      // Vertex below = (hex+dir[2]+dir[3]).N
      vertexKey({
        hex: cubeAdd(cubeAdd(hex, CUBE_DIRECTIONS[2]), CUBE_DIRECTIONS[3]),
        direction: "N",
      }),
    ];
  }
}

// === Edges at a vertex ===
// For hex.N: the 3 edges are hex's NE edge (dir 0), hex's NW edge (dir 5→canonical),
//   and the edge between NW_neighbor and NE_neighbor passing through this vertex.
//   That edge is NE_neighbor's W edge (dir 4→canonical).
// For hex.S: hex's SE edge (dir 2), hex's SW edge (dir 3→canonical),
//   and SE_neighbor's W edge (dir 4→canonical).

export function edgesAtVertex(vk: VertexKey): EdgeKey[] {
  const v = parseVertexKey(vk);
  const { hex, direction } = v;

  if (direction === "N") {
    return [
      edgeKey({ hex, direction: "NE" }),          // hex NE edge (dir 0)
      canonicalEdgeKey(hex, 5),                     // hex NW edge (dir 5 → remapped)
      canonicalEdgeKey(cubeAdd(hex, CUBE_DIRECTIONS[0]), 4), // NE_neighbor W edge
    ];
  } else {
    return [
      edgeKey({ hex, direction: "SE" }),          // hex SE edge (dir 2)
      canonicalEdgeKey(hex, 3),                     // hex SW edge (dir 3 → remapped)
      canonicalEdgeKey(cubeAdd(hex, CUBE_DIRECTIONS[2]), 4), // SE_neighbor W edge
    ];
  }
}

// === Edge endpoints ===
// Each edge connects two vertices.
// NE edge (dir 0): connects hex.N (pos 0) to hex.NE (pos 1)
// E edge (dir 1): connects hex.NE (pos 1) to hex.SE (pos 2)
// SE edge (dir 2): connects hex.SE (pos 2) to hex.S (pos 3)

export function edgeEndpoints(ek: EdgeKey): [VertexKey, VertexKey] {
  const { hex, direction } = parseEdgeKey(ek);

  switch (direction) {
    case "NE":
      return [
        vertexKey({ hex, direction: "N" }),
        vertexKey(canonicalVertex(hex, 1)), // NE position = NE_neighbor.S
      ];
    case "E":
      return [
        vertexKey(canonicalVertex(hex, 1)), // NE position = NE_neighbor.S
        vertexKey(canonicalVertex(hex, 2)), // SE position = SE_neighbor.N
      ];
    case "SE":
      return [
        vertexKey(canonicalVertex(hex, 2)), // SE position = SE_neighbor.N
        vertexKey({ hex, direction: "S" }),
      ];
    default:
      throw new Error(`Invalid edge direction: ${direction}`);
  }
}

// === Hex vertex/edge enumeration ===

export function hexVertices(hex: CubeCoord): VertexKey[] {
  const keys = new Set<VertexKey>();
  for (let pos = 0; pos < 6; pos++) {
    keys.add(vertexKey(canonicalVertex(hex, pos)));
  }
  return Array.from(keys);
}

export function hexEdges(hex: CubeCoord): EdgeKey[] {
  const keys = new Set<EdgeKey>();
  for (let i = 0; i < 6; i++) {
    keys.add(canonicalEdgeKey(hex, i));
  }
  return Array.from(keys);
}

// === Hexes adjacent to vertex ===
// A vertex is shared by 3 hexes. For hex.N: this hex, NE_neighbor, NW_neighbor.
// For hex.S: this hex, SE_neighbor, SW_neighbor.

export function hexesAdjacentToVertex(vk: VertexKey): CubeCoord[] {
  const v = parseVertexKey(vk);
  const { hex, direction } = v;

  if (direction === "N") {
    return [hex, cubeAdd(hex, CUBE_DIRECTIONS[0]), cubeAdd(hex, CUBE_DIRECTIONS[5])];
  } else {
    return [hex, cubeAdd(hex, CUBE_DIRECTIONS[2]), cubeAdd(hex, CUBE_DIRECTIONS[3])];
  }
}

// === Pixel conversion (pointy-top hexes) ===

const DEFAULT_HEX_SIZE = 50;

export function hexToPixel(hex: CubeCoord, size = DEFAULT_HEX_SIZE): { x: number; y: number } {
  const x = size * (Math.sqrt(3) * hex.q + (Math.sqrt(3) / 2) * hex.r);
  const y = size * ((3 / 2) * hex.r);
  return { x, y };
}

export function vertexToPixel(vk: VertexKey, size = DEFAULT_HEX_SIZE): { x: number; y: number } {
  const v = parseVertexKey(vk);
  const center = hexToPixel(v.hex, size);
  return v.direction === "N"
    ? { x: center.x, y: center.y - size }
    : { x: center.x, y: center.y + size };
}

export function edgeMidpoint(ek: EdgeKey, size = DEFAULT_HEX_SIZE): { x: number; y: number } {
  const [v1, v2] = edgeEndpoints(ek);
  const p1 = vertexToPixel(v1, size);
  const p2 = vertexToPixel(v2, size);
  return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
}

/** Get the 6 corner pixel positions of a hex (pointy-top) */
export function hexCornerPixels(hex: CubeCoord, size = DEFAULT_HEX_SIZE): { x: number; y: number }[] {
  const center = hexToPixel(hex, size);
  const corners: { x: number; y: number }[] = [];
  for (let i = 0; i < 6; i++) {
    const angleDeg = 60 * i - 90; // pointy-top: first vertex at top (−90°)
    const angleRad = (Math.PI / 180) * angleDeg;
    corners.push({
      x: center.x + size * Math.cos(angleRad),
      y: center.y + size * Math.sin(angleRad),
    });
  }
  return corners;
}

// === Shuffle utility ===

export function shuffle<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
