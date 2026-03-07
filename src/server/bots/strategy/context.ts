import type { GameState, Resource, PortType } from "@/shared/types/game";
import type { HexKey, VertexKey, EdgeKey } from "@/shared/types/coordinates";
import type { BotPersonality } from "@/shared/types/config";
import {
  hexVertices,
  hexKey,
  adjacentVertices,
  edgeEndpoints,
  edgesAtVertex,
} from "@/shared/utils/hexMath";
import { calculateLongestRoad } from "@/server/engine/longestRoad";
import { NUMBER_DOTS, TERRAIN_RESOURCE, ALL_RESOURCES, BUILDING_COSTS, MIN_KNIGHTS_FOR_LARGEST_ARMY, MIN_ROADS_FOR_LONGEST_ROAD } from "@/shared/constants";
import { getWeights, type PersonalityWeights } from "../personality";
import { scoreVertex, computeVertexProduction } from "./placement";

export type BotStrategy = "expansion" | "cities" | "development";

export interface PlayerThreat {
  playerIndex: number;
  threatScore: number;
  visibleVP: number;
  devCardCount: number;
  roadLength: number;
  knightsPlayed: number;
  totalProduction: number;
  productionRates: Record<Resource, number>;
  hasCityResources: boolean;
  hasPortAccess: boolean;
}

export interface BuildGoal {
  type: "city" | "settlement" | "road" | "developmentCard";
  missingResources: Partial<Record<Resource, number>>;
  estimatedTurns: number;
}

/**
 * A concrete plan: "I want to build a settlement at vertex X.
 * I need to build N roads to get there, then the settlement itself.
 * Here's the total cost and steps."
 */
export interface SettlementPlan {
  /** Target vertex for the new settlement */
  targetVertex: VertexKey;
  /** Score of the target vertex (production EV) */
  vertexScore: number;
  /** Road edges to build (in order) to reach the vertex */
  roadPath: EdgeKey[];
  /** Total resources needed for all roads + settlement */
  totalCost: Partial<Record<Resource, number>>;
  /** Resources still missing after what we have in hand */
  missingResources: Partial<Record<Resource, number>>;
  /** Total missing resource count */
  totalMissing: number;
  /** Estimated turns to complete (considering production + ports) */
  estimatedTurns: number;
  /** Is an opponent also racing toward this vertex? */
  contested: boolean;
}

/**
 * Effective trade ratios for each resource (considering ports).
 * E.g., if the player has a brick port, brick ratio is 2. Otherwise 4 (or 3 with any port).
 */
export type TradeRatios = Record<Resource, number>;

export interface BotStrategicContext {
  playerIndex: number;
  productionRates: Record<Resource, number>;
  /** Total expected resources per turn */
  totalProduction: number;
  ownRoadLength: number;
  distanceToLongestRoad: number;
  ownKnightsPlayed: number;
  distanceToLargestArmy: number;
  playerThreats: PlayerThreat[];
  strategy: BotStrategy;
  gameProgress: number;
  vpToWin: number;
  missingResources: Resource[];
  personality: BotPersonality;
  weights: PersonalityWeights;
  buildGoal: BuildGoal | null;
  buildGoals: BuildGoal[];
  isEndgame: boolean;
  ownVP: number;
  turnOrderPosition: number;
  playerCount: number;
  spatialUrgency: number;
  longestRoadThreatened: boolean;
  largestArmyThreatened: boolean;

  // ===== NEW: Plan-based fields =====

  /** The bot's primary settlement plan (build roads → settle) */
  settlementPlan: SettlementPlan | null;
  /** Secondary settlement plans (ranked alternatives) */
  alternativePlans: SettlementPlan[];
  /** City upgrade plan: which settlement to upgrade, and what's missing */
  cityPlan: { vertex: VertexKey; score: number; missingResources: Partial<Record<Resource, number>>; totalMissing: number } | null;
  /** Effective bank trade ratios per resource (considering ports) */
  tradeRatios: TradeRatios;
  /** Resources the bot can "effectively produce" via ports (produce X → trade for Y) */
  effectiveProduction: Record<Resource, number>;
  /** VP paths to victory: how many VP from each source */
  vpPaths: { settlements: number; cities: number; longestRoad: number; largestArmy: number; devCards: number };
}

