"use client";

import { useRef, useEffect } from "react";
import type { GameLogEntry } from "@/shared/types/game";
import { PLAYER_COLOR_HEX } from "@/shared/constants";

interface Props {
  log: GameLogEntry[];
  playerColors: string[];
}

export default function GameLog({ log, playerColors }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [log.length]);

  return (
    <div className="bg-white rounded-lg p-3 h-48 overflow-y-auto text-xs border border-gray-200 shadow-sm game-log-scroll">
      <h3 className="text-gray-500 font-medium mb-2">Game Log</h3>
      {log.map((entry, i) => (
        <div key={i} className={`mb-1 py-0.5 px-1 rounded ${i % 2 === 0 ? "bg-gray-50" : ""}`}>
          <span
            className="font-medium"
            style={{
              color:
                entry.playerIndex !== null
                  ? PLAYER_COLOR_HEX[playerColors[entry.playerIndex]]
                  : "#6b7280",
            }}
          >
            {entry.message}
          </span>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
