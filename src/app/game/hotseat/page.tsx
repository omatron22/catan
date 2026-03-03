"use client";

import { useEffect, useCallback, useState, useRef } from "react";
import { useGameStore } from "@/app/stores/gameStore";
import HexBoard from "@/app/components/board/HexBoard";
import PlayerPanel from "@/app/components/ui/PlayerPanel";
import DiceDisplay from "@/app/components/ui/DiceDisplay";
import ActionBar from "@/app/components/ui/ActionBar";
import DiscardDialog from "@/app/components/ui/DiscardDialog";
import ResourceSelector from "@/app/components/ui/ResourceSelector";
import ChatBox from "@/app/components/ui/ChatBox";
import { ResourceCard, ResourceIcon } from "@/app/components/icons/ResourceIcons";
import { VPIcon } from "@/app/components/icons/GameIcons";
import { SwordPixel, ScrollPixel, CrownPixel } from "@/app/components/icons/PixelIcons";
import {
  playDiceRoll, playBuild, playTrade, playTurnNotification,
  playRobber, playSteal, playEndTurn, playDevCard, playError,
  playChat, playSetup, playWin, playCollect, playClick,
} from "@/app/utils/sounds";
import type { GameAction } from "@/shared/types/actions";
import type { GameState, GameLogEntry, Resource, DevelopmentCardType } from "@/shared/types/game";
import type { VertexKey, EdgeKey, HexKey } from "@/shared/types/coordinates";
import {
  adjacentVertices,
  edgesAtVertex,
  edgeEndpoints,
  hexVertices,
  parseHexKey,
} from "@/shared/utils/hexMath";
import { applyAction } from "@/server/engine/gameEngine";
import { decideBotAction, decideBotTradeResponse, generateBotCounterOffer } from "@/server/bots/botController";
import { PLAYER_COLOR_HEX, ALL_RESOURCES, RESOURCE_COLORS } from "@/shared/constants";

const HUMAN_PLAYER_INDEX = 0;
const BOT_DELAY_MS = 600;
const BOT_SETUP_DELAY_MS = 400;

const RESOURCE_LABELS: Record<Resource, string> = {
  brick: "BRK",
  lumber: "WOD",
  ore: "ORE",
  grain: "WHT",
  wool: "WOL",
};

interface PendingTradeUI {
  tradeState: GameState;
  tradeId: string;
  responses: Record<number, "pending" | "accepted" | "rejected">;
  counterOffers: Record<number, { offering: Partial<Record<Resource, number>>; requesting: Partial<Record<Resource, number>> } | null>;
  resolved: boolean;
  acceptors: number[];
}