/**
 * Compute the strategic context for a bot player.
 */
export function computeStrategicContext(state: GameState, playerIndex: number): BotStrategicContext {
  const player = state.players[playerIndex];
  const vpToWin = state.config?.vpToWin ?? 10;
  const personality: BotPersonality = state.config?.players[playerIndex]?.personality ?? "balanced";
  const weights = getWeights(personality);

  // --- Production rates ---
  const productionRates: Record<Resource, number> = { brick: 0, lumber: 0, ore: 0, grain: 0, wool: 0 };

  for (const [, hex] of Object.entries(state.board.hexes)) {
    if (!hex.number || hex.hasRobber) continue;
    const resource = TERRAIN_RESOURCE[hex.terrain];
    if (!resource) continue;

    const dots = NUMBER_DOTS[hex.number] || 0;
    const probability = dots / 36;
    const verts = hexVertices(hex.coord);

    for (const vk of verts) {
      const building = state.board.vertices[vk];
      if (!building || building.playerIndex !== playerIndex) continue;
      const multiplier = building.type === "city" ? 2 : 1;
      productionRates[resource] += probability * multiplier;
    }
  }

  const totalProduction = Object.values(productionRates).reduce((s, v) => s + v, 0);

  // --- Trade ratios (port-aware) ---
  const tradeRatios = computeTradeRatios(player.portsAccess);

  // --- Effective production (what can we "produce" via port trading?) ---
  const effectiveProduction = computeEffectiveProduction(productionRates, tradeRatios);

  // --- Road length ---
  const ownRoadLength = calculateLongestRoad(state, playerIndex);
  const longestRoadHolder = state.longestRoadHolder;
  const longestRoadLength = longestRoadHolder !== null
    ? calculateLongestRoad(state, longestRoadHolder)
    : 0;

  let distanceToLongestRoad: number;
  if (longestRoadHolder === playerIndex) {
    distanceToLongestRoad = 0;
  } else if (longestRoadHolder !== null) {
    distanceToLongestRoad = longestRoadLength - ownRoadLength + 1;
  } else {
    distanceToLongestRoad = Math.max(0, MIN_ROADS_FOR_LONGEST_ROAD - ownRoadLength);
  }

  // --- Army ---
  const ownKnightsPlayed = player.knightsPlayed;
  const armyHolder = state.largestArmyHolder;
  const armyHolderKnights = armyHolder !== null ? state.players[armyHolder].knightsPlayed : 0;

  let distanceToLargestArmy: number;
  if (armyHolder === playerIndex) {
    distanceToLargestArmy = 0;
  } else if (armyHolder !== null) {
    distanceToLargestArmy = armyHolderKnights - ownKnightsPlayed + 1;
  } else {
    distanceToLargestArmy = Math.max(0, MIN_KNIGHTS_FOR_LARGEST_ARMY - ownKnightsPlayed);
  }

  // --- Threat assessment ---
  const playerThreats: PlayerThreat[] = [];
  for (let i = 0; i < state.players.length; i++) {
    if (i === playerIndex) continue;
    const p = state.players[i];
    const roadLen = calculateLongestRoad(state, i);
    const devCardCount = p.developmentCards.length + p.newDevelopmentCards.length;

    let threatScore = p.victoryPoints + devCardCount * 0.3;

    if (longestRoadHolder === null && roadLen >= MIN_ROADS_FOR_LONGEST_ROAD - 1) {
      threatScore += 1.5;
    } else if (longestRoadHolder !== i && roadLen >= longestRoadLength - 1) {
      threatScore += 1.5;
    }
    if (armyHolder === null && p.knightsPlayed >= MIN_KNIGHTS_FOR_LARGEST_ARMY - 1) {
      threatScore += 1.5;
    } else if (armyHolder !== i && p.knightsPlayed >= armyHolderKnights - 1) {
      threatScore += 1.5;
    }

    const opponentProduction: Record<Resource, number> = { brick: 0, lumber: 0, ore: 0, grain: 0, wool: 0 };
    for (const [, hex] of Object.entries(state.board.hexes)) {
      if (!hex.number || hex.hasRobber) continue;
      const resource = TERRAIN_RESOURCE[hex.terrain];
      if (!resource) continue;
      const dots = NUMBER_DOTS[hex.number] || 0;
      const probability = dots / 36;
      const verts = hexVertices(hex.coord);
      for (const vk of verts) {
        const building = state.board.vertices[vk];
        if (!building || building.playerIndex !== i) continue;
        const multiplier = building.type === "city" ? 2 : 1;
        opponentProduction[resource] += probability * multiplier;
      }
    }

    const oppTotalProduction = Object.values(opponentProduction).reduce((s, v) => s + v, 0);
    const hasCityResources = opponentProduction.ore > 0 && opponentProduction.grain > 0;
    const hasPortAccess = p.portsAccess.length > 0;

    const productionBonus = Math.max(0, (oppTotalProduction - 0.8) * 1.5);
    threatScore += productionBonus;

    if (hasCityResources) {
      const cityCombo = Math.min(opponentProduction.ore, opponentProduction.grain);
      threatScore += cityCombo * 2;
    }

    if (hasPortAccess) {
      const specificPorts = p.portsAccess.filter((pt) => pt !== "any").length;
      threatScore += specificPorts * 0.5 + (p.portsAccess.includes("any") ? 0.3 : 0);
    }

    playerThreats.push({
      playerIndex: i,
      threatScore,
      visibleVP: p.victoryPoints,
      devCardCount,
      roadLength: roadLen,
      knightsPlayed: p.knightsPlayed,
      totalProduction: oppTotalProduction,
      productionRates: opponentProduction,
      hasCityResources,
      hasPortAccess,
    });
  }

  playerThreats.sort((a, b) => b.threatScore - a.threatScore);

  // --- Longest road / largest army threats ---
  let longestRoadThreatened = false;
  let largestArmyThreatened = false;

  if (longestRoadHolder === playerIndex) {
    longestRoadThreatened = playerThreats.some((t) => t.roadLength >= ownRoadLength - 1);
  }
  if (armyHolder === playerIndex) {
    largestArmyThreatened = playerThreats.some((t) => t.knightsPlayed >= ownKnightsPlayed - 1);
  }

  // --- Spatial urgency ---
  const spatialUrgency = computeSpatialUrgency(state, playerIndex);

  // --- Strategy selection (now considers game phase and board state) ---
  const strategy = pickStrategy(productionRates, distanceToLargestArmy, player, state);

  // --- Game progress ---
  const maxVP = Math.max(...state.players.map((p) => p.victoryPoints));
  const gameProgress = maxVP / vpToWin;

  // --- Missing resources ---
  const missingResources = ALL_RESOURCES.filter((r) => productionRates[r] === 0);

  // --- Own VP (visible + hidden) ---
  const ownVP = player.victoryPoints + player.hiddenVictoryPoints;

  // --- Endgame detection ---
  const isEndgame = ownVP >= vpToWin * weights.endgameThreshold;

  // --- Build goals (for backward compat — trading still uses these) ---
  const buildGoals = computeBuildGoals(state, playerIndex, productionRates, tradeRatios);
  const buildGoal = buildGoals.length > 0 ? buildGoals[0] : null;

  // --- Turn order position ---
  const numPlayers = state.players.length;
  const turnOrderPosition = (playerIndex - state.startingPlayerIndex + numPlayers) % numPlayers;

  // --- Settlement plans (the core of plan-based decision making) ---
  const allPlans = computeSettlementPlans(state, playerIndex, productionRates, tradeRatios);
  const settlementPlan = allPlans.length > 0 ? allPlans[0] : null;
  const alternativePlans = allPlans.slice(1, 4);

  // --- City plan ---
  const cityPlan = computeCityPlan(state, playerIndex);

  // --- VP paths to victory ---
  const vpPaths = computeVPPaths(ownVP, vpToWin, player, distanceToLongestRoad, distanceToLargestArmy, state);

  return {
    playerIndex,
    productionRates,
    totalProduction,
    ownRoadLength,
    distanceToLongestRoad,
    ownKnightsPlayed,
    distanceToLargestArmy,
    playerThreats,
    strategy,
    gameProgress,
    vpToWin,
    missingResources,
    personality,
    weights,
    buildGoal,
    buildGoals,
    isEndgame,
    ownVP,
    turnOrderPosition,
    playerCount: numPlayers,
    spatialUrgency,
    longestRoadThreatened,
    largestArmyThreatened,
    settlementPlan,
    alternativePlans,
    cityPlan,
    tradeRatios,
    effectiveProduction,
    vpPaths,
  };
}

