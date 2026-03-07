import type { GameState, Resource } from "@/shared/types/game";
import type { GameAction } from "@/shared/types/actions";
import { pickSetupVertex, pickSetupRoad, pickBuildVertex, computeVertexProduction } from "./strategy/placement";
import { pickBuildRoad, planRoadPath } from "./strategy/roads";
import { pickBankTrade, pickPlayerTrade } from "./strategy/trading";
import { pickRobberHex, pickStealTarget, pickDiscardResources } from "./strategy/robber";
import { pickDevCardToPlay } from "./strategy/devCards";
import { computeStrategicContext, type BotStrategicContext } from "./strategy/context";
import { BUILDING_COSTS, ALL_RESOURCES } from "@/shared/constants";
import {
  edgesAtVertex,
  edgeEndpoints,
  adjacentVertices,
  hexVertices,
  hexEdges,
  parseHexKey,
} from "@/shared/utils/hexMath";

/**
 * Given the current game state and a bot player index,
 * decide what action the bot should take.
 */
export function decideBotAction(state: GameState, botIndex: number): GameAction | null {
  // Handle discard phase (any bot might need to discard, not just current player)
  if (state.turnPhase === "discard" && state.discardingPlayers.includes(botIndex)) {
    return makeDiscardAction(state, botIndex);
  }

  // All other actions require it to be our turn
  if (state.currentPlayerIndex !== botIndex) return null;

  // Setup phases
  if (state.phase === "setup-forward" || state.phase === "setup-reverse") {
    let context: BotStrategicContext | undefined;
    try {
      context = computeStrategicContext(state, botIndex);
    } catch {
      // Fallback to basic setup if context computation fails
    }
    return makeSetupAction(state, botIndex, context);
  }

  if (state.phase !== "main") return null;

  const context = computeStrategicContext(state, botIndex);

  switch (state.turnPhase) {
    case "roll":
      return makeRollOrPlayDevCard(state, botIndex, context);
    case "robber-place":
      return makeRobberPlaceAction(state, botIndex, context);
    case "robber-steal":
      return makeStealAction(state, botIndex, context);
    case "trade-or-build":
      return makePlanDrivenAction(state, botIndex, context);
    case "road-building-1":
    case "road-building-2":
      return makeRoadBuildingAction(state, botIndex, context);
    case "sheep-nuke-pick":
      return makeSheepNukePickAction(state, botIndex, context);
    case "monopoly":
    case "year-of-plenty":
      return null;
    default:
      return null;
  }
}

// ============================================================
// Setup
// ============================================================

function makeSetupAction(state: GameState, botIndex: number, context?: BotStrategicContext): GameAction | null {
  const isSettlementTurn = state.setupPlacementsMade % 2 === 0;

  if (isSettlementTurn) {
    const vertex = pickSetupVertex(state, botIndex, context);
    if (!vertex) return null;
    return { type: "place-settlement", playerIndex: botIndex, vertex };
  } else {
    const lastSettlement = state.players[botIndex].settlements[
      state.players[botIndex].settlements.length - 1
    ];
    const edge = pickSetupRoad(state, botIndex, lastSettlement, context);
    if (!edge) return null;
    return { type: "place-road", playerIndex: botIndex, edge };
  }
}

// ============================================================
// Pre-roll dev card decision
// ============================================================

function makeRollOrPlayDevCard(state: GameState, botIndex: number, context: BotStrategicContext): GameAction {
  const player = state.players[botIndex];
  if (!player.hasPlayedDevCardThisTurn && player.developmentCards.includes("knight")) {
    let playProb = 0.3 * context.weights.knightEagerness;
    if (context.distanceToLargestArmy <= 1) playProb = Math.min(1, 0.8 * context.weights.knightEagerness);
    else if (context.distanceToLargestArmy <= 2) playProb = Math.min(1, 0.6 * context.weights.knightEagerness);

    if (Math.random() < playProb) {
      return { type: "play-knight", playerIndex: botIndex };
    }
  }

  return { type: "roll-dice", playerIndex: botIndex };
}

// ============================================================
// Robber
// ============================================================

function makeRobberPlaceAction(state: GameState, botIndex: number, context: BotStrategicContext): GameAction {
  const hex = pickRobberHex(state, botIndex, context);
  return { type: "move-robber", playerIndex: botIndex, hex };
}

