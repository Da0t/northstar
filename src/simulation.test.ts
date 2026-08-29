import { describe, expect, it } from "vitest";
import {
  MAX_SCENARIO_COUNT,
  MAX_UINT32,
  MODEL_VERSION,
  SimulationNumericalError,
  SimulationValidationError,
  assumptionsEqual,
  createNormalGenerator,
  mulberry32,
  percentile,
  resolveSimulationOptions,
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
  annualInflation: 0,
  annualFee: 0,
  targetTodayValue: 500_000,
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
    ["annualInflation", 0.02],
    ["annualFee", 0.0025],
    ["targetTodayValue", 500_001],
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
    expect(differentSeed.points.at(-1)?.nominal.p50).not.toBe(
      first.points.at(-1)?.nominal.p50,
    );
    expect(first).toMatchObject({ seed: 42, modelVersion: MODEL_VERSION });
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

    expect(final?.nominal.p10).toBeCloseTo(expected, 7);
    expect(final?.nominal.p25).toBeCloseTo(expected, 7);
    expect(final?.nominal.p50).toBeCloseTo(expected, 7);
    expect(final?.nominal.p75).toBeCloseTo(expected, 7);
    expect(final?.nominal.p90).toBeCloseTo(expected, 7);
    expect(final?.real).toEqual(final?.nominal);
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
      expect(point.nominal.p50).toBe(expected);
      expect(point.real.p50).toBe(expected);
      expect(point.investedNominal).toBe(expected);
      expect(point.investedReal).toBe(expected);
    }
  });

  it("keeps a zero balance at zero when there are no contributions", () => {
    const result = runSimulation(
      {
        ...BASE,
        startingBalance: 0,
        monthlyContribution: 0,
        targetTodayValue: 1,
      },
      { scenarios: 50, seed: 7 },
    );

    expect(result.successProbability).toBe(0);
    for (const point of result.points) {
      expect(point).toMatchObject({
        nominal: { p10: 0, p25: 0, p50: 0, p75: 0, p90: 0 },
        real: { p10: 0, p25: 0, p50: 0, p75: 0, p90: 0 },
        investedNominal: 0,
        investedReal: 0,
      });
    }
  });

  it("treats a zero target as reached in every nonnegative path", () => {
    const result = runSimulation(
      { ...BASE, startingBalance: 0, monthlyContribution: 0, targetTodayValue: 0 },
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
        targetTodayValue: 100,
      },
      { scenarios: 3, seed: 1 },
    );
    expect(result.successProbability).toBe(1);
  });

  it("returns ordered, finite, nonnegative percentiles", () => {
    const result = runSimulation(BASE, { scenarios: 400, seed: 1234 });

    for (const point of result.points) {
      for (const values of [Object.values(point.nominal), Object.values(point.real)]) {
        expect(values.every((value) => Number.isFinite(value) && value >= 0)).toBe(true);
        expect(values[0]).toBeLessThanOrEqual(values[1]!);
        expect(values[1]).toBeLessThanOrEqual(values[2]!);
        expect(values[2]).toBeLessThanOrEqual(values[3]!);
        expect(values[3]).toBeLessThanOrEqual(values[4]!);
      }
      expect(point.investedNominal).toBeGreaterThanOrEqual(0);
      expect(point.investedReal).toBeGreaterThanOrEqual(0);
    }
  });

  it("captures year zero and one snapshot for every elapsed year", () => {
    const result = runSimulation({ ...BASE, years: 7 }, { scenarios: 5, seed: 5 });
    expect(result.points).toHaveLength(8);
    expect(result.points.map((point) => point.year)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(result.points[0]?.nominal).toEqual({
      p10: BASE.startingBalance,
      p25: BASE.startingBalance,
      p50: BASE.startingBalance,
      p75: BASE.startingBalance,
      p90: BASE.startingBalance,
    });
  });

  it("surfaces numerical overflow instead of converting it into apparent wealth", () => {
    expect(() =>
      runSimulation(
        {
          ...BASE,
          startingBalance: 1_000_000_000_000,
          monthlyContribution: 0,
          years: 50,
          annualReturn: 1,
          annualVolatility: 0,
        },
        { scenarios: 1, seed: 0 },
      ),
    ).toThrow(SimulationNumericalError);
  });
});