// ============================================================
// Trade ratios
// ============================================================

function computeTradeRatios(portsAccess: PortType[]): TradeRatios {
  const ratios: TradeRatios = { brick: 4, lumber: 4, ore: 4, grain: 4, wool: 4 };
  const hasAny = portsAccess.includes("any");
  for (const res of ALL_RESOURCES) {
    if (portsAccess.includes(res)) {
      ratios[res] = 2;
    } else if (hasAny) {
      ratios[res] = 3;
    }
  }
  return ratios;
}

/**
 * Effective production: for resources we don't produce directly, estimate
 * how quickly we could acquire them via port trading our surplus.
 * E.g., if we produce 0.4 brick/turn and have a 2:1 brick port,
 * we effectively produce 0.2 of any resource per turn via brick.
 */
function computeEffectiveProduction(
  productionRates: Record<Resource, number>,
  tradeRatios: TradeRatios,
): Record<Resource, number> {
  const effective = { ...productionRates };

  // Find our best "conversion" resource: highest production / trade ratio
  let bestConversionRate = 0;
  for (const res of ALL_RESOURCES) {
    const conversionRate = productionRates[res] / tradeRatios[res];
    if (conversionRate > bestConversionRate) {
      bestConversionRate = conversionRate;
    }
  }

  // For resources we don't produce, estimate via conversion
  for (const res of ALL_RESOURCES) {
    if (effective[res] === 0) {
      effective[res] = bestConversionRate * 0.5; // discount since you lose the source resource
    }
  }

  return effective;
}