function makeStealAction(state: GameState, botIndex: number, context: BotStrategicContext): GameAction | null {
  const target = pickStealTarget(state, botIndex, context);
  if (target === null) return null;
  return { type: "steal-resource", playerIndex: botIndex, targetPlayer: target };
}

function makeDiscardAction(state: GameState, botIndex: number): GameAction {
  let context: BotStrategicContext | undefined;
  try {
    context = computeStrategicContext(state, botIndex);
  } catch {
    // Fallback to basic discard
  }
  const resources = pickDiscardResources(state, botIndex, context);
  return { type: "discard-resources", playerIndex: botIndex, resources };
}

// ============================================================
// CORE: Plan-driven main phase action
// ============================================================

/**
 * The heart of the bot: decides what to do during trade-or-build phase.
 *
 * Architecture:
 * 1. Check for free nuke
 * 2. Consider playing a dev card (if it directly helps the plan)
 * 3. Check if we can execute the NEXT STEP of our plan
 *    - If plan says "build road to vertex X" and we can afford → build road
 *    - If plan says "build settlement at vertex X" and we can afford → build settlement
 * 4. Check opportunistic builds (city upgrade, dev card purchase)
 * 5. If we can't execute our plan step, try trading (player trade → bank trade)
 * 6. If nothing helps, END TURN and save resources
 *
 * Key principle: NEVER build something that doesn't advance a plan or provide clear VP value.
 * Roads are ONLY built on the planned path. Resources are SAVED for the plan.
 */
function makePlanDrivenAction(state: GameState, botIndex: number, context: BotStrategicContext): GameAction {
  const player = state.players[botIndex];

  // 0. Always take a free nuke
  if (state.freeNukeAvailable && state.config?.sheepNuke) {
    return { type: "sheep-nuke", playerIndex: botIndex };
  }

  // 1. Consider playing a dev card
  if (!player.hasPlayedDevCardThisTurn) {
    const devCard = pickDevCardToPlay(state, botIndex, context);
    if (devCard) {
      switch (devCard.card) {
        case "knight":
          return { type: "play-knight", playerIndex: botIndex };
        case "roadBuilding":
          return { type: "play-road-building", playerIndex: botIndex };
        case "yearOfPlenty":
          return {
            type: "play-year-of-plenty",
            playerIndex: botIndex,
            resource1: (devCard.params?.resource1 as Resource) || "ore",
            resource2: (devCard.params?.resource2 as Resource) || "grain",
          };
        case "monopoly":
          return {
            type: "play-monopoly",
            playerIndex: botIndex,
            resource: (devCard.params?.resource as Resource) || "ore",
          };
      }
    }
  }

  // 2. Evaluate all possible actions and pick the best one
  //    This is plan-aware: actions that advance the plan score higher.

  const actions = evaluateActions(state, botIndex, context);

  // Sort by score descending
  actions.sort((a, b) => b.score - a.score);

  // Try the highest-scoring action
  for (const action of actions) {
    if (action.score <= 0) break; // don't do negative-value actions
    const result = action.execute();
    if (result) return result;
  }

  // 3. If no build action scored positive, try trading toward the plan
  const tradeAction = tryTrading(state, botIndex, context);
  if (tradeAction) return tradeAction;

  // 4. Nothing useful to do — END TURN and save resources
  return { type: "end-turn", playerIndex: botIndex };
}

interface ScoredAction {
  name: string;
  score: number;
  execute: () => GameAction | null;
}

/**
 * Score all possible build actions based on how much they advance our plan
 * or provide direct VP value.
 */
