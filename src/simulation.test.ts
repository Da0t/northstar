import { describe, expect, it } from "vitest";
import {
  SimulationValidationError,
  assumptionsEqual,
  runSimulation,
  validateAssumptions,
  type PortfolioAssumptions,
} from "./simulation";

const BASE: PortfolioAssumptions = {
  startingBalance: 25_000,
  monthlyContribution: 750,
  years: 20,
  annualReturn: 0.07,
  annualVolatility: 0.15,
  targetEndingValue: 500_000,
};

describe("assumptionsEqual", () => {
  it("matches a numerically identical copy", () => {
    expect(assumptionsEqual(BASE, { ...BASE })).toBe(true);
  });

  it.each([
    ["startingBalance", 25_001],
    ["monthlyContribution", 751],
    ["years", 21],
    ["annualReturn", 0.071],
    ["annualVolatility", 0.151],
    ["targetEndingValue", 500_001],
  ] as const)("detects a changed %s", (field, value) => {
    expect(assumptionsEqual(BASE, { ...BASE, [field]: value })).toBe(false);
  });

  it("does not treat invalid numeric input as equal", () => {
    expect(assumptionsEqual(BASE, { ...BASE, startingBalance: Number.NaN })).toBe(false);
  });
});

describe("runSimulation", () => {
  it("is deterministic for the same seed and inputs", () => {
    const first = runSimulation(BASE, { scenarios: 250, seed: 42 });
    const second = runSimulation(BASE, { scenarios: 250, seed: 42 });
    const differentSeed = runSimulation(BASE, { scenarios: 250, seed: 43 });

    expect(first).toEqual(second);
    expect(differentSeed.points.at(-1)?.p50).not.toBe(first.points.at(-1)?.p50);
  });

  it("collapses every percentile to the closed-form value at zero volatility", () => {
    const assumptions: PortfolioAssumptions = {
      ...BASE,
      startingBalance: 10_000,
      monthlyContribution: 400,
      years: 3,
      annualReturn: 0.06,
      annualVolatility: 0,
    };
    const result = runSimulation(assumptions, { scenarios: 25, seed: 9 });
    const monthlyFactor = Math.exp(Math.log1p(assumptions.annualReturn) / 12);
    const months = assumptions.years * 12;
    const expected =
      assumptions.startingBalance * monthlyFactor ** months +
      assumptions.monthlyContribution * ((monthlyFactor ** months - 1) / (monthlyFactor - 1));
    const final = result.points.at(-1);

    expect(final?.p10).toBeCloseTo(expected, 7);
    expect(final?.p25).toBeCloseTo(expected, 7);
    expect(final?.p50).toBeCloseTo(expected, 7);
    expect(final?.p75).toBeCloseTo(expected, 7);
    expect(final?.p90).toBeCloseTo(expected, 7);
  });

  it("accumulates end-of-month contributions exactly when return and volatility are zero", () => {
    const assumptions: PortfolioAssumptions = {
      ...BASE,
      startingBalance: 1_200,
      monthlyContribution: 100,
      years: 4,
      annualReturn: 0,
      annualVolatility: 0,
    };
    const result = runSimulation(assumptions, { scenarios: 10, seed: 2 });

    for (const point of result.points) {
      const expected = assumptions.startingBalance + assumptions.monthlyContribution * point.year * 12;
      expect(point.p50).toBe(expected);
      expect(point.invested).toBe(expected);
    }
  });

  it("keeps a zero balance at zero when there are no contributions", () => {
    const result = runSimulation(
      {
        ...BASE,
        startingBalance: 0,
        monthlyContribution: 0,
        targetEndingValue: 1,
      },
      { scenarios: 50, seed: 7 },
    );

    expect(result.successProbability).toBe(0);
    for (const point of result.points) {
      expect(point).toMatchObject({ p10: 0, p25: 0, p50: 0, p75: 0, p90: 0, invested: 0 });
    }
  });

  it("treats a zero target as reached in every nonnegative path", () => {
    const result = runSimulation(
      { ...BASE, startingBalance: 0, monthlyContribution: 0, targetEndingValue: 0 },
      { scenarios: 50, seed: 3 },
    );
    expect(result.successProbability).toBe(1);
  });

  it("counts a final value exactly equal to the target as success", () => {
    const result = runSimulation(
      {
        ...BASE,
        startingBalance: 100,
        monthlyContribution: 0,
        years: 1,
        annualReturn: 0,
        annualVolatility: 0,
        targetEndingValue: 100,
      },
      { scenarios: 3, seed: 1 },
    );
    expect(result.successProbability).toBe(1);
  });

  it("returns ordered, finite, nonnegative percentiles", () => {
    const result = runSimulation(BASE, { scenarios: 400, seed: 1234 });

    for (const point of result.points) {
      const values = [point.p10, point.p25, point.p50, point.p75, point.p90];
      expect(values.every((value) => Number.isFinite(value) && value >= 0)).toBe(true);
      expect(point.invested).toBeGreaterThanOrEqual(0);
      expect(point.p10).toBeLessThanOrEqual(point.p25);
      expect(point.p25).toBeLessThanOrEqual(point.p50);
      expect(point.p50).toBeLessThanOrEqual(point.p75);
      expect(point.p75).toBeLessThanOrEqual(point.p90);
    }
  });

  it("captures year zero and one snapshot for every elapsed year", () => {
    const result = runSimulation({ ...BASE, years: 7 }, { scenarios: 5, seed: 5 });
    expect(result.points).toHaveLength(8);
    expect(result.points.map((point) => point.year)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(result.points[0]).toMatchObject({
      p10: BASE.startingBalance,
      p25: BASE.startingBalance,
      p50: BASE.startingBalance,
      p75: BASE.startingBalance,
      p90: BASE.startingBalance,
    });
  });
});

describe("validation", () => {
  it.each([
    ["startingBalance", Number.NaN],
    ["monthlyContribution", Number.POSITIVE_INFINITY],
    ["targetEndingValue", Number.NEGATIVE_INFINITY],
    ["annualReturn", Number.NaN],
    ["annualVolatility", Number.POSITIVE_INFINITY],
    ["years", Number.NaN],
  ] as const)("rejects a nonfinite %s", (field, value) => {
    const assumptions = { ...BASE, [field]: value };
    expect(validateAssumptions(assumptions)).toEqual(
      expect.arrayContaining([expect.objectContaining({ field })]),
    );
    expect(() => runSimulation(assumptions, { scenarios: 2 })).toThrow(SimulationValidationError);
  });

  it.each([
    { field: "startingBalance", value: -1 },
    { field: "monthlyContribution", value: -1 },
    { field: "targetEndingValue", value: -1 },
    { field: "annualVolatility", value: -0.01 },
    { field: "annualVolatility", value: 1.01 },
    { field: "annualReturn", value: -1 },
    { field: "annualReturn", value: -2 },
    { field: "years", value: 0 },
    { field: "years", value: 51 },
    { field: "years", value: 2.5 },
  ] as const)("rejects $field=$value", ({ field, value }) => {
    const assumptions = { ...BASE, [field]: value };
    expect(() => runSimulation(assumptions, { scenarios: 2 })).toThrow(SimulationValidationError);
  });

  it("rejects invalid scenario counts and seeds", () => {
    expect(() => runSimulation(BASE, { scenarios: 0 })).toThrow(RangeError);
    expect(() => runSimulation(BASE, { scenarios: 2.5 })).toThrow(RangeError);
    expect(() => runSimulation(BASE, { scenarios: 2, seed: Number.NaN })).toThrow(RangeError);
  });
});
