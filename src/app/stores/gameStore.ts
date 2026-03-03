import { create } from "zustand";
import type { GameState } from "@/shared/types/game";
import type { GameAction, ActionResult, GameEvent } from "@/shared/types/actions";
import type { VertexKey, EdgeKey, HexKey } from "@/shared/types/coordinates";
import type { GameConfig } from "@/shared/types/config";
import { createGame, applyAction } from "@/server/engine/gameEngine";

interface LegacyGameConfig {
  playerName: string;
  botNames: string[];
}

interface GameStore {
  // State
  gameState: GameState | null;
  config: LegacyGameConfig | null;
  fullConfig: GameConfig | null;
  botIndices: number[];
  activeAction: string | null;
  highlightedVertices: Set<VertexKey>;
  highlightedEdges: Set<EdgeKey>;
  highlightedHexes: Set<HexKey>;
  lastEvents: GameEvent[];
  error: string | null;
  botThinking: boolean;

  // Actions
  initGame: (config: LegacyGameConfig, fullConfig?: GameConfig) => void;
  dispatch: (action: GameAction) => ActionResult;
  setGameState: (state: GameState) => void;
  setActiveAction: (action: string | null) => void;
  setHighlightedVertices: (vertices: Set<VertexKey>) => void;
  setHighlightedEdges: (edges: Set<EdgeKey>) => void;
  setHighlightedHexes: (hexes: Set<HexKey>) => void;
  setBotThinking: (thinking: boolean) => void;
  clearError: () => void;
}

export const useGameStore = create<GameStore>((set, get) => ({
  gameState: null,
  config: null,
  fullConfig: null,
  botIndices: [],
  activeAction: null,
  highlightedVertices: new Set(),
  highlightedEdges: new Set(),
  highlightedHexes: new Set(),
  lastEvents: [],
  error: null,
  botThinking: false,

  initGame: (config: LegacyGameConfig, fullConfig?: GameConfig) => {
    const allNames = [config.playerName, ...config.botNames];
    const state = createGame(`game-${Date.now()}`, allNames, fullConfig);
    // Determine bot indices from fullConfig if available
    const botIndices = fullConfig
      ? fullConfig.players.map((p, i) => (p.isBot ? i : -1)).filter((i) => i >= 0)
      : config.botNames.map((_, i) => i + 1);
    set({
      gameState: state,
      config,
      fullConfig: fullConfig ?? null,
      botIndices,
      activeAction: null,
      highlightedVertices: new Set(),
      highlightedEdges: new Set(),
      highlightedHexes: new Set(),
      lastEvents: [],
      error: null,
      botThinking: false,
    });
  },

  dispatch: (action: GameAction) => {
    const { gameState } = get();
    if (!gameState) return { valid: false, error: "No game" };

    const result = applyAction(gameState, action);
    if (result.valid && result.newState) {
      set({
        gameState: result.newState,
        lastEvents: result.events || [],
        error: null,
        activeAction: null,
        highlightedVertices: new Set(),
        highlightedEdges: new Set(),
        highlightedHexes: new Set(),
      });
    } else {
      set({ error: result.error || "Invalid action" });
    }
    return result;
  },

  setGameState: (state) => set({ gameState: state }),
  setActiveAction: (action) => set({ activeAction: action }),
  setHighlightedVertices: (vertices) => set({ highlightedVertices: vertices }),
  setHighlightedEdges: (edges) => set({ highlightedEdges: edges }),
  setHighlightedHexes: (hexes) => set({ highlightedHexes: hexes }),
  setBotThinking: (thinking) => set({ botThinking: thinking }),
  clearError: () => set({ error: null }),
}));