describe("fees and purchasing power", () => {
  it("keeps nominal mechanics unchanged while deflating outcomes into today's dollars", () => {
    const assumptions: PortfolioAssumptions = {
      ...BASE,
      startingBalance: 100_000,
      monthlyContribution: 0,
      years: 10,
      annualReturn: 0,
      annualVolatility: 0,
      annualInflation: 0.02,
      targetTodayValue: 90_000,
    };
    const result = runSimulation(assumptions, { scenarios: 2, seed: 4 });
    const final = result.points.at(-1)!;
    const inflationIndex = 1.02 ** 10;

    expect(final.nominal.p50).toBe(100_000);
    expect(final.real.p50).toBeCloseTo(100_000 / inflationIndex, 10);
    expect(result.targetNominal).toBeCloseTo(90_000 * inflationIndex, 10);
    expect(result.successProbability).toBe(0);
  });

  it("applies the annual fee as a proportional monthly asset charge", () => {
    const assumptions: PortfolioAssumptions = {
      ...BASE,
      startingBalance: 10_000,
      monthlyContribution: 400,
      years: 3,
      annualReturn: 0.06,
      annualVolatility: 0,
      annualFee: 0.01,
    };
    const result = runSimulation(assumptions, { scenarios: 3, seed: 6 });
    const monthlyFactor =
      Math.exp(Math.log1p(assumptions.annualReturn) / 12) *
      (1 - assumptions.annualFee) ** (1 / 12);
    const months = assumptions.years * 12;
    const expected =
      assumptions.startingBalance * monthlyFactor ** months +
      assumptions.monthlyContribution *
        ((monthlyFactor ** months - 1) / (monthlyFactor - 1));

    expect(result.points.at(-1)?.nominal.p50).toBeCloseTo(expected, 7);
  });

  it("never improves a same-seed percentile when a positive fee is added", () => {
    const withoutFee = runSimulation(BASE, { scenarios: 250, seed: 77 });
    const withFee = runSimulation(
      { ...BASE, annualFee: 0.01 },
      { scenarios: 250, seed: 77 },
    );

    for (let index = 0; index < withoutFee.points.length; index += 1) {
      const baseline = withoutFee.points[index]!;
      const charged = withFee.points[index]!;
      for (const quantile of ["p10", "p25", "p50", "p75", "p90"] as const) {
        expect(charged.nominal[quantile]).toBeLessThanOrEqual(
          baseline.nominal[quantile],
        );
      }
    }
  });

  it("reports inflation-adjusted contributed capital at each deposit date", () => {
    const assumptions: PortfolioAssumptions = {
      ...BASE,
      startingBalance: 0,
      monthlyContribution: 100,
      years: 1,
      annualReturn: 0,
      annualVolatility: 0,
      annualInflation: 0.12,
    };
    const expectedRealCapital = Array.from(
      { length: 12 },
      (_, index) => 100 / 1.12 ** ((index + 1) / 12),
    ).reduce((sum, value) => sum + value, 0);

    const final = runSimulation(assumptions, { scenarios: 1, seed: 8 }).points.at(-1)!;
    expect(final.investedNominal).toBe(1_200);
    expect(final.investedReal).toBeCloseTo(expectedRealCapital, 10);
  });
});

describe("deterministic random stream", () => {
  it("pins the Mulberry32 stream for model-version review", () => {
    const random = mulberry32(0);
    expect(Array.from({ length: 5 }, () => random())).toEqual([
      0.26642920868471265,
      0.0003297457005828619,
      0.2232720274478197,
      0.1462021479383111,
      0.46732782293111086,
    ]);
  });

  it("resamples a zero Box-Muller radius input instead of inventing an extreme tail", () => {
    const draws = [0, 0.25, 0];
    const normal = createNormalGenerator(() => draws.shift() ?? 0.5);

    expect(normal()).toBeCloseTo(Math.sqrt(-2 * Math.log(0.25)), 12);
    expect(normal()).toBeCloseTo(0, 12);
  });

  it("rejects invalid random sources and aliased seeds", () => {
    expect(() => createNormalGenerator(() => 1)()).toThrow(RangeError);
    expect(() => createNormalGenerator(() => 0)()).toThrow(/zero too many/);
    for (const seed of [-1, 1.5, MAX_UINT32 + 1, Number.NaN]) {
      expect(() => mulberry32(seed)).toThrow(RangeError);
    }
  });
});

describe("percentile", () => {
  it("uses documented linear interpolation and clamps the requested fraction", () => {
    const sample = [10, 20, 30, 40];
    expect(percentile(sample, 0.25)).toBe(17.5);
    expect(percentile(sample, -1)).toBe(10);
    expect(percentile(sample, 2)).toBe(40);
  });
});

describe("simulation workload contract", () => {
  it("accepts the documented maximum local workload without executing it", () => {
    expect(
      resolveSimulationOptions(
        { scenarios: MAX_SCENARIO_COUNT, seed: MAX_UINT32 },
        50,
      ),
    ).toEqual({ scenarioCount: MAX_SCENARIO_COUNT, seed: MAX_UINT32 });
  });

  it.each([
    { scenarios: 0, seed: 0 },
    { scenarios: 2.5, seed: 0 },
    { scenarios: MAX_SCENARIO_COUNT + 1, seed: 0 },
    { scenarios: 1, seed: -1 },
    { scenarios: 1, seed: 1.5 },
    { scenarios: 1, seed: MAX_UINT32 + 1 },
  ])("rejects a noncanonical or excessive run config: %o", (options) => {
    expect(() => resolveSimulationOptions(options, 20)).toThrow(RangeError);
  });
});

describe("validation", () => {
  it.each([
    ["startingBalance", Number.NaN],
    ["monthlyContribution", Number.POSITIVE_INFINITY],
    ["targetTodayValue", Number.NEGATIVE_INFINITY],
    ["annualReturn", Number.NaN],
    ["annualVolatility", Number.POSITIVE_INFINITY],
    ["annualInflation", Number.NaN],
    ["annualFee", Number.POSITIVE_INFINITY],
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
    { field: "targetTodayValue", value: -1 },
    { field: "annualVolatility", value: -0.01 },
    { field: "annualVolatility", value: 1.01 },
    { field: "annualInflation", value: -0.01 },
    { field: "annualInflation", value: 0.201 },
    { field: "annualFee", value: -0.01 },
    { field: "annualFee", value: 0.101 },
    { field: "annualReturn", value: -1 },
    { field: "annualReturn", value: -2 },
    { field: "annualReturn", value: 1.01 },
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

  it.each([
    { field: "startingBalance", value: 1_000_000_000_001 },
    { field: "monthlyContribution", value: 100_000_001 },
    { field: "targetTodayValue", value: 10_000_000_000_001 },
  ] as const)("rejects an unsafe financial input boundary: $field", ({ field, value }) => {
    expect(validateAssumptions({ ...BASE, [field]: value })).toEqual(
      expect.arrayContaining([expect.objectContaining({ field })]),
    );
  });
});
