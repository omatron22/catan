import type { BuildingStyle } from "./types/config";

interface Point {
  x: number;
  y: number;
}

interface StyleDef {
  name: string;
  settlement: (pos: Point, r: number) => string;
  city: (pos: Point, r: number) => string;
}

export const STYLE_DEFS: Record<BuildingStyle, StyleDef> = {
  classic: {
    name: "Classic",
    // House with triangular roof (current default)
    settlement(pos, r) {
      const s = r * 1.4;
      return `M ${pos.x - s} ${pos.y + s * 0.6} L ${pos.x - s} ${pos.y - s * 0.2} L ${pos.x} ${pos.y - s} L ${pos.x + s} ${pos.y - s * 0.2} L ${pos.x + s} ${pos.y + s * 0.6} Z`;
    },
    // Castle with center tower (current default)
    city(pos, r) {
      const s = r * 1.8;
      return `M ${pos.x - s} ${pos.y + s * 0.5} L ${pos.x - s} ${pos.y - s * 0.3} L ${pos.x - s * 0.3} ${pos.y - s * 0.3} L ${pos.x - s * 0.3} ${pos.y - s * 0.8} L ${pos.x + s * 0.3} ${pos.y - s * 0.8} L ${pos.x + s * 0.3} ${pos.y - s * 0.3} L ${pos.x + s} ${pos.y - s * 0.3} L ${pos.x + s} ${pos.y + s * 0.5} Z`;
    },
  },

  medieval: {
    name: "Medieval",
    // Round keep (octagonal shape)
    settlement(pos, r) {
      const s = r * 1.3;
      const d = s * 0.707; // cos(45)
      return `M ${pos.x - d} ${pos.y - s} L ${pos.x + d} ${pos.y - s} L ${pos.x + s} ${pos.y - d} L ${pos.x + s} ${pos.y + d} L ${pos.x + d} ${pos.y + s} L ${pos.x - d} ${pos.y + s} L ${pos.x - s} ${pos.y + d} L ${pos.x - s} ${pos.y - d} Z`;
    },
    // Round keep with crenellated walls
    city(pos, r) {
      const s = r * 1.8;
      const w = s * 0.25; // merlon width
      return `M ${pos.x - s} ${pos.y + s * 0.5} L ${pos.x - s} ${pos.y - s * 0.1} L ${pos.x - s + w} ${pos.y - s * 0.1} L ${pos.x - s + w} ${pos.y - s * 0.3} L ${pos.x - s + w * 2} ${pos.y - s * 0.3} L ${pos.x - s + w * 2} ${pos.y - s * 0.1} L ${pos.x - w} ${pos.y - s * 0.1} L ${pos.x - w} ${pos.y - s * 0.8} L ${pos.x + w} ${pos.y - s * 0.8} L ${pos.x + w} ${pos.y - s * 0.1} L ${pos.x + s - w * 2} ${pos.y - s * 0.1} L ${pos.x + s - w * 2} ${pos.y - s * 0.3} L ${pos.x + s - w} ${pos.y - s * 0.3} L ${pos.x + s - w} ${pos.y - s * 0.1} L ${pos.x + s} ${pos.y - s * 0.1} L ${pos.x + s} ${pos.y + s * 0.5} Z`;
    },
  },

  nordic: {
    name: "Nordic",
    // Steep A-frame cabin
    settlement(pos, r) {
      const s = r * 1.4;
      return `M ${pos.x - s * 0.8} ${pos.y + s * 0.7} L ${pos.x - s * 0.3} ${pos.y + s * 0.7} L ${pos.x - s * 0.3} ${pos.y - s * 0.1} L ${pos.x} ${pos.y - s * 1.1} L ${pos.x + s * 0.3} ${pos.y - s * 0.1} L ${pos.x + s * 0.3} ${pos.y + s * 0.7} L ${pos.x + s * 0.8} ${pos.y + s * 0.7} L ${pos.x} ${pos.y - s * 1.1} Z`;
    },
    // Stave church with spire and wings
    city(pos, r) {
      const s = r * 1.8;
      return `M ${pos.x - s} ${pos.y + s * 0.5} L ${pos.x - s} ${pos.y} L ${pos.x - s * 0.5} ${pos.y - s * 0.4} L ${pos.x - s * 0.5} ${pos.y - s * 0.2} L ${pos.x - s * 0.15} ${pos.y - s * 0.6} L ${pos.x - s * 0.15} ${pos.y - s * 0.4} L ${pos.x} ${pos.y - s * 1.0} L ${pos.x + s * 0.15} ${pos.y - s * 0.4} L ${pos.x + s * 0.15} ${pos.y - s * 0.6} L ${pos.x + s * 0.5} ${pos.y - s * 0.2} L ${pos.x + s * 0.5} ${pos.y - s * 0.4} L ${pos.x + s} ${pos.y} L ${pos.x + s} ${pos.y + s * 0.5} Z`;
    },
  },

  colonial: {
    name: "Colonial",
    // Flat-roof house with chimney notch
    settlement(pos, r) {
      const s = r * 1.4;
      return `M ${pos.x - s} ${pos.y + s * 0.6} L ${pos.x - s} ${pos.y - s * 0.4} L ${pos.x + s * 0.4} ${pos.y - s * 0.4} L ${pos.x + s * 0.4} ${pos.y - s * 0.8} L ${pos.x + s * 0.7} ${pos.y - s * 0.8} L ${pos.x + s * 0.7} ${pos.y - s * 0.4} L ${pos.x + s} ${pos.y - s * 0.4} L ${pos.x + s} ${pos.y + s * 0.6} Z`;
    },
    // Wide manor with two chimneys
    city(pos, r) {
      const s = r * 1.8;
      return `M ${pos.x - s} ${pos.y + s * 0.5} L ${pos.x - s} ${pos.y - s * 0.2} L ${pos.x - s * 0.7} ${pos.y - s * 0.2} L ${pos.x - s * 0.7} ${pos.y - s * 0.65} L ${pos.x - s * 0.5} ${pos.y - s * 0.65} L ${pos.x - s * 0.5} ${pos.y - s * 0.2} L ${pos.x + s * 0.5} ${pos.y - s * 0.2} L ${pos.x + s * 0.5} ${pos.y - s * 0.65} L ${pos.x + s * 0.7} ${pos.y - s * 0.65} L ${pos.x + s * 0.7} ${pos.y - s * 0.2} L ${pos.x + s} ${pos.y - s * 0.2} L ${pos.x + s} ${pos.y + s * 0.5} Z`;
    },
  },

  eastern: {
    name: "Eastern",
    // Single-tier pagoda (upturned roof)
    settlement(pos, r) {
      const s = r * 1.4;
      return `M ${pos.x - s * 0.7} ${pos.y + s * 0.6} L ${pos.x - s * 0.7} ${pos.y} L ${pos.x - s * 1.0} ${pos.y - s * 0.1} L ${pos.x - s * 0.5} ${pos.y - s * 0.4} L ${pos.x} ${pos.y - s * 0.9} L ${pos.x + s * 0.5} ${pos.y - s * 0.4} L ${pos.x + s * 1.0} ${pos.y - s * 0.1} L ${pos.x + s * 0.7} ${pos.y} L ${pos.x + s * 0.7} ${pos.y + s * 0.6} Z`;
    },
    // Multi-tier pagoda
    city(pos, r) {
      const s = r * 1.8;
      return `M ${pos.x - s * 0.6} ${pos.y + s * 0.5} L ${pos.x - s * 0.6} ${pos.y + s * 0.1} L ${pos.x - s * 0.85} ${pos.y + s * 0.05} L ${pos.x - s * 0.45} ${pos.y - s * 0.15} L ${pos.x - s * 0.7} ${pos.y - s * 0.2} L ${pos.x - s * 0.3} ${pos.y - s * 0.45} L ${pos.x} ${pos.y - s * 0.9} L ${pos.x + s * 0.3} ${pos.y - s * 0.45} L ${pos.x + s * 0.7} ${pos.y - s * 0.2} L ${pos.x + s * 0.45} ${pos.y - s * 0.15} L ${pos.x + s * 0.85} ${pos.y + s * 0.05} L ${pos.x + s * 0.6} ${pos.y + s * 0.1} L ${pos.x + s * 0.6} ${pos.y + s * 0.5} Z`;
    },
  },

  modern: {
    name: "Modern",
    // Flat-roof cube (minimalist)
    settlement(pos, r) {
      const s = r * 1.3;
      return `M ${pos.x - s} ${pos.y + s} L ${pos.x - s} ${pos.y - s} L ${pos.x + s} ${pos.y - s} L ${pos.x + s} ${pos.y + s} Z`;
    },
    // Tall skyscraper with antenna
    city(pos, r) {
      const s = r * 1.8;
      return `M ${pos.x - s * 0.5} ${pos.y + s * 0.5} L ${pos.x - s * 0.5} ${pos.y - s * 0.6} L ${pos.x - s * 0.15} ${pos.y - s * 0.6} L ${pos.x - s * 0.15} ${pos.y - s * 0.75} L ${pos.x - s * 0.05} ${pos.y - s * 0.75} L ${pos.x - s * 0.05} ${pos.y - s * 1.0} L ${pos.x + s * 0.05} ${pos.y - s * 1.0} L ${pos.x + s * 0.05} ${pos.y - s * 0.75} L ${pos.x + s * 0.15} ${pos.y - s * 0.75} L ${pos.x + s * 0.15} ${pos.y - s * 0.6} L ${pos.x + s * 0.5} ${pos.y - s * 0.6} L ${pos.x + s * 0.5} ${pos.y + s * 0.5} Z`;
    },
  },
};
