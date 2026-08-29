import { describe, expect, it } from "vitest";

import {
  averageGoalShortfall,
  ceilToCents,
  floorToCents,
  lowerTailMean,
  requirementAtSuccessRate,
  supportedValueAtSuccessRate,
  wilsonInterval,
} from "./planningMetrics";

describe("wilsonInterval", () => {
  it.each([
    { successes: 0, lower: 0, upper: 0.03699349820698569 },
    { successes: 50, lower: 0.4038315303659956, upper: 0.5961684696340044 },
    { successes: 100, lower: 0.9630065017930143, upper: 1 },
  ])("matches a 95% fixture for $successes of 100", ({ successes, lower, upper }) => {
    const interval = wilsonInterval(successes, 100);
    expect(interval.lower).toBeCloseTo(lower, 14);
    expect(interval.upper).toBeCloseTo(upper, 14);
    expect(interval.confidenceLevel).toBe(0.95);
  });

  it("rejects inconsistent counts", () => {
    expect(() => wilsonInterval(2, 1)).toThrow(RangeError);
    expect(() => wilsonInterval(0.5, 1)).toThrow(RangeError);
  });
});

describe("planning order statistics", () => {
  const sample = [10, 20, 30, 40, 50];

  it("selects a requirement that at least the requested sample share can satisfy", () => {
    expect(requirementAtSuccessRate(sample, 8_000)).toBe(40);
    expect(requirementAtSuccessRate(sample, 10_000)).toBe(50);
  });

  it("selects the largest goal supported by the requested sample share", () => {
    expect(supportedValueAtSuccessRate(sample, 8_000)).toBe(20);
    expect(supportedValueAtSuccessRate(sample, 10_000)).toBe(10);
  });

  it("selects exactly 2,800 required paths for 56% of 5,000", () => {
    const sample = Array.from({ length: 5_000 }, (_, index) => index + 1);
    expect(requirementAtSuccessRate(sample, 5_600)).toBe(2_800);
    expect(supportedValueAtSuccessRate(sample, 5_600)).toBe(2_201);
  });

  it("calculates a lower-tail mean with a nonempty nearest-rank tail", () => {
    expect(lowerTailMean(sample, 0.2)).toBe(10);
    expect(lowerTailMean(sample, 0.4)).toBe(15);
  });

  it("averages only actual goal misses", () => {
    expect(averageGoalShortfall(sample, 35)).toBe(15);
    expect(averageGoalShortfall(sample, 10)).toBeNull();
  });

  it("rejects empty, unsorted, or invalid samples", () => {
    expect(() => requirementAtSuccessRate([], 8_000)).toThrow(RangeError);
    expect(() => supportedValueAtSuccessRate([2, 1], 8_000)).toThrow(RangeError);
    expect(() => lowerTailMean([1, Number.NaN], 0.1)).toThrow(RangeError);
  });

  it("uses directionally safe cent rounding at binary floating-point edges", () => {
    expect(ceilToCents(0.07)).toBe(0.07);
    expect(ceilToCents(0.070_001)).toBe(0.08);
    expect(floorToCents(0.29)).toBe(0.29);
    expect(floorToCents(0.299_999)).toBe(0.29);
    const maxSafeCurrency = Number.MAX_SAFE_INTEGER / 100;
    expect(ceilToCents(maxSafeCurrency)).toBe(maxSafeCurrency);
    expect(floorToCents(maxSafeCurrency)).toBe(maxSafeCurrency);
    expect(() => floorToCents(maxSafeCurrency + 1)).toThrow(/cent precision/);
  });
});
