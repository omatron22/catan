import { describe, it, expect } from "vitest";
import { generateBoard } from "@/server/engine/boardGenerator";
import { TERRAIN_COUNTS, NUMBER_TOKENS } from "@/shared/constants";
import type { Terrain } from "@/shared/types/game";
import { cubeDistance } from "@/shared/utils/hexMath";

describe("Board Generator", () => {
  it("generates a board with 19 hexes", () => {
    const board = generateBoard();
    expect(Object.keys(board.hexes)).toHaveLength(19);
  });

  it("has correct terrain distribution", () => {
    const board = generateBoard();
    const counts: Record<string, number> = {};
    for (const hex of Object.values(board.hexes)) {
      counts[hex.terrain] = (counts[hex.terrain] || 0) + 1;
    }
    for (const [terrain, expected] of Object.entries(TERRAIN_COUNTS)) {
      expect(counts[terrain]).toBe(expected);
    }
  });

  it("desert has no number and has the robber", () => {
    const board = generateBoard();
    const desert = Object.values(board.hexes).find((h) => h.terrain === "desert");
    expect(desert).toBeDefined();
    expect(desert!.number).toBeNull();
    expect(desert!.hasRobber).toBe(true);
    expect(board.robberHex).toBeTruthy();
  });

  it("non-desert hexes have numbers", () => {
    const board = generateBoard();
    for (const hex of Object.values(board.hexes)) {
      if (hex.terrain !== "desert") {
        expect(hex.number).toBeGreaterThanOrEqual(2);
        expect(hex.number).toBeLessThanOrEqual(12);
      }
    }
  });

  it("uses all 18 number tokens", () => {
    const board = generateBoard();
    const numbers = Object.values(board.hexes)
      .filter((h) => h.number !== null)
      .map((h) => h.number as number)
      .sort((a, b) => a - b);
    expect(numbers).toEqual([...NUMBER_TOKENS].sort((a, b) => a - b));
  });

  it("6 and 8 are never adjacent", () => {
    // Run multiple times since board is random
    for (let i = 0; i < 20; i++) {
      const board = generateBoard();
      const highHexes = Object.values(board.hexes).filter(
        (h) => h.number === 6 || h.number === 8
      );
      for (let a = 0; a < highHexes.length; a++) {
        for (let b = a + 1; b < highHexes.length; b++) {
          expect(cubeDistance(highHexes[a].coord, highHexes[b].coord)).toBeGreaterThan(1);
        }
      }
    }
  });

  it("has 9 ports", () => {
    const board = generateBoard();
    expect(board.ports).toHaveLength(9);
  });

  it("has vertices and edges initialized", () => {
    const board = generateBoard();
    expect(Object.keys(board.vertices).length).toBeGreaterThan(0);
    expect(Object.keys(board.edges).length).toBeGreaterThan(0);
    // All should be null (no buildings yet)
    for (const v of Object.values(board.vertices)) {
      expect(v).toBeNull();
    }
    for (const e of Object.values(board.edges)) {
      expect(e).toBeNull();
    }
  });
});
