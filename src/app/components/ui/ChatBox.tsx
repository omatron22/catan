"use client";

import { useRef, useEffect, useState, useMemo } from "react";
import type { GameLogEntry } from "@/shared/types/game";
import { PLAYER_COLOR_HEX, RESOURCE_COLORS } from "@/shared/constants";
import type { Resource } from "@/shared/types/game";
import {
  HousePixel, CityPixel, RoadPixel, ScrollPixel, GhostPixel,
  HelmetPixel, RoadBuildPixel, CornucopiaPixel, MonopolyPixel,
  CrownPixel, DiceFacePixel, ResourcePixel,
} from "@/app/components/icons/PixelIcons";

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

/** Parse roll pairs (d1, d2, total) from log messages */
function extractRollPairs(log: GameLogEntry[]): { d1: number; d2: number; total: number }[] {
  const pairs: { d1: number; d2: number; total: number }[] = [];
  for (const entry of log) {
    const m = entry.message.match(/rolled\s+(\d+)\s*\+\s*(\d+)\s*=\s*(\d+)/);
    if (m) pairs.push({ d1: parseInt(m[1], 10), d2: parseInt(m[2], 10), total: parseInt(m[3], 10) });
  }
  return pairs;
}

/** Dark outline for player names — ensures readability on white backgrounds */
function nameStyle(color: string): React.CSSProperties {
  return { color, textShadow: "-1px 0 #000, 1px 0 #000, 0 -1px #000, 0 1px #000" };
}

/** Tiny colored resource card for inline log display */
function InlineResource({ resource, idx }: { resource: Resource; idx: number }) {
  return (
    <span
      key={idx}
      className="inline-flex items-center justify-center align-middle border border-black/40"
      style={{
        width: 14,
        height: 17,
        backgroundColor: RESOURCE_COLORS[resource],
        marginLeft: idx > 0 ? -3 : 0,
        boxShadow: "1px 1px 0 rgba(0,0,0,0.2)",
        borderRadius: 1,
      }}
    >
      <ResourcePixel resource={resource} size={10} color="white" />
    </span>
  );
}

/** Replace "N resource" or standalone "resource" in text with inline resource icons */
function renderWithResourceIcons(text: string): React.ReactNode {
  const regex = /(?:(\d+)\s+)?\b(brick|lumber|ore|grain|wool)\b/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const count = match[1] ? parseInt(match[1]) : 1;
    const resource = match[2] as Resource;

    if (count <= 3) {
      for (let i = 0; i < count; i++) {
        parts.push(<InlineResource key={`r${key}-${i}`} resource={resource} idx={i} />);
      }
    } else {
      parts.push(<InlineResource key={`r${key}-0`} resource={resource} idx={0} />);
      parts.push(<span key={`r${key}-c`} className="font-pixel text-[8px] text-gray-500 align-middle">x{count}</span>);
    }
    // Add a tiny spacer after each resource group
    parts.push(<span key={`r${key}-s`} style={{ width: 2, display: "inline-block" }} />);
    key++;
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex === 0) return text; // no matches
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return <>{parts}</>;
}

/** Noun-to-icon replacements — matched text is replaced inline by the icon */
const ICON_SUBS: [RegExp, React.ReactNode][] = [
  [/ a settlement/, <HousePixel size={16} color="#6b7280" />],
  [/ a city/, <CityPixel size={16} color="#6b7280" />],
  [/ a road/, <RoadPixel size={16} color="#6b7280" />],
  [/ a development card/, <ScrollPixel size={16} color="#6b21a8" />],
  [/ the robber/, <GhostPixel size={16} color="#6b7280" />],
  [/ a knight/, <HelmetPixel size={16} color="#6b21a8" />],
  [/ Road Building/, <RoadBuildPixel size={16} color="#6b21a8" />],
  [/ Year of Plenty/, <CornucopiaPixel size={16} color="#6b21a8" />],
  [/ Monopoly/, <MonopolyPixel size={16} color="#6b21a8" />],
];

