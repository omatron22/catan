import type { GameState, Resource } from "@/shared/types/game";
import type { GameAction } from "@/shared/types/actions";
import { pickSetupVertex, pickSetupRoad, pickBuildVertex } from "./strategy/placement";
import { pickBuildRoad } from "./strategy/roads";
import { pickBankTrade } from "./strategy/trading";
import { pickRobberHex, pickStealTarget, pickDiscardResources } from "./strategy/robber";
import { pickDevCardToPlay } from "./strategy/devCards";
import { BUILDING_COSTS, ALL_RESOURCES } from "@/shared/constants";
import {
  edgesAtVertex,
  edgeEndpoints,
  adjacentVertices,
} from "@/shared/utils/hexMath";

/**
 * Given the current game state and a bot player index,
 * decide what action the bot should take.
 * Returns null if it's not this bot's turn or no action needed.
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
    return makeSetupAction(state, botIndex);
  }

  // Main game
  if (state.phase !== "main") return null;

  switch (state.turnPhase) {
    case "roll":
      return makeRollOrPlayDevCard(state, botIndex);
    case "robber-place":
      return makeRobberPlaceAction(state, botIndex);
    case "robber-steal":
      return makeStealAction(state, botIndex);
    case "trade-or-build":
      return makeMainPhaseAction(state, botIndex);
    case "road-building-1":
    case "road-building-2":
      return makeRoadBuildingAction(state, botIndex);
    case "monopoly":
    case "year-of-plenty":
      return null; // These are handled by dev card play
    default:
      return null;
  }
}

function makeSetupAction(state: GameState, botIndex: number): GameAction | null {
  const isSettlementTurn = state.setupPlacementsMade % 2 === 0;

  if (isSettlementTurn) {
    const vertex = pickSetupVertex(state, botIndex);
    if (!vertex) return null;
    return { type: "place-settlement", playerIndex: botIndex, vertex };
  } else {
    const lastSettlement = state.players[botIndex].settlements[
      state.players[botIndex].settlements.length - 1
    ];
    const edge = pickSetupRoad(state, botIndex, lastSettlement);
    if (!edge) return null;
    return { type: "place-road", playerIndex: botIndex, edge };
  }
}

function makeRollOrPlayDevCard(state: GameState, botIndex: number): GameAction {
  // Consider playing a knight before rolling (move robber preemptively)
  const player = state.players[botIndex];
  if (!player.hasPlayedDevCardThisTurn && player.developmentCards.includes("knight")) {
    // Play knight ~50% of the time if we have one
    if (Math.random() < 0.5) {
      return { type: "play-knight", playerIndex: botIndex };
    }
  }

  return { type: "roll-dice", playerIndex: botIndex };
}

function makeRobberPlaceAction(state: GameState, botIndex: number): GameAction {
  const hex = pickRobberHex(state, botIndex);
  return { type: "move-robber", playerIndex: botIndex, hex };
}

function makeStealAction(state: GameState, botIndex: number): GameAction | null {
  const target = pickStealTarget(state, botIndex);
  if (target === null) return null;
  return { type: "steal-resource", playerIndex: botIndex, targetPlayer: target };
}

function makeDiscardAction(state: GameState, botIndex: number): GameAction {
  const resources = pickDiscardResources(state, botIndex);
  return { type: "discard-resources", playerIndex: botIndex, resources };
}

function makeMainPhaseAction(state: GameState, botIndex: number): GameAction {
  const player = state.players[botIndex];

  // 1. Consider playing a dev card
  if (!player.hasPlayedDevCardThisTurn) {
    const devCard = pickDevCardToPlay(state, botIndex);
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

  // 2. Try to build a city (best VP/resource ratio)
  if (canAfford(player, BUILDING_COSTS.city) && player.settlements.length > 0) {
    // Pick the best settlement to upgrade
    const vertex = player.settlements[0]; // Simple: upgrade first
    return { type: "build-city", playerIndex: botIndex, vertex };
  }

  // 3. Try to build a settlement
  if (canAfford(player, BUILDING_COSTS.settlement)) {
    const vertex = pickBuildVertex(state, botIndex);
    if (vertex) {
      return { type: "build-settlement", playerIndex: botIndex, vertex };
    }
  }

  // 4. Try to build a road (if useful for reaching new settlement spots)
  if (canAfford(player, BUILDING_COSTS.road) && player.roads.length < 15) {
    const edge = pickBuildRoad(state, botIndex);
    if (edge) {
      return { type: "build-road", playerIndex: botIndex, edge };
    }
  }

  // 5. Try to buy a dev card
  if (
    canAfford(player, BUILDING_COSTS.developmentCard) &&
    state.developmentCardDeck.length > 0
  ) {
    return { type: "buy-development-card", playerIndex: botIndex };
  }

  // 6. Consider bank trading
  const bankTrade = pickBankTrade(state, botIndex);
  if (bankTrade) {
    return {
      type: "bank-trade",
      playerIndex: botIndex,
      giving: bankTrade.giving,
      givingCount: bankTrade.givingCount,
      receiving: bankTrade.receiving,
    };
  }

  // 7. Nothing useful to do, end turn
  return { type: "end-turn", playerIndex: botIndex };
}

function makeRoadBuildingAction(state: GameState, botIndex: number): GameAction {
  const edge = pickBuildRoad(state, botIndex);
  if (edge) {
    return { type: "build-road", playerIndex: botIndex, edge };
  }
  // If no valid road, we still need to handle this — end turn if possible
  // Actually road building forces road placement, but if no valid spot, turn phase
  // should auto-advance. For safety, try any valid edge.
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

  // Truly no valid road — this shouldn't happen but handle gracefully
  return { type: "end-turn", playerIndex: botIndex };
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

/**
 * Generate a counter-offer from a bot (~30% chance on reject).
 * Returns null if no counter-offer, or { offering, requesting } maps.
 */
