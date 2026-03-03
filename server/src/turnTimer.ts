import type { TypedServer, Room } from "./types.js";
import type { Resource } from "@/shared/types/game";
import { applyAction } from "@/server/engine/gameEngine";
import { broadcastState, scheduleBotActions } from "./gameSession.js";

export function startTurnTimer(io: TypedServer, room: Room, seconds: number) {
  clearTurnTimer(room);

  room.turnDeadline = Date.now() + seconds * 1000;

  room.turnTimer = setTimeout(() => {
    handleTimeout(io, room);
  }, seconds * 1000);
}

export function clearTurnTimer(room: Room) {
  if (room.turnTimer) {
    clearTimeout(room.turnTimer);
    room.turnTimer = null;
  }
  room.turnDeadline = null;
}

function handleTimeout(io: TypedServer, room: Room) {
  if (!room.gameState || room.gameState.phase === "finished") return;

  const state = room.gameState;
  const playerIndex = state.currentPlayerIndex;

  if (state.turnPhase === "discard") {
    // Auto-discard random resources for all remaining players
    for (const idx of state.discardingPlayers) {
      const player = state.players[idx];
      const total = Object.values(player.resources).reduce(
        (s: number, n) => s + n,
        0
      );
      const toDiscard = Math.floor(total / 2);
      const resources: Partial<Record<Resource, number>> = {};

      // Randomly pick resources to discard
      const available: Resource[] = [];
      for (const [res, count] of Object.entries(player.resources)) {
        for (let i = 0; i < count; i++) available.push(res as Resource);
      }
      // Shuffle and pick
      for (let i = available.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [available[i], available[j]] = [available[j], available[i]];
      }
      for (let i = 0; i < toDiscard && i < available.length; i++) {
        const r = available[i];
        resources[r] = (resources[r] || 0) + 1;
      }

      const result = applyAction(room.gameState!, {
        type: "discard-resources",
        playerIndex: idx,
        resources,
      });
      if (result.valid && result.newState) {
        room.gameState = result.newState;
      }
    }
  } else {
    // Auto end-turn
    const result = applyAction(state, {
      type: "end-turn",
      playerIndex,
    });
    if (result.valid && result.newState) {
      room.gameState = result.newState;
    }
  }

  broadcastState(io, room);
  scheduleBotActions(io, room);
}
