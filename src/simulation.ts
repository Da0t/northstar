import {
  averageGoalShortfall,
  ceilToCents,
  floorToCents,
  lowerTailMean,
  requirementAtSuccessRate,
  supportedValueAtSuccessRate,
  wilsonInterval,
  type ProbabilityInterval,
} from "./planningMetrics";

export const UI_SCENARIO_COUNT = 5_000;
export const MODEL_VERSION = "northstar-monte-carlo/2.2.0";
export const MAX_SCENARIO_COUNT = 10_000;
export const MAX_MONTHLY_UPDATES = 6_000_000;
export const MAX_SNAPSHOT_CELLS = 510_000;
export const MAX_UINT32 = 0xffff_ffff;

const MAX_STARTING_BALANCE = 1_000_000_000_000;
const MAX_MONTHLY_CONTRIBUTION = 100_000_000;
const MAX_TARGET_ENDING_VALUE = 10_000_000_000_000;
const MAX_MODELED_BALANCE = Number.MAX_SAFE_INTEGER / 100;

export interface PortfolioAssumptions {
  startingBalance: number;
  monthlyContribution: number;
  years: number;
  annualReturn: number;
  annualVolatility: number;
  annualInflation: number;
  annualFee: number;
  targetTodayValue: number;
  targetSuccessBps: number;
}

export type AssumptionField = keyof PortfolioAssumptions;

export interface ValidationIssue {
  field: AssumptionField;
  message: string;
}

export interface ForecastDistribution {
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}

export interface ForecastPoint {
  year: number;
  nominal: ForecastDistribution;
  real: ForecastDistribution;
  investedNominal: number;
  investedReal: number;
}

export interface SimulationResult {
  points: ForecastPoint[];
  successProbability: number;
  scenarioCount: number;
  seed: number;
  modelVersion: string;
  targetNominal: number;
  successfulScenarios: number;
  samplingInterval: ProbabilityInterval;
  planning: PlanningInsights;
}

export interface PlanningInsights {
  targetSuccessBps: number;
  requiredMonthlyContribution: number | null;
  requiredContributionExceedsModelLimit: boolean;
  monthlyContributionGap: number | null;
  supportedGoalToday: number;
  averageGoalShortfall: number | null;
  lowerTailAverage: number;
  medianNetNominalMaxDrawdown: number;
  p90NetNominalMaxDrawdown: number;
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
  "annualInflation",
  "annualFee",
  "targetTodayValue",
  "targetSuccessBps",
];

const DEFAULT_SEED = 0x4e4f5254;

export class SimulationValidationError extends Error {
  readonly issues: ValidationIssue[];

  constructor(issues: ValidationIssue[]) {
    super(issues.map((issue) => issue.message).join(" "));
    this.name = "SimulationValidationError";
    this.issues = issues;
  }
}

export class SimulationNumericalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SimulationNumericalError";
  }
}