function evaluateActions(state: GameState, botIndex: number, context: BotStrategicContext): ScoredAction[] {
  const player = state.players[botIndex];
  const actions: ScoredAction[] = [];
  const plan = context.settlementPlan;

  // --- SETTLEMENT (always highest priority — 1 VP + production) ---
  if (canAfford(player, BUILDING_COSTS.settlement)) {
    // Check if the plan's target vertex is directly reachable (0 roads needed)
    if (plan && plan.roadPath.length === 0) {
      const prod = computeVertexProduction(state, plan.targetVertex);
      let score = 200 + prod.totalEV * 100; // Very high — this IS the plan
      if (plan.contested) score += 50; // Rush!
      actions.push({
        name: "settlement-plan",
        score,
        execute: () => ({ type: "build-settlement", playerIndex: botIndex, vertex: plan.targetVertex }),
      });
    }
    // Also check any reachable vertex (in case plan vertex isn't the best available right now)
    const vertex = pickBuildVertex(state, botIndex);
    if (vertex && (!plan || vertex !== plan.targetVertex)) {
      const prod = computeVertexProduction(state, vertex);
      let score = 180 + prod.totalEV * 90;
      if (context.isEndgame) score += 40;
      actions.push({
        name: "settlement-opportunistic",
        score,
        execute: () => ({ type: "build-settlement", playerIndex: botIndex, vertex }),
      });
    }
  }

  // --- CITY (high VP value: 1 VP + doubled production) ---
  if (canAfford(player, BUILDING_COSTS.city) && context.cityPlan) {
    const cp = context.cityPlan;
    let score = 170 + cp.score * 80; // High base — cities are efficient VP
    if (context.strategy === "cities") score += 30;
    if (context.isEndgame) score += 40;
    actions.push({
      name: "city",
      score,
      execute: () => ({ type: "build-city", playerIndex: botIndex, vertex: cp.vertex }),
    });
  }

  // --- ROAD (ONLY if it's on the plan path) ---
  if (canAfford(player, BUILDING_COSTS.road) && player.roads.length < 15) {
    if (plan && plan.roadPath.length > 0) {
      // Build the FIRST road on the planned path
      const nextRoad = plan.roadPath[0];
      // Verify the road is still available
      if (state.board.edges[nextRoad] === null) {
        let score = 80; // Base: roads themselves aren't VP

        // Boost if the plan target is high-value
        score += plan.vertexScore * 0.3;

        // Boost if contested (race to settle)
        if (plan.contested) score += 40;

        // Boost if this is the LAST road before settlement placement
        if (plan.roadPath.length === 1) score += 30;

        // If we can't afford settlement anyway, slight penalty (save resources?)
        // But if the road is on the path, it's still progress
        const canAffordSettlement = canAfford(player, {
          brick: 1 + plan.roadPath.length,
          lumber: 1 + plan.roadPath.length,
          grain: 1,
          wool: 1,
        });
        if (!canAffordSettlement && plan.roadPath.length > 1) {
          // We need more roads AND can't afford everything — build the road if
          // we can at least save for next turn, but penalize if we're wasting
          score -= 10;
        }

        // IMPORTANT: don't build roads if we could build something with VP instead
        // Settlement/city will outscore this since they start at 170-200
        actions.push({
          name: "road-plan",
          score,
          execute: () => ({ type: "build-road", playerIndex: botIndex, edge: nextRoad }),
        });
      }
    }

    // Longest road pursuit: build a road even off-plan if it gives us longest road
    if (context.distanceToLongestRoad <= 2 && player.longestRoadLength >= 3) {
      const edge = pickBuildRoad(state, botIndex, context);
      if (edge) {
        const isOnPlan = plan?.roadPath.includes(edge);
        if (!isOnPlan) {
          let score = 60;
          if (context.distanceToLongestRoad <= 1) score = 110; // +2 VP is huge
          if (context.longestRoadThreatened) score += 30;
          actions.push({
            name: "road-longest",
            score,
            execute: () => ({ type: "build-road", playerIndex: botIndex, edge }),
          });
        }
      }
    }
  }

  // --- DEV CARD (VP + army + utility) ---
  if (canAfford(player, BUILDING_COSTS.developmentCard) && state.developmentCardDeck.length > 0) {
    let score = 50; // Base: dev cards are speculative

    // Army pursuit: dev cards contain knights
    if (context.distanceToLargestArmy <= 2 && player.knightsPlayed >= 2) score += 40;
    if (context.distanceToLargestArmy <= 1) score += 60;
    if (context.largestArmyThreatened) score += 30;

    // Strategy bonus
    if (context.strategy === "development") score += 25;

    // Endgame: dev cards might contain VP cards
    if (context.isEndgame) {
      const vpCardsRemaining = state.developmentCardDeck.length; // we don't know contents, but odds improve
      score += Math.min(30, vpCardsRemaining * 2);
    }

    // DON'T buy dev cards if we're saving for a settlement and close
    if (plan && plan.totalMissing <= 2) {
      score -= 40; // strongly prefer completing the plan
    }

    actions.push({
      name: "devCard",
      score,
      execute: () => ({ type: "buy-development-card", playerIndex: botIndex }),
    });
  }

  // --- SHEEP NUKE (desperation only) ---
  if (state.config?.sheepNuke && player.resources.wool >= 10) {
    const nukeScore = evaluateNukeDesirability(state, botIndex, context);
    if (nukeScore > 0) {
      actions.push({
        name: "sheepNuke",
        score: nukeScore,
        execute: () => ({ type: "sheep-nuke", playerIndex: botIndex }),
      });
    }
  }

  return actions;
}

