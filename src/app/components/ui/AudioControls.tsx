"use client";

import { useState, useCallback } from "react";
import { isMusicMuted, setMusicMuted, isSfxMuted, setSfxMuted, playClick } from "@/app/utils/sounds";

/** Pixel-art music note icon */
function MusicIcon({ muted, size = 16 }: { muted: boolean; size?: number }) {
  const color = muted ? "#666" : "#fbbf24";
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" shapeRendering="crispEdges">
      {/* Note stem */}
      <rect x="10" y="1" width="2" height="11" fill={color} />
      {/* Flag */}
      <rect x="12" y="1" width="2" height="2" fill={color} />
      <rect x="12" y="3" width="1" height="2" fill={color} />
      {/* Note head */}
      <rect x="6" y="10" width="4" height="3" fill={color} />
      <rect x="5" y="11" width="6" height="2" fill={color} />
      {/* X for muted */}
      {muted && (
        <>
          <rect x="1" y="3" width="2" height="2" fill="#ef4444" />
          <rect x="3" y="5" width="2" height="2" fill="#ef4444" />
          <rect x="1" y="7" width="2" height="2" fill="#ef4444" />
        </>
      )}
    </svg>
  );
}

/** Pixel-art speaker icon */
function SpeakerIcon({ muted, size = 16 }: { muted: boolean; size?: number }) {
  const color = muted ? "#666" : "#fbbf24";
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" shapeRendering="crispEdges">
      {/* Speaker body */}
      <rect x="2" y="5" width="3" height="6" fill={color} />
      <rect x="5" y="3" width="2" height="10" fill={color} />
      <rect x="7" y="1" width="2" height="14" fill={color} />
      {/* Sound waves or X */}
      {muted ? (
        <>
          <rect x="11" y="4" width="2" height="2" fill="#ef4444" />
          <rect x="13" y="6" width="2" height="2" fill="#ef4444" />
          <rect x="11" y="8" width="2" height="2" fill="#ef4444" />
          <rect x="13" y="4" width="2" height="2" fill="#ef4444" />
          <rect x="11" y="6" width="2" height="2" fill="#ef4444" />
          <rect x="13" y="8" width="2" height="2" fill="#ef4444" />
        </>
      ) : (
        <>
          <rect x="11" y="5" width="1" height="6" fill={color} />
          <rect x="13" y="3" width="1" height="10" fill={color} />
        </>
      )}
    </svg>
  );
}

export default function AudioControls({ className = "" }: { className?: string }) {
  const [musicOff, setMusicOff] = useState(isMusicMuted);
  const [sfxOff, setSfxOff] = useState(isSfxMuted);

  const toggleMusic = useCallback(() => {
    const next = !musicOff;
    setMusicOff(next);
    setMusicMuted(next);
    if (!next) playClick();
  }, [musicOff]);

  const toggleSfx = useCallback(() => {
    const next = !sfxOff;
    setSfxOff(next);
    setSfxMuted(next);
    if (!next) playClick();
  }, [sfxOff]);

  return (
    <div className={`flex items-center gap-1 ${className}`}>
      <button
        onClick={toggleMusic}
        className="w-8 h-8 flex items-center justify-center bg-black/40 hover:bg-black/60 border border-white/20 transition-colors cursor-pointer"
        title={musicOff ? "Music: OFF" : "Music: ON"}
      >
        <MusicIcon muted={musicOff} />
      </button>
      <button
        onClick={toggleSfx}
        className="w-8 h-8 flex items-center justify-center bg-black/40 hover:bg-black/60 border border-white/20 transition-colors cursor-pointer"
        title={sfxOff ? "Sound: OFF" : "Sound: ON"}
      >
        <SpeakerIcon muted={sfxOff} />
      </button>
    </div>
  );
}
