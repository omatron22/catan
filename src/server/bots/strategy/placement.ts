import type { GameState, Resource, Terrain } from "@/shared/types/game";
import type { VertexKey, EdgeKey } from "@/shared/types/coordinates";
import {
  adjacentVertices,
  edgesAtVertex,
  edgeEndpoints,
  hexesAdjacentToVertex,
  hexKey,
  vertexKey,
  hexVertices,
} from "@/shared/utils/hexMath";
import { NUMBER_DOTS, TERRAIN_RESOURCE } from "@/shared/constants";
import type { BotStrategicContext } from "./context";

export interface VertexProduction {
  totalEV: number;
  perResource: Record<Resource, number>;
  diversity: number;
  resourceSet: Set<Resource>;
}

/**
 * Compute the expected production for a vertex location.
 * Uses true probability (NUMBER_DOTS[n] / 36) instead of raw dots.
 */
export function computeVertexProduction(state: GameState, vertex: VertexKey): VertexProduction {
  const perResource: Record<Resource, number> = { brick: 0, lumber: 0, ore: 0, grain: 0, wool: 0 };
  const resourceSet = new Set<Resource>();
  let totalEV = 0;

  const adjacentHexes = hexesAdjacentToVertex(vertex);
  for (const hexCoord of adjacentHexes) {
    const hk = hexKey(hexCoord);
    const hex = state.board.hexes[hk];
    if (!hex) continue;

    const resource = TERRAIN_RESOURCE[hex.terrain];
    if (!resource || !hex.number) continue;

    const ev = (NUMBER_DOTS[hex.number] || 0) / 36;
    totalEV += ev;
    perResource[resource] += ev;
    resourceSet.add(resource);
  }

  return { totalEV, perResource, diversity: resourceSet.size, resourceSet };
}

/**
 * Evaluate the port bonus for a vertex given its production profile.
 * Returns the effective extra EV from port trading.
 */
export function evaluatePortStrategy(
  state: GameState,
  vertex: VertexKey,
  production: VertexProduction,
): number {
  let bonus = 0;

  for (const port of state.board.ports) {
    if (!port.edgeVertices.includes(vertex)) continue;

    if (port.type === "any") {
      // 3:1 any port: can convert any excess
      bonus += production.totalEV / 3;
    } else {
      // 2:1 specific port: if vertex produces that resource
      const portResource = port.type as Resource;
      const rate = production.perResource[portResource];
      if (rate > 0) {
        bonus += rate / 2;
      }
    }
  }

  return bonus;
}

/**
 * Score a vertex for settlement placement using EV-based math.
 * Higher score = better location.
 */
export function scoreVertex(
  state: GameState,
  vertex: VertexKey,
  playerIndex: number,
  context?: BotStrategicContext,
): number {
  // Validity checks
  if (state.board.vertices[vertex] !== null) return -1;
  const adj = adjacentVertices(vertex);
  for (const av of adj) {
    if (state.board.vertices[av] !== undefined && state.board.vertices[av] !== null) return -1;
  }

  const production = computeVertexProduction(state, vertex);

  // Base score from probability EV (scaled to useful range)
  let score = production.totalEV * 100;

  // Diversity bonus (quadratic — reward covering more resource types)
  score += production.diversity * production.diversity * 8;

  // Port bonus
  const portBonus = evaluatePortStrategy(state, vertex, production);
  score += portBonus * 80;

  // Penalty for edge-of-board vertices
  const adjacentHexes = hexesAdjacentToVertex(vertex);
  const onBoardHexes = adjacentHexes.filter((h) => state.board.hexes[hexKey(h)]).length;
  if (onBoardHexes < 3) score -= 5;
  if (onBoardHexes < 2) score -= 8;

  // Personality modifiers
  if (context) {
    if (context.personality === "builder") {
      // Builder slightly prefers brick/lumber EV
      score += (production.perResource.brick + production.perResource.lumber) * 20;
    }
    if (context.personality === "devcard") {
      // Devcard prefers ore/grain/wool EV
      score += (production.perResource.ore + production.perResource.grain + production.perResource.wool) * 15;
    }
  }

  return score;
}

/**
 * Pick the best vertex for settlement placement during setup.
 * Uses EV math, turn-order awareness, and port strategy evaluation.
 */
