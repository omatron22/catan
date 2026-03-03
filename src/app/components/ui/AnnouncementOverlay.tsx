"use client";

import { useEffect, useState } from "react";
import { HelmetPixel, RoadPixel } from "@/app/components/icons/PixelIcons";

export interface Announcement {
  playerName: string;
  playerColor: string;
  type: "largest-army" | "longest-road";
}

interface Props {
  announcement: Announcement | null;
  onDismiss: () => void;
}

export default function AnnouncementOverlay({ announcement, onDismiss }: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!announcement) { setVisible(false); return; }
    setVisible(true);
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(onDismiss, 400);
    }, 3000);
    return () => clearTimeout(timer);
  }, [announcement]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!announcement) return null;

  const isArmy = announcement.type === "largest-army";
  const title = isArmy ? "LARGEST ARMY" : "LONGEST ROAD";
  const bgColor = isArmy ? "bg-purple-900/90" : "bg-amber-900/90";
  const borderColor = isArmy ? "border-purple-400" : "border-amber-400";
  const textColor = isArmy ? "text-purple-200" : "text-amber-200";

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center pointer-events-none transition-opacity duration-400 ${
        visible ? "opacity-100" : "opacity-0"
      }`}
    >
      <div className={`${bgColor} border-4 ${borderColor} px-10 py-6 text-center`} style={{ backdropFilter: "blur(4px)" }}>
        <div className="flex justify-center mb-3">
          {isArmy ? (
            <HelmetPixel size={40} color={announcement.playerColor} />
          ) : (
            <RoadPixel size={40} color={announcement.playerColor} />
          )}
        </div>
        <div className="font-pixel text-[10px] text-gray-400 mb-1">
          {announcement.playerName.toUpperCase()}
        </div>
        <div className={`font-pixel text-[16px] ${textColor}`}>
          {title}
        </div>
      </div>
    </div>
  );
}
