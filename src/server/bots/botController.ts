import type { GameState, Resource } from "@/shared/types/game";
import type { GameAction } from "@/shared/types/actions";
import { pickSetupVertex, pickSetupRoad, pickBuildVertex, computeVertexProduction } from "./strategy/placement";
import { pickBuildRoad, planRoadPath } from "./strategy/roads";
import { pickBankTrade, pickPlayerTrade } from "./strategy/trading";
import { pickRobberHex, pickStealTarget, pickDiscardResources } from "./strategy/robber";
import { pickDevCardToPlay } from "./strategy/devCards";
import { computeStrategicContext, type BotStrategicContext } from "./strategy/context";
import { BUILDING_COSTS, ALL_RESOURCES, NUMBER_DOTS } from "@/shared/constants";
import { calculateLongestRoad } from "@/server/engine/longestRoad";
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
  pruneTradeMemory(state.turnNumber);

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
      // These turn phases are defined in the type but never set by the engine.
      // Monopoly and Year of Plenty resolve immediately during trade-or-build/roll.
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

/**
 * Pre-roll decision: play a knight (or other dev card) before rolling dice.
 *
 * Theory: "Play knights BEFORE rolling — you can move the robber off your hex
 * before seeing what produces. This is almost always better than playing after."
 *
 * Key heuristics:
 * - Robber on our hex → always play knight (unblock production before rolling)
 * - 1 knight from army → always play (guaranteed +2 VP)
 * - Robber on a high-EV hex of ours → strongly prefer pre-roll knight
 * - General army pursuit → play with scaling probability
 */
function makeRollOrPlayDevCard(state: GameState, botIndex: number, context: BotStrategicContext): GameAction {
  const player = state.players[botIndex];
  if (!player.hasPlayedDevCardThisTurn && player.developmentCards.includes("knight")) {
    let playProb = 0.3 * context.weights.knightEagerness;

    // Win check: if playing knight gives us largest army and wins the game
    const vpNeeded = context.vpToWin - context.ownVP;
    if (vpNeeded <= 2 && context.distanceToLargestArmy === 1) {
      return { type: "play-knight", playerIndex: botIndex }; // guaranteed win — always play
    }

    // Robber on our hex: ALWAYS play pre-roll to unblock production
    // Theory: playing before roll means your hex produces THIS turn instead of being blocked
    const robberOnOurHex = isRobberOnOurHex(state, botIndex);
    if (robberOnOurHex) {
      // Calculate how much production we're losing
      const robberHex = state.board.hexes[state.board.robberHex];
      const blockedDots = robberHex?.number ? (NUMBER_DOTS[robberHex.number] || 0) : 0;
      if (blockedDots >= 3) {
        return { type: "play-knight", playerIndex: botIndex }; // high-value hex blocked — play now
      }
      playProb = Math.max(playProb, 0.9); // even low-value hex, still strong incentive
    }

    // Army pursuit: scale probability by distance
    if (context.distanceToLargestArmy <= 1) {
      playProb = Math.min(1, 0.95 * context.weights.knightEagerness); // +2 VP is huge
    } else if (context.distanceToLargestArmy <= 2) {
      playProb = Math.min(1, 0.7 * context.weights.knightEagerness);
    } else if (context.distanceToLargestArmy <= 3) {
      playProb = Math.min(1, 0.5 * context.weights.knightEagerness);
    }

    // Army defense: if we hold army and someone is close, play to extend lead
    if (context.distanceToLargestArmy === 0 && context.largestArmyThreatened) {
      playProb = Math.max(playProb, 0.85);
    }

    // Endgame: always play knights (VP from army + robber control)
    if (context.isEndgame) playProb = Math.max(playProb, 0.9);

    // Pre-roll advantage: even without specific urgency, playing knight pre-roll
    // is better because you control the robber before production happens
    if (context.playerThreats.length > 0) {
      const leader = context.playerThreats[0];
      // If leader has a high-production hex, we can block it before they collect
      if (leader.totalProduction > 2) playProb += 0.1;
    }

    if (Math.random() < Math.min(1, playProb)) {
      return { type: "play-knight", playerIndex: botIndex };
    }
  }

  return { type: "roll-dice", playerIndex: botIndex };
}

