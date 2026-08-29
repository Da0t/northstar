import { MAX_UINT32 } from "./simulation";

export const DEFAULT_SIMULATION_SEED = 0x4e4f5254;

export type SeedInputResult =
  | { ok: true; value: number }
  | { ok: false; error: string };

const SEED_INPUT_ERROR =
  "Seed must use decimal digits from 0 through 4,294,967,295.";
const DECIMAL_DIGITS = /^[0-9]+$/;

function isUint32(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_UINT32;
}

/** Parses a user-entered base-10 seed without accepting coercive number syntax. */
export function parseSeedInput(input: string): SeedInputResult {
  if (!DECIMAL_DIGITS.test(input)) {
    return { ok: false, error: SEED_INPUT_ERROR };
  }

  const value = Number(input);
  return isUint32(value)
    ? { ok: true, value }
    : { ok: false, error: SEED_INPUT_ERROR };
}

/** Advances to the adjacent uint32 seed and wraps the maximum value to zero. */
export function nextSeed(seed: number): number {
  if (!isUint32(seed)) {
    throw new RangeError("Seed must be an unsigned 32-bit integer.");
  }

  return seed === MAX_UINT32 ? 0 : seed + 1;
}
