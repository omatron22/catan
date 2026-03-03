import type { GameState, Resource } from "@/shared/types/game";
import type { HexKey } from "@/shared/types/coordinates";
import {
  hexVertices,
  parseHexKey,
  hexKey,
} from "@/shared/utils/hexMath";
import { NUMBER_DOTS, TERRAIN_RESOURCE } from "@/shared/constants";

/**
 * Pick the best hex to place the robber.
 * Targets the leading opponent on a high-probability hex.
 */
export function pickRobberHex(state: GameState, playerIndex: number): HexKey {
  let bestHex: HexKey | null = null;
  let bestScore = -Infinity;

  for (const [hk, hex] of Object.entries(state.board.hexes)) {
    if (hk === state.board.robberHex) continue; // Must move to different hex
    if (hex.terrain === "desert") continue; // Don't put on desert (wastes robber)

    const dots = hex.number ? (NUMBER_DOTS[hex.number] || 0) : 0;
    let score = 0;

    // Check who has buildings on this hex
    const vertices = hexVertices(hex.coord);
    let affectsOpponent = false;
    let affectsSelf = false;

    for (const vk of vertices) {
      const building = state.board.vertices[vk];
      if (!building) continue;

      if (building.playerIndex === playerIndex) {
        affectsSelf = true;
      } else {
        affectsOpponent = true;
        const opponent = state.players[building.playerIndex];
        // Prefer blocking the leader
        score += opponent.victoryPoints * 2;
        // Bonus for blocking cities (they produce more)
        if (building.type === "city") score += 3;
        else score += 1;
      }
    }

    if (!affectsOpponent) continue; // Don't place where it doesn't hurt opponents
    if (affectsSelf) score -= 10; // Big penalty for hurting ourselves

    // Prefer high-probability hexes
    score += dots;

    if (score > bestScore) {
      bestScore = score;
      bestHex = hk;
    }
  }

  // Fallback: just pick any valid hex
  if (!bestHex) {
    for (const hk of Object.keys(state.board.hexes)) {
      if (hk !== state.board.robberHex) {
        bestHex = hk;
        break;
      }
    }
  }

  return bestHex!;
}

/**
 * Pick which player to steal from at the robber hex.
 */
export function pickStealTarget(state: GameState, playerIndex: number): number | null {
  const hexCoord = parseHexKey(state.board.robberHex);
  const vertices = hexVertices(hexCoord);
  const candidates: { player: number; score: number }[] = [];

  for (const vk of vertices) {
    const building = state.board.vertices[vk];
    if (!building || building.playerIndex === playerIndex) continue;

    const target = state.players[building.playerIndex];
    const resourceCount = Object.values(target.resources).reduce((s, n) => s + n, 0);
    if (resourceCount === 0) continue;

    // Already have this player?
    const existing = candidates.find((c) => c.player === building.playerIndex);
    if (existing) continue;

    candidates.push({
      player: building.playerIndex,
      score: target.victoryPoints * 3 + resourceCount,
    });
  }

  if (candidates.length === 0) return null;

  // Pick the leader (highest score)
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].player;
}

/**
 * Pick which resources to discard when a 7 is rolled.
 * Keeps the most valuable resources, discards the least useful.
 */
export function pickDiscardResources(
  state: GameState,
  playerIndex: number
): Partial<Record<Resource, number>> {
  const player = state.players[playerIndex];
  const total = Object.values(player.resources).reduce((s, n) => s + n, 0);
  const discardCount = Math.floor(total / 2);

  // Rank resources by value (keep the most useful ones)
  const resourceValue: Record<Resource, number> = {
    ore: 4,    // cities
    grain: 3,  // cities + settlements
    wool: 2,   // settlements + dev cards
    brick: 2,  // roads + settlements
    lumber: 2, // roads + settlements
  };

  // Build a list of all resource cards, sorted by value ascending (discard least valuable first)
  const cards: { resource: Resource; value: number }[] = [];
  for (const [res, count] of Object.entries(player.resources)) {
    for (let i = 0; i < count; i++) {
      cards.push({ resource: res as Resource, value: resourceValue[res as Resource] });
    }
  }
  cards.sort((a, b) => a.value - b.value);

  // Discard the least valuable cards
  const discard: Partial<Record<Resource, number>> = {};
  for (let i = 0; i < discardCount && i < cards.length; i++) {
    const res = cards[i].resource;
    discard[res] = (discard[res] || 0) + 1;
  }

  return discard;
}
