"use client";

import { useEffect, useCallback, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useSocket } from "@/app/hooks/useSocket";
import { useMultiplayerStore } from "@/app/stores/multiplayerStore";
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
import type { Resource, DevelopmentCardType, GameLogEntry } from "@/shared/types/game";
import type { ClientGameState, LobbyPlayer } from "@/shared/types/messages";
import type { VertexKey, EdgeKey, HexKey } from "@/shared/types/coordinates";
import {
  adjacentVertices,
  edgesAtVertex,
  edgeEndpoints,
  hexVertices,
  parseHexKey,
} from "@/shared/utils/hexMath";
import { PLAYER_COLOR_HEX, ALL_RESOURCES, RESOURCE_COLORS } from "@/shared/constants";

const RESOURCE_LABELS: Record<Resource, string> = {
  brick: "BRK",
  lumber: "WOD",
  ore: "ORE",
  grain: "WHT",
  wool: "WOL",
};

export default function OnlineGamePage() {
  const router = useRouter();
  const { socket, connected } = useSocket();
  const mpStore = useMultiplayerStore();
  const {
    roomCode,
    playerIndex: myPlayerIndex,
    reconnectToken,
    lobbyPlayers,
    gameState,
    lastEvents,
    error,
    chatMessages,
  } = mpStore;

  // Local UI state
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [highlightedVertices, setHighlightedVertices] = useState<Set<VertexKey>>(new Set());
  const [highlightedEdges, setHighlightedEdges] = useState<Set<EdgeKey>>(new Set());
  const [highlightedHexes, setHighlightedHexes] = useState<Set<HexKey>>(new Set());
  const [flashSeven, setFlashSeven] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  // Trade UI state
  const [tradeMode, setTradeMode] = useState(false);
  const [offering, setOffering] = useState<Resource[]>([]);
  const [requesting, setRequesting] = useState<Resource[]>([]);
  const [shakenResource, setShakenResource] = useState<Resource | null>(null);

  // Lobby state
  const [isHost, setIsHost] = useState(false);

  // --- Socket event listeners ---
  useEffect(() => {
    if (!socket) return;

    const onJoined = ({ roomCode: code, playerIndex: idx, reconnectToken: token }: { roomCode: string; playerIndex: number; reconnectToken: string }) => {
      mpStore.setRoomJoined(code, idx, token);
    };

    const onState = ({ state }: { state: ClientGameState }) => {
      mpStore.setGameState(state);
    };

    const onEvents = ({ events }: { events: import("@/shared/types/actions").GameEvent[] }) => {
      mpStore.setEvents(events);
    };

    const onError = ({ message }: { message: string }) => {
      setLocalError(message);
      setTimeout(() => setLocalError(null), 3000);
    };

    const onLobby = ({ players }: { players: LobbyPlayer[] }) => {
      mpStore.setLobbyPlayers(players);
    };

    const onChat = (msg: { playerIndex: number; playerName: string; text: string; timestamp: number }) => {
      mpStore.addChatMessage(msg);
      playChat();
    };

    socket.on("room:joined", onJoined);
    socket.on("game:state", onState);
    socket.on("game:events", onEvents);
    socket.on("game:error", onError);
    socket.on("room:lobby-state", onLobby);
    socket.on("chat:message", onChat);

    return () => {
      socket.off("room:joined", onJoined);
      socket.off("game:state", onState);
      socket.off("game:events", onEvents);
      socket.off("game:error", onError);
      socket.off("room:lobby-state", onLobby);
      socket.off("chat:message", onChat);
    };
  }, [socket]); // eslint-disable-line react-hooks/exhaustive-deps

  // Redirect if no room
  useEffect(() => {
    if (!roomCode) router.push("/");
  }, [roomCode, router]);

  // Track host status
  useEffect(() => {
    if (myPlayerIndex === 0) setIsHost(true);
  }, [myPlayerIndex]);

  // Reconnect on page load if we have a token
  useEffect(() => {
    if (!socket || !connected || gameState || !roomCode) return;
    if (reconnectToken) {
      socket.emit("room:join", {
        roomCode,
        playerName: "",
        reconnectToken,
      });
    }
  }, [socket, connected, roomCode, reconnectToken]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Sound effects ---
  const prevPlayerRef = useRef<number | null>(null);
  useEffect(() => {
    if (!gameState || myPlayerIndex === null) return;
    const prev = prevPlayerRef.current;
    prevPlayerRef.current = gameState.currentPlayerIndex;
    if (prev !== null && prev !== myPlayerIndex && gameState.currentPlayerIndex === myPlayerIndex && gameState.phase === "main") {
      playTurnNotification();
    }
  }, [gameState?.currentPlayerIndex, gameState?.phase, myPlayerIndex]);

  const prevPhaseRef = useRef<string | null>(null);
  useEffect(() => {
    if (!gameState) return;
    if (gameState.phase === "finished" && prevPhaseRef.current !== "finished") playWin();
    prevPhaseRef.current = gameState.phase;
  }, [gameState?.phase]);

  useEffect(() => {
    if (localError) playError();
  }, [localError]);

  // --- Event-based sound effects ---
  useEffect(() => {
    if (!lastEvents || lastEvents.length === 0) return;
    for (const event of lastEvents) {
      switch (event.type) {
        case "dice-rolled": playDiceRoll(); break;
        case "settlement-built":
        case "city-built":
        case "road-built": playBuild(); break;
        case "trade-completed": playTrade(); break;
        case "robber-moved": playRobber(); break;
        case "resource-stolen": playSteal(); break;
        case "turn-ended": playEndTurn(); break;
        case "development-card-bought":
        case "knight-played":
        case "road-building-played":
        case "year-of-plenty-played":
        case "monopoly-played": playDevCard(); break;
        case "resources-distributed": playCollect(); break;
      }
    }
  }, [lastEvents]);

  // --- Highlight valid placements ---
  useEffect(() => {
    if (!gameState || !activeAction || myPlayerIndex === null) {
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
          if (!edges.some((ek) => gameState.board.edges[ek]?.playerIndex === myPlayerIndex)) continue;
        }
        valid.add(vk);
      }
      setHighlightedVertices(valid);
    } else if (activeAction === "build-road" || activeAction === "setup-road") {
      const valid = new Set<EdgeKey>();
      for (const [ek, road] of Object.entries(gameState.board.edges)) {
        if (road !== null) continue;
        const [v1, v2] = edgeEndpoints(ek);
        let isConnected = false;
        for (const v of [v1, v2]) {
          const b = gameState.board.vertices[v];
          if (b && b.playerIndex === myPlayerIndex) { isConnected = true; break; }
          if (b && b.playerIndex !== myPlayerIndex) continue;
          const adjEdges = edgesAtVertex(v);
          if (adjEdges.some((ae) => ae !== ek && gameState.board.edges[ae]?.playerIndex === myPlayerIndex)) {
            isConnected = true; break;
          }
        }
        if (isConnected) valid.add(ek);
      }
      setHighlightedEdges(valid);
    } else if (activeAction === "build-city") {
      const valid = new Set<VertexKey>();
      for (const vk of gameState.players[myPlayerIndex].settlements) {
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
  }, [activeAction, gameState, myPlayerIndex]);

  // Auto-set active action for setup and special phases
  useEffect(() => {
    if (!gameState || myPlayerIndex === null) return;
    if (gameState.currentPlayerIndex !== myPlayerIndex) return;

    if (gameState.phase === "setup-forward" || gameState.phase === "setup-reverse") {
      const isSettlement = gameState.setupPlacementsMade % 2 === 0;
      setActiveAction(isSettlement ? "setup-settlement" : "setup-road");
    } else if (gameState.turnPhase === "robber-place") {
      setActiveAction("move-robber");
    } else if (gameState.turnPhase === "road-building-1" || gameState.turnPhase === "road-building-2") {
      setActiveAction("build-road");
    }
  }, [gameState?.phase, gameState?.turnPhase, gameState?.setupPlacementsMade, gameState?.currentPlayerIndex, myPlayerIndex]);

  // Reset trade mode on turn change
  useEffect(() => {
    closeTrade();
  }, [gameState?.currentPlayerIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Action dispatch (via socket) ---
  const handleAction = useCallback((action: GameAction) => {
    if (!socket) return;
    setLocalError(null);
    socket.emit("game:action", { action });

    // Flash hex lines on 7 (optimistic — server will confirm)
    if (action.type === "roll-dice") {
      // Sound will be triggered by events from server
    }
  }, [socket]);

  const handleVertexClick = useCallback((vertex: VertexKey) => {
    if (!gameState || myPlayerIndex === null) return;
    if (activeAction === "setup-settlement" || activeAction === "build-settlement") {
      const actionType = gameState.phase === "main" ? "build-settlement" : "place-settlement";
      handleAction({ type: actionType, playerIndex: myPlayerIndex, vertex } as GameAction);
    } else if (activeAction === "build-city") {
      handleAction({ type: "build-city", playerIndex: myPlayerIndex, vertex });
    }
  }, [gameState, activeAction, handleAction, myPlayerIndex]);

  const handleEdgeClick = useCallback((edge: EdgeKey) => {
    if (!gameState || myPlayerIndex === null) return;
    if (activeAction === "setup-road" || activeAction === "build-road") {
      const actionType = (gameState.phase === "setup-forward" || gameState.phase === "setup-reverse")
        ? "place-road" : "build-road";
      handleAction({ type: actionType, playerIndex: myPlayerIndex, edge } as GameAction);
    }
  }, [gameState, activeAction, handleAction, myPlayerIndex]);

  const handleHexClick = useCallback((hex: HexKey) => {
    if (!gameState || myPlayerIndex === null) return;
    if (activeAction === "move-robber") {
      handleAction({ type: "move-robber", playerIndex: myPlayerIndex, hex });
    }
  }, [gameState, activeAction, handleAction, myPlayerIndex]);

  const handleSetActiveAction = useCallback((action: string | null) => {
    if (action === "trade") {
      setTradeMode(true);
    } else {
      setActiveAction(action);
    }
  }, []);

  const handleSendChat = useCallback((message: string) => {
    if (!socket) return;
    playChat();
    socket.emit("chat:message", { text: message });
  }, [socket]);

  // --- Trade helpers ---
  function getTradeRatio(resource: Resource): number {
    if (!gameState || myPlayerIndex === null) return 4;
    const player = gameState.players[myPlayerIndex];
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
    if (!gameState || myPlayerIndex === null) return;
    const ratio = getTradeRatio(giving);
    handleAction({
      type: "bank-trade",
      playerIndex: myPlayerIndex,
      giving,
      givingCount: ratio,
      receiving,
    });
    closeTrade();
  }

  function handlePlayerTrade() {
    if (offering.length === 0 || requesting.length === 0 || myPlayerIndex === null) return;
    const offerMap: Partial<Record<Resource, number>> = {};
    for (const r of offering) offerMap[r] = (offerMap[r] || 0) + 1;
    const requestMap: Partial<Record<Resource, number>> = {};
    for (const r of requesting) requestMap[r] = (requestMap[r] || 0) + 1;
    handleAction({
      type: "offer-trade",
      playerIndex: myPlayerIndex,
      offering: offerMap,
      requesting: requestMap,
      toPlayer: null,
    });
    closeTrade();
  }

  function closeTrade() {
    setTradeMode(false);
    setOffering([]);
    setRequesting([]);
  }

  function addToOffering(resource: Resource) {
    if (!gameState || myPlayerIndex === null) return;
    const player = gameState.players[myPlayerIndex];
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
    setRequesting([...requesting, resource]);
  }

  function removeFromRequesting(index: number) {
    setRequesting(requesting.filter((_, i) => i !== index));
  }

  // --- Lobby actions ---
  function handleAddBot() {
    if (!socket) return;
    socket.emit("room:add-bot", { difficulty: "medium" });
  }

  function handleStartGame() {
    if (!socket) return;
    socket.emit("room:start-game", {});
  }

  // --- Render ---

  // Not connected or no room
  if (!roomCode || myPlayerIndex === null) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#2a6ab5]">
        <div className="font-pixel text-[12px] text-[#8BC34A] animate-pulse">CONNECTING...</div>
      </div>
    );
  }

  // Lobby — waiting to start
  if (!gameState) {
    const shareUrl = typeof window !== "undefined" ? `${window.location.origin}/join/${roomCode}` : "";
    return (
      <div className="h-screen flex items-center justify-center bg-[#2a6ab5]">
        <div className="bg-[#f0e6d0] pixel-border p-8 w-96 text-center">
          <h1
            className="font-pixel text-[20px] text-amber-400 mb-2"
            style={{ textShadow: "2px 2px 0 #000" }}
          >
            ERFINDUNG
          </h1>
          <p className="font-pixel text-[10px] text-gray-600 mb-1">ROOM CODE</p>
          <div className="flex items-center justify-center gap-2 mb-4">
            <span className="font-pixel text-[28px] text-amber-600 tracking-[0.3em]">{roomCode}</span>
            <button
              onClick={() => navigator.clipboard.writeText(shareUrl)}
              className="px-2 py-1 bg-gray-200 border-2 border-black font-pixel text-[7px] hover:bg-gray-300"
              title="Copy invite link"
            >
              COPY LINK
            </button>
          </div>

          <div className="bg-[#e8d8b8] border-2 border-black p-3 mb-4">
            <p className="font-pixel text-[8px] text-gray-600 mb-2">PLAYERS ({lobbyPlayers.length}/6)</p>
            <div className="space-y-1">
              {lobbyPlayers.map((p) => (
                <div key={p.index} className="flex items-center justify-between bg-white/50 px-2 py-1 border border-gray-300">
                  <span className="font-pixel text-[9px] text-gray-800">
                    {p.name} {p.isBot && <span className="text-gray-500 text-[7px]">(BOT)</span>}
                  </span>
                  <span className={`font-pixel text-[7px] ${p.isReady ? "text-green-600" : "text-gray-400"}`}>
                    {p.isReady ? "READY" : "..."}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {isHost && (
            <div className="space-y-2">
              <button
                onClick={handleAddBot}
                disabled={lobbyPlayers.length >= 6}
                className="w-full py-2 font-pixel text-[8px] pixel-btn bg-[#8BC34A] text-white hover:bg-[#7CB342] disabled:opacity-50"
              >
                + ADD BOT
              </button>
              <button
                onClick={handleStartGame}
                disabled={lobbyPlayers.length < 2}
                className="w-full py-3 bg-amber-400 text-gray-900 font-pixel text-[11px] pixel-btn disabled:opacity-50"
              >
                START GAME
              </button>
            </div>
          )}

          {!isHost && (
            <p className="font-pixel text-[8px] text-gray-500 animate-pulse">
              WAITING FOR HOST TO START...
            </p>
          )}

          {!connected && (
            <p className="font-pixel text-[7px] text-red-500 mt-2">DISCONNECTED — RECONNECTING...</p>
          )}
        </div>
      </div>
    );
  }

  // Game finished
  if (gameState.phase === "finished") {
    const winner = gameState.players[gameState.winner!];
    const isMyWin = gameState.winner === myPlayerIndex;
    return (
      <div className="h-screen flex items-center justify-center bg-[#2a6ab5]">
        <div className="text-center bg-[#f0e6d0] pixel-border p-10 max-w-md">
          <div className="flex justify-center mb-4">
            <VPIcon size={48} color={isMyWin ? "#d97706" : "#ef4444"} />
          </div>
          <h2 className={`font-pixel text-[16px] mb-3 ${isMyWin ? "text-amber-600" : "text-red-500"}`}>
            {isMyWin ? "YOU WIN!" : `${winner.name.toUpperCase()} WINS!`}
          </h2>
          <p className="text-gray-600 mb-6 text-sm">
            {winner.victoryPoints + winner.hiddenVictoryPoints} victory points
          </p>
          <button
            onClick={() => {
              mpStore.reset();
              router.push("/");
            }}
            className="px-8 py-3 bg-amber-400 text-gray-900 font-pixel text-[10px] pixel-btn"
          >
            BACK TO MENU
          </button>
        </div>
      </div>
    );
  }

  // Build playerColors
  const playerColors: Record<number, string> = {};
  for (const p of gameState.players) {
    playerColors[p.index] = PLAYER_COLOR_HEX[p.color] ?? "#fff";
  }

  const isMyTurn = gameState.currentPlayerIndex === myPlayerIndex;
  const currentPlayer = gameState.players[gameState.currentPlayerIndex];
  const myPlayer = gameState.players[myPlayerIndex];
  const needsDiscard = gameState.turnPhase === "discard" &&
    gameState.discardingPlayers.includes(myPlayerIndex);
  const needsStealTarget = gameState.turnPhase === "robber-steal" && isMyTurn;
  const stealTargets = needsStealTarget ? getStealTargets(gameState, myPlayerIndex) : [];

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

  const myResources = Object.entries(myPlayer.resources) as [Resource, number][];
  const canTradeOrBuild = gameState.phase === "main" && isMyTurn && gameState.turnPhase === "trade-or-build";
  const opponents = gameState.players.filter((p) => p.index !== myPlayerIndex);

  // Bank resources
  const bankResources = ALL_RESOURCES.map((res) => {
    const held = gameState.players.reduce((sum, p) => sum + p.resources[res], 0);
    return { resource: res, count: 19 - held };
  });

  const bankInfo = tradeMode ? getBankTradeInfo() : null;
  const showTradeStrip = tradeMode && canTradeOrBuild;

  // Chat log — merge game log + multiplayer chat messages
  const chatLog: GameLogEntry[] = [
    ...gameState.log,
    ...chatMessages.map((m) => ({
      timestamp: m.timestamp,
      playerIndex: m.playerIndex,
      message: m.text,
      type: "chat" as const,
    })),
  ].sort((a, b) => a.timestamp - b.timestamp);

  // Dev cards — only available for own player in ClientGameState
  const myDevCards = myPlayer.developmentCards ?? [];
  const myNewDevCards = myPlayer.newDevelopmentCards ?? [];

  return (
    <div className="h-screen flex overflow-hidden bg-[#2a6ab5]">
      {/* Left column: board + trade strips + bottom bar */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Board */}
        <div className="flex-1 flex items-center justify-center p-1 min-h-0 min-w-0 overflow-hidden relative">
          <HexBoard
            board={gameState.board}
            size={50}
            highlightedVertices={highlightedVertices}
            highlightedEdges={highlightedEdges}
            highlightedHexes={highlightedHexes}
            flashSeven={flashSeven}
            playerColors={playerColors}
            buildingStyles={{}}
            onVertexClick={isMyTurn ? handleVertexClick : undefined}
            onEdgeClick={isMyTurn ? handleEdgeClick : undefined}
            onHexClick={isMyTurn ? handleHexClick : undefined}
          />

          {/* Floating overlays */}
          <div className="absolute bottom-2 right-2 left-2 flex items-end justify-between gap-2 pointer-events-none" style={{ zIndex: 20 }}>
            {/* Left side: trade panel */}
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

                    <button
                      onClick={closeTrade}
                      className="px-2 py-1 text-[7px] text-gray-400 pixel-btn bg-[#2a2a4e] hover:bg-[#3a3a5e]"
                    >
                      X
                    </button>
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
                    onRoll={() => handleAction({ type: "roll-dice", playerIndex: myPlayerIndex })}
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
          {/* Resource cards */}
          <div className="flex items-end gap-0.5">
            {myResources
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

            {/* Existing dev cards */}
            {myDevCards.map((card: DevelopmentCardType, i: number) => (
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

            {/* New dev cards */}
            {myNewDevCards.map((card: DevelopmentCardType, i: number) => (
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
                    playerIndex: myPlayerIndex,
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
            </div>
            {(localError || error) && (
              <div className="font-pixel text-[7px] text-red-400 mt-0.5">{localError || error}</div>
            )}
            {!connected && (
              <div className="font-pixel text-[7px] text-red-400 mt-0.5 animate-pulse">RECONNECTING...</div>
            )}
          </div>

          {/* Action buttons */}
          {canTradeOrBuild && (
            <ActionBar
              gameState={gameState}
              localPlayerIndex={myPlayerIndex}
              onAction={handleAction}
              activeAction={activeAction}
              setActiveAction={handleSetActiveAction}
            />
          )}
        </div>
      </div>

      {/* Right sidebar */}
      <div className="w-72 flex flex-col bg-[#f0e6d0] border-l-4 border-black">
        <ChatBox
          log={chatLog}
          playerColors={gameState.players.map((p) => p.color)}
          playerNames={gameState.players.map((p) => p.name)}
          localPlayerIndex={myPlayerIndex}
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
            player={myPlayer}
            isCurrentTurn={isMyTurn}
            isLocalPlayer={true}
          />
        </div>
      </div>

      {/* Dialogs */}
      {needsDiscard && (
        <DiscardDialog
          player={myPlayer}
          playerIndex={myPlayerIndex}
          onAction={handleAction}
        />
      )}

      {activeAction === "monopoly" && (
        <ResourceSelector
          type="monopoly"
          playerIndex={myPlayerIndex}
          onAction={handleAction}
          onClose={() => setActiveAction(null)}
        />
      )}

      {activeAction === "year-of-plenty" && (
        <ResourceSelector
          type="year-of-plenty"
          playerIndex={myPlayerIndex}
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

function getStealTargets(state: ClientGameState, playerIndex: number): number[] {
  const targets = new Set<number>();
  const hexCoord = parseHexKey(state.board.robberHex);
  const vertices = hexVertices(hexCoord);
  for (const vk of vertices) {
    const building = state.board.vertices[vk];
    if (building && building.playerIndex !== playerIndex) {
      // In online mode, we only know resourceCount (not individual resources)
      // So check resourceCount if available, otherwise assume they have resources
      const player = state.players[building.playerIndex];
      if (player.resourceCount > 0) targets.add(building.playerIndex);
    }
  }
  return Array.from(targets);
}
