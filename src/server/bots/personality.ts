import type { BotPersonality } from "@/shared/types/config";
import { DEFAULT_BOT_PERSONALITY } from "@/shared/types/config";

export interface PersonalityWeights {
  cityScore: number;
  settlementScore: number;
  roadScore: number;
  devCardScore: number;
  playerTradeChance: number;
  tradeAcceptThreshold: number;
  counterOfferChance: number;
  robberAggression: number;
  robberSelfProtect: number;
  knightEagerness: number;
  resourceHoarding: number;
  endgameThreshold: number;
  setupDiversity: number;
  portStrategyWeight: number;
}

const PERSONALITY_WEIGHTS: Record<BotPersonality, PersonalityWeights> = {
  balanced: {
    cityScore: 1.0,
    settlementScore: 1.0,
    roadScore: 1.0,
    devCardScore: 1.0,
    playerTradeChance: 0.4,
    tradeAcceptThreshold: 0,
    counterOfferChance: 0.35,
    robberAggression: 1.0,
    robberSelfProtect: 1.0,
    knightEagerness: 1.0,
    resourceHoarding: 1.0,
    endgameThreshold: 0.8,
    setupDiversity: 1.0,
    portStrategyWeight: 0.5,
  },
  aggressive: {
    cityScore: 0.9,
    settlementScore: 0.8,
    roadScore: 1.3,
    devCardScore: 1.3,
    playerTradeChance: 0.2,
    tradeAcceptThreshold: 1,
    counterOfferChance: 0.15,
    robberAggression: 1.8,
    robberSelfProtect: 0.7,
    knightEagerness: 1.5,
    resourceHoarding: 0.8,
    endgameThreshold: 0.7,
    setupDiversity: 0.8,
    portStrategyWeight: 0.4,
  },
  builder: {
    cityScore: 1.3,
    settlementScore: 1.3,
    roadScore: 1.1,
    devCardScore: 0.7,
    playerTradeChance: 0.5,
    tradeAcceptThreshold: -1,
    counterOfferChance: 0.3,
    robberAggression: 0.8,
    robberSelfProtect: 1.3,
    knightEagerness: 0.6,
    resourceHoarding: 1.3,
    endgameThreshold: 0.85,
    setupDiversity: 1.3,
    portStrategyWeight: 0.3,
  },
  trader: {
    cityScore: 1.0,
    settlementScore: 1.0,
    roadScore: 0.9,
    devCardScore: 0.9,
    playerTradeChance: 0.8,
    tradeAcceptThreshold: -2,
    counterOfferChance: 0.6,
    robberAggression: 0.9,
    robberSelfProtect: 1.0,
    knightEagerness: 0.8,
    resourceHoarding: 0.7,
    endgameThreshold: 0.8,
    setupDiversity: 0.9,
    portStrategyWeight: 0.8,
  },
  devcard: {
    cityScore: 0.8,
    settlementScore: 0.7,
    roadScore: 0.6,
    devCardScore: 1.8,
    playerTradeChance: 0.3,
    tradeAcceptThreshold: 0,
    counterOfferChance: 0.3,
    robberAggression: 1.2,
    robberSelfProtect: 1.0,
    knightEagerness: 1.4,
    resourceHoarding: 1.2,
    endgameThreshold: 0.75,
    setupDiversity: 0.7,
    portStrategyWeight: 0.4,
  },
};

export function getWeights(personality?: BotPersonality): PersonalityWeights {
  return PERSONALITY_WEIGHTS[personality ?? DEFAULT_BOT_PERSONALITY];
}