// ============================================================
// Settlement plans
// ============================================================

/**
 * Find all viable settlement plans: target vertex + road path + cost.
 * BFS from the player's road/building frontier to find reachable settlement spots.
 * Ranks by: vertex quality / (cost + competition).
 */
function computeSettlementPlans(
  state: GameState,
  playerIndex: number,
  productionRates: Record<Resource, number>,
  tradeRatios: TradeRatios,
): SettlementPlan[] {
  const player = state.players[playerIndex];
  // Can't build more settlements if at max
  if (player.settlements.length + player.cities.length >= 5) return [];

  const plans: SettlementPlan[] = [];

  // Find frontier vertices (at end of our road network or at our buildings)
  const frontierVertices = new Set<VertexKey>();
  for (const road of player.roads) {
    const [v1, v2] = edgeEndpoints(road);
    for (const v of [v1, v2]) {
      const building = state.board.vertices[v];
      // Include if empty or our own building
      if (!building || building.playerIndex === playerIndex) {
        frontierVertices.add(v);
      }
    }
  }
  // Also include vertices at our buildings (for 0-road plans)
  for (const s of player.settlements) frontierVertices.add(s);
  for (const c of player.cities) frontierVertices.add(c);

  // BFS up to 4 roads deep
  const maxDepth = 4;
  interface QueueItem {
    vertex: VertexKey;
    path: EdgeKey[];
    depth: number;
  }

  const visited = new Set<VertexKey>();
  const queue: QueueItem[] = [];
  for (const fv of frontierVertices) {
    queue.push({ vertex: fv, path: [], depth: 0 });
    visited.add(fv);
  }

  while (queue.length > 0) {
    const item = queue.shift()!;
    if (item.depth >= maxDepth) continue;

    const adjEdges = edgesAtVertex(item.vertex);
    for (const ek of adjEdges) {
      if (state.board.edges[ek] !== null) continue; // already occupied

      const [v1, v2] = edgeEndpoints(ek);
      const otherEnd = v1 === item.vertex ? v2 : v1;

      if (visited.has(otherEnd)) continue;

      // Can't pass through opponent buildings
      const otherBuilding = state.board.vertices[otherEnd];
      if (otherBuilding && otherBuilding.playerIndex !== playerIndex) continue;

      const newPath = [...item.path, ek];
      visited.add(otherEnd);

      // Check if this is a valid settlement spot
      if (!otherBuilding) {
        const adjVerts = adjacentVertices(otherEnd);
        const tooClose = adjVerts.some(
          (av) => state.board.vertices[av] !== null && state.board.vertices[av] !== undefined
        );
        if (!tooClose) {
          const vs = scoreVertex(state, otherEnd, playerIndex);
          if (vs > 0) {
            const plan = buildSettlementPlan(
              state, playerIndex, otherEnd, newPath, vs,
              productionRates, tradeRatios
            );
            plans.push(plan);
          }
        }
      }

      if (item.depth + 1 < maxDepth) {
        queue.push({ vertex: otherEnd, path: newPath, depth: item.depth + 1 });
      }
    }
  }

  // Rank plans by value / cost, with contested spots boosted
  plans.sort((a, b) => {
    const aValue = a.vertexScore / (1 + a.totalMissing * 0.3 + a.roadPath.length * 0.5);
    const bValue = b.vertexScore / (1 + b.totalMissing * 0.3 + b.roadPath.length * 0.5);
    // Contested spots get a urgency bonus
    const aBonus = a.contested ? aValue * 0.3 : 0;
    const bBonus = b.contested ? bValue * 0.3 : 0;
    return (bValue + bBonus) - (aValue + aBonus);
  });

  return plans;
}