/** Check if the robber is on a hex adjacent to any of our settlements/cities */
function isRobberOnOurHex(state: GameState, botIndex: number): boolean {
  const robberHex = state.board.robberHex;
  const hex = state.board.hexes[robberHex];
  if (!hex) return false;
  const verts = hexVertices(hex.coord);
  return verts.some((vk) => {
    const b = state.board.vertices[vk];
    return b !== null && b !== undefined && b.playerIndex === botIndex;
  });
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

  // === WIN-THIS-TURN DETECTION ===
  // Research: "Work backwards from winning." Check if we can win RIGHT NOW.
  const winAction = checkWinningMove(state, botIndex, context);
  if (winAction) return winAction;

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

  // 4. Re-evaluate: after trading failed, check if any lower-priority action makes sense.
  // Theory: "If you can't execute your plan, don't just hoard — find SOMETHING productive."
  // This catches cases where bank trading unlocked resources on a previous call,
  // or where a secondary action (like a dev card) is better than ending turn empty-handed.
  if (actions.length > 0) {
    // Check if there's a dev card we should buy (even if it wasn't top priority)
    const devCardAction = actions.find(a => a.name === "devCard" && a.score > 40);
    if (devCardAction) {
      const result = devCardAction.execute();
      if (result) return result;
    }
  }

  // 5. Nothing useful to do — END TURN and save resources
  return { type: "end-turn", playerIndex: botIndex };
}

interface ScoredAction {
  name: string;
  score: number;
  execute: () => GameAction | null;
}

/**
 * Score all possible build actions based on game phase, opponent foresight,
 * race urgency, and Catan theory principles.
 *
 * Core philosophy:
 * - Cities are VP-efficient but settlements grab territory. Priority depends on CONTEXT.
 * - If opponents race toward a good spot → grab it before upgrading cities.
 * - If board is open / no pressure → cities first (they double production).
 * - Roads ONLY serve a purpose (reaching a settlement, finishing longest road).
 * - Dev cards are consistently strong mid/late game (winners buy 3-4 per game).
 * - Spend resources to avoid robber risk; don't hoard.
 */
