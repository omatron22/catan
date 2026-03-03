/** Cube coordinate for hexagonal grid. q + r + s = 0 always. */
export interface CubeCoord {
  q: number;
  r: number;
  s: number;
}

/**
 * A vertex is identified by a hex cube coord + direction.
 * Each hex has 6 vertices. We use 'N' and 'S' canonical directions
 * so each vertex has exactly one representation.
 * N = top vertex, S = bottom vertex of the hex.
 */
export interface VertexCoord {
  hex: CubeCoord;
  direction: "N" | "S";
}

/**
 * An edge is identified by a hex cube coord + direction.
 * Each hex has 6 edges. We use 'NE', 'E', 'SE' canonical directions
 * so each edge has exactly one representation.
 */
export interface EdgeCoord {
  hex: CubeCoord;
  direction: "NE" | "E" | "SE";
}

/** String key for indexing into maps. */
export type HexKey = string; // "q,r,s"
export type VertexKey = string; // "q,r,s:N" or "q,r,s:S"
export type EdgeKey = string; // "q,r,s:NE" etc.