function buildSettlementPlan(
  state: GameState,
  playerIndex: number,
  targetVertex: VertexKey,
  roadPath: EdgeKey[],
  vertexScore: number,
  productionRates: Record<Resource, number>,
  tradeRatios: TradeRatios,
): SettlementPlan {
  const player = state.players[playerIndex];

  // Total cost = N roads + 1 settlement
  const totalCost: Partial<Record<Resource, number>> = {};
  const roadCount = roadPath.length;
  if (roadCount > 0) {
    totalCost.brick = (totalCost.brick || 0) + roadCount;
    totalCost.lumber = (totalCost.lumber || 0) + roadCount;
  }
  // Settlement cost
  totalCost.brick = (totalCost.brick || 0) + 1;
  totalCost.lumber = (totalCost.lumber || 0) + 1;
  totalCost.grain = (totalCost.grain || 0) + 1;
  totalCost.wool = (totalCost.wool || 0) + 1;

  // Missing resources
  const missingResources: Partial<Record<Resource, number>> = {};
  let totalMissing = 0;
  for (const [res, amount] of Object.entries(totalCost)) {
    const need = (amount || 0) - player.resources[res as Resource];
    if (need > 0) {
      missingResources[res as Resource] = need;
      totalMissing += need;
    }
  }

  // Estimate turns to complete (using effective production including ports)
  let estimatedTurns = 0;
  if (totalMissing > 0) {
    for (const [res, need] of Object.entries(missingResources)) {
      const rate = productionRates[res as Resource];
      if (rate > 0) {
        estimatedTurns = Math.max(estimatedTurns, (need as number) / rate);
      } else {
        // Can we get it via port trading?
        const bestConversion = getBestConversionTurns(res as Resource, need as number, productionRates, tradeRatios);
        estimatedTurns = Math.max(estimatedTurns, bestConversion);
      }
    }
  }

  // Is this spot contested? (opponent road nearby)
  const contested = isVertexContested(state, targetVertex, playerIndex);

  return {
    targetVertex,
    vertexScore,
    roadPath,
    totalCost,
    missingResources,
    totalMissing,
    estimatedTurns,
    contested,
  };
}

