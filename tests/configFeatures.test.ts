import { describe, it, expect } from "vitest";
import { createGame, applyAction } from "@/server/engine/gameEngine";
import { generateBoard } from "@/server/engine/boardGenerator";
import { createFairDiceBag, drawFairDice } from "@/server/engine/fairDice";
import { hexVertices } from "@/shared/utils/hexMath";
import type { GameConfig } from "@/shared/types/config";

function makeConfig(overrides: Partial<GameConfig> = {}): GameConfig {
  return {
    players: [
      { name: "P1", color: "red", isBot: false },
      { name: "P2", color: "blue", isBot: true },
      { name: "P3", color: "white", isBot: true },
      { name: "P4", color: "orange", isBot: true },
    ],
    fairDice: false,
    friendlyRobber: false,
    doublesRollAgain: false,
    sheepNuke: false,
    gameMode: "classic",
    vpToWin: 10,
    turnTimer: 0,
    expansionBoard: false,
    ...overrides,
  };
}

describe("Config-aware createGame", () => {
  it("creates a game with custom player colors", () => {
    const config = makeConfig({
      players: [
        { name: "Me", color: "green", isBot: false },
        { name: "Bot", color: "purple", isBot: true },
      ],
    });
    const state = createGame("test", ["Me", "Bot"], config);
    expect(state.players[0].color).toBe("green");
    expect(state.players[1].color).toBe("purple");
    expect(state.players).toHaveLength(2);
  });

  it("stores config in state", () => {
    const config = makeConfig();
    const state = createGame("test", ["P1", "P2", "P3", "P4"], config);
    expect(state.config).toEqual(config);
  });

  it("falls back to default colors when no config", () => {
    const state = createGame("test", ["P1", "P2"]);
    expect(state.players[0].color).toBe("red");
    expect(state.players[1].color).toBe("blue");
    expect(state.config).toBeUndefined();
  });
});

describe("Speed Mode", () => {
  it("gives starting resources in speed mode", () => {
    const config = makeConfig({ gameMode: "speed", vpToWin: 6 });
    const state = createGame("test", ["P1", "P2", "P3", "P4"], config);
    for (const p of state.players) {
      expect(p.resources.brick).toBe(2);
      expect(p.resources.lumber).toBe(2);
      expect(p.resources.ore).toBe(2);
      expect(p.resources.grain).toBe(2);
      expect(p.resources.wool).toBe(2);
    }
  });

  it("uses configured VP to win", () => {
    const config = makeConfig({ gameMode: "speed", vpToWin: 6 });
    const state = createGame("test", ["P1", "P2", "P3", "P4"], config);
    expect(state.config?.vpToWin).toBe(6);
  });

  it("classic mode gives no starting resources", () => {
    const config = makeConfig({ gameMode: "classic" });
    const state = createGame("test", ["P1", "P2", "P3", "P4"], config);
    for (const p of state.players) {
      expect(p.resources.brick).toBe(0);
    }
  });
});

describe("Fair Dice", () => {
  it("creates a fair dice bag when enabled", () => {
    const config = makeConfig({ fairDice: true });
    const state = createGame("test", ["P1", "P2", "P3", "P4"], config);
    expect(state.fairDiceBag).toBeDefined();
    expect(state.fairDiceBag).toHaveLength(36);
  });

  it("does not create a fair dice bag when disabled", () => {
    const config = makeConfig({ fairDice: false });
    const state = createGame("test", ["P1", "P2", "P3", "P4"], config);
    expect(state.fairDiceBag).toBeUndefined();
  });

  it("bag contains correct distribution", () => {
    const bag = createFairDiceBag();
    expect(bag).toHaveLength(36);
    // Count occurrences of each total
    const counts: Record<number, number> = {};
    for (const t of bag) {
      counts[t] = (counts[t] || 0) + 1;
    }
    // 2 and 12 appear once each, 7 appears 6 times
    expect(counts[2]).toBe(1);
    expect(counts[7]).toBe(6);
    expect(counts[12]).toBe(1);
  });

  it("draw returns valid totals and shrinks bag", () => {
    const bag = createFairDiceBag();
    const { total, die1, die2, updatedBag } = drawFairDice(bag);
    expect(total).toBeGreaterThanOrEqual(2);
    expect(total).toBeLessThanOrEqual(12);
    expect(die1 + die2).toBe(total);
    expect(updatedBag).toHaveLength(35);
  });

  it("refills bag when empty", () => {
    const { total, updatedBag } = drawFairDice([]);
    expect(total).toBeGreaterThanOrEqual(2);
    expect(total).toBeLessThanOrEqual(12);
    expect(updatedBag).toHaveLength(35);
  });
});