export function pickSetupVertex(
  state: GameState,
  playerIndex: number,
  context?: BotStrategicContext,
): VertexKey | null {
  const player = state.players[playerIndex];
  const isSecondSettlement = player.settlements.length === 1;

  let bestVertex: VertexKey | null = null;
  let bestScore = -Infinity;

  // If second settlement, compute first settlement's production
  let firstProduction: VertexProduction | null = null;
  if (isSecondSettlement) {
    firstProduction = computeVertexProduction(state, player.settlements[0]);
  }

  for (const vk of Object.keys(state.board.vertices)) {
    const base = scoreVertex(state, vk, playerIndex, context);
    if (base < 0) continue;

    let score = base;
    const production = computeVertexProduction(state, vk);

    // Second settlement: complement first settlement's resources
    if (isSecondSettlement && firstProduction) {
      let newResources = 0;
      for (const res of production.resourceSet) {
        if (!firstProduction.resourceSet.has(res)) newResources++;
      }
      const diversityMult = context ? context.weights.setupDiversity : 1.0;
      score += newResources * 15 * diversityMult;

      // Strongly prefer brick/lumber if first settlement lacks them
      if (!firstProduction.resourceSet.has("brick") && production.resourceSet.has("brick")) score += 10;
      if (!firstProduction.resourceSet.has("lumber") && production.resourceSet.has("lumber")) score += 10;
    }

    // Turn-order awareness
    if (context) {
      const pos = context.turnOrderPosition;
      const total = context.playerCount;

      if (pos === 0 && !isSecondSettlement) {
        // First pick: prioritize raw probability
        score += production.totalEV * 20;
      } else if (pos >= total - 2 && !isSecondSettlement) {
        // Late first pick: boost diversity since top spots will be taken
        score += production.diversity * 5;
      }

      // Port strategy bonus (amplified by personality weight)
      const portBonus = evaluatePortStrategy(state, vk, production);
      if (portBonus > 0) {
        score += portBonus * 40 * context.weights.portStrategyWeight;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestVertex = vk;
    }
  }

  return bestVertex;
}

/**
 * Pick the best edge for road placement during setup.
 * Points toward high-value vertices and ports, with opponent avoidance.
 */
export function pickSetupRoad(
  state: GameState,
  playerIndex: number,
  settlementVertex: VertexKey,
  context?: BotStrategicContext,
): EdgeKey | null {
  const edges = edgesAtVertex(settlementVertex);
  let bestEdge: EdgeKey | null = null;
  let bestScore = -Infinity;

  for (const ek of edges) {
    if (state.board.edges[ek] !== null) continue;
    if (!(ek in state.board.edges)) continue;

    const [v1, v2] = edgeEndpoints(ek);
    const otherEnd = v1 === settlementVertex ? v2 : v1;

    let score = 0;

    // Score the other end of the road
    const otherProd = computeVertexProduction(state, otherEnd);
    if (state.board.vertices[otherEnd] === null) {
      score += otherProd.totalEV * 20;
      if (context) {
        const pb = evaluatePortStrategy(state, otherEnd, otherProd);
        score += pb * 25 * context.weights.portStrategyWeight;
      }
    }

    // Score vertices reachable from the other end
    const reachable = adjacentVertices(otherEnd);
    for (const rv of reachable) {
      if (rv === settlementVertex) continue;
      if (state.board.vertices[rv] !== null) continue;

      const prod = computeVertexProduction(state, rv);
      score += prod.totalEV * 40;

      if (context) {
        const pb = evaluatePortStrategy(state, rv, prod);
        score += pb * 30 * context.weights.portStrategyWeight;
      }
    }

    // Opponent proximity penalty
    if (context) {
      for (const rv of reachable) {
        const building = state.board.vertices[rv];
        if (building && building.playerIndex !== playerIndex) {
          score -= 10;
        }
        const adjEdges = edgesAtVertex(rv);
        for (const ae of adjEdges) {
          const road = state.board.edges[ae];
          if (road && road.playerIndex !== playerIndex) {
            score -= 3;
          }
        }
      }
    }

    score += 1; // tiebreaker

    if (score > bestScore) {
      bestScore = score;
      bestEdge = ek;
    }
  }

  return bestEdge;
}

/**
 * Pick the best vertex for building a settlement during main game.
 */
export function pickBuildVertex(state: GameState, playerIndex: number): VertexKey | null {
  const player = state.players[playerIndex];
  let bestVertex: VertexKey | null = null;
  let bestScore = 0;

  for (const vk of Object.keys(state.board.vertices)) {
    if (state.board.vertices[vk] !== null) continue;

    // Distance rule check
    const adj = adjacentVertices(vk);
    const tooClose = adj.some(
      (av) => state.board.vertices[av] !== null && state.board.vertices[av] !== undefined
    );
    if (tooClose) continue;

    // Must connect to player's road network
    const connectedEdges = edgesAtVertex(vk);
    const hasRoad = connectedEdges.some(
      (ek) => state.board.edges[ek]?.playerIndex === playerIndex
    );
    if (!hasRoad) continue;

    const score = scoreVertex(state, vk, playerIndex);
    if (score > bestScore) {
      bestScore = score;
      bestVertex = vk;
    }
  }

  return bestVertex;
}