function getBestConversionTurns(
  targetRes: Resource,
  amount: number,
  productionRates: Record<Resource, number>,
  tradeRatios: TradeRatios,
): number {
  let bestTurns = 30; // worst case
  for (const sourceRes of ALL_RESOURCES) {
    if (sourceRes === targetRes) continue;
    const rate = productionRates[sourceRes];
    if (rate <= 0) continue;
    const ratio = tradeRatios[sourceRes];
    // Need `amount * ratio` of sourceRes to get `amount` of targetRes
    const turnsNeeded = (amount * ratio) / rate;
    if (turnsNeeded < bestTurns) bestTurns = turnsNeeded;
  }
  return bestTurns;
}

function isVertexContested(state: GameState, vertex: VertexKey, playerIndex: number): boolean {
  const adjEdges = edgesAtVertex(vertex);
  for (const ae of adjEdges) {
    const road = state.board.edges[ae];
    if (road && road.playerIndex !== playerIndex) return true;
  }
  // Also check if opponent is 1 vertex away with roads
  const adjVerts = adjacentVertices(vertex);
  for (const av of adjVerts) {
    const avEdges = edgesAtVertex(av);
    for (const ae of avEdges) {
      const road = state.board.edges[ae];
      if (road && road.playerIndex !== playerIndex) return true;
    }
  }
  return false;
}

// ============================================================
// City plan
// ============================================================

function computeCityPlan(
  state: GameState,
  playerIndex: number,
): BotStrategicContext["cityPlan"] {
  const player = state.players[playerIndex];
  if (player.settlements.length === 0 || player.cities.length >= 4) return null;

  let bestVertex: VertexKey | null = null;
  let bestScore = 0;

  for (const v of player.settlements) {
    const prod = computeVertexProduction(state, v);
    // Cities double production, so score by how much production we gain
    if (prod.totalEV > bestScore) {
      bestScore = prod.totalEV;
      bestVertex = v;
    }
  }

  if (!bestVertex) return null;

  const cityCost = BUILDING_COSTS.city;
  const missingResources: Partial<Record<Resource, number>> = {};
  let totalMissing = 0;
  for (const [res, amount] of Object.entries(cityCost)) {
    const need = (amount || 0) - player.resources[res as Resource];
    if (need > 0) {
      missingResources[res as Resource] = need;
      totalMissing += need;
    }
  }

  return { vertex: bestVertex, score: bestScore, missingResources, totalMissing };
}

// ============================================================
// VP paths
// ============================================================

function computeVPPaths(
  ownVP: number,
  vpToWin: number,
  player: { settlements: VertexKey[]; cities: VertexKey[]; developmentCards: string[]; knightsPlayed: number; hasLongestRoad: boolean; hasLargestArmy: boolean },
  distanceToLongestRoad: number,
  distanceToLargestArmy: number,
  state: GameState,
): BotStrategicContext["vpPaths"] {
  const vpNeeded = vpToWin - ownVP;

  // How many VP could we get from each source?
  const maxNewSettlements = Math.min(5 - player.settlements.length - player.cities.length, 3);
  const maxNewCities = Math.min(4 - player.cities.length, player.settlements.length);
  const longestRoadVP = player.hasLongestRoad ? 0 : (distanceToLongestRoad <= 3 ? 2 : 0);
  const largestArmyVP = player.hasLargestArmy ? 0 : (distanceToLargestArmy <= 3 ? 2 : 0);
  const vpCards = player.developmentCards.filter(c => c === "victoryPoint").length;

  return {
    settlements: maxNewSettlements,
    cities: maxNewCities,
    longestRoad: longestRoadVP,
    largestArmy: largestArmyVP,
    devCards: vpCards + (state.developmentCardDeck.length > 0 ? 1 : 0),
  };
}

// ============================================================
// Strategy selection
// ============================================================