function evaluateNukeDesirability(state: GameState, botIndex: number, context: BotStrategicContext): number {
  const leader = context.playerThreats[0];
  const leaderVP = leader?.visibleVP ?? 0;
  const vpBehind = leaderVP - context.ownVP;
  const leaderCloseToWin = leaderVP >= context.vpToWin - 2;
  const botFarBehind = vpBehind >= 3;

  if (!botFarBehind && !leaderCloseToWin) return -1;

  let bestNukeScore = -Infinity;
  for (const num of [2, 3, 4, 5, 6, 8, 9, 10, 11, 12]) {
    let oppDmg = 0, selfDmg = 0;
    for (const [hk, hex] of Object.entries(state.board.hexes)) {
      if (hex.number !== num) continue;
      const parsedHex = parseHexKey(hk);
      for (const vk of hexVertices(parsedHex)) {
        const b = state.board.vertices[vk];
        if (!b) continue;
        const val = b.type === "city" ? 2 : 1;
        if (b.playerIndex === botIndex) selfDmg += val;
        else oppDmg += val;
      }
    }
    const s = oppDmg - selfDmg * 1.5;
    if (s > bestNukeScore) bestNukeScore = s;
  }

  if (bestNukeScore < 1) return -1;

  let score = 5 + bestNukeScore * 8;
  if (leaderCloseToWin) score += 20;
  if (vpBehind >= 5) score += 15;
  return score;
}

// ============================================================
// Trading (plan-aware)
// ============================================================

function tryTrading(state: GameState, botIndex: number, context: BotStrategicContext): GameAction | null {
  // First try player trade (better rates)
  const playerTradeAction = tryPlayerTrade(state, botIndex, context);
  if (playerTradeAction) return playerTradeAction;

  // Then try bank trade
  const bankTrade = pickBankTrade(state, botIndex, context);
  if (bankTrade) {
    return {
      type: "bank-trade",
      playerIndex: botIndex,
      giving: bankTrade.giving,
      givingCount: bankTrade.givingCount,
      receiving: bankTrade.receiving,
    };
  }

  return null;
}

function tryPlayerTrade(state: GameState, botIndex: number, context: BotStrategicContext): GameAction | null {
  const playerTrade = pickPlayerTrade(state, botIndex, context);
  if (!playerTrade) return null;

  const offerRes = Object.keys(playerTrade.offering)[0] as Resource;
  const requestRes = Object.keys(playerTrade.requesting)[0] as Resource;
  const pairKey = `${offerRes}->${requestRes}`;
  const mem = proposedTradeMemory.get(botIndex);

  let rejections = 0;
  if (mem && mem.pairKey === pairKey) {
    rejections = mem.rejections + 1;
  }

  const maxOffer = playerTrade.maxOffer ?? 1;
  const offerAmount = Math.min(1 + rejections, maxOffer, playerTrade.surplusCount);

  const finalOffering = { [offerRes]: offerAmount };
  const hash = getTradeHash(finalOffering, playerTrade.requesting);

  const maxedOut = mem && mem.pairKey === pairKey && offerAmount <= mem.rejections;
  const tooRecent = mem && mem.lastHash === hash && state.turnNumber - mem.turn < 2;
  if (!tooRecent && !maxedOut && offerAmount >= 1) {
    proposedTradeMemory.set(botIndex, { pairKey, rejections, turn: state.turnNumber, lastHash: hash });
    return {
      type: "offer-trade",
      playerIndex: botIndex,
      offering: finalOffering,
      requesting: playerTrade.requesting,
      toPlayer: null,
    };
  }

  return null;
}