function assertUint32Seed(seed: number): void {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > MAX_UINT32) {
    throw new RangeError("Seed must be an unsigned 32-bit integer.");
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

  if (requireFinite("startingBalance", "Starting balance")) {
    if (input.startingBalance < 0) {
      issues.push({ field: "startingBalance", message: "Starting balance cannot be negative." });
    } else if (input.startingBalance > MAX_STARTING_BALANCE) {
      issues.push({
        field: "startingBalance",
        message: "Starting balance must be $1 trillion or less.",
      });
    }
  }

  if (requireFinite("monthlyContribution", "Monthly contribution")) {
    if (input.monthlyContribution < 0) {
      issues.push({
        field: "monthlyContribution",
        message: "Monthly contribution cannot be negative.",
      });
    } else if (input.monthlyContribution > MAX_MONTHLY_CONTRIBUTION) {
      issues.push({
        field: "monthlyContribution",
        message: "Monthly contribution must be $100 million or less.",
      });
    }
  }

  if (requireFinite("targetTodayValue", "Goal in today's dollars")) {
    if (input.targetTodayValue < 0) {
      issues.push({
        field: "targetTodayValue",
        message: "Goal in today's dollars cannot be negative.",
      });
    } else if (input.targetTodayValue > MAX_TARGET_ENDING_VALUE) {
      issues.push({
        field: "targetTodayValue",
        message: "Goal in today's dollars must be $10 trillion or less.",
      });
    }
  }

  if (requireFinite("annualReturn", "Annual return")) {
    if (input.annualReturn <= -1) {
      issues.push({ field: "annualReturn", message: "Annual return must be greater than -100%." });
    } else if (input.annualReturn > 1) {
      issues.push({ field: "annualReturn", message: "Annual return must be 100% or less." });
    }
  }

  if (requireFinite("annualVolatility", "Annual volatility")) {
    if (input.annualVolatility < 0 || input.annualVolatility > 1) {
      issues.push({
        field: "annualVolatility",
        message: "Annual volatility must be between 0% and 100%.",
      });
    }
  }

  if (requireFinite("annualInflation", "Annual inflation")) {
    if (input.annualInflation < 0 || input.annualInflation > 0.2) {
      issues.push({
        field: "annualInflation",
        message: "Annual inflation must be between 0% and 20%.",
      });
    }
  }

  if (requireFinite("annualFee", "Annual fee")) {
    if (input.annualFee < 0 || input.annualFee > 0.1) {
      issues.push({
        field: "annualFee",
        message: "Annual fee must be between 0% and 10%.",
      });
    }
  }

  if (requireFinite("targetSuccessBps", "Planning threshold")) {
    if (
      !Number.isInteger(input.targetSuccessBps) ||
      input.targetSuccessBps % 100 !== 0 ||
      input.targetSuccessBps < 5_000 ||
      input.targetSuccessBps > 9_900
    ) {
      issues.push({
        field: "targetSuccessBps",
        message: "Planning threshold must be a whole percentage from 50% through 99%.",
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

  if (
    Number.isFinite(input.targetTodayValue) &&
    input.targetTodayValue >= 0 &&
    Number.isFinite(input.annualInflation) &&
    input.annualInflation >= 0 &&
    input.annualInflation <= 0.2 &&
    Number.isFinite(input.years) &&
    Number.isInteger(input.years) &&
    input.years >= 1 &&
    input.years <= 50 &&
    input.targetTodayValue * (1 + input.annualInflation) ** input.years >
      MAX_MODELED_BALANCE
  ) {
    issues.push({
      field: "targetTodayValue",
      message:
        "Goal and inflation exceed Northstar's cent-precision numerical safety boundary.",
    });
  }

  return issues;
}

/** A small deterministic pseudo-random generator with a 32-bit seed. */
export function mulberry32(seed: number): () => number {
  assertUint32Seed(seed);
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

    let zeroDraws = 0;
    let u1 = random();
    while (u1 === 0) {
      zeroDraws += 1;
      if (zeroDraws > 32) {
        throw new RangeError("The random source returned zero too many consecutive times.");
      }
      u1 = random();
    }
    const u2 = random();
    if (
      !Number.isFinite(u1) ||
      !Number.isFinite(u2) ||
      u1 < 0 ||
      u1 >= 1 ||
      u2 < 0 ||
      u2 >= 1
    ) {
      throw new RangeError("The random source must return values from 0 inclusive to 1 exclusive.");
    }
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

function checkedBalance(value: number, context: string): number {
  if (!Number.isFinite(value) || value < 0 || value > MAX_MODELED_BALANCE) {
    throw new SimulationNumericalError(
      `The ${context} left Northstar's nonnegative cent-precision numerical safety boundary.`,
    );
  }
  return value;
}

function checkedNonnegativeFinite(value: number, context: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new SimulationNumericalError(
      `The ${context} left Northstar's finite nonnegative numerical boundary.`,
    );
  }
  return value;
}

function investedCapital(input: PortfolioAssumptions, year: number): number {
  return checkedBalance(
    input.startingBalance + input.monthlyContribution * year * 12,
    "invested capital",
  );
}

function inflationIndex(input: PortfolioAssumptions, year: number): number {
  return (1 + input.annualInflation) ** year;
}

function investedCapitalReal(input: PortfolioAssumptions, year: number): number {
  let realCapital = input.startingBalance;
  for (let month = 1; month <= year * 12; month += 1) {
    realCapital += input.monthlyContribution / inflationIndex(input, month / 12);
  }
  return checkedBalance(realCapital, "inflation-adjusted invested capital");
}

function distribution(
  sortedValues: readonly number[],
  divisor = 1,
): ForecastDistribution {
  return {
    p10: percentile(sortedValues, 0.1) / divisor,
    p25: percentile(sortedValues, 0.25) / divisor,
    p50: percentile(sortedValues, 0.5) / divisor,
    p75: percentile(sortedValues, 0.75) / divisor,
    p90: percentile(sortedValues, 0.9) / divisor,
  };
}

export function resolveSimulationOptions(
  options: SimulationOptions,
  years: number,
): { scenarioCount: number; seed: number } {
  const scenarioCount = options.scenarios ?? UI_SCENARIO_COUNT;
  const seed = options.seed ?? DEFAULT_SEED;

  if (
    !Number.isSafeInteger(scenarioCount) ||
    scenarioCount < 1 ||
    scenarioCount > MAX_SCENARIO_COUNT
  ) {
    throw new RangeError(
      `Scenario count must be a whole number from 1 through ${MAX_SCENARIO_COUNT.toLocaleString("en-US")}.`,
    );
  }

  assertUint32Seed(seed);

  const monthlyUpdates = scenarioCount * years * 12;
  const snapshotCells = scenarioCount * (years + 1);
  if (monthlyUpdates > MAX_MONTHLY_UPDATES || snapshotCells > MAX_SNAPSHOT_CELLS) {
    throw new RangeError("The requested simulation exceeds Northstar's local workload limit.");
  }

  return { scenarioCount, seed };
}

export function runSimulation(
  input: PortfolioAssumptions,
  options: SimulationOptions = {},
): SimulationResult {
  const issues = validateAssumptions(input);

  if (issues.length > 0) {
    throw new SimulationValidationError(issues);
  }

  const { scenarioCount, seed } = resolveSimulationOptions(options, input.years);

  const random = mulberry32(seed);
  const normal = createNormalGenerator(random);
  const snapshots = Array.from({ length: input.years + 1 }, () => new Array<number>(scenarioCount));
  const monthlyDrift =
    (Math.log1p(input.annualReturn) - 0.5 * input.annualVolatility ** 2) / 12;
  const monthlyDiffusion = input.annualVolatility / Math.sqrt(12);
  const monthlyFeeFactor = (1 - input.annualFee) ** (1 / 12);
  const targetNominal = checkedBalance(
    input.targetTodayValue * inflationIndex(input, input.years),
    "inflation-adjusted goal",
  );
  const finalInflationIndex = inflationIndex(input, input.years);
  const finalRealBalances = new Array<number>(scenarioCount);
  const requiredContributions = new Array<number>(scenarioCount);
  const maximumDrawdowns = new Array<number>(scenarioCount);
  let maxRerunnableMonthlyContribution = MAX_MONTHLY_CONTRIBUTION;
  let successes = 0;

  for (let scenario = 0; scenario < scenarioCount; scenario += 1) {
    let balance = input.startingBalance;
    let startingBalanceComponent = input.startingBalance;
    let contributionCoefficient = 0;
    let growthIndex = 1;
    let peakGrowthIndex = 1;
    let maximumDrawdown = 0;
    const initialSnapshot = snapshots[0];
    if (initialSnapshot) {
      initialSnapshot[scenario] = balance;
    }

    for (let month = 1; month <= input.years * 12; month += 1) {
      const factor =
        Math.exp(monthlyDrift + monthlyDiffusion * normal()) * monthlyFeeFactor;
      balance = checkedBalance(
        balance * factor + input.monthlyContribution,
        `balance in scenario ${scenario + 1}, month ${month}`,
      );
      startingBalanceComponent = checkedBalance(
        startingBalanceComponent * factor,
        `starting-balance component in scenario ${scenario + 1}, month ${month}`,
      );
      contributionCoefficient = checkedNonnegativeFinite(
        contributionCoefficient * factor + 1,
        `contribution coefficient in scenario ${scenario + 1}, month ${month}`,
      );
      maxRerunnableMonthlyContribution = Math.min(
        maxRerunnableMonthlyContribution,
        (MAX_MODELED_BALANCE - startingBalanceComponent) /
          contributionCoefficient,
      );
      growthIndex *= factor;
      if (!Number.isFinite(growthIndex) || growthIndex <= 0) {
        throw new SimulationNumericalError(
          `The growth index failed in scenario ${scenario + 1}, month ${month}.`,
        );
      }
      peakGrowthIndex = Math.max(peakGrowthIndex, growthIndex);
      maximumDrawdown = Math.max(
        maximumDrawdown,
        1 - growthIndex / peakGrowthIndex,
      );

      if (month % 12 === 0) {
        const annualSnapshot = snapshots[month / 12];
        if (annualSnapshot) {
          annualSnapshot[scenario] = balance;
        }
      }
    }

    const finalRealBalance = balance / finalInflationIndex;
    finalRealBalances[scenario] = finalRealBalance;
    const requiredContribution =
      targetNominal <= startingBalanceComponent
        ? 0
        : (targetNominal - startingBalanceComponent) / contributionCoefficient;
    if (!Number.isFinite(requiredContribution) || requiredContribution < 0) {
      throw new SimulationNumericalError(
        `The contribution solver failed in scenario ${scenario + 1}.`,
      );
    }
    requiredContributions[scenario] = requiredContribution;
    maximumDrawdowns[scenario] = maximumDrawdown;

    if (balance >= targetNominal) {
      successes += 1;
    }
  }

  const points = snapshots.map((values, year) => {
    values.sort((a, b) => a - b);
    const yearlyInflationIndex = inflationIndex(input, year);
    return {
      year,
      nominal: distribution(values),
      real: distribution(values, yearlyInflationIndex),
      investedNominal: investedCapital(input, year),
      investedReal: investedCapitalReal(input, year),
    };
  });

  finalRealBalances.sort((a, b) => a - b);
  requiredContributions.sort((a, b) => a - b);
  maximumDrawdowns.sort((a, b) => a - b);
  const rawRequiredMonthlyContribution = requirementAtSuccessRate(
    requiredContributions,
    input.targetSuccessBps,
  );
  const roundedRequiredMonthlyContribution = ceilToCents(
    rawRequiredMonthlyContribution,
  );
  const requiredContributionExceedsModelLimit =
    roundedRequiredMonthlyContribution > MAX_MONTHLY_CONTRIBUTION ||
    roundedRequiredMonthlyContribution >
      floorToCents(maxRerunnableMonthlyContribution);
  const requiredMonthlyContribution = requiredContributionExceedsModelLimit
    ? null
    : roundedRequiredMonthlyContribution;
  const supportedGoalToday = floorToCents(
    supportedValueAtSuccessRate(
      finalRealBalances,
      input.targetSuccessBps,
    ),
  );

  return {
    points,
    successProbability: successes / scenarioCount,
    scenarioCount,
    seed,
    modelVersion: MODEL_VERSION,
    targetNominal,
    successfulScenarios: successes,
    samplingInterval: wilsonInterval(successes, scenarioCount),
    planning: {
      targetSuccessBps: input.targetSuccessBps,
      requiredMonthlyContribution,
      requiredContributionExceedsModelLimit,
      monthlyContributionGap:
        requiredMonthlyContribution === null
          ? null
          : ceilToCents(
              Math.max(0, requiredMonthlyContribution - input.monthlyContribution),
            ),
      supportedGoalToday,
      averageGoalShortfall: averageGoalShortfall(
        finalRealBalances,
        input.targetTodayValue,
      ),
      lowerTailAverage: lowerTailMean(finalRealBalances, 0.1),
      medianNetNominalMaxDrawdown: percentile(maximumDrawdowns, 0.5),
      p90NetNominalMaxDrawdown: percentile(maximumDrawdowns, 0.9),
    },
  };
}
