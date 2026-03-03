import { shuffle } from "@/shared/utils/hexMath";

/**
 * Fair dice: a bag of 36 outcomes matching true 2d6 probability distribution.
 * Draw one per roll, refill when empty. Guarantees statistical fairness over cycles.
 */

/** Build a full bag of 36 dice totals matching 2d6 probability */
export function createFairDiceBag(): number[] {
  const bag: number[] = [];
  for (let d1 = 1; d1 <= 6; d1++) {
    for (let d2 = 1; d2 <= 6; d2++) {
      bag.push(d1 + d2);
    }
  }
  return shuffle(bag);
}

/** Draw a total from the bag. If empty, refills first. Returns [total, updatedBag] */
export function drawFairDice(bag: number[]): { total: number; die1: number; die2: number; updatedBag: number[] } {
  let currentBag = bag.length > 0 ? [...bag] : createFairDiceBag();
  const total = currentBag.pop()!;

  // Split total into two dice for display (deterministic split for consistency)
  const die1 = Math.min(6, Math.max(1, Math.ceil(total / 2)));
  const die2 = total - die1;

  return { total, die1, die2, updatedBag: currentBag };
}
