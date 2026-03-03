"use client";

import { useRef, useEffect, useState, useMemo } from "react";
import type { GameLogEntry } from "@/shared/types/game";
import { PLAYER_COLOR_HEX } from "@/shared/constants";

interface Props {
  log: GameLogEntry[];
  playerColors: string[];
  playerNames: string[];
  localPlayerIndex: number;
  onSendChat: (message: string) => void;
}

type Tab = "chat" | "log" | "stats";

/** Parse roll totals from log messages like "Alice rolled 3 + 4 = 7" */
function extractRolls(log: GameLogEntry[]): number[] {
  const rolls: number[] = [];
  for (const entry of log) {
    const m = entry.message.match(/rolled\s+\d+\s*\+\s*\d+\s*=\s*(\d+)/);
    if (m) rolls.push(parseInt(m[1], 10));
  }
  return rolls;
}

export default function ChatBox({ log, playerColors, playerNames, localPlayerIndex, onSendChat }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [message, setMessage] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("log");

  const chatEntries = log.filter((e) => e.type === "chat");
  const logEntries = log.filter((e) => e.type !== "chat");

  const entries = activeTab === "chat" ? chatEntries : logEntries;

  const rolls = useMemo(() => extractRolls(log), [log]);

  useEffect(() => {
    if (activeTab !== "stats") {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [entries.length, activeTab]);

  function handleSend() {
    const text = message.trim();
    if (!text) return;
    onSendChat(text);
    setMessage("");
    setActiveTab("chat");
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  // Group log entries and detect turn changes for separators
  let lastTurnLabel: string | null = null;

  const tabClass = (tab: Tab) =>
    `flex-1 px-2 py-1.5 font-pixel text-[8px] transition-colors ${
      activeTab === tab
        ? "bg-white text-gray-800 border-b-2 border-amber-400"
        : "bg-gray-200 text-gray-500 hover:bg-gray-100"
    }`;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Tab header */}
      <div className="flex flex-shrink-0 border-b-2 border-black">
        <button onClick={() => setActiveTab("chat")} className={tabClass("chat")}>
          CHAT
          {chatEntries.length > 0 && activeTab !== "chat" && (
            <span className="ml-1 text-[6px] bg-amber-400 text-black px-1 border border-black">{chatEntries.length}</span>
          )}
        </button>
        <button onClick={() => setActiveTab("log")} className={tabClass("log")}>
          LOG
        </button>
        <button onClick={() => setActiveTab("stats")} className={tabClass("stats")}>
          STATS
        </button>
      </div>

      {/* Content area */}
      {activeTab === "stats" ? (
        <StatsPanel rolls={rolls} />
      ) : (
        <>
          {/* Messages area */}
          <div className="flex-1 overflow-y-auto px-2 py-1.5 game-log-scroll bg-white" style={{ minHeight: 0 }}>
            {entries.length === 0 && (
              <div className="text-[9px] text-gray-400 font-pixel text-center mt-4">
                {activeTab === "chat" ? "No messages yet" : "No events yet"}
              </div>
            )}
            {entries.map((entry, i) => {
              let turnSeparator: React.ReactNode = null;

              if (activeTab === "log" && entry.type === "system" && entry.message.match(/turn\s+\d+/i)) {
                const turnMatch = entry.message.match(/turn\s+(\d+)/i);
                if (turnMatch) {
                  const turnLabel = `TURN ${turnMatch[1]}`;
                  if (turnLabel !== lastTurnLabel) {
                    lastTurnLabel = turnLabel;
                    turnSeparator = (
                      <div className="flex items-center gap-2 my-1.5" key={`sep-${i}`}>
                        <div className="flex-1 h-px bg-gray-300" />
                        <span className="font-pixel text-[6px] text-gray-400">{turnLabel}</span>
                        <div className="flex-1 h-px bg-gray-300" />
                      </div>
                    );
                  }
                }
              }

              if (entry.type === "chat") {
                const color = entry.playerIndex !== null
                  ? PLAYER_COLOR_HEX[playerColors[entry.playerIndex]]
                  : "#9ca3af";
                const name = entry.playerIndex !== null
                  ? playerNames[entry.playerIndex]
                  : "System";
                return (
                  <div key={i}>
                    {turnSeparator}
                    <div className="mb-1 text-[10px]">
                      <span className="font-bold font-pixel text-[9px]" style={{ color }}>{name}: </span>
                      <span className="text-gray-700">{entry.message}</span>
                    </div>
                  </div>
                );
              }

              if (entry.type === "system") {
                return (
                  <div key={i}>
                    {turnSeparator}
                    <div className="mb-0.5 text-[9px] font-pixel text-amber-600">
                      {entry.message}
                    </div>
                  </div>
                );
              }

              // action
              const color = entry.playerIndex !== null
                ? PLAYER_COLOR_HEX[playerColors[entry.playerIndex]]
                : "#9ca3af";

              const playerName = entry.playerIndex !== null ? playerNames[entry.playerIndex] : null;
              let actionContent: React.ReactNode;
              if (playerName && entry.message.startsWith(playerName)) {
                actionContent = (
                  <>
                    <span className="font-bold" style={{ color }}>{playerName}</span>
                    <span className="text-gray-500">{entry.message.slice(playerName.length)}</span>
                  </>
                );
              } else {
                actionContent = <span style={{ color }}>{entry.message}</span>;
              }

              return (
                <div key={i}>
                  {turnSeparator}
                  <div className="mb-0.5 text-[10px]">
                    {actionContent}
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>

          {/* Input area */}
          <div className="flex gap-1 px-1.5 pb-1.5 pt-1 bg-white flex-shrink-0 border-t border-gray-200">
            <input
              type="text"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type..."
              className="flex-1 bg-gray-50 px-2 py-1 text-[10px] text-gray-800 focus:outline-none border-2 border-gray-300 placeholder-gray-400"
            />
            <button
              onClick={handleSend}
              className="px-2 py-1 bg-amber-400 text-gray-900 font-pixel text-[7px] pixel-btn flex-shrink-0"
            >
              SEND
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// Ways to make each total with 2d6
const DICE_WAYS: Record<number, number> = {
  2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1,
};

function barColor(n: number): string {
  if (n === 7) return "#d97706";
  if (n === 6 || n === 8) return "#ea580c";
  if (n === 5 || n === 9) return "#2563eb";
  if (n === 4 || n === 10) return "#7c3aed";
  if (n === 3 || n === 11) return "#6b7280";
  return "#9ca3af";
}

/** Full-space dice stats with horizontal bars and probabilities */
function StatsPanel({ rolls }: { rolls: number[] }) {
  const counts: Record<number, number> = {};
  for (let i = 2; i <= 12; i++) counts[i] = 0;
  for (const r of rolls) {
    if (counts[r] !== undefined) counts[r]++;
  }

  const maxCount = Math.max(1, ...Object.values(counts));
  const totalRolls = rolls.length;

  return (
    <div className="flex-1 overflow-y-auto px-3 py-3 bg-white" style={{ minHeight: 0 }}>
      <div className="font-pixel text-[8px] text-gray-400 mb-3 text-center">
        DICE STATS — {totalRolls} ROLL{totalRolls !== 1 ? "S" : ""}
      </div>

      {totalRolls === 0 ? (
        <div className="text-[9px] text-gray-400 font-pixel text-center mt-8">
          No rolls yet
        </div>
      ) : (
        <div className="flex flex-col gap-[3px]">
          {Array.from({ length: 11 }, (_, i) => i + 2).map((n) => {
            const count = counts[n];
            const pct = totalRolls > 0 ? (count / totalRolls) * 100 : 0;
            const expectedPct = (DICE_WAYS[n] / 36) * 100;
            const widthPct = (count / maxCount) * 100;
            // How "hot" or "cold" vs expected
            const diff = pct - expectedPct;
            const hot = diff > 3;
            const cold = diff < -3;

            return (
              <div key={n} className="flex items-center gap-1" style={{ height: 18 }}>
                {/* Number label */}
                <div
                  className="font-pixel text-[9px] w-5 text-right flex-shrink-0"
                  style={{ color: barColor(n) }}
                >
                  {n}
                </div>

                {/* Bar */}
                <div className="flex-1 h-full flex items-center relative">
                  {/* Expected marker */}
                  {totalRolls >= 4 && (
                    <div
                      className="absolute top-0 bottom-0 border-r border-dashed border-gray-300"
                      style={{ left: `${((DICE_WAYS[n] / 36) * totalRolls / maxCount) * 100}%` }}
                    />
                  )}
                  <div
                    style={{
                      width: `${widthPct}%`,
                      height: "100%",
                      backgroundColor: barColor(n),
                      minWidth: count > 0 ? 3 : 0,
                      border: count > 0 ? "1px solid #000" : "none",
                      boxShadow: count > 0 ? "1px 1px 0 #000" : "none",
                    }}
                  />
                </div>

                {/* Count */}
                <div className="font-pixel text-[8px] text-gray-600 w-4 text-right flex-shrink-0">
                  {count}
                </div>

                {/* Actual % */}
                <div className="font-pixel text-[7px] text-gray-500 w-8 text-right flex-shrink-0">
                  {pct.toFixed(0)}%
                </div>

                {/* Hot/cold indicator */}
                <div className="font-pixel text-[7px] w-3 flex-shrink-0 text-center">
                  {hot ? <span style={{ color: "#dc2626" }}>↑</span> : cold ? <span style={{ color: "#2563eb" }}>↓</span> : ""}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Legend */}
      {totalRolls > 0 && (
        <div className="mt-3 pt-2 border-t border-gray-200">
          <div className="flex items-center gap-3 justify-center">
            <div className="flex items-center gap-1">
              <span className="font-pixel text-[7px] text-red-600">↑</span>
              <span className="font-pixel text-[5px] text-gray-400">HOT</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="font-pixel text-[7px] text-blue-600">↓</span>
              <span className="font-pixel text-[5px] text-gray-400">COLD</span>
            </div>
          </div>
        </div>
      )}

      {/* Probability reference */}
      <div className="mt-3 pt-2 border-t border-gray-200">
        <div className="font-pixel text-[7px] text-gray-400 mb-1.5 text-center">ODDS PER ROLL</div>
        <div className="flex flex-col gap-[1px]">
          {Array.from({ length: 11 }, (_, i) => i + 2).map((n) => {
            const ways = DICE_WAYS[n];
            const pct = (ways / 36) * 100;
            return (
              <div key={n} className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <span className="font-pixel text-[7px] w-4 text-right" style={{ color: barColor(n) }}>{n}</span>
                  <span className="font-pixel text-[6px] text-gray-400">{ways}/36</span>
                </div>
                <div className="flex items-center gap-1">
                  <div
                    className="h-1.5"
                    style={{
                      width: `${(pct / 16.7) * 40}px`,
                      backgroundColor: barColor(n),
                      opacity: 0.4,
                    }}
                  />
                  <span className="font-pixel text-[6px] text-gray-500 w-8 text-right">{pct.toFixed(1)}%</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
