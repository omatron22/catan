import type { GameState, Resource } from "@/shared/types/game";
import { BUILDING_COSTS, ALL_RESOURCES } from "@/shared/constants";
import type { BotStrategicContext } from "./context";

interface BankTrade {
  giving: Resource;
  givingCount: number;
  receiving: Resource;
}

export interface PlayerTradeOffer {
  offering: Partial<Record<Resource, number>>;
  requesting: Partial<Record<Resource, number>>;
  /** Max the bot is willing to offer for this resource (based on urgency) */
  maxOffer: number;
  /** How many surplus cards the bot has of the offered resource */
  surplusCount: number;
}

/**
 * Decide whether the bot should initiate a player trade.
 * Bots will offer more cards when they have surplus to make trades more attractive.
 */
export function pickPlayerTrade(
  state: GameState,
  playerIndex: number,
  context: BotStrategicContext,
): PlayerTradeOffer | null {
  if (Math.random() >= context.weights.playerTradeChance) return null;

  const player = state.players[playerIndex];

  // Don't trade with anyone within 2 VP of winning in endgame
  if (context.isEndgame) {
    const anyoneClose = context.playerThreats.some((t) => t.visibleVP >= context.vpToWin - 2);
    if (anyoneClose) return null;
  }

  // Determine what we need
  let needed: Resource[] = [];
  if (context.buildGoal) {
    for (const [res, amount] of Object.entries(context.buildGoal.missingResources)) {
      if ((amount || 0) > 0) needed.push(res as Resource);
    }
  }
  // Also consider generally scarce resources if no build goal needs
  if (needed.length === 0) {
    needed = ALL_RESOURCES.filter((r) => player.resources[r] === 0 && context.productionRates[r] === 0);
  }
  if (needed.length === 0) return null;

  const totalMissing = context.buildGoal
    ? Object.values(context.buildGoal.missingResources).reduce((sum, n) => sum + (n || 0), 0)
    : Infinity;

  // --- Compute true surplus per resource ---
  // "Surplus" = what you can safely give away without hurting your plans.
  // A real player considers:
  //   1. Current build goal needs (never trade away what you need right now)
  //   2. Next build goal needs (protect resources for your follow-up plan)
  //   3. Production rate (if you produce it every turn, it's cheap to give away)
  //   4. Robber risk (7+ cards means some will be stolen — better to trade than lose)

  // Gather needs across current + next build goal
  const currentGoalNeeds: Partial<Record<Resource, number>> = {};
  const futureNeeds: Partial<Record<Resource, number>> = {};
  if (context.buildGoal) {
    for (const [r, amt] of Object.entries(context.buildGoal.missingResources)) {
      if ((amt || 0) > 0) currentGoalNeeds[r as Resource] = amt as number;
    }
  }
  // Look at second build goal for what to protect
  if (context.buildGoals.length > 1) {
    const nextGoal = context.buildGoals[1];
    for (const [r, amt] of Object.entries(nextGoal.missingResources)) {
      if ((amt || 0) > 0) futureNeeds[r as Resource] = amt as number;
    }
  }

  const totalHand = Object.values(player.resources).reduce((s, n) => s + n, 0);

  const surplusList: { res: Resource; spendable: number; count: number; value: number }[] = [];
  for (const res of ALL_RESOURCES) {
    if (needed.includes(res)) continue; // never offer what we're trying to get
    const have = player.resources[res];
    if (have < 2) continue;

    // How many do we need to keep for our plans?
    const keepForCurrent = currentGoalNeeds[res] ?? 0;
    const keepForFuture = futureNeeds[res] ?? 0;
    // Always reserve for current goal, partially reserve for future goal
    const reserved = keepForCurrent + Math.ceil(keepForFuture * 0.5);
    const spendable = Math.max(0, have - Math.max(reserved, 1)); // keep at least 1
    if (spendable <= 0) continue;

    // Value: how "expensive" is this resource to us?
    // Low production = high value, high production = low value (cheap to give)
    const prodRate = context.productionRates[res];
    let value = 1;
    if (prodRate === 0) value = 3; // can't produce it — very valuable
    else if (prodRate <= 0.05) value = 2; // rare production
    else value = 1; // decent production, cheap to give

    // If we need it for future builds, bump value
    if (keepForFuture > 0) value += 1;

    surplusList.push({ res, spendable, count: have, value });
  }
  if (surplusList.length === 0) return null;

  // Pick the best resource to offer: most spendable, lowest value (cheapest to give)
  surplusList.sort((a, b) => {
    // Primary: lowest value first (cheapest to give away)
    if (a.value !== b.value) return a.value - b.value;
    // Secondary: most spendable (most we can spare)
    return b.spendable - a.spendable;
  });
  const best = surplusList[0];
  const offerRes = best.res;
  const spendable = best.spendable;

  // Pick a needed resource that at least one opponent actually has
  const requestRes = needed.find((r) =>
    state.players.some((p, i) => i !== playerIndex && p.resources[r] > 0)
  );
  if (!requestRes) return null;

  // --- Determine max willingness to offer ---
  // Scales with urgency. A real player asks "how badly do I need this?"
  const vpAway = context.vpToWin - context.ownVP;

  let maxOffer = 1;

  // 1 VP from winning + 1 resource away — give everything you can spare
  if (vpAway <= 1 && totalMissing === 1) {
    maxOffer = spendable;
  }
  // 2 VP away, 1 resource short — very aggressive
  else if (vpAway <= 2 && totalMissing === 1) {
    maxOffer = Math.max(4, Math.ceil(spendable * 0.8));
  }
  // Close to completing a build
  else if (totalMissing === 1) {
    maxOffer = Math.min(spendable, 4);
  }
  else if (totalMissing <= 2) {
    maxOffer = Math.min(spendable, 3);
  }

  // Racing opponents for a spot
  if (context.spatialUrgency >= 0.8) maxOffer = Math.max(maxOffer, Math.min(spendable, 4));
  else if (context.spatialUrgency >= 0.6) maxOffer = Math.max(maxOffer, Math.min(spendable, 3));

  // Can't produce the resource we need — willing to overpay
  if (context.missingResources.includes(requestRes)) maxOffer = Math.max(maxOffer, Math.min(spendable, 3));

  // Robber risk: 7+ cards means we might lose half — better to trade now
  if (totalHand >= 7) {
    const extraCards = totalHand - 6; // how many over "safe" threshold
    maxOffer = Math.max(maxOffer, Math.min(spendable, 1 + Math.floor(extraCards * 0.5)));
  }

  // Cheap resource (high production) — can afford to be generous
  if (best.value === 1 && spendable >= 3) maxOffer = Math.max(maxOffer, Math.min(spendable, 3));

  // --- Opponent benefit check ---
  // Giving away N cards helps the opponent too. Only overpay (2+ for 1) when
  // the benefit to us clearly outweighs the gift to them.
  // A 1:1 trade is always fair. Anything above that needs justification.
  if (maxOffer > 1) {
    // How far ahead is the leading opponent?
    const maxOpponentVP = Math.max(...context.playerThreats.map((t) => t.visibleVP));
    const vpLead = maxOpponentVP - context.ownVP;

    // If an opponent is ahead of us, be stingy — don't feed the leader
    if (vpLead >= 3) {
      maxOffer = 1; // only 1:1 when far behind
    } else if (vpLead >= 2) {
      maxOffer = Math.min(maxOffer, 2);
    }

    // Even when we're ahead or tied, cap generosity unless truly urgent
    // "Truly urgent" = about to win, or racing for a spot
    const trulyUrgent = (vpAway <= 2 && totalMissing <= 1) || context.spatialUrgency >= 0.7;
    if (!trulyUrgent && maxOffer > 2) {
      maxOffer = 2; // don't give 3+ for 1 without a strong reason
    }
  }

  // Final cap
  maxOffer = Math.min(maxOffer, spendable);
  if (maxOffer < 1) maxOffer = 1;

  // Always start at 1:1 — escalation happens in botController based on rejections
  return {
    offering: { [offerRes]: 1 },
    requesting: { [requestRes]: 1 },
    maxOffer,
    surplusCount: spendable,
  };
}

