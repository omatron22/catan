"use client";

import { CrownPixel, HelmetPixel, RoadPixel, HousePixel, CityPixel } from "@/app/components/icons/PixelIcons";
import { PLAYER_COLOR_HEX } from "@/shared/constants";
import type { GameState } from "@/shared/types/game";
import type { ClientGameState } from "@/shared/types/messages";

type AnyGameState = GameState | ClientGameState;

interface Props {
  gameState: AnyGameState;
  localPlayerIndex: number;
  onPlayAgain?: () => void;
  onMainMenu: () => void;
}

export default function VictoryOverlay({ gameState, localPlayerIndex, onPlayAgain, onMainMenu }: Props) {
  const winner = gameState.players[gameState.winner!];
  const isLocalWinner = gameState.winner === localPlayerIndex;

  // Sort players by total VP descending
  const ranked = [...gameState.players].sort((a, b) => {
    const aVP = a.victoryPoints + a.hiddenVictoryPoints;
    const bVP = b.victoryPoints + b.hiddenVictoryPoints;
    return bVP - aVP;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" style={{ backdropFilter: "blur(3px)" }}>
      <div className="bg-[#f0e6d0] border-4 border-black px-8 py-6 max-w-lg w-full mx-4">
        {/* Winner header */}
        <div className="text-center mb-4">
          <div className="flex justify-center mb-2">
            <CrownPixel size={40} color={isLocalWinner ? "#d97706" : "#ef4444"} />
          </div>
          <h2 className={`font-pixel text-[16px] ${isLocalWinner ? "text-amber-600" : "text-red-500"}`}>
            {isLocalWinner ? "YOU WIN!" : `${winner.name.toUpperCase()} WINS!`}
          </h2>
          <p className="font-pixel text-[9px] text-gray-500 mt-1">
            {winner.victoryPoints + winner.hiddenVictoryPoints} VICTORY POINTS
          </p>
        </div>

        {/* Stats table */}
        <div className="bg-[#e8d8b8] border-2 border-black p-3 mb-4">
          {/* Header */}
          <div className="flex items-center gap-1 pb-1.5 mb-1.5 border-b border-gray-400">
            <span className="flex-1 font-pixel text-[6px] text-gray-500">PLAYER</span>
            <span className="w-8 text-center" title="Victory Points"><CrownPixel size={12} color="#d97706" /></span>
            <span className="w-8 text-center" title="Settlements"><HousePixel size={12} color="#666" /></span>
            <span className="w-8 text-center" title="Cities"><CityPixel size={12} color="#666" /></span>
            <span className="w-8 text-center" title="Roads"><RoadPixel size={12} color="#666" /></span>
            <span className="w-8 text-center" title="Knights"><HelmetPixel size={12} color="#6b21a8" /></span>
          </div>

          {/* Player rows */}
          {ranked.map((p) => {
            const totalVP = p.victoryPoints + p.hiddenVictoryPoints;
            const color = PLAYER_COLOR_HEX[p.color];
            const isWinner = p.index === gameState.winner;
            return (
              <div
                key={p.index}
                className={`flex items-center gap-1 py-1 ${isWinner ? "bg-amber-200/50" : ""}`}
              >
                <div className="flex items-center gap-1.5 flex-1">
                  <div className="w-3 h-3 border border-black" style={{ backgroundColor: color }} />
                  <span className={`font-pixel text-[7px] ${isWinner ? "text-amber-700" : "text-gray-700"}`}>
                    {p.name.toUpperCase()}
                  </span>
                </div>
                <span className="w-8 text-center font-pixel text-[8px] text-gray-800 font-bold">{totalVP}</span>
                <span className="w-8 text-center font-pixel text-[7px] text-gray-600">{p.settlements.length}</span>
                <span className="w-8 text-center font-pixel text-[7px] text-gray-600">{p.cities.length}</span>
                <span className="w-8 text-center font-pixel text-[7px] text-gray-600">{p.roads.length}</span>
                <span className="w-8 text-center font-pixel text-[7px] text-gray-600">{p.knightsPlayed}</span>
              </div>
            );
          })}
        </div>

        {/* VP breakdown for winner */}
        <div className="bg-[#e8d8b8] border-2 border-black p-3 mb-4">
          <div className="font-pixel text-[7px] text-gray-500 mb-1.5">VP BREAKDOWN — {winner.name.toUpperCase()}</div>
          <div className="flex flex-wrap gap-x-4 gap-y-0.5">
            {winner.settlements.length > 0 && (
              <span className="font-pixel text-[7px] text-gray-700">Settlements: {winner.settlements.length}</span>
            )}
            {winner.cities.length > 0 && (
              <span className="font-pixel text-[7px] text-gray-700">Cities: {winner.cities.length * 2}</span>
            )}
            {winner.hasLongestRoad && (
              <span className="font-pixel text-[7px] text-amber-700">Longest Road: 2</span>
            )}
            {winner.hasLargestArmy && (
              <span className="font-pixel text-[7px] text-purple-700">Largest Army: 2</span>
            )}
            {winner.hiddenVictoryPoints > 0 && (
              <span className="font-pixel text-[7px] text-gray-700">Dev Cards: {winner.hiddenVictoryPoints}</span>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex justify-center gap-3">
          {onPlayAgain && (
            <button
              onClick={onPlayAgain}
              className="px-6 py-2.5 bg-amber-400 text-gray-900 font-pixel text-[10px] pixel-btn"
            >
              PLAY AGAIN
            </button>
          )}
          <button
            onClick={onMainMenu}
            className="px-6 py-2.5 bg-gray-400 text-gray-900 font-pixel text-[10px] pixel-btn"
          >
            MAIN MENU
          </button>
        </div>
      </div>
    </div>
  );
}
