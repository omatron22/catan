"use client";

import { useState } from "react";
import type { Resource, PlayerState } from "@/shared/types/game";
import type { ClientPlayerState } from "@/shared/types/messages";
import type { GameAction } from "@/shared/types/actions";
import { ALL_RESOURCES } from "@/shared/constants";
import { ResourceIcon } from "@/app/components/icons/ResourceIcons";

function totalResources(resources: Record<Resource, number>): number {
  return Object.values(resources).reduce((sum, n) => sum + n, 0);
}

interface Props {
  player: PlayerState | ClientPlayerState;
  playerIndex: number;
  onAction: (action: GameAction) => void;
}

export default function DiscardDialog({ player, playerIndex, onAction }: Props) {
  const [discarding, setDiscarding] = useState<Record<Resource, number>>({
    brick: 0, lumber: 0, ore: 0, grain: 0, wool: 0,
  });

  const total = totalResources(player.resources);
  const discardAmount = Math.floor(total / 2);
  const currentDiscard = Object.values(discarding).reduce((s, n) => s + n, 0);

  function handleDiscard() {
    if (currentDiscard !== discardAmount) return;
    const filtered = Object.fromEntries(
      Object.entries(discarding).filter(([, v]) => v > 0)
    ) as Partial<Record<Resource, number>>;
    onAction({
      type: "discard-resources",
      playerIndex,
      resources: filtered,
    });
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-[#f0e6d0] pixel-border p-6 max-w-md w-full mx-4">
        <h2 className="font-pixel text-[11px] text-gray-800 mb-2">DISCARD</h2>
        <p className="text-[10px] text-gray-600 mb-4">
          You have {total} cards. Discard {discardAmount}. ({currentDiscard}/{discardAmount})
        </p>

        <div className="flex flex-wrap gap-3 md:gap-4 justify-center mb-4">
          {ALL_RESOURCES.map((res) => (
            <div key={res} className="flex flex-col items-center gap-1">
              <ResourceIcon resource={res} size={24} />
              <span className="text-[9px] text-gray-500">({player.resources[res]})</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() =>
                    setDiscarding({ ...discarding, [res]: Math.max(0, discarding[res] - 1) })
                  }
                  disabled={discarding[res] <= 0}
                  className="w-6 h-6 bg-white border-2 border-black font-pixel text-[8px] text-gray-600 hover:bg-gray-100"
                >
                  -
                </button>
                <span className="w-4 text-center text-sm font-bold text-gray-700">{discarding[res]}</span>
                <button
                  onClick={() =>
                    setDiscarding({
                      ...discarding,
                      [res]: Math.min(player.resources[res], discarding[res] + 1),
                    })
                  }
                  disabled={
                    discarding[res] >= player.resources[res] ||
                    currentDiscard >= discardAmount
                  }
                  className="w-6 h-6 bg-white border-2 border-black font-pixel text-[8px] text-gray-600 hover:bg-gray-100"
                >
                  +
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Progress bar */}
        <div className="w-full h-2 bg-gray-300 border border-black mb-3">
          <div
            className={`h-full transition-all ${currentDiscard >= discardAmount ? "bg-green-500" : "bg-red-500"}`}
            style={{ width: `${Math.min(100, (currentDiscard / discardAmount) * 100)}%` }}
          />
        </div>

        <button
          onClick={handleDiscard}
          disabled={currentDiscard !== discardAmount}
          className={`w-full py-2 font-pixel text-[9px] ${
            currentDiscard === discardAmount
              ? "bg-green-600 text-white pixel-btn"
              : "bg-gray-400 text-gray-200 cursor-not-allowed border-2 border-black"
          }`}
        >
          DISCARD {discardAmount} CARDS
        </button>
      </div>
    </div>
  );
}