/**
 * Decide whether the bot should make a bank trade.
 * Ranks all possible bank trades and picks the best one by need urgency.
 */
export function pickBankTrade(state: GameState, playerIndex: number, context?: BotStrategicContext): BankTrade | null {
  const player = state.players[playerIndex];

  const needs = getResourceNeeds(state, playerIndex, context);
  if (needs.length === 0) return null;

  // Only protect resources when very close to completing build goal
  const totalMissing = context?.buildGoal
    ? Object.values(context.buildGoal.missingResources).reduce((sum, n) => sum + (n || 0), 0)
    : Infinity;

  // Collect all valid trades and score them
  const candidates: { trade: BankTrade; score: number }[] = [];

  for (let ni = 0; ni < needs.length; ni++) {
    const needed = needs[ni];
    // Score: earlier in needs list = higher priority
    const needScore = needs.length - ni;

    for (const giving of ALL_RESOURCES) {
      if (giving === needed) continue;

      const ratio = getTradeRatio(state, playerIndex, giving);
      if (player.resources[giving] < ratio) continue;

      // Don't trade away resources we also need (unless large surplus)
      const giveNeed = needs.find((n) => n === giving);
      if (giveNeed && player.resources[giving] <= ratio + 1) continue;

      // Goal-oriented protection: only when within 1 resource of completing
      if (context?.buildGoal && totalMissing <= 1) {
        const goalNeed = getGoalNeed(context, giving);
        if (goalNeed > 0 && player.resources[giving] <= ratio + goalNeed) continue;
      }

      // Score: prefer better ratios and higher need priority
      // Lower ratio = more efficient = better
      const ratioBonus = (5 - ratio); // 4:1=1, 3:1=2, 2:1=3
      const surplusBonus = Math.min(player.resources[giving] - ratio, 3); // extra cards after trade
      const score = needScore * 3 + ratioBonus * 2 + surplusBonus;

      const givingCount = ratio;
      candidates.push({ trade: { giving, givingCount, receiving: needed }, score });

      // Also consider double trade if large surplus
      if (player.resources[giving] >= ratio * 2 && !giveNeed) {
        candidates.push({
          trade: { giving, givingCount: ratio * 2, receiving: needed },
          score: score + 1, // slight bonus for getting more
        });
      }
    }
  }

  if (candidates.length === 0) return null;

  // Pick the best trade
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].trade;
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
 */