// ============================================================
// Road building dev card
// ============================================================

function makeRoadBuildingAction(state: GameState, botIndex: number, context: BotStrategicContext): GameAction {
  const player = state.players[botIndex];
  const hasNetwork = player.settlements.length > 0 || player.cities.length > 0 || player.roads.length > 0;

  if (hasNetwork) {
    // Prefer roads on the settlement plan path
    const plan = context.settlementPlan;
    if (plan && plan.roadPath.length > 0) {
      // Find the first unbuilt road on the plan path
      for (const ek of plan.roadPath) {
        if (state.board.edges[ek] === null) {
          return { type: "build-road", playerIndex: botIndex, edge: ek };
        }
      }
    }

    const edge = pickBuildRoad(state, botIndex, context);
    if (edge) {
      return { type: "build-road", playerIndex: botIndex, edge };
    }
    // Fallback: try any valid edge connected to our network
    for (const [ek, road] of Object.entries(state.board.edges)) {
      if (road !== null) continue;
      const [v1, v2] = edgeEndpoints(ek);
      for (const v of [v1, v2]) {
        const building = state.board.vertices[v];
        if (building && building.playerIndex === botIndex) {
          return { type: "build-road", playerIndex: botIndex, edge: ek };
        }
        if (building && building.playerIndex !== botIndex) continue;
        const adjEdges = edgesAtVertex(v);
        for (const ae of adjEdges) {
          if (ae !== ek && state.board.edges[ae]?.playerIndex === botIndex) {
            return { type: "build-road", playerIndex: botIndex, edge: ek };
          }
        }
      }
    }
  } else {
    // No network (everything nuked) — place road at best vertex
    let bestEdge: string | null = null;
    let bestScore = -Infinity;
    for (const [ek, road] of Object.entries(state.board.edges)) {
      if (road !== null) continue;
      const [v1, v2] = edgeEndpoints(ek);
      let score = 0;
      for (const v of [v1, v2]) {
        if (state.board.vertices[v] !== null) continue;
        const vs = computeVertexProduction(state, v);
        score += vs.totalEV;
      }
      if (score > bestScore) {
        bestScore = score;
        bestEdge = ek;
      }
    }
    if (bestEdge) {
      return { type: "build-road", playerIndex: botIndex, edge: bestEdge };
    }
  }

  return { type: "end-turn", playerIndex: botIndex };
}

// ============================================================
// Sheep nuke pick
// ============================================================

function makeSheepNukePickAction(state: GameState, botIndex: number, context: BotStrategicContext): GameAction {
  const candidates = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12];
  let bestNumber = candidates[0];
  let bestScore = -Infinity;

  for (const num of candidates) {
    let opponentDamage = 0;
    let selfDamage = 0;

    for (const [hk, hex] of Object.entries(state.board.hexes)) {
      if (hex.number !== num) continue;
      const parsedHex = parseHexKey(hk);
      for (const vk of hexVertices(parsedHex)) {
        const building = state.board.vertices[vk];
        if (!building) continue;
        const vp = building.type === "city" ? 2 : 1;
        if (building.playerIndex === botIndex) selfDamage += vp;
        else opponentDamage += vp;
      }
      for (const ek of hexEdges(parsedHex)) {
        const road = state.board.edges[ek];
        if (!road) continue;
        if (road.playerIndex === botIndex) selfDamage += 0.3;
        else opponentDamage += 0.3;
      }
    }

    const score = opponentDamage - selfDamage * 1.5;
    if (score > bestScore) {
      bestScore = score;
      bestNumber = num;
    }
  }

  return { type: "sheep-nuke-pick", playerIndex: botIndex, number: bestNumber };
}

// ============================================================
// Helpers
// ============================================================

function canAfford(
  player: { resources: Record<Resource, number> },
  cost: Partial<Record<Resource, number>>
): boolean {
  for (const [res, amount] of Object.entries(cost)) {
    if ((amount || 0) > player.resources[res as Resource]) return false;
  }
  return true;
}

