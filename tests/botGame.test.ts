import { describe, it, expect } from "vitest";
import { createGame, applyAction } from "@/server/engine/gameEngine";
import { decideBotAction } from "@/server/bots/botController";
import type { GameState } from "@/shared/types/game";

/**
 * Run a complete bot-only game.
 * Handles invalid bot actions gracefully (skips to end-turn as fallback).
 */
function runBotGame(playerCount: number, maxTurns = 1000): {
  state: GameState;
  turns: number;
  finished: boolean;
} {
  let state = createGame("bot-test", Array.from({ length: playerCount }, (_, i) => `Bot${i + 1}`));
  let turns = 0;
  let consecutiveFailures = 0;

  while (state.phase !== "finished" && turns < maxTurns) {
    turns++;

    let botIndex: number;
    if (state.turnPhase === "discard" && state.discardingPlayers.length > 0) {
      botIndex = state.discardingPlayers[0];
    } else {
      botIndex = state.currentPlayerIndex;
    }

    const action = decideBotAction(state, botIndex);
    if (!action) {
      // Bot can't decide — if it's trade-or-build, end turn
      if (state.turnPhase === "trade-or-build") {
        const fallback = applyAction(state, { type: "end-turn", playerIndex: botIndex });
        if (fallback.valid) {
          state = fallback.newState!;
          consecutiveFailures = 0;
          continue;
        }
      }
      consecutiveFailures++;
      if (consecutiveFailures > 20) break;
      continue;
    }

    const result = applyAction(state, action);
    if (!result.valid) {
      // Bot made invalid move — try end turn as fallback
      if (action.type !== "end-turn" && state.turnPhase === "trade-or-build") {
        const fallback = applyAction(state, { type: "end-turn", playerIndex: botIndex });
        if (fallback.valid) {
          state = fallback.newState!;
          consecutiveFailures = 0;
          continue;
        }
      }
      consecutiveFailures++;
      if (consecutiveFailures > 20) break;
      continue;
    }

    state = result.newState!;
    consecutiveFailures = 0;
  }

  return { state, turns, finished: state.phase === "finished" };
}

describe("Bot Game Simulation", () => {
  it("completes a 4-player bot game", () => {
    const { state, turns, finished } = runBotGame(4);
    expect(finished).toBe(true);
    expect(state.winner).not.toBeNull();
    console.log(`4p game: ${turns} turns, winner: ${state.players[state.winner!].name} with ${state.players[state.winner!].victoryPoints + state.players[state.winner!].hiddenVictoryPoints} VP`);
  });

  it("completes a 3-player bot game", () => {
    const { state, turns, finished } = runBotGame(3);
    expect(finished).toBe(true);
    console.log(`3p game: ${turns} turns`);
  });

  it("completes a 2-player bot game", () => {
    const { state, turns, finished } = runBotGame(2);
    expect(finished).toBe(true);
    console.log(`2p game: ${turns} turns`);
  });

  it("completes 10 consecutive 4-player games", () => {
    let totalTurns = 0;
    for (let i = 0; i < 10; i++) {
      const { state, turns, finished } = runBotGame(4);
      expect(finished).toBe(true);
      totalTurns += turns;
    }
    console.log(`10 games average: ${Math.round(totalTurns / 10)} turns`);
  });
});
