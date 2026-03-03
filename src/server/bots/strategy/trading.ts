import type { GameState, Resource } from "@/shared/types/game";
import { BUILDING_COSTS, ALL_RESOURCES } from "@/shared/constants";

interface BankTrade {
  giving: Resource;
  givingCount: number;
  receiving: Resource;
}

/**
 * Decide whether the bot should make a bank trade.
 * Returns a trade if beneficial, null otherwise.
 */
export function pickBankTrade(state: GameState, playerIndex: number): BankTrade | null {
  const player = state.players[playerIndex];

  // Figure out what we're saving toward
  const needs = getResourceNeeds(state, playerIndex);
  if (needs.length === 0) return null;

  // For each needed resource, check if we can bank-trade for it
  for (const needed of needs) {
    // Find a resource we have excess of
    for (const giving of ALL_RESOURCES) {
      if (giving === needed) continue;

      const ratio = getTradeRatio(state, playerIndex, giving);
      if (player.resources[giving] < ratio) continue;

      // Don't trade away resources we also need
      const giveNeed = needs.find((n) => n === giving);
      if (giveNeed && player.resources[giving] <= ratio) continue;

      // Only trade if we have significant surplus
      const surplus = player.resources[giving] - ratio;
      if (surplus < 0) continue;

      return { giving, givingCount: ratio, receiving: needed };
    }
  }

  return null;
}

/**
 * Get the trade ratio for a resource based on port access.
 */
function getTradeRatio(state: GameState, playerIndex: number, resource: Resource): number {
  const player = state.players[playerIndex];
  if (player.portsAccess.includes(resource)) return 2;
  if (player.portsAccess.includes("any")) return 3;
  return 4;
}

/**
 * Determine what resources the bot needs most.
 * Returns resources ordered by priority.
 */
function getResourceNeeds(state: GameState, playerIndex: number): Resource[] {
  const player = state.players[playerIndex];
  const needs: Resource[] = [];

  // Check what we can almost afford
  const goals = getBuildGoals(state, playerIndex);

  for (const goal of goals) {
    const cost = BUILDING_COSTS[goal];
    if (!cost) continue;

    for (const [res, amount] of Object.entries(cost)) {
      const have = player.resources[res as Resource];
      if (have < (amount || 0)) {
        if (!needs.includes(res as Resource)) {
          needs.push(res as Resource);
        }
      }
    }
  }

  return needs;
}

/**
 * Determine what the bot should try to build, in priority order.
 */
function getBuildGoals(state: GameState, playerIndex: number): string[] {
  const player = state.players[playerIndex];
  const goals: string[] = [];

  // City is high priority if we have settlements
  if (player.settlements.length > 0 && player.cities.length < 4) {
    goals.push("city");
  }

  // Settlement if we have road connections to good spots
  if (player.settlements.length < 5) {
    goals.push("settlement");
  }

  // Roads to expand network
  if (player.roads.length < 15) {
    goals.push("road");
  }

  // Dev cards for knights/VPs
  if (state.developmentCardDeck.length > 0) {
    goals.push("developmentCard");
  }

  return goals;
}
