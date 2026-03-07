import type { Terrain, Resource, DevelopmentCardType, PortType } from "./types/game";

/** Terrain distribution for the 19-hex standard board */
export const TERRAIN_COUNTS: Record<Terrain, number> = {
  hills: 3,
  forest: 4,
  mountains: 3,
  fields: 4,
  pasture: 4,
  desert: 1,
};

/** What resource each terrain produces */
export const TERRAIN_RESOURCE: Record<Terrain, Resource | null> = {
  hills: "brick",
  forest: "lumber",
  mountains: "ore",
  fields: "grain",
  pasture: "wool",
  desert: null,
};

/** Number tokens distributed on the board (excluding desert) */
export const NUMBER_TOKENS = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];

/** Probability dots for each number (how many ways to roll it) */
export const NUMBER_DOTS: Record<number, number> = {
  2: 1,
  3: 2,
  4: 3,
  5: 4,
  6: 5,
  8: 5,
  9: 4,
  10: 3,
  11: 2,
  12: 1,
};

/** Building costs */
export const BUILDING_COSTS: Record<string, Partial<Record<Resource, number>>> = {
  road: { brick: 1, lumber: 1 },
  settlement: { brick: 1, lumber: 1, grain: 1, wool: 1 },
  city: { ore: 3, grain: 2 },
  developmentCard: { ore: 1, grain: 1, wool: 1 },
};

/** Development card deck composition */
export const DEV_CARD_COUNTS: Record<DevelopmentCardType, number> = {
  knight: 14,
  roadBuilding: 2,
  yearOfPlenty: 2,
  monopoly: 2,
  victoryPoint: 5,
};

/** Port configuration — standard Catan has 9 ports */
export const PORT_TYPES: PortType[] = [
  "any",
  "any",
  "any",
  "any",
  "brick",
  "lumber",
  "ore",
  "grain",
  "wool",
];

/** Building limits per player */
export const MAX_SETTLEMENTS = 5;
export const MAX_CITIES = 4;
export const MAX_ROADS = 15;

/** Victory points to win */
export const VP_TO_WIN = 10;

/** Minimum knights for largest army */
export const MIN_KNIGHTS_FOR_LARGEST_ARMY = 3;

/** Minimum roads for longest road */
export const MIN_ROADS_FOR_LONGEST_ROAD = 5;

/** Resource hand limit before discard on 7 */
export const DISCARD_THRESHOLD = 7;

export const ALL_RESOURCES: Resource[] = ["brick", "lumber", "ore", "grain", "wool"];

/** Colors for players */
export const PLAYER_COLOR_HEX: Record<string, string> = {
  red: "#e74c3c",
  blue: "#3498db",
  white: "#ecf0f1",
  orange: "#e67e22",
  green: "#27ae60",
  purple: "#9b59b6",
  pink: "#e91e8f",
  teal: "#1abc9c",
  yellow: "#f1c40f",
  brown: "#8B4513",
  navy: "#2c3e7a",
  lime: "#7ed321",
  coral: "#ff6b6b",
  crimson: "#c0392b",
  sky: "#74b9ff",
  lavender: "#a29bfe",
  maroon: "#6c1d45",
  gold: "#d4a017",
  cyan: "#00cec9",
  charcoal: "#4a4a4a",
};

/** Terrain colors for rendering — matched to colonist.io palette */
export const TERRAIN_COLORS: Record<Terrain, string> = {
  hills: "#C4522A",
  forest: "#2E7D32",
  mountains: "#9EABB5",
  fields: "#EAB308",
  pasture: "#8BC34A",
  desert: "#D4C098",
};

/** Resource colors */
export const RESOURCE_COLORS: Record<Resource, string> = {
  brick: "#C4522A",
  lumber: "#2E7D32",
  ore: "#607d8b",
  grain: "#EAB308",
  wool: "#8BC34A",
};

/** UI color constants */
export const OCEAN_COLOR = "#2a6ab5";
export const UI_BG = "#2a6ab5";
export const UI_PANEL = "#ffffff";
export const UI_ACCENT = "#e8a024";

/** Hex ring coordinates for standard Catan board */
export const HEX_RING_COORDS: Array<{ q: number; r: number; s: number }> = [
  // Center
  { q: 0, r: 0, s: 0 },
  // Ring 1 (6 hexes)
  { q: 1, r: -1, s: 0 },
  { q: 1, r: 0, s: -1 },
  { q: 0, r: 1, s: -1 },
  { q: -1, r: 1, s: 0 },
  { q: -1, r: 0, s: 1 },
  { q: 0, r: -1, s: 1 },
  // Ring 2 (12 hexes)
  { q: 2, r: -2, s: 0 },
  { q: 2, r: -1, s: -1 },
  { q: 2, r: 0, s: -2 },
  { q: 1, r: 1, s: -2 },
  { q: 0, r: 2, s: -2 },
  { q: -1, r: 2, s: -1 },
  { q: -2, r: 2, s: 0 },
  { q: -2, r: 1, s: 1 },
  { q: -2, r: 0, s: 2 },
  { q: -1, r: -1, s: 2 },
  { q: 0, r: -2, s: 2 },
  { q: 1, r: -2, s: 1 },
];

// === Expansion Board (5-6 players) ===

/** Terrain distribution for the 30-hex expansion board (2 deserts) */
export const EXPANSION_TERRAIN_COUNTS: Record<Terrain, number> = {
  hills: 5,
  forest: 6,
  mountains: 5,
  fields: 6,
  pasture: 6,
  desert: 2,
};

/** Number tokens for expansion board (28 non-desert hexes) */
export const EXPANSION_NUMBER_TOKENS = [
  2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6,
  8, 8, 8, 9, 9, 9, 10, 10, 10, 11, 11, 11, 12, 12,
];

/** Port types for expansion board (11 ports) */
export const EXPANSION_PORT_TYPES: PortType[] = [
  "any", "any", "any", "any", "any",
  "brick", "lumber", "ore", "grain", "wool", "any",
];

/** Expansion building limits per player */
export const EXPANSION_MAX_SETTLEMENTS = 6;
export const EXPANSION_MAX_CITIES = 5;
export const EXPANSION_MAX_ROADS = 20;

/** Hex ring coordinates for expansion board (standard 19 + 11 expansion = 30 hexes)
 *  Symmetric diamond: row widths 3,4,5,6,5,4,3
 */
export const EXPANSION_HEX_RING_COORDS: Array<{ q: number; r: number; s: number }> = [
  // Include all standard hexes
  ...HEX_RING_COORDS,
  // Top row (r=-3): 3 new hexes
  { q: 0, r: -3, s: 3 },
  { q: 1, r: -3, s: 2 },
  { q: 2, r: -3, s: 1 },
  // Left-side extensions (r=-2 to r=2): 5 new hexes
  { q: -1, r: -2, s: 3 },
  { q: -2, r: -1, s: 3 },
  { q: -3, r: 0, s: 3 },
  { q: -3, r: 1, s: 2 },
  { q: -3, r: 2, s: 1 },
  // Bottom row (r=3): 3 new hexes
  { q: -3, r: 3, s: 0 },
  { q: -2, r: 3, s: -1 },
  { q: -1, r: 3, s: -2 },
];