/** Render action message, replacing nouns with icons and dice text with faces */
function renderActionContent(message: string, playerName: string | null, color: string): React.ReactNode {
  // Dice roll — replace "X + Y = Z" with dice faces
  const rollMatch = message.match(/^(.+?) rolled (\d+) \+ (\d+) = (\d+)$/);
  if (rollMatch) {
    const [, name, d1, d2, totalStr] = rollMatch;
    const total = parseInt(totalStr);
    return (
      <span className="inline-flex items-center gap-0.5 flex-wrap">
        <span className="font-bold" style={nameStyle(color)}>{name}</span>
        <DiceFacePixel value={parseInt(d1)} size={18} />
        <DiceFacePixel value={parseInt(d2)} size={18} />
        <span className="text-gray-500">= </span>
        <span className="font-bold" style={{ color: total === 7 ? "#d97706" : "#374151" }}>{total}</span>
      </span>
    );
  }

  // Try noun → icon replacement
  for (const [pattern, icon] of ICON_SUBS) {
    const m = message.match(pattern);
    if (m && m.index !== undefined) {
      const before = message.slice(0, m.index);
      const after = message.slice(m.index + m[0].length);
      const nameEnd = playerName && before.startsWith(playerName) ? playerName.length : 0;
      return (
        <>
          {nameEnd > 0 && <span className="font-bold" style={nameStyle(color)}>{playerName}</span>}
          {nameEnd > 0 ? (
            <span className="text-gray-500">{before.slice(nameEnd)}</span>
          ) : (
            <span style={nameStyle(color)}>{before}</span>
          )}
          <span className="inline-block align-middle mx-0.5">{icon}</span>
          {after && <span className="text-gray-500">{renderWithResourceIcons(after)}</span>}
        </>
      );
    }
  }

  // "wins with" — keep text, append crown
  if (/wins with/i.test(message) && playerName && message.startsWith(playerName)) {
    return (
      <>
        <span className="font-bold" style={nameStyle(color)}>{playerName}</span>
        <span className="text-gray-500">{renderWithResourceIcons(message.slice(playerName.length))}</span>
        <span className="inline-block ml-1 align-middle"><CrownPixel size={16} color="#d97706" /></span>
      </>
    );
  }

  // Default — replace resource names with icons
  if (playerName && message.startsWith(playerName)) {
    return (
      <>
        <span className="font-bold" style={nameStyle(color)}>{playerName}</span>
        <span className="text-gray-500">{renderWithResourceIcons(message.slice(playerName.length))}</span>
      </>
    );
  }
  return <span style={nameStyle(color)}>{renderWithResourceIcons(message)}</span>;
}

