"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import {
  isMusicMuted, setMusicMuted,
  setSfxMuted, playClick,
  getMasterVolume, setMasterVolume, updateMusicVolume,
} from "@/app/utils/sounds";

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
function SpeakerIcon({ volume, size = 16 }: { volume: number; size?: number }) {
  const color = volume === 0 ? "#666" : "#fbbf24";
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" shapeRendering="crispEdges">
      {/* Speaker body */}
      <rect x="2" y="5" width="3" height="6" fill={color} />
      {/* Speaker cone */}
      <rect x="5" y="4" width="1" height="8" fill={color} />
      <rect x="6" y="3" width="1" height="10" fill={color} />
      <rect x="7" y="2" width="1" height="12" fill={color} />
      {/* Sound waves */}
      {volume > 0 && <rect x="9" y="5" width="1" height="6" fill={color} opacity={0.6} />}
      {volume > 40 && <rect x="11" y="4" width="1" height="8" fill={color} opacity={0.4} />}
      {volume > 70 && <rect x="13" y="3" width="1" height="10" fill={color} opacity={0.25} />}
      {/* X for muted */}
      {volume === 0 && (
        <>
          <rect x="10" y="4" width="2" height="2" fill="#ef4444" />
          <rect x="12" y="6" width="2" height="2" fill="#ef4444" />
          <rect x="10" y="8" width="2" height="2" fill="#ef4444" />
        </>
      )}
    </svg>
  );
}

export default function AudioControls({ className = "" }: { className?: string }) {
  const [musicOff, setMusicOff] = useState(isMusicMuted);
  const [vol, setVol] = useState(getMasterVolume);
  const [showSlider, setShowSlider] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const toggleMusic = useCallback(() => {
    const next = !musicOff;
    setMusicOff(next);
    setMusicMuted(next);
    if (!next) playClick();
  }, [musicOff]);

  const toggleSlider = useCallback(() => {
    setShowSlider((prev) => !prev);
  }, []);

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    setVol(v);
    setMasterVolume(v);
    updateMusicVolume();
    setSfxMuted(v === 0);
  }, []);

  // Click-outside to close slider
  useEffect(() => {
    if (!showSlider) return;
    function handleMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSlider(false);
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [showSlider]);

  return (
    <div ref={containerRef} className={`flex items-center gap-1 ${className}`}>
      {/* Music on/off toggle */}
      <button
        onClick={toggleMusic}
        className={`w-8 h-8 flex items-center justify-center border transition-colors cursor-pointer ${
          musicOff
            ? "bg-black/40 border-white/20 hover:bg-black/60"
            : "bg-black/40 border-amber-400/50 hover:bg-black/60"
        }`}
        title={musicOff ? "Music: OFF" : "Music: ON"}
      >
        <MusicIcon muted={musicOff} />
      </button>

      {/* Sound volume button + slider */}
      <button
        onClick={toggleSlider}
        className={`w-8 h-8 flex items-center justify-center border transition-colors cursor-pointer ${
          vol === 0
            ? "bg-black/40 border-white/20 hover:bg-black/60"
            : "bg-black/40 border-amber-400/50 hover:bg-black/60"
        }`}
        title={`Sound: ${vol}%`}
      >
        <SpeakerIcon volume={vol} />
      </button>
      {showSlider && (
        <input
          type="range"
          min={0}
          max={100}
          value={vol}
          onChange={handleVolumeChange}
          className="w-16 h-1.5 accent-amber-400 cursor-pointer"
          title={`Volume: ${vol}%`}
        />
      )}
    </div>
  );
}
