import type { GameState, Resource, DevelopmentCardType } from "@/shared/types/game";
import { BUILDING_COSTS, ALL_RESOURCES } from "@/shared/constants";

/**
 * Decide if and which development card to play.
 * Returns the action type to play, or null.
 */
export function pickDevCardToPlay(
  state: GameState,
  playerIndex: number
): { card: DevelopmentCardType; params?: Record<string, unknown> } | null {
  const player = state.players[playerIndex];
  if (player.hasPlayedDevCardThisTurn) return null;
  if (player.developmentCards.length === 0) return null;

  const cards = player.developmentCards;

  // Play knight if we have one (robber is useful, and works toward largest army)
  if (cards.includes("knight")) {
    return { card: "knight" };
  }

  // Play road building if we have roads to place and < 2 road resources
  if (cards.includes("roadBuilding")) {
    const canBuildRoads = player.roads.length < 14; // room for 2 more
    if (canBuildRoads) {
      return { card: "roadBuilding" };
    }
  }

  // Play year of plenty to complete a build
  if (cards.includes("yearOfPlenty")) {
    const needed = getMostNeededResources(state, playerIndex, 2);
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

  // Play monopoly if an opponent likely has a lot of something we need
  if (cards.includes("monopoly")) {
    const target = pickMonopolyResource(state, playerIndex);
    if (target) {
      return { card: "monopoly", params: { resource: target } };
    }
  }

  return null;
}

/**
 * Get the resources we need most, up to `count`.
 */
function getMostNeededResources(state: GameState, playerIndex: number, count: number): Resource[] {
  const player = state.players[playerIndex];
  const needed: Resource[] = [];

  // Check what we're close to affording
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

  // If we don't need anything specific, pick ore and grain (toward city)
  if (needed.length === 0) {
    needed.push("ore", "grain");
  }

  return needed.slice(0, count);
}

/**
 * Pick the best resource for monopoly.
 * Target a resource that opponents likely have a lot of.
 */
function pickMonopolyResource(state: GameState, playerIndex: number): Resource | null {
  let bestResource: Resource | null = null;
  let bestEstimate = 2; // Only monopoly if we think we'll get at least 3

  for (const res of ALL_RESOURCES) {
    let totalOpponentCards = 0;
    for (const p of state.players) {
      if (p.index === playerIndex) continue;
      totalOpponentCards += p.resources[res];
    }

    if (totalOpponentCards > bestEstimate) {
      bestEstimate = totalOpponentCards;
      bestResource = res;
    }
  }

  return bestResource;
}
