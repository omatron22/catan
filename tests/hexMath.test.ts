import { describe, it, expect } from "vitest";
import {
  hexKey,
  parseHexKey,
  vertexKey,
  parseVertexKey,
  edgeKey,
  parseEdgeKey,
  cubeAdd,
  cubeEqual,
  cubeDistance,
  CUBE_DIRECTIONS,
  hexNeighbors,
  canonicalVertex,
  adjacentVertices,
  edgesAtVertex,
  edgeEndpoints,
  hexVertices,
  hexEdges,
  hexToPixel,
  vertexToPixel,
  hexesAdjacentToVertex,
  shuffle,
} from "@/shared/utils/hexMath";

describe("Key serialization", () => {
  it("hexKey round-trips", () => {
    const coord = { q: 1, r: -2, s: 1 };
    expect(parseHexKey(hexKey(coord))).toEqual(coord);
  });

  it("vertexKey round-trips", () => {
    const v = { hex: { q: 0, r: 0, s: 0 }, direction: "N" as const };
    const key = vertexKey(v);
    expect(key).toBe("0,0,0:N");
    expect(parseVertexKey(key)).toEqual(v);
  });

  it("edgeKey round-trips", () => {
    const e = { hex: { q: 1, r: -1, s: 0 }, direction: "NE" as const };
    const key = edgeKey(e);
    expect(key).toBe("1,-1,0:NE");
    expect(parseEdgeKey(key)).toEqual(e);
  });
});

describe("Cube coordinate arithmetic", () => {
  it("cubeAdd works", () => {
    expect(cubeAdd({ q: 1, r: 0, s: -1 }, { q: -1, r: 1, s: 0 })).toEqual({ q: 0, r: 1, s: -1 });
  });

  it("cubeEqual works", () => {
    expect(cubeEqual({ q: 1, r: -1, s: 0 }, { q: 1, r: -1, s: 0 })).toBe(true);
    expect(cubeEqual({ q: 1, r: -1, s: 0 }, { q: 0, r: 0, s: 0 })).toBe(false);
  });

  it("cubeDistance works", () => {
    expect(cubeDistance({ q: 0, r: 0, s: 0 }, { q: 0, r: 0, s: 0 })).toBe(0);
    expect(cubeDistance({ q: 0, r: 0, s: 0 }, { q: 1, r: -1, s: 0 })).toBe(1);
    expect(cubeDistance({ q: 0, r: 0, s: 0 }, { q: 2, r: -2, s: 0 })).toBe(2);
  });

  it("has 6 directions", () => {
    expect(CUBE_DIRECTIONS).toHaveLength(6);
    for (const d of CUBE_DIRECTIONS) {
      expect(d.q + d.r + d.s).toBe(0);
    }
  });

  it("hexNeighbors returns 6 neighbors", () => {
    const neighbors = hexNeighbors({ q: 0, r: 0, s: 0 });
    expect(neighbors).toHaveLength(6);
    for (const n of neighbors) {
      expect(cubeDistance({ q: 0, r: 0, s: 0 }, n)).toBe(1);
    }
  });
});

describe("Canonical vertex", () => {
  it("each hex has 6 unique vertices", () => {
    const hex = { q: 0, r: 0, s: 0 };
    const verts = hexVertices(hex);
    expect(verts).toHaveLength(6);
    expect(new Set(verts).size).toBe(6);
  });

  it("N and S of same hex are different", () => {
    const hex = { q: 0, r: 0, s: 0 };
    const n = vertexKey(canonicalVertex(hex, 0));
    const s = vertexKey(canonicalVertex(hex, 3));
    expect(n).not.toBe(s);
  });

  it("adjacent hexes share exactly 2 vertices", () => {
    const center = { q: 0, r: 0, s: 0 };
    const ne = { q: 1, r: -1, s: 0 };
    const centerVerts = new Set(hexVertices(center));
    const neVerts = hexVertices(ne);
    const shared = neVerts.filter((v) => centerVerts.has(v));
    expect(shared).toHaveLength(2);
  });

  it("hex.NE vertex equals NE_neighbor.S", () => {
    const hex = { q: 0, r: 0, s: 0 };
    const neVertex = vertexKey(canonicalVertex(hex, 1)); // NE position
    const neNeighborS = vertexKey({ hex: cubeAdd(hex, CUBE_DIRECTIONS[0]), direction: "S" });
    expect(neVertex).toBe(neNeighborS);
  });
});