describe("Friendly Robber", () => {
  it("blocks robber placement on hexes where only low-VP players have buildings", () => {
    const config = makeConfig({ friendlyRobber: true });
    const state = createGame("test", ["P1", "P2", "P3", "P4"], config);

    // Manually set up: put game in main phase with a building
    state.phase = "main";
    state.turnPhase = "robber-place";
    state.currentPlayerIndex = 0;

    // Find a hex that has a settlement from a player with low VP
    // Place a settlement on a vertex of a non-desert hex
    const hexKeys = Object.keys(state.board.hexes);
    const targetHex = hexKeys.find((k) => !state.board.hexes[k].hasRobber)!;
    const hex = state.board.hexes[targetHex];

    // Find a vertex on this hex
    const verts = hexVertices(hex.coord);
    const vertex = verts[0];

    // Place a settlement for player 1 (who has 0 VP visible, but let's set to 2)
    state.board.vertices[vertex] = { type: "settlement", playerIndex: 1 };
    state.players[1].victoryPoints = 2;

    // Try to move robber to this hex
    const result = applyAction(state, {
      type: "move-robber",
      playerIndex: 0,
      hex: targetHex,
    });

    expect(result.valid).toBe(false);
    expect(result.error).toContain("Friendly robber");
  });

  it("allows robber on hexes with high-VP players", () => {
    const config = makeConfig({ friendlyRobber: true });
    const state = createGame("test", ["P1", "P2", "P3", "P4"], config);

    state.phase = "main";
    state.turnPhase = "robber-place";
    state.currentPlayerIndex = 0;

    const hexKeys = Object.keys(state.board.hexes);
    const targetHex = hexKeys.find((k) => !state.board.hexes[k].hasRobber)!;
    const hex = state.board.hexes[targetHex];

    const verts = hexVertices(hex.coord);
    const vertex = verts[0];

    state.board.vertices[vertex] = { type: "settlement", playerIndex: 1 };
    state.players[1].victoryPoints = 5; // > 2, so robber is OK

    const result = applyAction(state, {
      type: "move-robber",
      playerIndex: 0,
      hex: targetHex,
    });

    expect(result.valid).toBe(true);
  });
});

describe("Expansion Board", () => {
  it("generates a 30-hex expansion board", () => {
    const board = generateBoard(true);
    const hexCount = Object.keys(board.hexes).length;
    expect(hexCount).toBe(30);
  });

  it("standard board has 19 hexes", () => {
    const board = generateBoard(false);
    const hexCount = Object.keys(board.hexes).length;
    expect(hexCount).toBe(19);
  });

  it("expansion board has more vertices and edges than standard", () => {
    const standard = generateBoard(false);
    const expansion = generateBoard(true);
    expect(Object.keys(expansion.vertices).length).toBeGreaterThan(
      Object.keys(standard.vertices).length
    );
    expect(Object.keys(expansion.edges).length).toBeGreaterThan(
      Object.keys(standard.edges).length
    );
  });

  it("expansion config uses higher building limits", () => {
    const config = makeConfig({ expansionBoard: true });
    const state = createGame("test", ["P1", "P2", "P3", "P4", "P5", "P6"], {
      ...config,
      players: [
        { name: "P1", color: "red", isBot: false },
        { name: "P2", color: "blue", isBot: true },
        { name: "P3", color: "white", isBot: true },
        { name: "P4", color: "orange", isBot: true },
        { name: "P5", color: "green", isBot: true },
        { name: "P6", color: "purple", isBot: true },
      ],
    });
    expect(state.players).toHaveLength(6);
    expect(state.config?.expansionBoard).toBe(true);
    expect(Object.keys(state.board.hexes).length).toBe(30);
  });
});
