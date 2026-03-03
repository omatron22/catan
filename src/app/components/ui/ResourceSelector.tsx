"use client";

import { useState } from "react";
import type { Resource } from "@/shared/types/game";
import type { GameAction } from "@/shared/types/actions";
import { ALL_RESOURCES, RESOURCE_COLORS } from "@/shared/constants";
import { ResourceIcon } from "@/app/components/icons/ResourceIcons";

interface MonopolyProps {
  type: "monopoly";
  playerIndex: number;
  onAction: (action: GameAction) => void;
  onClose: () => void;
}

interface YearOfPlentyProps {
  type: "year-of-plenty";
  playerIndex: number;
  onAction: (action: GameAction) => void;
  onClose: () => void;
}

type Props = MonopolyProps | YearOfPlentyProps;

export default function ResourceSelector(props: Props) {
  const [selected, setSelected] = useState<Resource[]>([]);

  function handleSelect(res: Resource) {
    if (props.type === "monopoly") {
      props.onAction({
        type: "play-monopoly",
        playerIndex: props.playerIndex,
        resource: res,
      });
      props.onClose();
    } else {
      const newSelected = [...selected, res];
      if (newSelected.length === 2) {
        props.onAction({
          type: "play-year-of-plenty",
          playerIndex: props.playerIndex,
          resource1: newSelected[0],
          resource2: newSelected[1],
        });
        props.onClose();
      } else {
        setSelected(newSelected);
      }
    }
  }

  const title = props.type === "monopoly"
    ? "MONOPOLY"
    : `PICK ${2 - selected.length} RESOURCE${2 - selected.length > 1 ? "S" : ""}`;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-[#f0e6d0] pixel-border p-6 max-w-sm w-full mx-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-pixel text-[10px] text-gray-800">{title}</h2>
          <button onClick={props.onClose} className="font-pixel text-[10px] text-gray-600 hover:text-gray-900 pixel-btn bg-[#e8d8b8] px-2 py-1">X</button>
        </div>
        <div className="flex gap-3 justify-center">
          {ALL_RESOURCES.map((res) => (
            <button
              key={res}
              onClick={() => handleSelect(res)}
              className="flex flex-col items-center gap-1 px-3 py-2 bg-[#e8d8b8] border-2 border-black hover:bg-amber-200 pixel-btn"
            >
              <div
                className="w-10 h-10 flex items-center justify-center border-2 border-black"
                style={{ backgroundColor: RESOURCE_COLORS[res] }}
              >
                <ResourceIcon resource={res} size={24} />
              </div>
              <span className="font-pixel text-[6px] capitalize text-gray-700">{res}</span>
            </button>
          ))}
        </div>
        {selected.length > 0 && (
          <div className="flex items-center gap-2 mt-3 justify-center">
            <span className="font-pixel text-[7px] text-gray-500">SELECTED:</span>
            {selected.map((r, i) => (
              <div key={i} className="w-6 h-6 flex items-center justify-center border border-black" style={{ backgroundColor: RESOURCE_COLORS[r] }}>
                <ResourceIcon resource={r} size={14} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
