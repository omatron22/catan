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
 * Evaluate the port bonus for a vertex.
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
      bonus += production.totalEV / 3;
    } else {
      const portResource = port.type as Resource;
      const rate = production.perResource[portResource];
      if (rate > 0) {
        // 2:1 port for a resource we produce → very efficient
        bonus += rate / 2;
      }
    }
  }

  return bonus;
}

/**
 * Check if a vertex is on or adjacent to a port.
 */
function getPortAtVertex(state: GameState, vertex: VertexKey): { type: string } | null {
  for (const port of state.board.ports) {
    if (port.edgeVertices.includes(vertex)) {
      return { type: port.type };
    }
  }
  return null;
}

/**
 * Score a vertex for settlement placement using EV-based math.
 */
export function scoreVertex(
  state: GameState,
  vertex: VertexKey,
  playerIndex: number,
  context?: BotStrategicContext,
): number {
  if (state.board.vertices[vertex] !== null) return -1;
  const adj = adjacentVertices(vertex);
  for (const av of adj) {
    if (state.board.vertices[av] !== undefined && state.board.vertices[av] !== null) return -1;
  }

  const production = computeVertexProduction(state, vertex);

  // Base score from probability EV
  let score = production.totalEV * 100;

  // Diversity bonus (quadratic)
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
      score += (production.perResource.brick + production.perResource.lumber) * 20;
    }
    if (context.personality === "devcard") {
      score += (production.perResource.ore + production.perResource.grain + production.perResource.wool) * 15;
    }
  }

  return score;
}

/**
 * Pick the best vertex for settlement placement during setup.
 *
 * Key Catan theory for setup:
 * 1. First pick: maximize raw production EV (you get the best spot on the board)
 * 2. Middle picks: balance EV with diversity
 * 3. Late first pick: focus on diversity since top EV spots will be gone
 * 4. Second settlement (reverse order): COMPLEMENT first settlement's resources
 *    - If first has brick+lumber, second needs ore+grain
 *    - Port synergy matters here (2:1 port + matching production = huge)
 * 5. DON'T pick first settlement based on second settlement potential
 *    (since 2-3 other players place before your second pick)
 */