describe("Vertex adjacency", () => {
  it("each vertex has exactly 3 adjacent vertices", () => {
    const key = vertexKey({ hex: { q: 0, r: 0, s: 0 }, direction: "N" });
    const adj = adjacentVertices(key);
    expect(adj).toHaveLength(3);
    expect(new Set(adj).size).toBe(3);
    expect(adj).not.toContain(key);
  });

  it("adjacency is symmetric", () => {
    const key = vertexKey({ hex: { q: 0, r: 0, s: 0 }, direction: "N" });
    const adj = adjacentVertices(key);
    for (const av of adj) {
      const backAdj = adjacentVertices(av);
      expect(backAdj).toContain(key);
    }
  });

  it("hex.S adjacency is also symmetric", () => {
    const key = vertexKey({ hex: { q: 0, r: 0, s: 0 }, direction: "S" });
    const adj = adjacentVertices(key);
    expect(adj).toHaveLength(3);
    for (const av of adj) {
      const backAdj = adjacentVertices(av);
      expect(backAdj).toContain(key);
    }
  });
});

describe("Edges at vertex", () => {
  it("each vertex has 3 edges", () => {
    const key = vertexKey({ hex: { q: 0, r: 0, s: 0 }, direction: "N" });
    const edges = edgesAtVertex(key);
    expect(edges).toHaveLength(3);
    expect(new Set(edges).size).toBe(3);
  });
});

describe("Edge endpoints", () => {
  it("edge has 2 distinct endpoint vertices", () => {
    const ek = edgeKey({ hex: { q: 0, r: 0, s: 0 }, direction: "NE" });
    const [v1, v2] = edgeEndpoints(ek);
    expect(v1).not.toBe(v2);
  });

  it("endpoint vertices are adjacent to each other", () => {
    const ek = edgeKey({ hex: { q: 0, r: 0, s: 0 }, direction: "NE" });
    const [v1, v2] = edgeEndpoints(ek);
    expect(adjacentVertices(v1)).toContain(v2);
    expect(adjacentVertices(v2)).toContain(v1);
  });

  it("all edge types have valid endpoints", () => {
    const hex = { q: 0, r: 0, s: 0 };
    for (const dir of ["NE", "E", "SE"] as const) {
      const ek = edgeKey({ hex, direction: dir });
      const [v1, v2] = edgeEndpoints(ek);
      expect(adjacentVertices(v1)).toContain(v2);
    }
  });
});

describe("Hex edges", () => {
  it("hex has 6 edges", () => {
    const edges = hexEdges({ q: 0, r: 0, s: 0 });
    expect(edges).toHaveLength(6);
    expect(new Set(edges).size).toBe(6);
  });

  it("adjacent hexes share exactly 1 edge", () => {
    const center = { q: 0, r: 0, s: 0 };
    const ne = { q: 1, r: -1, s: 0 };
    const centerEdges = new Set(hexEdges(center));
    const neEdges = hexEdges(ne);
    const shared = neEdges.filter((e) => centerEdges.has(e));
    expect(shared).toHaveLength(1);
  });
});

describe("Hexes adjacent to vertex", () => {
  it("returns 3 hexes for each vertex", () => {
    const vk = vertexKey({ hex: { q: 0, r: 0, s: 0 }, direction: "N" });
    const hexes = hexesAdjacentToVertex(vk);
    expect(hexes).toHaveLength(3);
  });
});

describe("Pixel conversion", () => {
  it("center hex is at origin", () => {
    const pos = hexToPixel({ q: 0, r: 0, s: 0 });
    expect(pos.x).toBeCloseTo(0);
    expect(pos.y).toBeCloseTo(0);
  });

  it("N vertex is above center", () => {
    const vk = vertexKey({ hex: { q: 0, r: 0, s: 0 }, direction: "N" });
    const pos = vertexToPixel(vk, 50);
    expect(pos.y).toBeLessThan(0);
  });

  it("S vertex is below center", () => {
    const vk = vertexKey({ hex: { q: 0, r: 0, s: 0 }, direction: "S" });
    const pos = vertexToPixel(vk, 50);
    expect(pos.y).toBeGreaterThan(0);
  });
});

describe("shuffle", () => {
  it("preserves all elements", () => {
    const arr = [1, 2, 3, 4, 5];
    const shuffled = shuffle(arr);
    expect(shuffled).toHaveLength(5);
    expect(shuffled.sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it("doesn't modify original array", () => {
    const arr = [1, 2, 3];
    shuffle(arr);
    expect(arr).toEqual([1, 2, 3]);
  });
});