function pickStrategy(
  productionRates: Record<Resource, number>,
  distanceToLargestArmy: number,
  player: { settlements: VertexKey[]; cities: VertexKey[]; roads: EdgeKey[] },
  state: GameState,
): BotStrategy {
  const brickLumber = productionRates.brick + productionRates.lumber;
  const oreGrain = productionRates.ore + productionRates.grain;
  const woolOreGrain = productionRates.wool + productionRates.ore + productionRates.grain;

  // Early game: always expand if we have few buildings
  const totalBuildings = player.settlements.length + player.cities.length;
  if (totalBuildings <= 2) return "expansion";

  // If we produce ore+grain well and have settlements to upgrade → cities
  if (oreGrain > brickLumber * 1.3 && player.settlements.length > 0) {
    return "cities";
  }

  // If we produce dev card resources and army is close → development
  if (woolOreGrain > brickLumber * 1.2 && distanceToLargestArmy <= 3) {
    return "development";
  }

  return "expansion";
}

// ============================================================
// Spatial urgency (unchanged)
// ============================================================

function computeSpatialUrgency(state: GameState, playerIndex: number): number {
  const playerRoads = state.players[playerIndex].roads;
  if (playerRoads.length === 0) return 0;

  const expandableSet = new Set<string>();
  for (const road of playerRoads) {
    const [v1, v2] = edgeEndpoints(road);
    for (const v of [v1, v2]) {
      if (state.board.vertices[v] !== null) continue;
      const adj = adjacentVertices(v);
      const tooClose = adj.some((av) => {
        const b = state.board.vertices[av];
        return b !== null && b !== undefined;
      });
      if (tooClose) continue;
      expandableSet.add(v);
    }
  }

  if (expandableSet.size === 0) return 1;

  let threatened = 0;
  for (const v of expandableSet) {
    const adj = adjacentVertices(v);
    let isThreatened = false;
    for (const av of adj) {
      const b = state.board.vertices[av];
      if (b && b.playerIndex !== playerIndex) { isThreatened = true; break; }
      const adj2 = adjacentVertices(av);
      for (const sv of adj2) {
        if (sv === v) continue;
        const b2 = state.board.vertices[sv];
        if (b2 && b2.playerIndex !== playerIndex) { isThreatened = true; break; }
      }
      if (isThreatened) break;
    }
    if (isThreatened) threatened++;
  }

  return threatened / expandableSet.size;
}

// ============================================================
// Build goals (for backward compat with trading)
// ============================================================

function computeBuildGoals(
  state: GameState,
  playerIndex: number,
  productionRates: Record<Resource, number>,
  tradeRatios: TradeRatios,
): BuildGoal[] {
  const player = state.players[playerIndex];
  const candidates: Array<BuildGoal & { score: number }> = [];

  const buildTypes: Array<{ type: BuildGoal["type"]; costKey: string; canBuild: boolean }> = [
    { type: "city", costKey: "city", canBuild: player.settlements.length > 0 && player.cities.length < 4 },
    { type: "settlement", costKey: "settlement", canBuild: player.settlements.length + player.cities.length < 5 },
    { type: "road", costKey: "road", canBuild: player.roads.length < 15 },
    { type: "developmentCard", costKey: "developmentCard", canBuild: state.developmentCardDeck.length > 0 },
  ];

  for (const bt of buildTypes) {
    if (!bt.canBuild) continue;
    const cost = BUILDING_COSTS[bt.costKey as keyof typeof BUILDING_COSTS];
    if (!cost) continue;

    const missing: Partial<Record<Resource, number>> = {};
    let totalMissing = 0;

    for (const [res, amount] of Object.entries(cost)) {
      const need = (amount || 0) - player.resources[res as Resource];
      if (need > 0) {
        missing[res as Resource] = need;
        totalMissing += need;
      }
    }

    let estimatedTurns = 0;
    if (totalMissing > 0) {
      for (const [res, need] of Object.entries(missing)) {
        const rate = productionRates[res as Resource];
        if (rate > 0) {
          estimatedTurns = Math.max(estimatedTurns, (need as number) / rate);
        } else {
          estimatedTurns = Math.max(estimatedTurns, getBestConversionTurns(res as Resource, need as number, productionRates, tradeRatios));
        }
      }
    }

    const score = 1 / (1 + estimatedTurns);
    candidates.push({ type: bt.type, missingResources: missing, estimatedTurns, score });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.map((c) => ({ type: c.type, missingResources: c.missingResources, estimatedTurns: c.estimatedTurns }));
}