export default function GamePage() {
  const {
    gameState,
    fullConfig,
    botIndices,
    activeAction,
    highlightedVertices,
    highlightedEdges,
    highlightedHexes,
    error,
    botThinking,
    initGame,
    dispatch,
    setGameState,
    setActiveAction,
    setHighlightedVertices,
    setHighlightedEdges,
    setHighlightedHexes,
    setBotThinking,
    clearError,
  } = useGameStore();

  const [flashSeven, setFlashSeven] = useState(false);

  // Inline trade state
  const [tradeMode, setTradeMode] = useState(false);
  const [offering, setOffering] = useState<Resource[]>([]);
  const [requesting, setRequesting] = useState<Resource[]>([]);
  const [shakenResource, setShakenResource] = useState<Resource | null>(null);

  const [pendingTradeUI, setPendingTradeUI] = useState<PendingTradeUI | null>(null);
  const botTimerRef = useRef<NodeJS.Timeout | null>(null);
  const tradeTimersRef = useRef<NodeJS.Timeout[]>([]);

  // Initialize game
  useEffect(() => {
    if (!gameState) {
      const fullStored = sessionStorage.getItem("catan-game-config");
      const legacyStored = sessionStorage.getItem("catan-config");
      if (fullStored) {
        const fullConfig = JSON.parse(fullStored);
        const legacyCfg = {
          playerName: fullConfig.players[0]?.name ?? "You",
          botNames: fullConfig.players.slice(1).map((p: { name: string }) => p.name),
        };
        initGame(legacyCfg, fullConfig);
      } else if (legacyStored) {
        const cfg = JSON.parse(legacyStored);
        initGame(cfg);
      } else {
        initGame({ playerName: "You", botNames: ["Alice", "Bob", "Carol"] });
      }
    }
  }, [gameState, initGame]);

  // === BOT AUTO-PLAY ===
  useEffect(() => {
    if (!gameState || gameState.phase === "finished" || gameState.phase === "waiting") return;

    if (botTimerRef.current) {
      clearTimeout(botTimerRef.current);
      botTimerRef.current = null;
    }

    if (gameState.turnPhase === "discard") {
      const botDiscarder = gameState.discardingPlayers.find((pi) => botIndices.includes(pi));
      if (botDiscarder !== undefined) {
        scheduleBotAction(gameState, botDiscarder, BOT_DELAY_MS);
        return;
      }
      return;
    }

    const currentPlayer = gameState.currentPlayerIndex;
    if (botIndices.includes(currentPlayer)) {
      const delay =
        gameState.phase === "setup-forward" || gameState.phase === "setup-reverse"
          ? BOT_SETUP_DELAY_MS
          : BOT_DELAY_MS;
      scheduleBotAction(gameState, currentPlayer, delay);
    }
  }, [gameState, botIndices]); // eslint-disable-line react-hooks/exhaustive-deps

  function scheduleBotAction(state: GameState, botIndex: number, delay: number) {
    setBotThinking(true);
    botTimerRef.current = setTimeout(() => {
      executeBotAction(state, botIndex);
    }, delay);
  }

  function playActionSound(actionType: string) {
    switch (actionType) {
      case "roll-dice": playDiceRoll(); break;
      case "build-road":
      case "build-settlement":
      case "build-city": playBuild(); break;
      case "place-settlement":
      case "place-road": playSetup(); break;
      case "bank-trade":
      case "offer-trade": playTrade(); break;
      case "move-robber": playRobber(); break;
      case "steal-resource": playSteal(); break;
      case "end-turn": playEndTurn(); break;
      case "buy-development-card": playDevCard(); break;
      case "play-knight": playRobber(); break;
      case "play-road-building":
      case "play-year-of-plenty":
      case "play-monopoly": playDevCard(); break;
      default: playClick(); break;
    }
  }

  function executeBotAction(state: GameState, botIndex: number) {
    const action = decideBotAction(state, botIndex);
    if (!action) {
      setBotThinking(false);
      return;
    }

    const result = applyAction(state, action);
    if (result.valid && result.newState) {
      playActionSound(action.type);
      setGameState(result.newState);
    } else {
      console.warn(`Bot ${botIndex} invalid action:`, action.type, result.error);
      if (action.type !== "end-turn" && state.currentPlayerIndex === botIndex && state.turnPhase === "trade-or-build") {
        const fallback = applyAction(state, { type: "end-turn", playerIndex: botIndex });
        if (fallback.valid && fallback.newState) {
          setGameState(fallback.newState);
        }
      }
    }
    setBotThinking(false);
  }

  useEffect(() => {
    return () => {
      if (botTimerRef.current) clearTimeout(botTimerRef.current);
      tradeTimersRef.current.forEach(clearTimeout);
    };
  }, []);

  // === SAFETY: clear stuck trade UI ===
  useEffect(() => {
    if (!gameState?.pendingTrade && pendingTradeUI) {
      tradeTimersRef.current.forEach(clearTimeout);
      tradeTimersRef.current = [];
      setPendingTradeUI(null);
      closeTrade();
    }
  }, [gameState?.pendingTrade]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (pendingTradeUI || tradeMode) {
      tradeTimersRef.current.forEach(clearTimeout);
      tradeTimersRef.current = [];
      setPendingTradeUI(null);
      closeTrade();
    }
  }, [gameState?.currentPlayerIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  // === HIGHLIGHT VALID PLACEMENTS ===
  useEffect(() => {
    if (!gameState || !activeAction) {
      setHighlightedVertices(new Set());
      setHighlightedEdges(new Set());
      setHighlightedHexes(new Set());
      return;
    }

    if (activeAction === "build-settlement" || activeAction === "setup-settlement") {
      const valid = new Set<VertexKey>();
      for (const [vk, building] of Object.entries(gameState.board.vertices)) {
        if (building !== null) continue;
        const adj = adjacentVertices(vk);
        if (adj.some((av) => gameState.board.vertices[av] !== null && gameState.board.vertices[av] !== undefined)) continue;
        if (gameState.phase === "main") {
          const edges = edgesAtVertex(vk);
          if (!edges.some((ek) => gameState.board.edges[ek]?.playerIndex === HUMAN_PLAYER_INDEX)) continue;
        }
        valid.add(vk);
      }
      setHighlightedVertices(valid);
    } else if (activeAction === "build-road" || activeAction === "setup-road") {
      const valid = new Set<EdgeKey>();
      for (const [ek, road] of Object.entries(gameState.board.edges)) {
        if (road !== null) continue;
        const [v1, v2] = edgeEndpoints(ek);
        let connected = false;
        for (const v of [v1, v2]) {
          const b = gameState.board.vertices[v];
          if (b && b.playerIndex === HUMAN_PLAYER_INDEX) { connected = true; break; }
          if (b && b.playerIndex !== HUMAN_PLAYER_INDEX) continue;
          const adjEdges = edgesAtVertex(v);
          if (adjEdges.some((ae) => ae !== ek && gameState.board.edges[ae]?.playerIndex === HUMAN_PLAYER_INDEX)) {
            connected = true; break;
          }
        }
        if (connected) valid.add(ek);
      }
      setHighlightedEdges(valid);
    } else if (activeAction === "build-city") {
      const valid = new Set<VertexKey>();
      for (const vk of gameState.players[HUMAN_PLAYER_INDEX].settlements) {
        valid.add(vk);
      }
      setHighlightedVertices(valid);
    } else if (activeAction === "move-robber") {
      const valid = new Set<HexKey>();
      for (const key of Object.keys(gameState.board.hexes)) {
        if (key !== gameState.board.robberHex) valid.add(key);
      }
      setHighlightedHexes(valid);
    }
  }, [activeAction, gameState, setHighlightedVertices, setHighlightedEdges, setHighlightedHexes]);

  // Auto-set active action for setup and special phases (human only)
  useEffect(() => {
    if (!gameState) return;
    if (gameState.currentPlayerIndex !== HUMAN_PLAYER_INDEX) return;

    if (gameState.phase === "setup-forward" || gameState.phase === "setup-reverse") {
      const isSettlement = gameState.setupPlacementsMade % 2 === 0;
      setActiveAction(isSettlement ? "setup-settlement" : "setup-road");
    } else if (gameState.turnPhase === "robber-place") {
      setActiveAction("move-robber");
    } else if (gameState.turnPhase === "road-building-1" || gameState.turnPhase === "road-building-2") {
      setActiveAction("build-road");
    }
  }, [gameState?.phase, gameState?.turnPhase, gameState?.setupPlacementsMade, gameState?.currentPlayerIndex, setActiveAction]);

  // === SOUND: play turn notification when it becomes human's turn ===
  const prevPlayerRef = useRef<number | null>(null);
  useEffect(() => {
    if (!gameState) return;
    const prev = prevPlayerRef.current;
    prevPlayerRef.current = gameState.currentPlayerIndex;
    if (
      prev !== null &&
      prev !== HUMAN_PLAYER_INDEX &&
      gameState.currentPlayerIndex === HUMAN_PLAYER_INDEX &&
      gameState.phase === "main"
    ) {
      playTurnNotification();
    }
  }, [gameState?.currentPlayerIndex, gameState?.phase]);

  // === SOUND: play win fanfare when game finishes ===
  const prevPhaseRef = useRef<string | null>(null);
  useEffect(() => {
    if (!gameState) return;
    if (gameState.phase === "finished" && prevPhaseRef.current !== "finished") {
      playWin();
    }
    prevPhaseRef.current = gameState.phase;
  }, [gameState?.phase]);

  // === SOUND: play error buzz when action fails ===
  useEffect(() => {
    if (error) playError();
  }, [error]);

  // === SOUND: play collect sound when human gains resources after dice ===
  const prevResourceTotal = useRef<number | null>(null);
  useEffect(() => {
    if (!gameState) return;
    const total = Object.values(gameState.players[HUMAN_PLAYER_INDEX].resources).reduce((s, n) => s + n, 0);
    if (prevResourceTotal.current !== null && total > prevResourceTotal.current && gameState.phase === "main") {
      playCollect();
    }
    prevResourceTotal.current = total;
  }, [gameState?.players[HUMAN_PLAYER_INDEX]?.resources]);

  // === INLINE TRADE HELPERS ===
  function getTradeRatio(resource: Resource): number {
    if (!gameState) return 4;
    const player = gameState.players[HUMAN_PLAYER_INDEX];
    if (player.portsAccess.includes(resource)) return 2;
    if (player.portsAccess.includes("any")) return 3;
    return 4;
  }

  function getBankTradeInfo(): { valid: boolean; giving: Resource; ratio: number } | null {
    if (offering.length === 0) return null;
    const res = offering[0];
    if (!offering.every((r) => r === res)) return null;
    const ratio = getTradeRatio(res);
    if (offering.length === ratio) return { valid: true, giving: res, ratio };
    return null;
  }

  function handleBankTrade(giving: Resource, receiving: Resource) {
    if (!gameState) return;
    const ratio = getTradeRatio(giving);
    const player = gameState.players[HUMAN_PLAYER_INDEX];
    if (player.resources[giving] < ratio) return;

    handleAction({
      type: "bank-trade",
      playerIndex: HUMAN_PLAYER_INDEX,
      giving,
      givingCount: ratio,
      receiving,
    });
    setOffering([]);
    setRequesting([]);
    setTradeMode(false);
  }

  function handlePlayerTrade() {
    if (offering.length === 0 || requesting.length === 0) return;

    const offerMap: Partial<Record<Resource, number>> = {};
    for (const r of offering) offerMap[r] = (offerMap[r] || 0) + 1;
    const requestMap: Partial<Record<Resource, number>> = {};
    for (const r of requesting) requestMap[r] = (requestMap[r] || 0) + 1;

    handleAction({
      type: "offer-trade",
      playerIndex: HUMAN_PLAYER_INDEX,
      offering: offerMap,
      requesting: requestMap,
      toPlayer: null,
    });
  }

  function closeTrade() {
    setTradeMode(false);
    setOffering([]);
    setRequesting([]);
  }

  function addToOffering(resource: Resource) {
    if (!gameState) return;
    const player = gameState.players[HUMAN_PLAYER_INDEX];
    const offeringCounts: Record<Resource, number> = { brick: 0, lumber: 0, ore: 0, grain: 0, wool: 0 };
    for (const r of offering) offeringCounts[r]++;
    if (offeringCounts[resource] >= player.resources[resource]) return;
    if (!tradeMode) setTradeMode(true);
    setOffering([...offering, resource]);
  }

  function removeFromOffering(index: number) {
    setOffering(offering.filter((_, i) => i !== index));
  }

  function addToRequesting(resource: Resource) {
    if (!gameState) return;
    // Count how many of this resource are already being requested
    const alreadyRequested = requesting.filter((r) => r === resource).length;
    // Check if ANY single opponent has more than that amount
    const canAnyOpponentFulfill = gameState.players.some(
      (p, i) => i !== HUMAN_PLAYER_INDEX && p.resources[resource] > alreadyRequested
    );
    if (!canAnyOpponentFulfill) {
      // Shake the button to indicate unavailable
      setShakenResource(resource);
      setTimeout(() => setShakenResource(null), 400);
      return;
    }
    setRequesting([...requesting, resource]);
  }

  function removeFromRequesting(index: number) {
    setRequesting(requesting.filter((_, i) => i !== index));
  }

  // === TRADE ORCHESTRATION ===
  function startTradeOrchestration(tradeState: GameState) {
    const trade = tradeState.pendingTrade;
    if (!trade) return;

    const responses: Record<number, "pending" | "accepted" | "rejected"> = {};
    const counterOffers: Record<number, { offering: Partial<Record<Resource, number>>; requesting: Partial<Record<Resource, number>> } | null> = {};
    for (const bi of botIndices) {
      if (trade.toPlayer === null || trade.toPlayer === bi) {
        responses[bi] = "pending";
        counterOffers[bi] = null;
      }
    }
    setPendingTradeUI({
      tradeState,
      tradeId: trade.id,
      responses,
      counterOffers,
      resolved: false,
      acceptors: [],
    });

    const respondingBots = Object.keys(responses).map(Number);
    const decisions: Array<{ botIndex: number; decision: "accept" | "reject" }> = [];

    tradeTimersRef.current.forEach(clearTimeout);
    tradeTimersRef.current = [];

    respondingBots.forEach((bi, i) => {
      const delay = 1000 + i * 1200 + Math.random() * 800;
      const timer = setTimeout(() => {
        const decision = decideBotTradeResponse(tradeState, bi);
        decisions.push({ botIndex: bi, decision });

        // Generate counter-offer on reject
        let counter: { offering: Partial<Record<Resource, number>>; requesting: Partial<Record<Resource, number>> } | null = null;
        if (decision === "reject") {
          counter = generateBotCounterOffer(tradeState, bi);
        }

        setPendingTradeUI((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            responses: {
              ...prev.responses,
              [bi]: decision === "accept" ? "accepted" : "rejected",
            },
            counterOffers: {
              ...prev.counterOffers,
              [bi]: counter,
            },
          };
        });

        // If all bots have responded, mark resolved for player choice
        if (decisions.length === respondingBots.length) {
          setTimeout(() => {
            const acceptors = decisions.filter((d) => d.decision === "accept").map((d) => d.botIndex);
            let shouldAutoCancel = false;
            setPendingTradeUI((prev) => {
              if (!prev) return null;
              const hasCounters = decisions.some(
                (d) => d.decision === "reject" && prev.counterOffers?.[d.botIndex] != null
              );
              if (acceptors.length === 0 && !hasCounters) {
                shouldAutoCancel = true;
              }
              return { ...prev, resolved: true, acceptors };
            });

            if (shouldAutoCancel) {
              setTimeout(() => cancelPendingTrade(tradeState, trade.id), 800);
            }
          }, 600);
        }
      }, delay);
      tradeTimersRef.current.push(timer);
    });
  }

  function cancelPendingTrade(tradeState: GameState, tradeId: string) {
    const result = applyAction(tradeState, {
      type: "cancel-trade",
      playerIndex: HUMAN_PLAYER_INDEX,
      tradeId,
    });
    if (result.valid && result.newState) {
      playError();
      setGameState(result.newState);
    }
    setPendingTradeUI(null);
    closeTrade();
  }

  function acceptTradeWith(botIndex: number) {
    if (!pendingTradeUI) return;
    const result = applyAction(pendingTradeUI.tradeState, {
      type: "accept-trade",
      playerIndex: botIndex,
      tradeId: pendingTradeUI.tradeId,
    });
    if (result.valid && result.newState) {
      playTrade();
      setGameState(result.newState);
    }
    setPendingTradeUI(null);
    closeTrade();
  }

  function declineAcceptor(botIndex: number) {
    setPendingTradeUI((prev) => {
      if (!prev) return null;
      const newAcceptors = prev.acceptors.filter((a) => a !== botIndex);
      // Also remove any counter-offer
      const newCounters = { ...prev.counterOffers, [botIndex]: null };
      // If no acceptors or counters left, cancel
      const hasCounters = Object.values(newCounters).some((c) => c != null);
      if (newAcceptors.length === 0 && !hasCounters) {
        setTimeout(() => cancelPendingTrade(prev.tradeState, prev.tradeId), 200);
        return null;
      }
      return { ...prev, acceptors: newAcceptors, counterOffers: newCounters };
    });
  }

  function acceptCounterOffer(botIndex: number) {
    if (!pendingTradeUI || !gameState) return;
    const counter = pendingTradeUI.counterOffers[botIndex];
    if (!counter) return;

    // Cancel the original trade first
    const cancelResult = applyAction(pendingTradeUI.tradeState, {
      type: "cancel-trade",
      playerIndex: HUMAN_PLAYER_INDEX,
      tradeId: pendingTradeUI.tradeId,
    });
    if (!cancelResult.valid || !cancelResult.newState) {
      setPendingTradeUI(null);
      closeTrade();
      return;
    }

    // Now offer the counter as a new trade and auto-accept
    const offerResult = applyAction(cancelResult.newState, {
      type: "offer-trade",
      playerIndex: HUMAN_PLAYER_INDEX,
      offering: counter.requesting, // We give what the bot requested
      requesting: counter.offering, // We get what the bot offered
      toPlayer: botIndex,
    });
    if (!offerResult.valid || !offerResult.newState || !offerResult.newState.pendingTrade) {
      setPendingTradeUI(null);
      closeTrade();
      return;
    }

    const acceptResult = applyAction(offerResult.newState, {
      type: "accept-trade",
      playerIndex: botIndex,
      tradeId: offerResult.newState.pendingTrade.id,
    });
    if (acceptResult.valid && acceptResult.newState) {
      playTrade();
      setGameState(acceptResult.newState);
    }
    setPendingTradeUI(null);
    closeTrade();
  }

  function declineAllTrades() {
    if (!pendingTradeUI) return;
    cancelPendingTrade(pendingTradeUI.tradeState, pendingTradeUI.tradeId);
  }

  // === ACTION HANDLERS ===
  const handleAction = useCallback((action: GameAction) => {
    clearError();
    const result = dispatch(action);

    // Special handling for offer-trade: start bot response orchestration
    if (action.type === "offer-trade" && result.valid && result.newState) {
      playTrade();
      startTradeOrchestration(result.newState);
      return;
    }

    // Flash hex lines on 7
    if (action.type === "roll-dice" && result.valid && result.newState?.lastDiceRoll) {
      const total = result.newState.lastDiceRoll.die1 + result.newState.lastDiceRoll.die2;
      if (total === 7) {
        setFlashSeven(true);
        setTimeout(() => setFlashSeven(false), 2000);
      }
    }

    // Play appropriate 8-bit sound
    playActionSound(action.type);
  }, [dispatch, clearError, gameState, botIndices]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleVertexClick = useCallback((vertex: VertexKey) => {
    if (!gameState) return;
    if (activeAction === "setup-settlement" || activeAction === "build-settlement") {
      const actionType = gameState.phase === "main" ? "build-settlement" : "place-settlement";
      handleAction({ type: actionType, playerIndex: HUMAN_PLAYER_INDEX, vertex } as GameAction);
    } else if (activeAction === "build-city") {
      handleAction({ type: "build-city", playerIndex: HUMAN_PLAYER_INDEX, vertex });
    }
  }, [gameState, activeAction, handleAction]);

  const handleEdgeClick = useCallback((edge: EdgeKey) => {
    if (!gameState) return;
    if (activeAction === "setup-road" || activeAction === "build-road") {
      const actionType = (gameState.phase === "setup-forward" || gameState.phase === "setup-reverse")
        ? "place-road" : "build-road";
      handleAction({ type: actionType, playerIndex: HUMAN_PLAYER_INDEX, edge } as GameAction);
    }
  }, [gameState, activeAction, handleAction]);

  const handleHexClick = useCallback((hex: HexKey) => {
    if (!gameState) return;
    if (activeAction === "move-robber") {
      handleAction({ type: "move-robber", playerIndex: HUMAN_PLAYER_INDEX, hex });
    }
  }, [gameState, activeAction, handleAction]);

  const handleSetActiveAction = useCallback((action: string | null) => {
    if (action === "trade") {
      setTradeMode(true);
    } else {
      setActiveAction(action);
    }
  }, [setActiveAction]);

  const handleSendChat = useCallback((message: string) => {
    if (!gameState) return;
    playChat();
    const entry: GameLogEntry = {
      timestamp: Date.now(),
      playerIndex: HUMAN_PLAYER_INDEX,
      message,
      type: "chat",
    };
    setGameState({ ...gameState, log: [...gameState.log, entry] });
  }, [gameState, setGameState]);

  // === RENDER ===
  if (!gameState) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#2a6ab5]">
        <div className="font-pixel text-[12px] text-[#8BC34A] animate-pulse">LOADING...</div>
      </div>
    );
  }

  if (gameState.phase === "finished") {
    const winner = gameState.players[gameState.winner!];
    const isHumanWinner = gameState.winner === HUMAN_PLAYER_INDEX;
    return (
      <div className="h-screen flex items-center justify-center bg-[#2a6ab5]">
        <div className="text-center bg-[#f0e6d0] pixel-border p-10 max-w-md">
          <div className="flex justify-center mb-4">
            <VPIcon size={48} color={isHumanWinner ? "#d97706" : "#ef4444"} />
          </div>
          <h2 className={`font-pixel text-[16px] mb-3 ${isHumanWinner ? "text-amber-600" : "text-red-500"}`}>
            {isHumanWinner ? "YOU WIN!" : `${winner.name.toUpperCase()} WINS!`}
          </h2>
          <p className="text-gray-600 mb-6 text-sm">
            {winner.victoryPoints + winner.hiddenVictoryPoints} victory points
          </p>
          <button
            onClick={() => {
              const fullStored = sessionStorage.getItem("catan-game-config");
              const legacyStored = sessionStorage.getItem("catan-config");
              if (fullStored) {
                const fc = JSON.parse(fullStored);
                const lc = { playerName: fc.players[0]?.name ?? "You", botNames: fc.players.slice(1).map((p: { name: string }) => p.name) };
                initGame(lc, fc);
              } else if (legacyStored) {
                initGame(JSON.parse(legacyStored));
              }
            }}
            className="px-8 py-3 bg-amber-400 text-gray-900 font-pixel text-[10px] pixel-btn"
          >
            PLAY AGAIN
          </button>
        </div>
      </div>
    );
  }

  // Build playerColors and buildingStyles from config
  const playerColors: Record<number, string> = {};
  const boardBuildingStyles: Record<number, import("@/shared/types/config").BuildingStyle> = {};
  if (gameState.players) {
    for (const p of gameState.players) {
      playerColors[p.index] = PLAYER_COLOR_HEX[p.color] ?? "#fff";
    }
  }
  if (fullConfig?.players) {
    for (let i = 0; i < fullConfig.players.length; i++) {
      const pc = fullConfig.players[i];
      if (pc.buildingStyle) {
        boardBuildingStyles[i] = pc.buildingStyle;
      }
    }
  }

  const isMyTurn = gameState.currentPlayerIndex === HUMAN_PLAYER_INDEX;
  const currentPlayer = gameState.players[gameState.currentPlayerIndex];
  const humanPlayer = gameState.players[HUMAN_PLAYER_INDEX];
  const needsDiscard = gameState.turnPhase === "discard" &&
    gameState.discardingPlayers.includes(HUMAN_PLAYER_INDEX);
  const needsStealTarget = gameState.turnPhase === "robber-steal" && isMyTurn;

  const stealTargets = needsStealTarget ? getStealTargets(gameState, HUMAN_PLAYER_INDEX) : [];

  // Phase info
  let phaseText = "";
  if (gameState.phase === "setup-forward" || gameState.phase === "setup-reverse") {
    if (isMyTurn) {
      const isSettlement = gameState.setupPlacementsMade % 2 === 0;
      phaseText = `PLACE ${isSettlement ? "SETTLEMENT" : "ROAD"}`;
    } else {
      phaseText = `${currentPlayer.name.toUpperCase()} PLACING...`;
    }
  } else if (isMyTurn) {
    switch (gameState.turnPhase) {
      case "roll": phaseText = "ROLL THE DICE"; break;
      case "discard": phaseText = "WAITING FOR DISCARDS..."; break;
      case "robber-place": phaseText = "MOVE THE ROBBER"; break;
      case "robber-steal": phaseText = "CHOOSE STEAL TARGET"; break;
      case "trade-or-build": phaseText = "TRADE OR BUILD"; break;
      case "road-building-1": phaseText = "PLACE ROAD 1/2"; break;
      case "road-building-2": phaseText = "PLACE ROAD 2/2"; break;
    }
  } else {
    phaseText = `${currentPlayer.name.toUpperCase()} THINKING...`;
  }

  const humanResources = Object.entries(humanPlayer.resources) as [Resource, number][];
  const canTradeOrBuild = gameState.phase === "main" && isMyTurn && gameState.turnPhase === "trade-or-build";
  const opponents = gameState.players.filter((p) => p.index !== HUMAN_PLAYER_INDEX);

  // Compute bank resources: 19 total per type minus all players' holdings
  const bankResources = ALL_RESOURCES.map((res) => {
    const held = gameState.players.reduce((sum, p) => sum + p.resources[res], 0);
    return { resource: res, count: 19 - held };
  });

  const bankInfo = tradeMode ? getBankTradeInfo() : null;
  const showTradeStrip = tradeMode && canTradeOrBuild && !pendingTradeUI;
  const showTradeOverlay = pendingTradeUI !== null;

  return (
    <div className="h-screen flex overflow-hidden bg-[#2a6ab5]">
      {/* Left column: board + trade strips + bottom bar */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Board: fills remaining space */}
        <div className="flex-1 flex items-center justify-center p-1 min-h-0 min-w-0 overflow-hidden relative">
          <HexBoard
            board={gameState.board}
            size={50}
            highlightedVertices={highlightedVertices}
            highlightedEdges={highlightedEdges}
            highlightedHexes={highlightedHexes}
            flashSeven={flashSeven}
            playerColors={playerColors}
            buildingStyles={boardBuildingStyles}
            onVertexClick={isMyTurn ? handleVertexClick : undefined}
            onEdgeClick={isMyTurn ? handleEdgeClick : undefined}
            onHexClick={isMyTurn ? handleHexClick : undefined}
          />

          {/* Floating overlays — positioned at bottom of board area */}
          <div className="absolute bottom-2 right-2 left-2 flex items-end justify-between gap-2 pointer-events-none" style={{ zIndex: 20 }}>
            {/* Left side: trade panels */}
            <div className="flex flex-col gap-2">
            {showTradeStrip && (
              <div className="bg-[#1a1a2e]/95 border-2 border-[#3a3a5e] px-3 py-2 pointer-events-auto" style={{ backdropFilter: "blur(4px)" }}>
                <div className="flex items-center gap-3">
                  {/* Offering section */}
                  <div className="flex items-center gap-1">
                    <span className="text-[7px] text-green-400 mr-1">OFFERING:</span>
                    {offering.length === 0 ? (
                      <span className="text-[6px] text-gray-600">click cards below</span>
                    ) : (
                      offering.map((res, i) => (
                        <MiniCard key={`o-${i}`} resource={res} onClick={() => removeFromOffering(i)} glow="green" />
                      ))
                    )}
                  </div>

                  {/* Swap icon */}
                  <span className="text-[12px] text-amber-400">&#8644;</span>

                  {/* Requesting section */}
                  <div className="flex items-center gap-1">
                    <span className="text-[7px] text-red-400 mr-1">REQUESTING:</span>
                    {requesting.length === 0 ? (
                      <span className="text-[6px] text-gray-600">click + buttons</span>
                    ) : (
                      requesting.map((res, i) => (
                        <MiniCard key={`r-${i}`} resource={res} onClick={() => removeFromRequesting(i)} glow="red" />
                      ))
                    )}
                  </div>

                  {/* Request resource buttons */}
                  <div className="flex gap-1">
                    {ALL_RESOURCES.map((res) => (
                      <button
                        key={res}
                        onClick={() => addToRequesting(res)}
                        className={`w-7 h-7 flex items-center justify-center border border-[#3a3a5e] hover:border-white transition-colors${shakenResource === res ? " res-shake" : ""}`}
                        style={{ backgroundColor: RESOURCE_COLORS[res] }}
                        title={`Request ${RESOURCE_LABELS[res]}`}
                      >
                        <ResourceIcon resource={res} size={14} />
                      </button>
                    ))}
                  </div>

                  {/* Bank trade button */}
                  {bankInfo ? (
                    <div className="flex items-center gap-1">
                      <span className="text-[6px] text-gray-400">{bankInfo.ratio}:1</span>
                      {ALL_RESOURCES.filter((r) => r !== bankInfo.giving).map((res) => (
                        <button
                          key={res}
                          onClick={() => handleBankTrade(bankInfo.giving, res)}
                          className="w-6 h-6 flex items-center justify-center border border-black hover:border-amber-400"
                          style={{ backgroundColor: RESOURCE_COLORS[res] }}
                          title={`Bank: get ${RESOURCE_LABELS[res]}`}
                        >
                          <ResourceIcon resource={res} size={12} />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <button
                      disabled
                      className="px-2 py-1 bg-[#2a2a4e] text-gray-600 text-[6px] border border-[#3a3a5e] cursor-not-allowed"
                    >
                      BANK
                    </button>
                  )}

                  {/* Offer to players */}
                  <button
                    onClick={handlePlayerTrade}
                    disabled={offering.length === 0 || requesting.length === 0}
                    className={`px-2 py-1 text-[7px] pixel-btn ${
                      offering.length > 0 && requesting.length > 0
                        ? "bg-green-600 text-white"
                        : "bg-[#2a2a4e] text-gray-600 cursor-not-allowed"
                    }`}
                  >
                    OFFER
                  </button>

                  {/* Close */}
                  <button
                    onClick={closeTrade}
                    className="px-2 py-1 text-[7px] text-gray-400 pixel-btn bg-[#2a2a4e] hover:bg-[#3a3a5e]"
                  >
                    X
                  </button>
                </div>
              </div>
            )}

            {/* Trade response overlay */}
            {showTradeOverlay && gameState.pendingTrade && (
              <div className="bg-[#1a1a2e]/95 border-2 border-amber-500/50 px-3 py-2 pointer-events-auto" style={{ backdropFilter: "blur(4px)" }}>
                <div className="flex items-center gap-3">
                  <span className="text-[8px] text-amber-400">
                    {pendingTradeUI.resolved ? "CHOOSE:" : "WAITING..."}
                  </span>

                  <div className="flex gap-2">
                    {Object.entries(pendingTradeUI.responses).map(([idxStr, status]) => {
                      const idx = Number(idxStr);
                      const p = gameState.players[idx];
                      const color = PLAYER_COLOR_HEX[p.color];
                      const isAcceptor = pendingTradeUI.resolved && pendingTradeUI.acceptors.includes(idx);
                      const counter = pendingTradeUI.counterOffers[idx];

                      return (
                        <div key={idx} className="flex items-center gap-1.5 px-2 py-1 bg-[#0d0d1a] border border-[#3a3a5e]">
                          <span className="text-[8px] font-bold" style={{ color }}>
                            {p.name.toUpperCase()}
                          </span>

                          {status === "pending" && (
                            <span className="text-[7px] text-gray-400 animate-pulse">...</span>
                          )}

                          {status === "rejected" && !counter && (
                            <span className="text-[7px] text-red-400">NO</span>
                          )}

                          {status === "rejected" && counter && pendingTradeUI.resolved && (
                            <div className="flex items-center gap-1">
                              <span className="text-[6px] text-yellow-400">COUNTER:</span>
                              <div className="flex gap-0.5">
                                {Object.entries(counter.offering).map(([r, amt]) => (
                                  <span key={r} className="text-[6px] text-green-300">{amt}{RESOURCE_LABELS[r as Resource]}</span>
                                ))}
                              </div>
                              <span className="text-[6px] text-gray-500">for</span>
                              <div className="flex gap-0.5">
                                {Object.entries(counter.requesting).map(([r, amt]) => (
                                  <span key={r} className="text-[6px] text-red-300">{amt}{RESOURCE_LABELS[r as Resource]}</span>
                                ))}
                              </div>
                              <button
                                onClick={() => acceptCounterOffer(idx)}
                                className="px-1.5 py-0.5 bg-amber-500 text-black text-[6px] border border-black hover:bg-amber-400"
                              >
                                ACCEPT
                              </button>
                            </div>
                          )}

                          {isAcceptor && (
                            <div className="flex gap-1">
                              <button
                                onClick={() => acceptTradeWith(idx)}
                                className="px-2 py-0.5 bg-green-600 text-white text-[7px] border border-black hover:bg-green-500"
                              >
                                TRADE
                              </button>
                              <button
                                onClick={() => declineAcceptor(idx)}
                                className="px-2 py-0.5 bg-red-700 text-white text-[7px] border border-black hover:bg-red-600"
                              >
                                DECLINE
                              </button>
                            </div>
                          )}

                          {status === "accepted" && !pendingTradeUI.resolved && (
                            <span className="text-[7px] text-green-400">YES</span>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Decline All */}
                  {pendingTradeUI.resolved && (
                    <button
                      onClick={declineAllTrades}
                      className="px-2 py-1 bg-red-800 text-white text-[7px] pixel-btn hover:bg-red-700"
                    >
                      DECLINE ALL
                    </button>
                  )}
                </div>
              </div>
            )}
            </div>

            {/* Dice */}
            {gameState.phase === "main" && (
              <div className="pointer-events-auto">
                {gameState.turnPhase === "roll" && isMyTurn ? (
                  <DiceDisplay
                    roll={null}
                    canRoll={true}
                    onRoll={() => handleAction({ type: "roll-dice", playerIndex: HUMAN_PLAYER_INDEX })}
                  />
                ) : gameState.lastDiceRoll ? (
                  <DiceDisplay roll={gameState.lastDiceRoll} canRoll={false} onRoll={() => {}} />
                ) : null}
              </div>
            )}
          </div>
        </div>

      {/* Bottom bar */}
      <div className="h-20 bg-[#2a5a4a] border-t-4 border-black flex items-center px-2 gap-2">
        {/* Resource cards — individually clickable in trade mode */}
        <div className="flex items-end gap-0.5">
          {humanResources
            .filter(([, count]) => count > 0)
            .map(([res, count]) => (
              <div
                key={res}
                className={canTradeOrBuild ? "cursor-pointer" : ""}
                onClick={canTradeOrBuild ? () => addToOffering(res) : undefined}
                title={canTradeOrBuild ? `Click to offer ${RESOURCE_LABELS[res]}` : undefined}
              >
                <ResourceCard resource={res} count={count} />
              </div>
            ))}

          {/* Existing dev cards (always visible) */}
          {humanPlayer.developmentCards.length > 0 &&
            humanPlayer.developmentCards.map((card: DevelopmentCardType, i: number) => (
              <div
                key={`dev-${i}`}
                className="w-10 h-14 flex flex-col items-center justify-center border-2 border-black bg-purple-700 relative"
                title={formatDevCard(card)}
              >
                {card === "knight" ? (
                  <SwordPixel size={14} color="white" />
                ) : card === "victoryPoint" ? (
                  <CrownPixel size={14} color="#fbbf24" />
                ) : (
                  <ScrollPixel size={14} color="white" />
                )}
                <span className="text-[5px] text-purple-200">{formatDevCardShort(card)}</span>
              </div>
            ))}

          {/* New dev cards (bought this turn, locked) */}
          {humanPlayer.newDevelopmentCards.length > 0 &&
            humanPlayer.newDevelopmentCards.map((card: DevelopmentCardType, i: number) => (
              <div
                key={`new-${i}`}
                className="w-10 h-14 flex flex-col items-center justify-center border-2 border-dashed border-purple-400 bg-purple-900/50 opacity-60 relative"
                title={`${formatDevCard(card)} (new - can't play yet)`}
              >
                {card === "knight" ? (
                  <SwordPixel size={14} color="#a78bfa" />
                ) : card === "victoryPoint" ? (
                  <CrownPixel size={14} color="#fbbf24" />
                ) : (
                  <ScrollPixel size={14} color="#a78bfa" />
                )}
                <span className="text-[5px] text-purple-300">{formatDevCardShort(card)}</span>
                <span className="absolute -top-1 -right-1 bg-amber-500 text-black text-[5px] px-0.5 border border-black leading-none py-0.5">
                  NEW
                </span>
              </div>
            ))}
        </div>

        {/* Steal target buttons */}
        {needsStealTarget && (
          <div className="flex gap-1.5 items-center ml-2">
            <span className="font-pixel text-[7px] text-white">STEAL:</span>
            {stealTargets.map((targetIdx) => (
              <button
                key={targetIdx}
                onClick={() => handleAction({
                  type: "steal-resource",
                  playerIndex: HUMAN_PLAYER_INDEX,
                  targetPlayer: targetIdx,
                })}
                className="px-2 py-1 font-pixel text-[7px] pixel-btn bg-[#e8d8b8]"
                style={{
                  color: PLAYER_COLOR_HEX[gameState.players[targetIdx].color],
                }}
              >
                {gameState.players[targetIdx].name.toUpperCase()}
              </button>
            ))}
          </div>
        )}

        {/* Status center */}
        <div className="flex-1 text-center">
          <div className={`font-pixel text-[9px] ${isMyTurn ? "text-yellow-300" : "text-gray-400"}`}>
            {isMyTurn ? "YOUR TURN" : `${currentPlayer.name.toUpperCase()}'S TURN`}
          </div>
          <div className="font-pixel text-[7px] text-gray-300 mt-0.5">
            {phaseText}
            {botThinking && !isMyTurn && (
              <span className="animate-pulse ml-1">...</span>
            )}
          </div>
          {error && <div className="font-pixel text-[7px] text-red-400 mt-0.5">{error}</div>}
        </div>

        {/* Action buttons */}
        {canTradeOrBuild && (
          <ActionBar
            gameState={gameState}
            localPlayerIndex={HUMAN_PLAYER_INDEX}
            onAction={handleAction}
            activeAction={activeAction}
            setActiveAction={handleSetActiveAction}
          />
        )}
      </div>
      </div>{/* end left column */}

      {/* Right sidebar — full height */}
      <div className="w-72 flex flex-col bg-[#f0e6d0] border-l-4 border-black">
        {/* Chat fills the top */}
        <ChatBox
          log={gameState.log}
          playerColors={gameState.players.map((p) => p.color)}
          playerNames={gameState.players.map((p) => p.name)}
          localPlayerIndex={HUMAN_PLAYER_INDEX}
          onSendChat={handleSendChat}
        />

        {/* Bank resource row */}
        <div className="flex items-center justify-center gap-2 px-2 py-2 bg-white/90 border-t-2 border-gray-300">
          {bankResources.map(({ resource, count }) => (
            <div key={resource} className="flex flex-col items-center">
              <div
                className="w-8 h-8 flex items-center justify-center border-2 border-black"
                style={{ backgroundColor: RESOURCE_COLORS[resource], boxShadow: "1px 1px 0 #000" }}
              >
                <ResourceIcon resource={resource} size={16} color="white" />
              </div>
              <span className="text-[7px] text-gray-600 mt-0.5">{count}</span>
            </div>
          ))}
        </div>

        {/* Opponent panels */}
        <div className="space-y-0.5 px-1.5 py-1">
          {opponents.map((p) => (
            <PlayerPanel
              key={p.index}
              player={p}
              isCurrentTurn={p.index === gameState.currentPlayerIndex}
              isLocalPlayer={false}
            />
          ))}
        </div>

        {/* Local player panel */}
        <div className="px-1.5 pb-1.5">
          <PlayerPanel
            player={humanPlayer}
            isCurrentTurn={isMyTurn}
            isLocalPlayer={true}
          />
        </div>
      </div>

      {/* Dialogs */}
      {needsDiscard && (
        <DiscardDialog
          player={humanPlayer}
          playerIndex={HUMAN_PLAYER_INDEX}
          onAction={handleAction}
        />
      )}

      {activeAction === "monopoly" && (
        <ResourceSelector
          type="monopoly"
          playerIndex={HUMAN_PLAYER_INDEX}
          onAction={handleAction}
          onClose={() => setActiveAction(null)}
        />
      )}

      {activeAction === "year-of-plenty" && (
        <ResourceSelector
          type="year-of-plenty"
          playerIndex={HUMAN_PLAYER_INDEX}
          onAction={handleAction}
          onClose={() => setActiveAction(null)}
        />
      )}
    </div>
  );
}

function MiniCard({
  resource,
  onClick,
  glow,
}: {
  resource: Resource;
  onClick: () => void;
  glow?: "green" | "red";
}) {
  const bg = RESOURCE_COLORS[resource];
  const borderColor = glow === "green" ? "#22c55e" : glow === "red" ? "#ef4444" : "#000";
  const shadowColor = glow === "green" ? "0 0 4px #22c55e" : glow === "red" ? "0 0 4px #ef4444" : "none";

  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center justify-center select-none hover:scale-105 transition-transform active:scale-95"
      style={{
        width: 30,
        height: 36,
        backgroundColor: bg,
        border: `2px solid ${borderColor}`,
        boxShadow: `2px 2px 0 #000${shadowColor !== "none" ? `, ${shadowColor}` : ""}`,
      }}
    >
      <ResourceIcon resource={resource} size={14} />
      <span className="font-pixel" style={{ fontSize: 5, color: "white", textShadow: "1px 1px 0 rgba(0,0,0,0.6)" }}>
        {RESOURCE_LABELS[resource]}
      </span>
    </button>
  );
}

function formatDevCard(card: DevelopmentCardType): string {
  switch (card) {
    case "knight": return "Knight";
    case "roadBuilding": return "Road Building";
    case "yearOfPlenty": return "Year of Plenty";
    case "monopoly": return "Monopoly";
    case "victoryPoint": return "Victory Point";
  }
}

function formatDevCardShort(card: DevelopmentCardType): string {
  switch (card) {
    case "knight": return "KNT";
    case "roadBuilding": return "RDB";
    case "yearOfPlenty": return "YOP";
    case "monopoly": return "MON";
    case "victoryPoint": return "VP";
  }
}

function getStealTargets(state: GameState, playerIndex: number): number[] {
  const targets = new Set<number>();
  const hexCoord = parseHexKey(state.board.robberHex);
  const vertices = hexVertices(hexCoord);
  for (const vk of vertices) {
    const building = state.board.vertices[vk];
    if (building && building.playerIndex !== playerIndex) {
      const res = state.players[building.playerIndex].resources;
      const total = Object.values(res).reduce((s: number, n) => s + n, 0);
      if (total > 0) targets.add(building.playerIndex);
    }
  }
  return Array.from(targets);
}