function evaluateActions(state: GameState, botIndex: number, context: BotStrategicContext): ScoredAction[] {
  const player = state.players[botIndex];
  const actions: ScoredAction[] = [];
  const plan = context.settlementPlan;
  const totalHand = Object.values(player.resources).reduce((s, n) => s + n, 0);
  const totalBuildings = player.settlements.length + player.cities.length;

  // 7-card management: if we have 7+ cards, we're at risk of losing half on a 7.
  // Boost all affordable actions to encourage spending rather than hoarding.
  const robberRiskBonus = totalHand >= 7 ? Math.min(50, (totalHand - 6) * 12) : 0;

  // === GAME PHASE ===
  // Early: building foundations (≤3 buildings), Mid: engine running, Late: racing to win
  const phase: "early" | "mid" | "late" =
    totalBuildings <= 3 ? "early" :
    context.ownVP >= context.vpToWin - 3 ? "late" : "mid";

  // === RACE / FORESIGHT DETECTION ===
  // Analyze opponents to determine if we're in a race for settlement spots.
  // This drives the city-vs-settlement priority dynamically.
  const raceUrgency = computeRaceUrgency(plan, context, state, botIndex);

  // === OPPONENT FORESIGHT ===
  // What are opponents likely to do? This affects our priorities.
  const leaderEstVP = context.playerThreats.length > 0 ? context.playerThreats[0].estimatedVP : 0;
  const leaderMomentum = context.playerThreats.length > 0 ? context.playerThreats[0].momentum : 0;
  // Are we behind the leader? If so, we need to be more aggressive about expansion.
  const vpBehindLeader = leaderEstVP - context.ownVP;
  const behindPressure = vpBehindLeader >= 2 ? Math.min(30, vpBehindLeader * 8) : 0;

  // --- SETTLEMENT (1 VP + new production + territory control) ---
  if (canAfford(player, BUILDING_COSTS.settlement)) {
    // Check if the plan's target vertex is directly reachable (0 roads needed)
    if (plan && plan.roadPath.length === 0) {
      const prod = computeVertexProduction(state, plan.targetVertex);
      let score = 170 + prod.totalEV * 80;

      // Quality gate: don't settle on terrible vertices (3/11/desert-adjacent)
      if (prod.totalEV < 0.25) score -= 120; // heavily penalize garbage spots
      else if (prod.totalEV < 0.4) score -= 40; // mildly penalize mediocre spots

      // RACE URGENCY: if opponents are heading toward this spot, grab it NOW
      // "I have to make sure I get to my spots before I settle down and make cities"
      if (plan.contested) score += 35 + raceUrgency * 70;

      // Early game: settlements are crucial for production diversity
      if (phase === "early") score += 25;

      // Late game: any VP counts
      if (phase === "late") score += 40;

      // Behind the leader: need to expand faster
      score += behindPressure;

      // Does this settlement fill a production gap? (covers missing resources)
      const gapBonus = computeProductionGapBonus(state, plan.targetVertex, context);
      score += gapBonus;

      score += robberRiskBonus;
      actions.push({
        name: "settlement-plan",
        score,
        execute: () => ({ type: "build-settlement", playerIndex: botIndex, vertex: plan.targetVertex }),
      });
    }

    // Opportunistic settlement (pickBuildVertex found something not in our plan)
    const vertex = pickBuildVertex(state, botIndex);
    if (vertex && (!plan || vertex !== plan.targetVertex)) {
      const prod = computeVertexProduction(state, vertex);
      let score = 150 + prod.totalEV * 70;

      // Quality gate
      if (prod.totalEV < 0.25) score -= 120;
      else if (prod.totalEV < 0.4) score -= 40;

      if (phase === "late") score += 40;
      score += behindPressure * 0.5;
      score += robberRiskBonus;
      actions.push({
        name: "settlement-opportunistic",
        score,
        execute: () => ({ type: "build-settlement", playerIndex: botIndex, vertex }),
      });
    }
  }

  // --- CITY (1 VP + doubled production) ---
  // Cities are the most VP-efficient action WHEN there's no race pressure.
  // But if opponents threaten our settlement targets, territory comes first.
  if (canAfford(player, BUILDING_COSTS.city) && context.cityPlan) {
    const cp = context.cityPlan;
    let score = 220 + cp.score * 80;

    if (context.strategy === "cities") score += 20;

    // Late game: guaranteed VP, very strong
    if (phase === "late") score += 50;

    // If no settlement plan or it needs roads, city is the clear best action
    if (!plan || plan.roadPath.length > 0) score += 20;

    // === RACE CONTEXT ===
    // If we're in a race for a settlement spot AND can afford to settle NOW,
    // the city should yield priority. Territory first, upgrade later.
    if (raceUrgency > 0.4 && plan && plan.roadPath.length === 0 && canAfford(player, BUILDING_COSTS.settlement)) {
      // Scale the penalty by how urgent the race is
      score -= 30 + raceUrgency * 50;
    }

    // Early game: prefer getting to 3 buildings before cities (diversify production)
    // But only if a quality settlement is immediately reachable
    if (phase === "early" && plan && plan.roadPath.length === 0 && canAfford(player, BUILDING_COSTS.settlement)) {
      const planProd = computeVertexProduction(state, plan.targetVertex);
      if (planProd.totalEV >= 0.4) { // only defer city for a good settlement
        score -= 30;
      }
    }

    // Behind the leader with few buildings: expand don't upgrade
    if (vpBehindLeader >= 3 && totalBuildings <= 3) {
      score -= 20;
    }

    score += robberRiskBonus;
    actions.push({
      name: "city",
      score,
      execute: () => ({ type: "build-city", playerIndex: botIndex, vertex: cp.vertex }),
    });
  }

  // --- ROAD (ONLY if purposeful: plan path or longest road finish/defense) ---
  if (canAfford(player, BUILDING_COSTS.road) && player.roads.length < 15) {
    // Plan roads: build toward a settlement destination
    if (plan && plan.roadPath.length > 0) {
      const nextRoad = plan.roadPath[0];
      if (state.board.edges[nextRoad] === null) {
        let score = 55; // base lower than cities/settlements — roads aren't VP

        // Score based on destination quality
        const destProd = computeVertexProduction(state, plan.targetVertex);
        score += plan.vertexScore * 0.25;

        // Quality gate: if destination is bad, don't invest roads toward it
        if (destProd.totalEV < 0.3) score -= 40;

        // Contested destination: build roads faster to race there
        if (plan.contested) score += 25 + raceUrgency * 45;

        // Last road before we can settle: very valuable (unlocks the VP)
        if (plan.roadPath.length === 1) score += 40;
        // Second-to-last road is also meaningful
        else if (plan.roadPath.length === 2) score += 15;

        // Long plan with many missing resources: consider saving instead
        if (plan.roadPath.length > 2 && plan.totalMissing > 4) {
          score -= 20;
        }

        // 7-card risk: spend on plan road rather than lose cards
        score += robberRiskBonus * 0.4;

        // Diminishing returns on many roads
        if (player.roads.length >= 10) score -= 20;
        if (player.roads.length >= 12) score -= 30;

        // Early game with no urgency: save for settlements/cities instead
        if (phase === "early" && !plan.contested && plan.roadPath.length > 1) {
          score -= 15;
        }

        actions.push({
          name: "road-plan",
          score,
          execute: () => ({ type: "build-road", playerIndex: botIndex, edge: nextRoad }),
        });
      }
    }

    // Longest road pursuit — ONLY as finishing move or active defense
    // Theory: "Don't go out of your way for longest road early/mid game.
    // Building settlements and cities creates a more sustainable road network."
    const shouldPursueLongestRoad =
      context.distanceToLongestRoad === 0 ? context.longestRoadThreatened : // defend only if threatened
      context.distanceToLongestRoad <= 1 ? true : // 1 road = +2 VP, always worth it
      // 2 away: only in late game as a finishing move
      context.distanceToLongestRoad <= 2 && phase === "late" && context.vpPaths.longestRoad > 0;

    if (shouldPursueLongestRoad && player.roads.length < 13) {
      const edge = pickBuildRoad(state, botIndex, context);
      if (edge) {
        const isOnPlan = plan?.roadPath.includes(edge);
        if (!isOnPlan) {
          let score = 0;
          if (context.distanceToLongestRoad === 0) {
            score = context.longestRoadThreatened ? 150 : 0; // only defend if threatened
          } else if (context.distanceToLongestRoad <= 1) {
            // +2 VP for 1 road is efficient, but even more so as a finisher
            score = phase === "late" ? 170 : 110;
          } else if (context.distanceToLongestRoad <= 2) {
            score = 70; // only reachable in late game (gated above)
          }

          if (context.longestRoadThreatened) score += 30;
          score += robberRiskBonus * 0.3;

          if (player.roads.length >= 10) score -= 25;

          if (score > 0) {
            actions.push({
              name: "road-longest",
              score,
              execute: () => ({ type: "build-road", playerIndex: botIndex, edge }),
            });
          }
        }
      }
    }
  }

  // --- DEV CARD (speculative VP + army progress) ---
  // Theory: winners buy 3-4 dev cards per game. Knights provide robber control,
  // VP cards are hidden finishers, and the army bonus is +2 VP.
  if (canAfford(player, BUILDING_COSTS.developmentCard) && state.developmentCardDeck.length > 0) {
    let score = 65; // boosted base (theory: consistently valuable)

    // === "City before dev cards" rule ===
    // Cities double your income, making future purchases easier.
    if (player.cities.length === 0 && player.settlements.length > 0) {
      score -= 25;
    }

    // Army pursuit: dev deck is ~56% knights. If 1 knight from army = +2 VP,
    // expected value of buying = 0.56 * 2 VP = 1.12 VP. That's huge.
    const knightsInHand = player.developmentCards.filter(c => c === "knight").length;
    const totalKnightsNeeded = context.distanceToLargestArmy;

    if (totalKnightsNeeded <= 1 && knightsInHand === 0) {
      score += 80;
    } else if (totalKnightsNeeded <= 1 && knightsInHand >= 1) {
      score += 20;
    } else if (totalKnightsNeeded <= 2) {
      score += 50;
    } else if (totalKnightsNeeded <= 3) {
      score += 25;
    }

    if (context.largestArmyThreatened) score += 35;
    if (context.strategy === "development") score += 20;

    // VP path integration: army is part of our win plan
    if (context.vpPaths.largestArmy > 0 && totalKnightsNeeded <= 3) {
      score += 25;
    }

    // Late game: VP cards in deck can be game-ending
    if (phase === "late") {
      score += Math.min(35, state.developmentCardDeck.length * 3);
    }

    // Mid-game with good production: dev cards provide army control + hidden VP
    if (phase === "mid" && context.totalProduction > 1.5) {
      score += 10;
    }

    // Don't buy if we're about to settle (1-2 resources from completing the plan)
    if (plan && plan.totalMissing <= 2 && plan.roadPath.length === 0) {
      score -= 50;
    }

    // === Opponent foresight: if an opponent is close to army, we should contest ===
    const opponentArmyThreat = context.playerThreats.some(
      t => t.knightsPlayed >= 2 && t.devCardCount >= 1
    );
    if (opponentArmyThreat && context.ownKnightsPlayed >= 1) {
      score += 15; // contest the army race
    }

    // 7-card risk: dev card costs 3 resources, helps reduce hand
    score += robberRiskBonus * 0.7;

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

/**
 * Determine how urgently we need to race for settlement spots vs. playing it safe.
 * Returns 0 (no race) to 1 (must grab spot immediately).
 *
 * Considers:
 * - Whether our planned settlement vertex is contested (opponent roads nearby)
 * - Opponent expansion capability (brick+lumber production = they expand fast)
 * - Opponent momentum (high momentum = they'll reach spots sooner)
 * - Board crowding (spatial urgency)
 * - How many good spots remain on the board
 */
function computeRaceUrgency(
  plan: BotStrategicContext["settlementPlan"],
  context: BotStrategicContext,
  state: GameState,
  botIndex: number,
): number {
  if (!plan) return context.spatialUrgency * 0.4; // general board pressure

  let urgency = 0;

  // === OPPONENT PROXIMITY ===
  // How close is the nearest opponent to our target? This is the #1 race signal.
  if (plan.contested) {
    if (plan.opponentDistance <= 1) {
      // Opponent road is RIGHT NEXT to our target — critical urgency
      urgency += 0.6;
    } else if (plan.opponentDistance <= 2) {
      // Opponent is 1 vertex away — high urgency
      urgency += 0.4;
    } else {
      urgency += 0.2; // contested but not immediately threatening
    }
  }

  // === OPPONENT FORESIGHT ===
  // Analyze each opponent's capability and intent
  for (const threat of context.playerThreats) {
    // Opponents producing brick+lumber can build roads toward our spots
    const expansionRate = Math.min(threat.productionRates.brick, threat.productionRates.lumber);
    if (expansionRate > 0.15) urgency += 0.08;

    // High-momentum opponents build faster — more likely to snipe spots
    if (threat.momentum > 2.5) urgency += 0.08;

    // Opponent close to winning will grab any good spot to close out
    if (threat.estimatedVP >= context.vpToWin - 2) urgency += 0.1;

    // Opponent has all 4 settlement resources = can settle any time
    const canSettle = threat.productionRates.brick > 0 && threat.productionRates.lumber > 0 &&
      threat.productionRates.grain > 0 && threat.productionRates.wool > 0;
    if (canSettle && threat.upgradeableSettlements < 3) urgency += 0.05; // they want more settlements
  }

  // === BOARD PRESSURE ===
  // Fewer open spots = every spot is more valuable = more competition
  urgency += context.spatialUrgency * 0.25;

  // === OUR READINESS ===
  // If we can settle NOW (0 roads, affordable), the race is winnable — boost urgency
  // If we need 3 roads first, the "race" is less about urgency and more about pivoting
  if (plan.roadPath.length === 0) {
    urgency += 0.05; // we can act immediately
  } else if (plan.roadPath.length >= 3) {
    urgency -= 0.15; // long way to go — maybe pick a different spot
  }

  // If we have good alternatives, urgency drops (we can pivot if we lose this race)
  if (context.alternativePlans.length >= 2) urgency -= 0.08;

  return Math.max(0, Math.min(1, urgency));
}

/**
 * Bonus for settling a vertex that fills a gap in our production.
 * In Catan, covering many different numbers/resources is better than
 * stacking on few. A settlement that gives us ore when we have none
 * is worth much more than another brick source.
 */
function computeProductionGapBonus(
  state: GameState,
  vertex: string,
  context: BotStrategicContext,
): number {
  const prod = computeVertexProduction(state, vertex);
  let bonus = 0;

  // Bonus for each resource we don't currently produce
  for (const res of ALL_RESOURCES) {
    if (context.productionRates[res] < 0.05 && prod.perResource[res] > 0) {
      // Filling a missing resource is very valuable
      bonus += 15;
      // Extra bonus for strategically important resources
      if (res === "ore" || res === "grain") bonus += 8; // city resources
    }
  }

  // Bonus for number diversity (covering numbers we don't have)
  // This is implicit in the vertex scoring but worth a small extra nudge
  if (context.missingResources.length >= 2 && prod.totalEV > 0.3) {
    bonus += 5;
  }

  return bonus;
}

function evaluateNukeDesirability(state: GameState, botIndex: number, context: BotStrategicContext): number {
  const leader = context.playerThreats[0];
  // Use estimatedVP to detect the true leader, not just visible points
  const leaderVP = leader?.estimatedVP ?? 0;
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

/**
 * Check if the bot can win the game THIS TURN.
 * Research: "Always think about what wins the game. Work from back to front."
 *
 * Checks (in order of priority):
 * 1. Building a settlement or city that reaches VP target
 * 2. Buying a dev card when we have hidden VP cards that push us over
 * 3. Playing a knight that gives us largest army for the win
 */
/**
 * Check if the bot can win the game THIS TURN — including multi-action sequences.
 * Theory: "Finish with a bang" — chain actions on the winning turn so opponents
 * can't react (e.g., road building → settle → city all in one turn).
 *
 * Priority order:
 * 1. Single-action wins (city, settlement, knight for army)
 * 2. Two-action wins (settlement + city, road + longest road)
 * 3. Dev card combos (road building → settle, year of plenty → build)
 * 4. Road for longest road finisher
 */
function checkWinningMove(state: GameState, botIndex: number, context: BotStrategicContext): GameAction | null {
  const player = state.players[botIndex];
  const vpNeeded = context.vpToWin - context.ownVP;

  if (vpNeeded <= 0) return null; // already won (shouldn't happen)

  // --- Can we win by building a city? (1 VP) ---
  if (vpNeeded === 1 && canAfford(player, BUILDING_COSTS.city) && context.cityPlan) {
    return { type: "build-city", playerIndex: botIndex, vertex: context.cityPlan.vertex };
  }

  // --- Can we win by building a settlement? (1 VP) ---
  if (vpNeeded === 1 && canAfford(player, BUILDING_COSTS.settlement)) {
    const plan = context.settlementPlan;
    if (plan && plan.roadPath.length === 0) {
      return { type: "build-settlement", playerIndex: botIndex, vertex: plan.targetVertex };
    }
    const vertex = pickBuildVertex(state, botIndex);
    if (vertex) {
      return { type: "build-settlement", playerIndex: botIndex, vertex };
    }
  }

  // --- Can we win by playing a knight for largest army? (2 VP) ---
  if (vpNeeded <= 2 && !player.hasPlayedDevCardThisTurn && player.developmentCards.includes("knight")) {
    if (context.distanceToLargestArmy === 1) {
      return { type: "play-knight", playerIndex: botIndex };
    }
  }

  // --- Can we win with settlement + city combo? (2 VP) ---
  if (vpNeeded === 2 && canAfford(player, BUILDING_COSTS.settlement) && canAfford(player, BUILDING_COSTS.city)) {
    const combinedCost: Partial<Record<Resource, number>> = {};
    for (const [r, a] of Object.entries(BUILDING_COSTS.settlement)) {
      combinedCost[r as Resource] = (combinedCost[r as Resource] || 0) + (a || 0);
    }
    for (const [r, a] of Object.entries(BUILDING_COSTS.city)) {
      combinedCost[r as Resource] = (combinedCost[r as Resource] || 0) + (a || 0);
    }
    if (canAfford(player, combinedCost)) {
      const plan = context.settlementPlan;
      if (plan && plan.roadPath.length === 0) {
        return { type: "build-settlement", playerIndex: botIndex, vertex: plan.targetVertex };
      }
      const vertex = pickBuildVertex(state, botIndex);
      if (vertex) {
        return { type: "build-settlement", playerIndex: botIndex, vertex };
      }
    }
  }

  // --- Road building dev card → settle combo (3 VP potential) ---
  // Theory: "Finish with a bang" — play road building to reach a settlement spot
  // in the same turn, then settle for the win.
  if (vpNeeded <= 1 && !player.hasPlayedDevCardThisTurn && player.developmentCards.includes("roadBuilding")) {
    const plan = context.settlementPlan;
    // Road building gives 2 free roads. If plan needs 1-2 roads and we can afford settlement:
    if (plan && plan.roadPath.length >= 1 && plan.roadPath.length <= 2 &&
        canAfford(player, BUILDING_COSTS.settlement)) {
      // Play road building first — it will lead to the settlement spot
      return { type: "play-road-building", playerIndex: botIndex };
    }
  }

  // --- Road building for longest road finisher (2 VP) ---
  if (vpNeeded <= 2 && !player.hasPlayedDevCardThisTurn && player.developmentCards.includes("roadBuilding")) {
    if (context.distanceToLongestRoad <= 2) {
      return { type: "play-road-building", playerIndex: botIndex };
    }
  }

  // --- Year of Plenty to complete a winning build ---
  if (!player.hasPlayedDevCardThisTurn && player.developmentCards.includes("yearOfPlenty")) {
    // Check if year of plenty + existing resources = enough to build a winning city
    if (vpNeeded === 1 && context.cityPlan && context.cityPlan.totalMissing <= 2) {
      const missing = context.cityPlan.missingResources;
      const missingRes = Object.entries(missing).filter(([, amt]) => (amt || 0) > 0).map(([r]) => r as Resource);
      if (missingRes.length > 0) {
        return {
          type: "play-year-of-plenty",
          playerIndex: botIndex,
          resource1: missingRes[0],
          resource2: missingRes.length > 1 ? missingRes[1] : missingRes[0],
        };
      }
    }
    // Check if year of plenty completes a winning settlement
    if (vpNeeded === 1 && context.settlementPlan && context.settlementPlan.roadPath.length === 0 &&
        context.settlementPlan.totalMissing <= 2) {
      const missing = context.settlementPlan.missingResources;
      const missingRes = Object.entries(missing).filter(([, amt]) => (amt || 0) > 0).map(([r]) => r as Resource);
      if (missingRes.length > 0) {
        return {
          type: "play-year-of-plenty",
          playerIndex: botIndex,
          resource1: missingRes[0],
          resource2: missingRes.length > 1 ? missingRes[1] : missingRes[0],
        };
      }
    }
  }

  // --- Can we win by building road for longest road? (2 VP) ---
  if (vpNeeded <= 2 && context.distanceToLongestRoad === 1 && canAfford(player, BUILDING_COSTS.road)) {
    const edge = pickBuildRoad(state, botIndex, context);
    if (edge) {
      const simPlayers = state.players.map((p, i) =>
        i === botIndex ? { ...p, roads: [...p.roads, edge] } : p
      );
      const simEdges = { ...state.board.edges, [edge]: { playerIndex: botIndex } };
      const simState = { ...state, players: simPlayers, board: { ...state.board, edges: simEdges } } as GameState;
      const newLength = calculateLongestRoad(simState, botIndex);
      const currentHolder = state.longestRoadHolder;
      const currentBest = currentHolder !== null ? calculateLongestRoad(state, currentHolder) : 0;

      if (newLength >= 5 && (currentHolder === null || newLength > currentBest || currentHolder === botIndex)) {
        return { type: "build-road", playerIndex: botIndex, edge };
      }
    }
  }

  // --- Monopoly for winning resources ---
  // If monopoly could grab the 1-2 resources needed to build a winning piece
  if (!player.hasPlayedDevCardThisTurn && player.developmentCards.includes("monopoly")) {
    if (vpNeeded === 1) {
      // Check if monopoly on a specific resource completes a city or settlement
      for (const res of ALL_RESOURCES) {
        let totalOppCards = 0;
        for (let i = 0; i < state.players.length; i++) {
          if (i === botIndex) continue;
          totalOppCards += state.players[i].resources[res];
        }
        if (totalOppCards === 0) continue;

        // Simulate having all of that resource
        const simResources = { ...player.resources };
        simResources[res] += totalOppCards;
        const simPlayer = { ...player, resources: simResources };

        // Would this let us build a city?
        if (context.cityPlan && canAfford(simPlayer, BUILDING_COSTS.city)) {
          return { type: "play-monopoly", playerIndex: botIndex, resource: res };
        }
        // Would this let us build a settlement?
        if (context.settlementPlan?.roadPath.length === 0 && canAfford(simPlayer, BUILDING_COSTS.settlement)) {
          return { type: "play-monopoly", playerIndex: botIndex, resource: res };
        }
      }
    }
  }

  return null;
}

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

/** Prune old entries from trade memory maps to prevent unbounded growth */
function pruneTradeMemory(currentTurn: number): void {
  // Only prune every 10 turns to avoid overhead
  if (currentTurn % 10 !== 0) return;
  for (const [key, mem] of tradeMemory) {
    if (currentTurn - mem.turn > 10) tradeMemory.delete(key);
  }
  for (const [key, mem] of proposedTradeMemory) {
    if (currentTurn - mem.turn > 10) proposedTradeMemory.delete(key);
  }
  for (const [key, mem] of counterOfferMemory) {
    if (currentTurn - mem.turn > 10) counterOfferMemory.delete(key);
  }
}

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

      // Use estimatedVP — catch players with hidden VP cards near winning
      const fromThreat = context.playerThreats.find((t) => t.playerIndex === trade!.fromPlayer);
      const fromEstVP = fromThreat?.estimatedVP ?? state.players[trade!.fromPlayer].victoryPoints;
      if (fromEstVP >= context.vpToWin - 1) return null;

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

  // Check memory (keyed by bot+opponent pair so memory is per-relationship)
  const memKey = `${botIndex}-${trade.fromPlayer}`;
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
  // Use estimatedVP to catch players with hidden VP cards
  if (context) {
    const fromThreat = context.playerThreats.find((t) => t.playerIndex === trade.fromPlayer);
    const fromEstimatedVP = fromThreat?.estimatedVP ?? state.players[trade.fromPlayer].victoryPoints;
    if (fromEstimatedVP >= context.vpToWin - 1) {
      tradeMemory.set(memKey, { tradeHash, turn: state.turnNumber, decision: "reject" });
      return "reject";
    }

    // Also reject if the LEADER is 1 VP from winning (don't help them)
    // But still allow trades with non-leaders to avoid completely freezing the game
    const leaderThreat = context.playerThreats[0];
    if (leaderThreat && leaderThreat.playerIndex === trade.fromPlayer && leaderThreat.estimatedVP >= context.vpToWin - 1) {
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

  // VP penalty for trading with leaders — use estimatedVP for true leader detection
  if (context) {
    const fromThreat = context.playerThreats.find((t) => t.playerIndex === trade.fromPlayer);
    const fromVP = fromThreat?.estimatedVP ?? state.players[trade.fromPlayer].victoryPoints;
    const botVP = context.ownVP;
    if (fromVP >= botVP + 2) score -= 2;
    else if (fromVP >= botVP + 1) score -= 0.5;

    // === OPPONENT BUILD COMPLETION CHECK ===
    // Theory: "Don't give opponents resources that complete a build for them"
    // If this trade gives them the last 1-2 resources for a city/settlement, hard penalty.
    if (fromThreat) {
      const opponent = state.players[trade.fromPlayer];
      // Simulate what opponent would have after the trade
      const simResources: Record<Resource, number> = { ...opponent.resources } as Record<Resource, number>;
      for (const [res, amt] of Object.entries(trade.offering)) {
        simResources[res as Resource] -= (amt || 0); // they give these away
      }
      for (const [res, amt] of Object.entries(trade.requesting)) {
        simResources[res as Resource] += (amt || 0); // they receive these
      }

      // Check if the trade completes a city for them
      if (opponent.settlements.length > 0) {
        const canCityBefore = opponent.resources.ore >= 3 && opponent.resources.grain >= 2;
        const canCityAfter = simResources.ore >= 3 && simResources.grain >= 2;
        if (!canCityBefore && canCityAfter) {
          score -= 4; // this trade hands them a city (+1 VP)
        }
      }
      // Check if the trade completes a settlement
      const canSettleBefore = opponent.resources.brick >= 1 && opponent.resources.lumber >= 1 &&
        opponent.resources.grain >= 1 && opponent.resources.wool >= 1;
      const canSettleAfter = simResources.brick >= 1 && simResources.lumber >= 1 &&
        simResources.grain >= 1 && simResources.wool >= 1;
      if (!canSettleBefore && canSettleAfter) {
        score -= 3; // hands them a settlement
      }
      // Check if trade completes a dev card purchase
      const canDevBefore = opponent.resources.ore >= 1 && opponent.resources.grain >= 1 && opponent.resources.wool >= 1;
      const canDevAfter = simResources.ore >= 1 && simResources.grain >= 1 && simResources.wool >= 1;
      if (!canDevBefore && canDevAfter && fromVP >= botVP) {
        score -= 2; // hands them a dev card (potential hidden VP)
      }
    }

    // Momentum penalty: don't help players accelerating faster than us
    // Strengthened: high-momentum leaders get harder rejection
    if (fromThreat && fromThreat.momentum > 1.5) {
      score -= fromThreat.momentum * 0.5;
      // Hard gate: don't trade with high-momentum leaders within 3 VP of winning
      if (fromThreat.momentum > 2.5 && fromVP >= context.vpToWin - 3) {
        score -= 3;
      }
    }

    // === Trade timing awareness ===
    // Research: "Trading on your turn benefits you more — you can use resources immediately."
    // When it's the opponent's turn, they benefit more from the trade. Be pickier.
    if (state.currentPlayerIndex === trade.fromPlayer) {
      // It's their turn — they'll use these resources right away
      score -= 0.8;
      // Extra cautious in endgame: opponent might win with these resources
      if (context.isEndgame) score -= 2;
    }
  }

  const threshold = context?.weights.tradeAcceptThreshold ?? 0;
  const decision = score > threshold ? "accept" : "reject";

  tradeMemory.set(memKey, { tradeHash, turn: state.turnNumber, decision });
  return decision;
}
