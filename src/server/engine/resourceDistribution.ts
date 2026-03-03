import type { GameState, Resource } from "@/shared/types/game";
import type { GameEvent } from "@/shared/types/actions";
import { TERRAIN_RESOURCE } from "@/shared/constants";
import { hexKey, hexVertices } from "@/shared/utils/hexMath";

/**
 * Distribute resources based on a dice roll.
 * Each hex with the matching number that doesn't have the robber
 * gives resources to players with settlements (1) or cities (2) on its vertices.
 */
export function distributeResources(
  state: GameState,
  diceTotal: number
): { updatedPlayers: GameState["players"]; events: GameEvent[]; distributions: Record<number, Partial<Record<Resource, number>>> } {
  const players = state.players.map((p) => ({
    ...p,
    resources: { ...p.resources },
  }));
  const events: GameEvent[] = [];
  const distributions: Record<number, Partial<Record<Resource, number>>> = {};

  for (const hex of Object.values(state.board.hexes)) {
    if (hex.number !== diceTotal) continue;
    if (hex.hasRobber) continue;

    const resource = TERRAIN_RESOURCE[hex.terrain];
    if (!resource) continue;

    const vertices = hexVertices(hex.coord);
    for (const vk of vertices) {
      const building = state.board.vertices[vk];
      if (!building) continue;

      const amount = building.type === "city" ? 2 : 1;
      const player = players[building.playerIndex];
      player.resources[resource] += amount;

      if (!distributions[building.playerIndex]) {
        distributions[building.playerIndex] = {};
      }
      distributions[building.playerIndex][resource] =
        (distributions[building.playerIndex][resource] || 0) + amount;
    }
  }

  if (Object.keys(distributions).length > 0) {
    events.push({
      type: "resources-distributed",
      playerIndex: null,
      data: { distributions },
    });
  }

  return { updatedPlayers: players, events, distributions };
}

/** Count total resources in hand */
export function totalResources(resources: Record<Resource, number>): number {
  return Object.values(resources).reduce((sum, n) => sum + n, 0);
}