function getResourceNeeds(state: GameState, playerIndex: number, context?: BotStrategicContext): Resource[] {
  const player = state.players[playerIndex];
  const needs: Resource[] = [];

  // Prioritize build goal resources
  if (context?.buildGoal) {
    for (const [res, amount] of Object.entries(context.buildGoal.missingResources)) {
      if ((amount || 0) > 0 && !needs.includes(res as Resource)) {
        needs.push(res as Resource);
      }
    }
    if (needs.length > 0) return needs;
  }

  const goals = getBuildGoals(state, playerIndex, context);

  for (const goal of goals) {
    const cost = BUILDING_COSTS[goal as keyof typeof BUILDING_COSTS];
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
function getBuildGoals(state: GameState, playerIndex: number, context?: BotStrategicContext): string[] {
  const player = state.players[playerIndex];
  const goals: string[] = [];

  if (context) {
    // Use strategy to prioritize
    if (context.strategy === "cities") {
      if (player.settlements.length > 0) goals.push("city");
      if (state.developmentCardDeck.length > 0) goals.push("developmentCard");
      if (player.settlements.length < 5) goals.push("settlement");
      if (player.roads.length < 15) goals.push("road");
    } else if (context.strategy === "development") {
      if (state.developmentCardDeck.length > 0) goals.push("developmentCard");
      if (player.settlements.length > 0) goals.push("city");
      if (player.settlements.length < 5) goals.push("settlement");
      if (player.roads.length < 15) goals.push("road");
    } else {
      // expansion
      if (player.settlements.length < 5) goals.push("settlement");
      if (player.roads.length < 15) goals.push("road");
      if (player.settlements.length > 0) goals.push("city");
      if (state.developmentCardDeck.length > 0) goals.push("developmentCard");
    }
  } else {
    if (player.settlements.length > 0 && player.cities.length < 4) goals.push("city");
    if (player.settlements.length < 5) goals.push("settlement");
    if (player.roads.length < 15) goals.push("road");
    if (state.developmentCardDeck.length > 0) goals.push("developmentCard");
  }

  return goals;
}

/**
 * Should bot reject a trade that helps the proposer?
 * Reject if proposer has 2+ more VP than the bot.
 */
export function shouldRejectLeaderTrade(
  state: GameState,
  fromPlayer: number,
  context: BotStrategicContext
): boolean {
  const fromVP = state.players[fromPlayer].victoryPoints;
  const botVP = state.players[context.playerIndex].victoryPoints;
  if (fromVP >= botVP + 2) return true;
  return false;
}

/**
 * How much of a resource does the current build goal need?
 */
function getGoalNeed(context: BotStrategicContext, resource: Resource): number {
  if (!context.buildGoal) return 0;
  return context.buildGoal.missingResources[resource] ?? 0;
}