export default function ChatBox({ log, playerColors, playerNames, localPlayerIndex, onSendChat }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [message, setMessage] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("log");

  const chatEntries = log.filter((e) => e.type === "chat");
  const logEntries = log.filter((e) => e.type !== "chat");

  const entries = activeTab === "chat" ? chatEntries : logEntries;

  const rolls = useMemo(() => extractRolls(log), [log]);
  const rollPairs = useMemo(() => extractRollPairs(log), [log]);

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
        <StatsPanel rolls={rolls} rollPairs={rollPairs} />
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
                      <span className="font-bold font-pixel text-[9px]" style={nameStyle(color)}>{name}: </span>
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

              return (
                <div key={i}>
                  {turnSeparator}
                  <div className="mb-0.5 text-[10px]">
                    {renderActionContent(entry.message, playerName, color)}
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

/** Consolidated dice stats with histogram, luck label, DUE indicators, roll history, and summary */
function StatsPanel({ rolls, rollPairs }: { rolls: number[]; rollPairs: { d1: number; d2: number; total: number }[] }) {
  const counts: Record<number, number> = {};
  for (let i = 2; i <= 12; i++) counts[i] = 0;
  for (const r of rolls) {
    if (counts[r] !== undefined) counts[r]++;
  }

  const maxCount = Math.max(1, ...Object.values(counts));
  const totalRolls = rolls.length;

  // Track rolls since each number was last seen
  const rollsSinceLast: Record<number, number> = {};
  for (let n = 2; n <= 12; n++) {
    let last = -1;
    for (let i = rolls.length - 1; i >= 0; i--) {
      if (rolls[i] === n) { last = i; break; }
    }
    rollsSinceLast[n] = last === -1 ? totalRolls : totalRolls - 1 - last;
  }

  // Chi-squared goodness of fit
  let chi2 = 0;
  if (totalRolls > 0) {
    for (let n = 2; n <= 12; n++) {
      const expected = totalRolls * DICE_WAYS[n] / 36;
      chi2 += (counts[n] - expected) ** 2 / expected;
    }
  }

  let luckLabel: { text: string; color: string } | null = null;
  if (totalRolls >= 10) {
    if (chi2 >= 23.21) luckLabel = { text: "WILD DICE", color: "#dc2626" };
    else if (chi2 >= 15.99) luckLabel = { text: "STREAKY", color: "#d97706" };
    else luckLabel = { text: "NORMAL", color: "#16a34a" };
  }

  // Current trailing streak (same number repeated at end)
  let currentStreak = 0;
  let streakNumber = 0;
  if (rolls.length > 0) {
    streakNumber = rolls[rolls.length - 1];
    for (let i = rolls.length - 1; i >= 0 && rolls[i] === streakNumber; i--) {
      currentStreak++;
    }
  }
  const streakProb = currentStreak >= 2
    ? Math.pow(DICE_WAYS[streakNumber] / 36, currentStreak) * 100
    : 0;

  // Notable droughts — P(number not appearing for d rolls)
  const notableDroughts: { n: number; d: number; prob: number }[] = [];
  for (let n = 2; n <= 12; n++) {
    const d = rollsSinceLast[n];
    if (d >= 3) {
      const prob = Math.pow(1 - DICE_WAYS[n] / 36, d) * 100;
      if (prob < 20) notableDroughts.push({ n, d, prob });
    }
  }
  notableDroughts.sort((a, b) => a.prob - b.prob);

  return (
    <div className="flex-1 overflow-y-auto px-3 py-3 bg-white" style={{ minHeight: 0 }}>
      <div className="font-pixel text-[8px] text-gray-400 mb-3 text-center">
        DICE STATS — {totalRolls} ROLL{totalRolls !== 1 ? "S" : ""}
        {luckLabel && (
          <span className="ml-2 px-1.5 py-0.5 border border-current font-bold" style={{ color: luckLabel.color }}>
            {luckLabel.text}
          </span>
        )}
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
            const diff = pct - expectedPct;
            const hot = diff > 3;
            const cold = diff < -3;
            // DUE indicator
            const expectedInterval = 36 / DICE_WAYS[n];
            const isDue = totalRolls >= 6 && rollsSinceLast[n] > 1.5 * expectedInterval;

            return (
              <div key={n} className="flex items-center gap-1" style={{ height: 20 }}>
                {/* Number label */}
                <div className="font-pixel text-[9px] w-5 text-right flex-shrink-0" style={{ color: barColor(n) }}>
                  {n}
                </div>

                {/* Bar */}
                <div className="flex-1 h-full flex items-center relative">
                  {/* Expected marker — solid semi-transparent line */}
                  {totalRolls >= 4 && (
                    <div
                      className="absolute top-0 bottom-0"
                      style={{
                        left: `${((DICE_WAYS[n] / 36) * totalRolls / maxCount) * 100}%`,
                        width: 2,
                        backgroundColor: "rgba(0,0,0,0.2)",
                      }}
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

                {/* Actual % (expected %) */}
                <div className="font-pixel text-[7px] text-gray-500 w-14 text-right flex-shrink-0">
                  {pct.toFixed(0)}%<span className="text-gray-300">({expectedPct.toFixed(0)}%)</span>
                </div>

                {/* Hot/cold/due indicator */}
                <div className="font-pixel text-[7px] w-6 flex-shrink-0 text-center">
                  {isDue ? <span style={{ color: "#d97706" }}>DUE</span> : hot ? <span style={{ color: "#dc2626" }}>↑</span> : cold ? <span style={{ color: "#2563eb" }}>↓</span> : ""}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Notable streaks & droughts */}
      {totalRolls >= 4 && (currentStreak >= 2 || notableDroughts.length > 0) && (
        <div className="mt-2 pt-2 border-t border-gray-200 px-1">
          <div className="font-pixel text-[7px] text-gray-400 mb-1 text-center">NOTABLE</div>
          {currentStreak >= 2 && (
            <div className="font-pixel text-[7px] mb-0.5" style={{ color: "#dc2626" }}>
              {streakNumber} rolled {currentStreak}x in a row ({streakProb < 0.1 ? "<0.1" : streakProb.toFixed(1)}% odds)
            </div>
          )}
          {notableDroughts.slice(0, 3).map(({ n, d, prob }) => (
            <div key={n} className="font-pixel text-[7px] mb-0.5" style={{ color: "#2563eb" }}>
              {n} absent for {d} rolls ({prob.toFixed(1)}% odds)
            </div>
          ))}
        </div>
      )}

      {/* Roll History — mini dice faces */}
      {rollPairs.length > 0 && (
        <div className="mt-2 pt-2 border-t border-gray-200 px-1">
          <div className="font-pixel text-[7px] text-gray-400 mb-1.5 text-center">ROLL HISTORY</div>
          <div className="flex flex-wrap gap-1">
            {rollPairs.slice(-20).map((pair, i) => {
              const isLatest = i === rollPairs.slice(-20).length - 1;
              return (
                <div
                  key={i}
                  className="flex gap-px p-0.5"
                  style={{
                    backgroundColor: barColor(pair.total) + "20",
                    border: isLatest ? `2px solid ${barColor(pair.total)}` : "1px solid rgba(0,0,0,0.1)",
                  }}
                >
                  <DiceFacePixel value={pair.d1} size={12} />
                  <DiceFacePixel value={pair.d2} size={12} />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Summary Stats */}
      {totalRolls > 0 && (() => {
        const avg = rolls.reduce((s, r) => s + r, 0) / totalRolls;
        let mostNum = 2, mostCount = counts[2];
        let leastNum = 0, leastCount = Infinity;
        for (let n = 2; n <= 12; n++) {
          if (counts[n] > mostCount) { mostNum = n; mostCount = counts[n]; }
          if (counts[n] < leastCount && (totalRolls < 20 || counts[n] > 0)) { leastNum = n; leastCount = counts[n]; }
        }
        if (leastNum === 0) { leastNum = 2; leastCount = counts[2]; }
        return (
          <div className="mt-2 pt-2 border-t border-gray-200 px-1">
            <div className="font-pixel text-[7px] text-gray-400 mb-1 text-center">SUMMARY</div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-pixel text-[8px]">
              <div className="text-gray-500">AVG ROLL</div>
              <div className="text-right">
                <span className="text-gray-700">{avg.toFixed(1)}</span>
                <span className="text-gray-400 ml-1">/ 7.0</span>
              </div>
              <div className="text-gray-500">MOST</div>
              <div className="text-right">
                <span style={{ color: barColor(mostNum) }}>{mostNum}</span>
                <span className="text-gray-400 ml-1">×{mostCount}</span>
              </div>
              <div className="text-gray-500">LEAST</div>
              <div className="text-right">
                <span style={{ color: barColor(leastNum) }}>{leastNum}</span>
                <span className="text-gray-400 ml-1">×{leastCount}</span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Explanation */}
      {totalRolls > 0 && (
        <div className="mt-2 pt-2 border-t border-gray-200 px-1">
          <div className="font-pixel text-[6px] text-gray-400 leading-relaxed space-y-0.5">
            <div>
              <span style={{ color: "#dc2626" }}>↑</span> hot &nbsp;
              <span style={{ color: "#2563eb" }}>↓</span> cold &nbsp;
              <span style={{ color: "#d97706" }}>DUE</span> overdue &nbsp;
              <span className="text-gray-300">|</span> = expected
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