export function pickSetupVertex(
  state: GameState,
  playerIndex: number,
  context?: BotStrategicContext,
): VertexKey | null {
  const player = state.players[playerIndex];
  const isSecondSettlement = player.settlements.length === 1;
  const numPlayers = state.players.length;

  let bestVertex: VertexKey | null = null;
  let bestScore = -Infinity;

  // For second settlement: compute what resources our first settlement produces
  let firstProduction: VertexProduction | null = null;
  if (isSecondSettlement) {
    firstProduction = computeVertexProduction(state, player.settlements[0]);
  }

  for (const vk of Object.keys(state.board.vertices)) {
    const base = scoreVertex(state, vk, playerIndex, context);
    if (base < 0) continue;

    let score = base;
    const production = computeVertexProduction(state, vk);

    if (isSecondSettlement && firstProduction) {
      // === SECOND SETTLEMENT: Complement first ===

      // Strong bonus for NEW resource types we don't produce yet
      let newResources = 0;
      for (const res of production.resourceSet) {
        if (!firstProduction.resourceSet.has(res)) newResources++;
      }
      // Diversity bonus scaled much higher than base EV for second settlement
      const diversityMult = context ? context.weights.setupDiversity : 1.0;
      score += newResources * 35 * diversityMult;

      // Critical resource coverage:
      // In Catan, you NEED brick+lumber (for roads/settlements) AND ore+grain (for cities/dev cards)
      // If first settlement covers one pair, second MUST cover the other
      const hasBrickLumber = firstProduction.resourceSet.has("brick") && firstProduction.resourceSet.has("lumber");
      const hasOreGrain = firstProduction.resourceSet.has("ore") && firstProduction.resourceSet.has("grain");

      if (!hasBrickLumber) {
        // Desperately need brick and lumber
        if (production.resourceSet.has("brick")) score += 20;
        if (production.resourceSet.has("lumber")) score += 20;
        if (production.resourceSet.has("brick") && production.resourceSet.has("lumber")) score += 15; // combo bonus
      }
      if (!hasOreGrain) {
        // Need ore and grain for cities
        if (production.resourceSet.has("ore")) score += 18;
        if (production.resourceSet.has("grain")) score += 18;
        if (production.resourceSet.has("ore") && production.resourceSet.has("grain")) score += 12;
      }

      // Wool coverage (needed for settlements + dev cards)
      if (!firstProduction.resourceSet.has("wool") && production.resourceSet.has("wool")) score += 12;

      // Port synergy: if this vertex has a 2:1 port matching a resource we heavily produce
      const port = getPortAtVertex(state, vk);
      if (port) {
        if (port.type !== "any") {
          const portRes = port.type as Resource;
          // Great if our first settlement produces this resource (we can trade 2:1)
          if (firstProduction.perResource[portRes] > 0) {
            score += 25 + firstProduction.perResource[portRes] * 100;
          }
          // Also good if THIS vertex produces it
          if (production.perResource[portRes] > 0) {
            score += 15 + production.perResource[portRes] * 60;
          }
        } else {
          // 3:1 any port: universally useful
          score += 12;
        }
      }

    } else {
      // === FIRST SETTLEMENT ===

      if (context) {
        const pos = context.turnOrderPosition;

        if (pos === 0) {
          // First pick: maximize raw production — you get the BEST spot
          score += production.totalEV * 25;
          // Still value diversity somewhat
          score += production.diversity * 5;
        } else if (pos === 1) {
          // Second pick: still prioritize EV, slight diversity
          score += production.totalEV * 20;
          score += production.diversity * 8;
        } else if (pos >= numPlayers - 1) {
          // Last pick: diversity matters more (best EV spots are taken)
          score += production.diversity * 15;
          // Port strategy becomes more important for late pickers
          const portBonus = evaluatePortStrategy(state, vk, production);
          if (portBonus > 0) {
            score += portBonus * 60 * (context.weights.portStrategyWeight + 0.2);
          }
        } else {
          // Middle picks: balanced
          score += production.totalEV * 15;
          score += production.diversity * 10;
        }

        // Port strategy bonus (amplified by personality)
        const portBonus = evaluatePortStrategy(state, vk, production);
        if (portBonus > 0) {
          score += portBonus * 40 * context.weights.portStrategyWeight;
        }
      } else {
        // No context: just use raw production
        score += production.totalEV * 20;
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
 * Points toward high-value vertices, ports, and expansion paths.
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

    // Score the vertex at the other end of the road
    const otherProd = computeVertexProduction(state, otherEnd);
    if (state.board.vertices[otherEnd] === null) {
      // Good settlement spot at the other end
      score += otherProd.totalEV * 25;

      // Distance rule check: can we actually settle here?
      const adjVerts = adjacentVertices(otherEnd);
      const tooClose = adjVerts.some(
        (av) => state.board.vertices[av] !== null && state.board.vertices[av] !== undefined
      );
      if (tooClose) {
        score -= 15; // can't settle here, but might pass through
      } else {
        score += 10; // valid settlement spot bonus
      }

      if (context) {
        const pb = evaluatePortStrategy(state, otherEnd, otherProd);
        score += pb * 30 * context.weights.portStrategyWeight;
      }
    }

    // Score vertices TWO hops away (what's beyond the immediate neighbor)
    const reachable = adjacentVertices(otherEnd);
    for (const rv of reachable) {
      if (rv === settlementVertex) continue;
      if (state.board.vertices[rv] !== null) continue;

      const prod = computeVertexProduction(state, rv);
      score += prod.totalEV * 40;

      // Check if this 2-hop vertex is a valid settlement spot
      const adjVerts = adjacentVertices(rv);
      const tooClose = adjVerts.some(
        (av) => av !== otherEnd && state.board.vertices[av] !== null && state.board.vertices[av] !== undefined
      );
      if (!tooClose) score += 8; // valid expansion target

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

    const adj = adjacentVertices(vk);
    const tooClose = adj.some(
      (av) => state.board.vertices[av] !== null && state.board.vertices[av] !== undefined
    );
    if (tooClose) continue;

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
