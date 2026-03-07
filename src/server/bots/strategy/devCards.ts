import type { GameState, Resource, DevelopmentCardType } from "@/shared/types/game";
import { BUILDING_COSTS, ALL_RESOURCES } from "@/shared/constants";
import type { BotStrategicContext } from "./context";

/**
 * Decide if and which development card to play.
 * Returns the action type to play, or null.
 */
export function pickDevCardToPlay(
  state: GameState,
  playerIndex: number,
  context?: BotStrategicContext
): { card: DevelopmentCardType; params?: Record<string, unknown> } | null {
  const player = state.players[playerIndex];
  if (player.hasPlayedDevCardThisTurn) return null;
  if (player.developmentCards.length === 0) return null;

  const cards = player.developmentCards;
  const knightEagerness = context?.weights.knightEagerness ?? 1.0;

  // --- Endgame: play VP cards if they would win ---
  if (context?.isEndgame && cards.includes("victoryPoint")) {
    const vpCards = cards.filter((c) => c === "victoryPoint").length;
    if (context.ownVP + vpCards >= context.vpToWin) {
      // VP cards are auto-revealed at win — no action needed
      // But let's prioritize other cards that help win
    }
  }

  // --- Knight with army awareness ---
  if (cards.includes("knight")) {
    let playProbability = 0.4 * knightEagerness;

    if (context) {
      if (context.distanceToLargestArmy === 0) playProbability = 0.5 * knightEagerness;
      else if (context.distanceToLargestArmy <= 1) playProbability = Math.min(1.0, 1.0 * knightEagerness);
      else if (context.distanceToLargestArmy <= 2) playProbability = 0.85 * knightEagerness;
      else if (context.distanceToLargestArmy <= 3) playProbability = 0.65 * knightEagerness;
    }

    if (Math.random() < Math.min(1, playProbability)) {
      return { card: "knight" };
    }
  }

  // Play road building if we have roads to place
  if (cards.includes("roadBuilding")) {
    const canBuildRoads = player.roads.length < 14;
    if (canBuildRoads) {
      // Higher priority if close to longest road
      if (context && context.distanceToLongestRoad <= 2) {
        return { card: "roadBuilding" };
      }
      // Still play it with lower priority
      if (!context || context.strategy === "expansion") {
        return { card: "roadBuilding" };
      }
    }
  }

  // Play year of plenty to complete a build
  if (cards.includes("yearOfPlenty")) {
    const needed = getMostNeededResources(state, playerIndex, 2, context);
    if (needed.length > 0) {
      return {
        card: "yearOfPlenty",
        params: {
          resource1: needed[0],
          resource2: needed.length > 1 ? needed[1] : needed[0],
        },
      };
    }
  }

  // Play monopoly — smarter version that considers build goal
  if (cards.includes("monopoly")) {
    const target = pickMonopolyResource(state, playerIndex, context);
    if (target) {
      return { card: "monopoly", params: { resource: target } };
    }
  }

  // If we still have an unplayed knight, play it
  if (cards.includes("knight")) {
    return { card: "knight" };
  }

  return null;
}

/**
 * Get the resources we need most, up to `count`.
 * Plan-aware: prioritizes settlement plan → city plan → build goal.
 */
export function getMostNeededResources(
  state: GameState,
  playerIndex: number,
  count: number,
  context?: BotStrategicContext
): Resource[] {
  const player = state.players[playerIndex];
  const needed: Resource[] = [];

  // Priority 1: Settlement plan resources
  if (context?.settlementPlan) {
    for (const [res, amount] of Object.entries(context.settlementPlan.missingResources)) {
      if ((amount || 0) > 0 && !needed.includes(res as Resource)) {
        needed.push(res as Resource);
        if (needed.length >= count) return needed;
      }
    }
  }

  // Priority 2: City plan resources
  if (context?.cityPlan) {
    for (const [res, amount] of Object.entries(context.cityPlan.missingResources)) {
      if ((amount || 0) > 0 && !needed.includes(res as Resource)) {
        needed.push(res as Resource);
        if (needed.length >= count) return needed;
      }
    }
  }

  // Priority 3: Build goal resources
  if (context?.buildGoal) {
    for (const [res, amount] of Object.entries(context.buildGoal.missingResources)) {
      if ((amount || 0) > 0 && !needed.includes(res as Resource)) {
        needed.push(res as Resource);
        if (needed.length >= count) return needed;
      }
    }
  }

  // Priority 4: Army pursuit
  if (context && context.distanceToLargestArmy <= 2 && context.strategy === "development") {
    const devCost = BUILDING_COSTS.developmentCard;
    for (const [res, amount] of Object.entries(devCost)) {
      if (player.resources[res as Resource] < (amount || 0)) {
        if (!needed.includes(res as Resource)) {
          needed.push(res as Resource);
          if (needed.length >= count) return needed;
        }
      }
    }
  }

  // Fallback: general build goals
  const goals: Array<{ name: string; cost: Partial<Record<Resource, number>> }> = [
    { name: "city", cost: BUILDING_COSTS.city },
    { name: "settlement", cost: BUILDING_COSTS.settlement },
    { name: "developmentCard", cost: BUILDING_COSTS.developmentCard },
    { name: "road", cost: BUILDING_COSTS.road },
  ];

  for (const goal of goals) {
    for (const [res, amount] of Object.entries(goal.cost)) {
      if (player.resources[res as Resource] < (amount || 0)) {
        if (!needed.includes(res as Resource)) {
          needed.push(res as Resource);
          if (needed.length >= count) return needed;
        }
      }
    }
  }

  if (needed.length === 0) {
    needed.push("ore", "grain");
  }

  return needed.slice(0, count);
}

/**
 * Pick the best resource for monopoly.
 * Smarter: scores each resource as opponentHoldings × needMultiplier.
 * Only plays if expected gain >= 2.
 */
function pickMonopolyResource(state: GameState, playerIndex: number, context?: BotStrategicContext): Resource | null {
  let bestResource: Resource | null = null;
  let bestScore = 0;
  const minGain = context?.isEndgame ? 1 : 2;

  for (const res of ALL_RESOURCES) {
    let totalOpponentCards = 0;
    for (let i = 0; i < state.players.length; i++) {
      if (i === playerIndex) continue;
      totalOpponentCards += state.players[i].resources[res];
    }

    if (totalOpponentCards < minGain) continue;

    // Need multiplier: high if we need this resource for our build goal
    let needMultiplier = 1;
    if (context?.buildGoal?.missingResources[res]) {
      needMultiplier = 3; // Big bonus for resources we need
    }

    const score = totalOpponentCards * needMultiplier;

    if (score > bestScore) {
      bestScore = score;
      bestResource = res;
    }
  }

  return bestResource;
}