export function generateBotCounterOffer(
  state: GameState,
  botIndex: number
): { offering: Partial<Record<Resource, number>>; requesting: Partial<Record<Resource, number>> } | null {
  const trade = state.pendingTrade;
  if (!trade) return null;

  // ~30% chance to counter-offer
  if (Math.random() > 0.3) return null;

  const bot = state.players[botIndex];

  // Counter: offer something the proposer wanted (slightly less), request something the proposer offered
  // Take one resource from the original requesting and one from offering, tweak amounts
  const requestedKeys = Object.entries(trade.offering)
    .filter(([, amt]) => (amt || 0) > 0)
    .map(([r]) => r as Resource);
  const offeredKeys = Object.entries(trade.requesting)
    .filter(([, amt]) => (amt || 0) > 0)
    .map(([r]) => r as Resource);

  if (requestedKeys.length === 0 || offeredKeys.length === 0) return null;

  // Pick a resource the bot can actually give
  const canGive = offeredKeys.filter((r) => bot.resources[r] > 0);
  if (canGive.length === 0) return null;

  const giveRes = canGive[Math.floor(Math.random() * canGive.length)];
  const wantRes = requestedKeys[Math.floor(Math.random() * requestedKeys.length)];

  // Give 1 of what they wanted, ask for 1 of what they were offering
  const offering: Partial<Record<Resource, number>> = { [giveRes]: 1 };
  const requesting: Partial<Record<Resource, number>> = { [wantRes]: 1 };

  return { offering, requesting };
}

/**
 * Decide whether a bot should accept or reject a pending trade offer.
 * Returns "accept" or "reject".
 */
export function decideBotTradeResponse(state: GameState, botIndex: number): "accept" | "reject" {
  const trade = state.pendingTrade;
  if (!trade) return "reject";
  if (trade.fromPlayer === botIndex) return "reject";
  if (trade.toPlayer !== null && trade.toPlayer !== botIndex) return "reject";

  const bot = state.players[botIndex];

  // Check if bot can afford to give the requested resources
  for (const [res, amount] of Object.entries(trade.requesting)) {
    if ((amount || 0) > bot.resources[res as Resource]) return "reject";
  }

  // Evaluate: how much does the bot need the offered resources vs the requested ones?
  // Score = sum of "need" for offered resources - sum of "need" for requested resources
  // Need is based on how close the bot is to building something that uses that resource

  const buildPriorities: Array<{ name: string; cost: Partial<Record<Resource, number>> }> = [
    { name: "settlement", cost: BUILDING_COSTS.settlement },
    { name: "city", cost: BUILDING_COSTS.city },
    { name: "road", cost: BUILDING_COSTS.road },
    { name: "developmentCard", cost: BUILDING_COSTS.developmentCard },
  ];

  // For each resource, compute a "need score": how many build targets need it and bot is short on it
  function resourceNeed(res: Resource): number {
    let need = 0;
    for (const { cost } of buildPriorities) {
      const required = cost[res] || 0;
      if (required > 0) {
        const deficit = required - bot.resources[res];
        if (deficit > 0) need += deficit;
      }
    }
    return need;
  }

  let gainScore = 0;
  for (const [res, amount] of Object.entries(trade.offering)) {
    gainScore += resourceNeed(res as Resource) * (amount || 0);
  }

  let lossScore = 0;
  for (const [res, amount] of Object.entries(trade.requesting)) {
    lossScore += resourceNeed(res as Resource) * (amount || 0);
  }

  // Accept if we gain more needed resources than we lose, with some randomness
  const netBenefit = gainScore - lossScore;
  if (netBenefit > 0) return "accept";
  if (netBenefit === 0 && Math.random() < 0.3) return "accept";
  return "reject";
}
