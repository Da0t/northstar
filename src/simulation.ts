export const UI_SCENARIO_COUNT = 5_000;

export interface PortfolioAssumptions {
  startingBalance: number;
  monthlyContribution: number;
  years: number;
  annualReturn: number;
  annualVolatility: number;
  targetEndingValue: number;
}

export type AssumptionField = keyof PortfolioAssumptions;

export interface ValidationIssue {
  field: AssumptionField;
  message: string;
}

export interface ForecastPoint {
  year: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  invested: number;
}

export interface SimulationResult {
  points: ForecastPoint[];
  successProbability: number;
  scenarioCount: number;
  seed: number;
}

export interface SimulationOptions {
  scenarios?: number;
  seed?: number;
}

const ASSUMPTION_FIELDS: readonly AssumptionField[] = [
  "startingBalance",
  "monthlyContribution",
  "years",
  "annualReturn",
  "annualVolatility",
  "targetEndingValue",
];

const DEFAULT_SEED = 0x4e4f5254;
const MAX_BALANCE = Number.MAX_VALUE / 4;

export class SimulationValidationError extends Error {
  readonly issues: ValidationIssue[];

  constructor(issues: ValidationIssue[]) {
    super(issues.map((issue) => issue.message).join(" "));
    this.name = "SimulationValidationError";
    this.issues = issues;
  }
}

export function assumptionsEqual(
  left: PortfolioAssumptions,
  right: PortfolioAssumptions,
): boolean {
  return ASSUMPTION_FIELDS.every((field) => left[field] === right[field]);
}

export function validateAssumptions(input: PortfolioAssumptions): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const requireFinite = (field: AssumptionField, label: string): boolean => {
    if (!Number.isFinite(input[field])) {
      issues.push({ field, message: `${label} must be a finite number.` });
      return false;
    }
    return true;
  };

  if (requireFinite("startingBalance", "Starting balance") && input.startingBalance < 0) {
    issues.push({ field: "startingBalance", message: "Starting balance cannot be negative." });
  }

  if (
    requireFinite("monthlyContribution", "Monthly contribution") &&
    input.monthlyContribution < 0
  ) {
    issues.push({
      field: "monthlyContribution",
      message: "Monthly contribution cannot be negative.",
    });
  }

  if (requireFinite("targetEndingValue", "Target ending value") && input.targetEndingValue < 0) {
    issues.push({
      field: "targetEndingValue",
      message: "Target ending value cannot be negative.",
    });
  }

  if (requireFinite("annualReturn", "Annual return") && input.annualReturn <= -1) {
    issues.push({ field: "annualReturn", message: "Annual return must be greater than -100%." });
  }

  if (requireFinite("annualVolatility", "Annual volatility")) {
    if (input.annualVolatility < 0 || input.annualVolatility > 1) {
      issues.push({
        field: "annualVolatility",
        message: "Annual volatility must be between 0% and 100%.",
      });
    }
  }

  if (requireFinite("years", "Time horizon")) {
    if (!Number.isInteger(input.years) || input.years < 1 || input.years > 50) {
      issues.push({
        field: "years",
        message: "Time horizon must be a whole number from 1 to 50 years.",
      });
    }
  }

  return issues;
}

/** A small deterministic pseudo-random generator with a 32-bit seed. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = value + Math.imul(value ^ (value >>> 7), 61 | value) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Produces independent standard normals in pairs using Box-Muller. */
export function createNormalGenerator(random: () => number): () => number {
  let spare: number | undefined;

  return () => {
    if (spare !== undefined) {
      const value = spare;
      spare = undefined;
      return value;
    }

    // Mulberry32 can return zero. Clamp u1 so log(u1) always remains finite.
    const u1 = Math.max(random(), Number.EPSILON);
    const u2 = random();
    const radius = Math.sqrt(-2 * Math.log(u1));
    const angle = 2 * Math.PI * u2;
    spare = radius * Math.sin(angle);
    return radius * Math.cos(angle);
  };
}

export function percentile(sortedValues: readonly number[], fraction: number): number {
  if (sortedValues.length === 0) {
    throw new Error("A percentile requires at least one value.");
  }

  const boundedFraction = Math.min(1, Math.max(0, fraction));
  const position = (sortedValues.length - 1) * boundedFraction;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sortedValues[lowerIndex];
  const upper = sortedValues[upperIndex];

  if (lower === undefined || upper === undefined) {
    throw new Error("Percentile index was outside the sample.");
  }

  if (lowerIndex === upperIndex || lower === upper) {
    return lower;
  }

  const weight = position - lowerIndex;
  return lower * (1 - weight) + upper * weight;
}

function capBalance(value: number): number {
  if (!Number.isFinite(value) || value > MAX_BALANCE) {
    return MAX_BALANCE;
  }
  return Math.max(0, value);
}

function investedCapital(input: PortfolioAssumptions, year: number): number {
  return capBalance(input.startingBalance + input.monthlyContribution * year * 12);
}

export function runSimulation(
  input: PortfolioAssumptions,
  options: SimulationOptions = {},
): SimulationResult {
  const issues = validateAssumptions(input);
  const scenarioCount = options.scenarios ?? UI_SCENARIO_COUNT;
  const seed = options.seed ?? DEFAULT_SEED;

  if (!Number.isInteger(scenarioCount) || scenarioCount < 1 || !Number.isFinite(scenarioCount)) {
    throw new RangeError("Scenario count must be a positive whole number.");
  }

  if (!Number.isFinite(seed)) {
    throw new RangeError("Seed must be finite.");
  }

  if (issues.length > 0) {
    throw new SimulationValidationError(issues);
  }

  const random = mulberry32(seed);
  const normal = createNormalGenerator(random);
  const snapshots = Array.from({ length: input.years + 1 }, () => new Array<number>(scenarioCount));
  const monthlyDrift =
    (Math.log1p(input.annualReturn) - 0.5 * input.annualVolatility ** 2) / 12;
  const monthlyDiffusion = input.annualVolatility / Math.sqrt(12);
  let successes = 0;

  for (let scenario = 0; scenario < scenarioCount; scenario += 1) {
    let balance = input.startingBalance;
    const initialSnapshot = snapshots[0];
    if (initialSnapshot) {
      initialSnapshot[scenario] = balance;
    }

    for (let month = 1; month <= input.years * 12; month += 1) {
      const factor = Math.exp(monthlyDrift + monthlyDiffusion * normal());
      balance = capBalance(balance * factor + input.monthlyContribution);

      if (month % 12 === 0) {
        const annualSnapshot = snapshots[month / 12];
        if (annualSnapshot) {
          annualSnapshot[scenario] = balance;
        }
      }
    }

    if (balance >= input.targetEndingValue) {
      successes += 1;
    }
  }

  const points = snapshots.map((values, year) => {
    values.sort((a, b) => a - b);
    return {
      year,
      p10: percentile(values, 0.1),
      p25: percentile(values, 0.25),
      p50: percentile(values, 0.5),
      p75: percentile(values, 0.75),
      p90: percentile(values, 0.9),
      invested: investedCapital(input, year),
    };
  });

  return {
    points,
    successProbability: successes / scenarioCount,
    scenarioCount,
    seed: seed >>> 0,
  };
}
