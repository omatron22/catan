"use client";

import type { PlayerState } from "@/shared/types/game";
import { PLAYER_COLOR_HEX } from "@/shared/constants";
import { SwordPixel, RoadPixel, CrownPixel } from "@/app/components/icons/PixelIcons";

interface Props {
  player: PlayerState;
  isCurrentTurn: boolean;
  isLocalPlayer: boolean;
}

export default function PlayerPanel({ player, isCurrentTurn, isLocalPlayer }: Props) {
  const color = PLAYER_COLOR_HEX[player.color];
  const totalCards = Object.values(player.resources).reduce((s, n) => s + n, 0);
  const devCards = player.developmentCards.length + player.newDevelopmentCards.length;

  return (
    <div
      className={`bg-[#e8d8b8] border-2 border-black pixel-border-sm px-2 py-1.5 flex items-center gap-2 ${
        isCurrentTurn ? "outline-2 outline-yellow-400 outline" : ""
      }`}
    >
      {/* Player color swatch (no VP) */}
      <div
        className="w-4 h-4 flex-shrink-0 border-2 border-black"
        style={{ backgroundColor: color }}
      />

      {/* Name */}
      <span className="font-pixel text-[7px] text-gray-800 truncate flex-1">
        {player.name}
      </span>

      {/* Achievements */}
      {player.hasLargestArmy && (
        <span className="font-pixel text-[5px] bg-purple-600 text-white px-0.5 border border-black" title="Largest Army">LA</span>
      )}
      {player.hasLongestRoad && (
        <span className="font-pixel text-[5px] bg-orange-500 text-white px-0.5 border border-black" title="Longest Road">LR</span>
      )}

      {/* VP */}
      <div className="flex items-center gap-0.5" title={`${player.victoryPoints} victory points`}>
        <div className="pixel-icon"><CrownPixel size={14} color="#d97706" /></div>
        <span className="text-[8px] text-gray-700 font-bold">{player.victoryPoints}</span>
      </div>

      {/* Resource cards */}
      <div className="flex items-center gap-0.5" title={`${totalCards} resource cards`}>
        <div className="w-4 h-5 bg-blue-600 border border-black flex items-center justify-center">
          <span className="text-[6px] text-white font-bold">?</span>
        </div>
        <span className="text-[8px] text-gray-700 font-bold">{totalCards}</span>
      </div>

      {/* Dev cards — plain purple card */}
      <div className="flex items-center gap-0.5" title={`${devCards} development cards`}>
        <div className="w-4 h-5 bg-purple-700 border border-black" />
        <span className="text-[8px] text-gray-700 font-bold">{devCards}</span>
      </div>

      {/* Knights played */}
      <div className="flex items-center gap-0.5" title={`${player.knightsPlayed} knights played`}>
        <div className="pixel-icon"><SwordPixel size={14} color="#6b21a8" /></div>
        <span className="text-[8px] text-gray-700 font-bold">{player.knightsPlayed}</span>
      </div>

      {/* Longest road length */}
      <div className="flex items-center gap-0.5" title={`Longest road: ${player.longestRoadLength}`}>
        <div className="pixel-icon"><RoadPixel size={14} color="#8b7355" /></div>
        <span className="text-[8px] text-gray-700 font-bold">{player.longestRoadLength}</span>
      </div>
    </div>
  );
}