function resourceMapsEqual(
  a: Partial<Record<Resource, number>>,
  b: Partial<Record<Resource, number>>,
): boolean {
  for (const r of ALL_RESOURCES) {
    if ((a[r] ?? 0) !== (b[r] ?? 0)) return false;
  }
  return true;
}

// ============================================================
// Trade memory
// ============================================================

const tradeMemory = new Map<string, { tradeHash: string; turn: number; decision: "accept" | "reject" }>();
const proposedTradeMemory = new Map<number, { pairKey: string; rejections: number; turn: number; lastHash: string }>();
const counterOfferMemory = new Map<string, {
  turn: number;
  result: { offering: Partial<Record<Resource, number>>; requesting: Partial<Record<Resource, number>> } | null;
}>();

function getTradeHash(offering: Partial<Record<Resource, number>>, requesting: Partial<Record<Resource, number>>): string {
  const o = ALL_RESOURCES.map((r) => offering[r] ?? 0).join(",");
  const r = ALL_RESOURCES.map((res) => requesting[res] ?? 0).join(",");
  return `${o}|${r}`;
}

// ============================================================
// Counter-offers
// ============================================================

export function generateBotCounterOffer(
  state: GameState,
  botIndex: number
): { offering: Partial<Record<Resource, number>>; requesting: Partial<Record<Resource, number>> } | null {
  const trade = state.pendingTrades.find((t) => t.fromPlayer !== botIndex && (t.toPlayer === null || t.toPlayer === botIndex));
  if (!trade) return null;

  const coTradeHash = getTradeHash(trade.offering, trade.requesting);
  const coMemKey = `${botIndex}-${coTradeHash}`;
  const coMem = counterOfferMemory.get(coMemKey);
  if (coMem && coMem.turn === state.turnNumber) {
    if (coMem.result) {
      const bot = state.players[botIndex];
      const canStillAfford = Object.entries(coMem.result.offering).every(
        ([r, amt]) => (amt || 0) <= bot.resources[r as Resource]
      );
      const stillNeeds = Object.entries(coMem.result.requesting).some(
        ([r, amt]) => (amt || 0) > 0 && bot.resources[r as Resource] < 3
      );
      if (!canStillAfford || !stillNeeds) {
        counterOfferMemory.delete(coMemKey);
        return null;
      }
    }
    return coMem.result;
  }

  function isIdenticalToOriginal(counter: { offering: Partial<Record<Resource, number>>; requesting: Partial<Record<Resource, number>> }): boolean {
    return resourceMapsEqual(counter.offering, trade!.requesting) && resourceMapsEqual(counter.requesting, trade!.offering);
  }

  function generate(): { offering: Partial<Record<Resource, number>>; requesting: Partial<Record<Resource, number>> } | null {
    let counterChance = 0.3;
    try {
      const context = computeStrategicContext(state, botIndex);
      counterChance = context.weights.counterOfferChance;

      const fromVP = state.players[trade!.fromPlayer].victoryPoints;
      if (fromVP >= context.vpToWin - 1) return null;

      if (Math.random() > counterChance) return null;

      const bot = state.players[botIndex];
      const proposer = state.players[trade!.fromPlayer];

      const proposerWants = ALL_RESOURCES.filter((r) => (trade!.requesting[r] ?? 0) > 0);
      const proposerOffering = ALL_RESOURCES.filter((r) => (trade!.offering[r] ?? 0) > 0);

      const canOffer: { res: Resource; surplus: number }[] = [];
      const wants: { res: Resource; urgency: number }[] = [];

      for (const r of ALL_RESOURCES) {
        const have = bot.resources[r];
        const goalNeed = context.buildGoal?.missingResources[r] ?? 0;
        // Also consider settlement plan needs
        const planNeed = context.settlementPlan?.missingResources[r] ?? 0;
        const totalNeed = Math.max(goalNeed, planNeed);
        const spareAfterGoal = have - totalNeed;

        if (spareAfterGoal >= 2) {
          canOffer.push({ res: r, surplus: spareAfterGoal });
        } else if (spareAfterGoal >= 1 && have >= 3) {
          canOffer.push({ res: r, surplus: 1 });
        }

        if (totalNeed > 0 && have < totalNeed) {
          wants.push({ res: r, urgency: totalNeed - have });
        }
      }

      if (wants.length === 0) {
        for (const r of ALL_RESOURCES) {
          if (bot.resources[r] === 0) wants.push({ res: r, urgency: 1 });
        }
      }

      if (canOffer.length === 0 || wants.length === 0) return null;

      const proposerLikelyHas = new Set<Resource>(proposerOffering);
      for (const r of ALL_RESOURCES) {
        if (proposer.resources[r] >= 2) proposerLikelyHas.add(r);
      }

      // Strategy 1: Adjust quantities on original trade
      const canGiveProposerWants = canOffer.filter((c) => proposerWants.includes(c.res));
      const wantFromProposer = wants.filter((w) => proposerOffering.includes(w.res));

      if (canGiveProposerWants.length > 0 && wantFromProposer.length > 0) {
        const give = canGiveProposerWants[Math.floor(Math.random() * canGiveProposerWants.length)];
        const want = wantFromProposer[Math.floor(Math.random() * wantFromProposer.length)];

        const origGiveAmt = trade!.requesting[give.res] ?? 1;
        const origWantAmt = trade!.offering[want.res] ?? 1;

        let giveAmount = Math.max(1, origGiveAmt - 1);
        let wantAmount = origWantAmt;
        if (give.surplus >= 4) giveAmount = origGiveAmt;
        if (Math.random() < 0.3 && proposer.resources[want.res] >= origWantAmt + 1) {
          wantAmount = origWantAmt + 1;
        }

        const counter = { offering: { [give.res]: giveAmount }, requesting: { [want.res]: wantAmount } };
        if (!isIdenticalToOriginal(counter)) return counter;
      }

      // Strategy 2: Give what they want, request different resource
      if (canGiveProposerWants.length > 0) {
        const feasibleWants = wants.filter((w) => proposerLikelyHas.has(w.res));
        const alternativeWants = feasibleWants.filter((w) => !proposerOffering.includes(w.res));
        const wantPool = alternativeWants.length > 0 ? alternativeWants : feasibleWants;

        if (wantPool.length > 0) {
          const give = canGiveProposerWants[Math.floor(Math.random() * canGiveProposerWants.length)];
          const want = wantPool[Math.floor(Math.random() * wantPool.length)];
          if (give.res !== want.res) {
            const counter = { offering: { [give.res]: 1 }, requesting: { [want.res]: 1 } };
            if (!isIdenticalToOriginal(counter)) return counter;
          }
        }
      }

      // Strategy 3: Offer different resource, ask for what they were giving
      if (wantFromProposer.length > 0) {
        const alternativeOffers = canOffer.filter(
          (c) => !proposerWants.includes(c.res) && proposer.resources[c.res] <= 1
        );
        if (alternativeOffers.length > 0) {
          alternativeOffers.sort((a, b) => b.surplus - a.surplus);
          const give = alternativeOffers[0];
          const want = wantFromProposer[Math.floor(Math.random() * wantFromProposer.length)];
          if (give.res !== want.res) {
            const counter = { offering: { [give.res]: 1 }, requesting: { [want.res]: 1 } };
            if (!isIdenticalToOriginal(counter)) return counter;
          }
        }
      }

      return null;
    } catch {
      if (Math.random() > counterChance) return null;

      const bot = state.players[botIndex];
      const proposerOffering = ALL_RESOURCES.filter((r) => (trade!.offering[r] ?? 0) > 0);
      const proposerWants = ALL_RESOURCES.filter((r) => (trade!.requesting[r] ?? 0) > 0);

      const surplusOfWanted = proposerWants.filter((r) => bot.resources[r] > 1);
      const wantFromOffered = proposerOffering.filter((r) => bot.resources[r] <= 1);

      if (surplusOfWanted.length > 0 && wantFromOffered.length > 0) {
        const giveRes = surplusOfWanted[Math.floor(Math.random() * surplusOfWanted.length)];
        const wantRes = wantFromOffered[Math.floor(Math.random() * wantFromOffered.length)];
        if (giveRes !== wantRes) {
          const counter = { offering: { [giveRes]: 1 }, requesting: { [wantRes]: 1 } };
          if (!isIdenticalToOriginal(counter)) return counter;
        }
      }

      return null;
    }
  }

  const result = generate();
  counterOfferMemory.set(coMemKey, { turn: state.turnNumber, result });
  return result;
}

