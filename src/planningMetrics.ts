export interface ProbabilityInterval {
  lower: number;
  upper: number;
  confidenceLevel: number;
}

function assertSample(
  sortedValues: readonly number[],
  label: string,
): void {
  if (sortedValues.length === 0) {
    throw new RangeError(`${label} requires at least one value.`);
  }
  let previous = Number.NEGATIVE_INFINITY;
  for (const value of sortedValues) {
    if (!Number.isFinite(value) || value < 0 || value < previous) {
      throw new RangeError(`${label} values must be finite, nonnegative, and sorted.`);
    }
    previous = value;
  }
}

function assertSuccessBps(successBps: number): void {
  if (!Number.isSafeInteger(successBps) || successBps < 1 || successBps > 10_000) {
    throw new RangeError("Success threshold must be an integer from 1 through 10,000 bps.");
  }
}

function requiredSampleCount(sampleSize: number, successBps: number): number {
  assertSuccessBps(successBps);
  return Math.floor((successBps * sampleSize + 9_999) / 10_000);
}

export function wilsonInterval(
  successes: number,
  sampleSize: number,
): ProbabilityInterval {
  if (
    !Number.isSafeInteger(successes) ||
    !Number.isSafeInteger(sampleSize) ||
    sampleSize < 1 ||
    successes < 0 ||
    successes > sampleSize
  ) {
    throw new RangeError("Wilson interval counts must be valid nonnegative integers.");
  }

  const z = 1.959963984540054;
  const observed = successes / sampleSize;
  const zSquared = z ** 2;
  const denominator = 1 + zSquared / sampleSize;
  const center = (observed + zSquared / (2 * sampleSize)) / denominator;
  const margin =
    (z / denominator) *
    Math.sqrt(
      (observed * (1 - observed)) / sampleSize +
        zSquared / (4 * sampleSize ** 2),
    );

  return {
    lower: Math.max(0, center - margin),
    upper: Math.min(1, center + margin),
    confidenceLevel: 0.95,
  };
}

export function requirementAtSuccessRate(
  sortedRequirements: readonly number[],
  successBps: number,
): number {
  assertSample(sortedRequirements, "Required contribution selection");
  const requiredSuccesses = requiredSampleCount(
    sortedRequirements.length,
    successBps,
  );
  return sortedRequirements[Math.max(0, requiredSuccesses - 1)]!;
}

export function supportedValueAtSuccessRate(
  sortedOutcomes: readonly number[],
  successBps: number,
): number {
  assertSample(sortedOutcomes, "Supported goal selection");
  const requiredSuccesses = requiredSampleCount(
    sortedOutcomes.length,
    successBps,
  );
  const index = Math.max(0, sortedOutcomes.length - requiredSuccesses);
  return sortedOutcomes[index]!;
}

export function lowerTailMean(
  sortedOutcomes: readonly number[],
  tailFraction: number,
): number {
  assertSample(sortedOutcomes, "Lower-tail mean");
  if (!Number.isFinite(tailFraction) || tailFraction <= 0 || tailFraction > 1) {
    throw new RangeError("Tail fraction must be greater than 0 and at most 1.");
  }
  const tailCount = Math.max(1, Math.ceil(sortedOutcomes.length * tailFraction));
  let total = 0;
  for (let index = 0; index < tailCount; index += 1) {
    total += sortedOutcomes[index]!;
  }
  return total / tailCount;
}

export function ceilToCents(value: number): number {
  if (
    !Number.isFinite(value) ||
    value < 0 ||
    value * 100 > Number.MAX_SAFE_INTEGER
  ) {
    throw new RangeError("Currency value must be finite, nonnegative, and safe at cent precision.");
  }
  let cents = Math.ceil(value * 100);
  if (cents > 0 && (cents - 1) / 100 >= value) cents -= 1;
  if (cents / 100 < value) cents += 1;
  return cents / 100;
}

export function floorToCents(value: number): number {
  if (
    !Number.isFinite(value) ||
    value < 0 ||
    value * 100 > Number.MAX_SAFE_INTEGER
  ) {
    throw new RangeError("Currency value must be finite, nonnegative, and safe at cent precision.");
  }
  let cents = Math.floor(value * 100);
  if ((cents + 1) / 100 <= value) cents += 1;
  if (cents > 0 && cents / 100 > value) cents -= 1;
  return cents / 100;
}

/** Subtracts displayed currency values in integer cents to avoid binary drift. */
export function nonnegativeCurrencyDifference(
  minuend: number,
  subtrahend: number,
): number {
  for (const value of [minuend, subtrahend]) {
    if (
      !Number.isFinite(value) ||
      value < 0 ||
      value * 100 > Number.MAX_SAFE_INTEGER
    ) {
      throw new RangeError(
        "Currency value must be finite, nonnegative, and safe at cent precision.",
      );
    }
  }

  const minuendCents = Math.round(minuend * 100);
  const subtrahendCents = Math.round(subtrahend * 100);
  return Math.max(0, minuendCents - subtrahendCents) / 100;
}

export function averageGoalShortfall(
  sortedOutcomes: readonly number[],
  goal: number,
): number | null {
  assertSample(sortedOutcomes, "Average goal shortfall");
  if (!Number.isFinite(goal) || goal < 0) {
    throw new RangeError("Goal must be finite and nonnegative.");
  }

  let misses = 0;
  let totalShortfall = 0;
  for (const outcome of sortedOutcomes) {
    if (outcome >= goal) break;
    totalShortfall += goal - outcome;
    misses += 1;
  }
  return misses === 0 ? null : totalShortfall / misses;
}
