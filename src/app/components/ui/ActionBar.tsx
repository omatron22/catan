"use client";

import type { GameState, PlayerState, Resource, DevelopmentCardType } from "@/shared/types/game";
import type { ClientGameState, ClientPlayerState } from "@/shared/types/messages";
import type { GameAction } from "@/shared/types/actions";
import { BUILDING_COSTS, MAX_ROADS, MAX_SETTLEMENTS, MAX_CITIES } from "@/shared/constants";
import {
  RoadPixel,
  HousePixel,
  CityPixel,
  ScrollPixel,
  SwordPixel,
  EndTurnPixel,
} from "@/app/components/icons/PixelIcons";

interface Props {
  gameState: GameState | ClientGameState;
  localPlayerIndex: number;
  onAction: (action: GameAction) => void;
  activeAction: string | null;
  setActiveAction: (action: string | null) => void;
}

function canAfford(player: PlayerState | ClientPlayerState, cost: Partial<Record<Resource, number>>): boolean {
  for (const [res, amount] of Object.entries(cost)) {
    if ((amount || 0) > player.resources[res as Resource]) return false;
  }
  return true;
}

const ACTION_COLORS: Record<string, string> = {
  "build-road": "#8B5E3C",
  "build-settlement": "#E67E22",
  "build-city": "#8E44AD",
  "buy-dev-card": "#2980B9",
  "end-turn": "#27AE60",
};

export default function ActionBar({
  gameState,
  localPlayerIndex,
  onAction,
  activeAction,
  setActiveAction,
}: Props) {
  const player = gameState.players[localPlayerIndex];

  const roadsLeft = MAX_ROADS - player.roads.length;
  const settlementsLeft = MAX_SETTLEMENTS - player.settlements.length;
  const citiesLeft = MAX_CITIES - player.cities.length;

  const actions = [
    {
      id: "build-road",
      icon: <RoadPixel size={20} color="white" />,
      affordable: canAfford(player, BUILDING_COSTS.road) && roadsLeft > 0,
      title: "Road (1 Brick + 1 Wood)",
      remaining: roadsLeft,
    },
    {
      id: "build-settlement",
      icon: <HousePixel size={20} color="white" />,
      affordable: canAfford(player, BUILDING_COSTS.settlement) && settlementsLeft > 0,
      title: "Settlement (1 Brick + 1 Wood + 1 Wheat + 1 Wool)",
      remaining: settlementsLeft,
    },
    {
      id: "build-city",
      icon: <CityPixel size={20} color="white" />,
      affordable: canAfford(player, BUILDING_COSTS.city) && citiesLeft > 0,
      title: "City (3 Ore + 2 Wheat)",
      remaining: citiesLeft,
    },
    {
      id: "buy-dev-card",
      icon: <ScrollPixel size={20} color="white" />,
      affordable:
        canAfford(player, BUILDING_COSTS.developmentCard) &&
        ("developmentCardDeck" in gameState
          ? gameState.developmentCardDeck.length > 0
          : gameState.developmentCardDeckCount > 0),
      title: "Dev Card (1 Ore + 1 Wheat + 1 Wool)",
      remaining: "developmentCardDeck" in gameState
        ? gameState.developmentCardDeck.length
        : gameState.developmentCardDeckCount,
    },
  ];

  const playerDevCards = player.developmentCards ?? [];
  const devCards = playerDevCards.filter((c) => c !== "victoryPoint");
  const canPlayDevCard = !player.hasPlayedDevCardThisTurn && devCards.length > 0;

  return (
    <div className="flex items-center gap-1.5">
      {/* Build action buttons */}
      {actions.map((action) => {
        const isActive = activeAction === action.id;
        const enabled = action.affordable;
        const bg = ACTION_COLORS[action.id] || "#555";
        return (
          <button
            key={action.id}
            onClick={() => {
              if (action.id === "buy-dev-card") {
                onAction({ type: "buy-development-card", playerIndex: localPlayerIndex });
              } else {
                setActiveAction(isActive ? null : action.id);
              }
            }}
            disabled={!enabled}
            title={action.title}
            className={`w-14 h-14 flex flex-col items-center justify-center gap-0.5 pixel-btn text-white ${
              isActive
                ? "translate-x-[2px] translate-y-[2px] !shadow-[1px_1px_0_#000]"
                : !enabled
                ? "opacity-40 cursor-not-allowed"
                : ""
            }`}
            style={{ backgroundColor: isActive ? "#d4900e" : enabled ? bg : "#666" }}
          >
            {action.icon}
            <span className="font-pixel text-[7px]">{action.remaining}</span>
          </button>
        );
      })}

      {/* Dev card play buttons */}
      {canPlayDevCard &&
        Array.from(new Set(devCards)).map((card) => (
          <button
            key={card}
            onClick={() => {
              if (card === "knight") {
                onAction({ type: "play-knight", playerIndex: localPlayerIndex });
              } else if (card === "roadBuilding") {
                onAction({ type: "play-road-building", playerIndex: localPlayerIndex });
              } else if (card === "monopoly") {
                setActiveAction("monopoly");
              } else if (card === "yearOfPlenty") {
                setActiveAction("year-of-plenty");
              }
            }}
            title={formatCardName(card)}
            className="w-12 h-12 flex flex-col items-center justify-center pixel-btn bg-purple-600 text-white"
          >
            {card === "knight" ? (
              <SwordPixel size={18} color="white" />
            ) : (
              <ScrollPixel size={18} color="white" />
            )}
            <span className="font-pixel text-[6px] truncate max-w-[40px]">{formatCardShort(card)}</span>
          </button>
        ))}

      {/* End Turn */}
      <button
        onClick={() => onAction({ type: "end-turn", playerIndex: localPlayerIndex })}
        title="End Turn"
        className="w-14 h-14 flex flex-col items-center justify-center pixel-btn text-white"
        style={{ backgroundColor: ACTION_COLORS["end-turn"] }}
      >
        <EndTurnPixel size={20} color="white" />
        <span className="font-pixel text-[6px]">END</span>
      </button>
    </div>
  );
}

function formatCardName(card: DevelopmentCardType): string {
  switch (card) {
    case "knight": return "Knight";
    case "roadBuilding": return "Road Building";
    case "yearOfPlenty": return "Year of Plenty";
    case "monopoly": return "Monopoly";
    case "victoryPoint": return "Victory Point";
  }
}

function formatCardShort(card: DevelopmentCardType): string {
  switch (card) {
    case "knight": return "KNT";
    case "roadBuilding": return "RDB";
    case "yearOfPlenty": return "YOP";
    case "monopoly": return "MON";
    case "victoryPoint": return "VP";
  }
}