// ============================================================
// Trade response (plan-aware)
// ============================================================

export function decideBotTradeResponse(state: GameState, botIndex: number): "accept" | "reject" {
  const trade = state.pendingTrades.find((t) => t.fromPlayer !== botIndex && (t.toPlayer === null || t.toPlayer === botIndex));
  if (!trade) return "reject";
  if (trade.fromPlayer === botIndex) return "reject";
  if (trade.toPlayer !== null && trade.toPlayer !== botIndex) return "reject";

  const bot = state.players[botIndex];

  // Can we afford it?
  for (const [res, amount] of Object.entries(trade.requesting)) {
    if ((amount || 0) > bot.resources[res as Resource]) {
      return "reject";
    }
  }

  // Check memory
  const memKey = `${botIndex}`;
  const tradeHash = getTradeHash(trade.offering, trade.requesting);
  const mem = tradeMemory.get(memKey);
  if (mem && mem.tradeHash === tradeHash && state.turnNumber - mem.turn < 5) {
    return mem.decision;
  }

  let context: BotStrategicContext | undefined;
  try {
    context = computeStrategicContext(state, botIndex);
  } catch {
    // Fallback
  }

  // Hard reject: never trade with someone about to win
  if (context) {
    const fromVP = state.players[trade.fromPlayer].victoryPoints;
    if (fromVP >= context.vpToWin - 1) {
      tradeMemory.set(memKey, { tradeHash, turn: state.turnNumber, decision: "reject" });
      return "reject";
    }
  }

  // Score the trade
  let score = 0;
  let totalGiving = 0;
  let totalGaining = 0;
  for (const amount of Object.values(trade.requesting)) totalGiving += (amount || 0);
  for (const amount of Object.values(trade.offering)) totalGaining += (amount || 0);

  const generosity = totalGaining - totalGiving;
  score += generosity * 2;

  // Score what we're gaining (plan-aware)
  for (const [res, amount] of Object.entries(trade.offering)) {
    const amt = amount || 0;
    if (amt === 0) continue;
    const r = res as Resource;

    // Check if this resource advances our plan
    const planNeed = context?.settlementPlan?.missingResources[r] ?? 0;
    const goalNeed = context?.buildGoal?.missingResources[r] ?? 0;
    const totalNeed = Math.max(planNeed, goalNeed);

    if (totalNeed > 0) {
      score += Math.min(amt, totalNeed) * 3.5; // High value — advances our plan
      if (amt > totalNeed) score += (amt - totalNeed) * 0.5;
    } else if (bot.resources[r] === 0) {
      score += amt * 1.5; // Resource we don't have
    } else {
      score += amt * 0.3; // Surplus
    }
  }

  // Score what we're giving away (plan-aware)
  for (const [res, amount] of Object.entries(trade.requesting)) {
    const amt = amount || 0;
    if (amt === 0) continue;
    const r = res as Resource;

    const planNeed = context?.settlementPlan?.missingResources[r] ?? 0;
    const goalNeed = context?.buildGoal?.missingResources[r] ?? 0;
    const totalNeed = Math.max(planNeed, goalNeed);
    const have = bot.resources[r];

    if (totalNeed > 0 && have - amt < totalNeed) {
      score -= amt * 3.5; // Giving away plan resources!
    } else if (have - amt >= 2) {
      score -= amt * 0.3;
    } else if (have - amt >= 1) {
      score -= amt * 1;
    } else {
      score -= amt * 1.5;
    }
  }

  // VP penalty for trading with leaders
  if (context) {
    const fromVP = state.players[trade.fromPlayer].victoryPoints;
    const botVP = context.ownVP;
    if (fromVP >= botVP + 2) score -= 2;
    else if (fromVP >= botVP + 1) score -= 0.5;
  }

  const threshold = context?.weights.tradeAcceptThreshold ?? 0;
  const decision = score > threshold ? "accept" : "reject";

  tradeMemory.set(memKey, { tradeHash, turn: state.turnNumber, decision });
  return decision;
}
