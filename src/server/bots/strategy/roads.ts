import type { GameState } from "@/shared/types/game";
import type { EdgeKey, VertexKey } from "@/shared/types/coordinates";
import {
  edgesAtVertex,
  edgeEndpoints,
  adjacentVertices,
} from "@/shared/utils/hexMath";
import { scoreVertex } from "./placement";

/**
 * Pick the best edge for road building during main game.
 * Considers: expansion toward good settlements, longest road progress.
 */
export function pickBuildRoad(state: GameState, playerIndex: number): EdgeKey | null {
  const player = state.players[playerIndex];
  let bestEdge: EdgeKey | null = null;
  let bestScore = -Infinity;

  for (const [ek, road] of Object.entries(state.board.edges)) {
    if (road !== null) continue;

    // Must connect to our network
    if (!isConnectedToNetwork(state, playerIndex, ek)) continue;

    let score = 0;

    // Score by what vertices we can reach from the new road's far end
    const [v1, v2] = edgeEndpoints(ek);

    for (const v of [v1, v2]) {
      // Is this end a frontier (no building, no opponent blocking)?
      const building = state.board.vertices[v];
      if (building && building.playerIndex !== playerIndex) continue;

      if (!building) {
        // Score potential settlement site
        const settlementScore = scoreVertex(state, v, playerIndex);
        if (settlementScore > 0) score += settlementScore * 0.5;
      }

      // Also look one step further
      const nextVerts = adjacentVertices(v);
      for (const nv of nextVerts) {
        const ns = scoreVertex(state, nv, playerIndex);
        if (ns > 0) score += ns * 0.1;
      }
    }

    // Bonus for extending longest road
    score += 2;

    if (score > bestScore) {
      bestScore = score;
      bestEdge = ek;
    }
  }

  return bestEdge;
}

function isConnectedToNetwork(state: GameState, playerIndex: number, edge: EdgeKey): boolean {
  const [v1, v2] = edgeEndpoints(edge);

  for (const v of [v1, v2]) {
    const building = state.board.vertices[v];
    if (building && building.playerIndex === playerIndex) return true;

    if (building && building.playerIndex !== playerIndex) continue;

    const adjacent = edgesAtVertex(v);
    for (const adjEdge of adjacent) {
      if (adjEdge === edge) continue;
      if (state.board.edges[adjEdge]?.playerIndex === playerIndex) return true;
    }
  }

  return false;
}
