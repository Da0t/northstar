import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FanChart, type DollarMode } from "./components/FanChart";
import { AnnualResultsTable } from "./components/AnnualResultsTable";
import {
  formatCurrency,
  formatExactCurrency,
  formatPercentageInput,
  formatProbability,
} from "./format";
import {
  UI_SCENARIO_COUNT,
  assumptionsEqual,
  validateAssumptions,
  type AssumptionField,
  type PortfolioAssumptions,
  type SimulationResult,
} from "./simulation";
import {
  SimulationCancelledError,
  SimulationWorkerClient,
} from "./simulationWorkerClient";
import {
  DEFAULT_SIMULATION_SEED,
  nextSeed,
  parseSeedInput,
} from "./runConfig";

const DEFAULT_ASSUMPTIONS: PortfolioAssumptions = {
  startingBalance: 25_000,
  monthlyContribution: 750,
  years: 20,
  annualReturn: 0.07,
  annualVolatility: 0.15,
  annualInflation: 0.025,
  annualFee: 0.0025,
  targetTodayValue: 250_000,
  targetSuccessBps: 8_000,
};

const PRESETS = [
  { name: "Lower variation", return: 4, volatility: 8 },
  { name: "Baseline", return: 7, volatility: 15 },
  { name: "Higher variation", return: 9, volatility: 22 },
] as const;

type FormState = Record<AssumptionField, string>;
type FormErrors = Partial<Record<AssumptionField, string>>;

interface CompletedRun {
  assumptions: PortfolioAssumptions;
  result: SimulationResult;
}

interface FieldProps {
  field: AssumptionField;
  label: string;
  value: string;
  error?: string;
  prefix?: string;
  suffix?: string;
  min?: number;
  max?: number;
  step?: string;
  help?: string;
  onChange: (field: AssumptionField, value: string) => void;
}

function assumptionsToForm(assumptions: PortfolioAssumptions): FormState {
  return {
    startingBalance: String(assumptions.startingBalance),
    monthlyContribution: String(assumptions.monthlyContribution),
    years: String(assumptions.years),
    annualReturn: formatPercentageInput(assumptions.annualReturn),
    annualVolatility: formatPercentageInput(assumptions.annualVolatility),
    annualInflation: formatPercentageInput(assumptions.annualInflation),
    annualFee: formatPercentageInput(assumptions.annualFee),
    targetTodayValue: String(assumptions.targetTodayValue),
    targetSuccessBps: formatPercentageInput(
      assumptions.targetSuccessBps / 10_000,
    ),
  };
}

function parseNumber(value: string): number {
  return value.trim() === "" ? Number.NaN : Number(value);
}

function parseForm(form: FormState): { assumptions: PortfolioAssumptions; errors: FormErrors } {
  const assumptions: PortfolioAssumptions = {
    startingBalance: parseNumber(form.startingBalance),
    monthlyContribution: parseNumber(form.monthlyContribution),
    years: parseNumber(form.years),
    annualReturn: parseNumber(form.annualReturn) / 100,
    annualVolatility: parseNumber(form.annualVolatility) / 100,
    annualInflation: parseNumber(form.annualInflation) / 100,
    annualFee: parseNumber(form.annualFee) / 100,
    targetTodayValue: parseNumber(form.targetTodayValue),
    targetSuccessBps: Number.isInteger(parseNumber(form.targetSuccessBps))
      ? parseNumber(form.targetSuccessBps) * 100
      : Number.NaN,
  };
  const errors: FormErrors = {};

  for (const issue of validateAssumptions(assumptions)) {
    errors[issue.field] ??= issue.message;
  }

  if (
    Number.isFinite(assumptions.annualReturn) &&
    assumptions.annualReturn > -1 &&
    (assumptions.annualReturn < -0.2 || assumptions.annualReturn > 0.3)
  ) {
    errors.annualReturn = "Use an annual return between -20% and 30%.";
  }

  return { assumptions, errors };
}

function AssumptionField({
  field,
  label,
  value,
  error,
  prefix,
  suffix,
  min,
  max,
  step = "any",
  help,
  onChange,
}: FieldProps) {
  const errorId = `${field}-error`;
  const helpId = `${field}-help`;
  const describedBy = [help ? helpId : null, error ? errorId : null]
    .filter(Boolean)
    .join(" ") || undefined;
  return (
    <div className={`field ${error ? "field-invalid" : ""}`}>
      <label htmlFor={field}>{label}</label>
      <div className="input-shell">
        {prefix ? (
          <span className="input-adornment input-prefix" aria-hidden="true">
            {prefix}
          </span>
        ) : null}
        <input
          id={field}
          name={field}
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          value={value}
          className={prefix ? "has-prefix" : suffix ? "has-suffix" : undefined}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          onChange={(event) => onChange(field, event.target.value)}
        />
        {suffix ? (
          <span className="input-adornment input-suffix" aria-hidden="true">
            {suffix}
          </span>
        ) : null}
      </div>
      {help ? (
        <span className="field-help" id={helpId}>
          {help}
        </span>
      ) : null}
      {error ? (
        <span className="field-error" id={errorId} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

function MetricCard({
  label,
  value,
  note,
  accent = false,
}: {
  label: string;
  value: string;
  note: string;
  accent?: boolean;
}) {
  return (
    <article className={`metric-card ${accent ? "metric-card-accent" : ""}`}>
      <p>{label}</p>
      <strong>{value}</strong>
      <span>{note}</span>
    </article>
  );
}

function DecisionCard({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="decision-card">
      <p>{label}</p>
      <strong>{value}</strong>
      <span>{note}</span>
    </div>
  );
}

export default function App() {
  const [form, setForm] = useState<FormState>(() => assumptionsToForm(DEFAULT_ASSUMPTIONS));
  const [seedInput, setSeedInput] = useState(String(DEFAULT_SIMULATION_SEED));
  const [completedRun, setCompletedRun] = useState<CompletedRun | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [dollarMode, setDollarMode] = useState<DollarMode>("real");
  const [statusMessage, setStatusMessage] = useState("Preparing the initial forecast.");
  const [runError, setRunError] = useState<string | null>(null);
  const formRef = useRef(form);
  const seedInputRef = useRef(seedInput);
  const workerClientRef = useRef<SimulationWorkerClient | null>(null);
  const jobTokenRef = useRef(0);
  if (workerClientRef.current === null) {
    workerClientRef.current = new SimulationWorkerClient();
  }
  const parsed = useMemo(() => parseForm(form), [form]);
  const parsedSeed = useMemo(() => parseSeedInput(seedInput), [seedInput]);
  const hasErrors = Object.keys(parsed.errors).length > 0 || !parsedSeed.ok;
  const projection = completedRun?.result ?? null;
  const lastRun = completedRun?.assumptions ?? null;
  const isStale =
    completedRun === null ||
    hasErrors ||
    !assumptionsEqual(parsed.assumptions, completedRun.assumptions) ||
    (parsedSeed.ok && parsedSeed.value !== completedRun.result.seed);
  const finalPoint = projection?.points.at(-1);
  const finalDistribution = finalPoint?.[dollarMode];
  const displayedGoal =
    projection && lastRun
      ? dollarMode === "real"
        ? lastRun.targetTodayValue
        : projection.targetNominal
      : 0;
  const displayedInvested =
    dollarMode === "real" ? finalPoint?.investedReal : finalPoint?.investedNominal;
  const planningThreshold = projection
    ? projection.planning.targetSuccessBps / 10_000
    : 0;
  const isBoundaryHitSample =
    projection !== null &&
    (projection.successfulScenarios === 0 ||
      projection.successfulScenarios === projection.scenarioCount);
  const samplingSummary = !projection
    ? ""
    : isBoundaryHitSample
      ? `${projection.successfulScenarios.toLocaleString("en-US")} of ${projection.scenarioCount.toLocaleString("en-US")} paths shared the same goal outcome; interval not emphasized at this boundary`
      : `${projection.successfulScenarios.toLocaleString("en-US")} of ${projection.scenarioCount.toLocaleString("en-US")} paths · ${formatProbability(projection.samplingInterval.confidenceLevel)} conditional sampling-error interval ${formatProbability(projection.samplingInterval.lower)}–${formatProbability(projection.samplingInterval.upper)}`;
  const forecastStatusLabel = isRunning
    ? "Forecast running"
    : projection === null
      ? "No forecast yet"
      : isStale
        ? "Assumptions changed"
        : "Forecast current";
  const forecastStatusClass = isRunning
    ? "status-running"
    : isStale
      ? "status-stale"
      : "status-current";

  const executeForecast = useCallback(
    async (
      assumptions: PortfolioAssumptions,
      seed: number,
      initialRun = false,
    ) => {
      const client = workerClientRef.current;
      if (!client) return;

      const token = jobTokenRef.current + 1;
      jobTokenRef.current = token;
      setIsRunning(true);
      setRunError(null);
      setStatusMessage(
        initialRun
          ? `Building the initial ${UI_SCENARIO_COUNT.toLocaleString("en-US")}-path forecast…`
          : `Running ${UI_SCENARIO_COUNT.toLocaleString("en-US")} local scenarios in a background worker…`,
      );

      try {
        const result = await client.run(assumptions, {
          scenarios: UI_SCENARIO_COUNT,
          seed,
        });
        if (jobTokenRef.current !== token) return;

        const latest = parseForm(formRef.current);
        const latestSeed = parseSeedInput(seedInputRef.current);
        const latestHasErrors = Object.keys(latest.errors).length > 0;
        const resultsAreCurrent =
          !latestHasErrors &&
          latestSeed.ok &&
          latestSeed.value === seed &&
          assumptionsEqual(latest.assumptions, assumptions);
        setCompletedRun({ assumptions, result });
        setStatusMessage(
          resultsAreCurrent
            ? `Forecast updated with ${UI_SCENARIO_COUNT.toLocaleString("en-US")} scenarios.`
            : "Forecast finished, but current assumptions differ from this run. Run it again to refresh.",
        );
      } catch (error) {
        if (jobTokenRef.current !== token) return;
        if (error instanceof SimulationCancelledError) {
          setStatusMessage("Forecast canceled. The last completed result was preserved.");
          return;
        }

        const message =
          error instanceof Error
            ? error.message
            : "The forecast could not be completed safely.";
        setRunError(message);
        setStatusMessage(`Forecast failed: ${message}`);
      } finally {
        if (jobTokenRef.current === token) {
          setIsRunning(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    void executeForecast(DEFAULT_ASSUMPTIONS, DEFAULT_SIMULATION_SEED, true);
    return () => {
      jobTokenRef.current += 1;
      workerClientRef.current?.cancel("The simulation component was disposed.");
    };
  }, [executeForecast]);

  const updateForm = (nextForm: FormState, changedMessage: string, currentMessage: string) => {
    setRunError(null);
    formRef.current = nextForm;
    setForm(nextForm);
    const next = parseForm(nextForm);
    const nextHasErrors = Object.keys(next.errors).length > 0;
    setStatusMessage(
      nextHasErrors ||
      !parsedSeed.ok ||
      projection === null ||
      parsedSeed.value !== projection.seed ||
      lastRun === null ||
      !assumptionsEqual(next.assumptions, lastRun)
        ? changedMessage
        : currentMessage,
    );
  };

  const handleFieldChange = (field: AssumptionField, value: string) => {
    updateForm(
      { ...formRef.current, [field]: value },
      "Assumptions changed. Run the forecast to refresh results.",
      "Assumptions match the displayed forecast.",
    );
  };

  const applyPreset = (annualReturn: number, annualVolatility: number, name: string) => {
    updateForm(
      {
        ...formRef.current,
        annualReturn: String(annualReturn),
        annualVolatility: String(annualVolatility),
      },
      `${name} assumptions selected. Run the forecast to refresh results.`,
      `${name} assumptions selected. Displayed forecast is current.`,
    );
  };

  const resetAssumptions = () => {
    updateForm(
      assumptionsToForm(DEFAULT_ASSUMPTIONS),
      "Assumptions reset. Run the forecast to refresh results.",
      "Assumptions reset. Displayed forecast is current.",
    );
  };

  const updateSeed = (value: string) => {
    seedInputRef.current = value;
    setSeedInput(value);
    setRunError(null);
    const next = parseSeedInput(value);
    const assumptionsAreCurrent =
      lastRun !== null && assumptionsEqual(parsed.assumptions, lastRun);
    setStatusMessage(
      next.ok && projection && next.value === projection.seed && assumptionsAreCurrent
        ? "Seed and assumptions match the displayed forecast."
        : "Run configuration changed. Run the forecast to refresh results.",
    );
  };

  const useNextSeed = () => {
    const baseSeed = parsedSeed.ok
      ? parsedSeed.value
      : projection?.seed ?? DEFAULT_SIMULATION_SEED;
    updateSeed(String(nextSeed(baseSeed)));
  };

  const runForecast = () => {
    const current = parseForm(formRef.current);
    if (Object.keys(current.errors).length > 0) {
      setStatusMessage("Fix the highlighted assumptions before running the forecast.");
      return;
    }

    const currentSeed = parseSeedInput(seedInputRef.current);
    if (!currentSeed.ok) {
      setStatusMessage("Enter a valid unsigned 32-bit decimal seed before running the forecast.");
      return;
    }

    void executeForecast(current.assumptions, currentSeed.value);
  };

  const cancelForecast = () => {
    jobTokenRef.current += 1;
    if (workerClientRef.current?.cancel()) {
      setIsRunning(false);
      setRunError(null);
      setStatusMessage(
        completedRun
          ? "Forecast canceled. The last completed result was preserved."
          : "Initial forecast canceled. Run the forecast when you are ready.",
      );
    }
  };

  const selectedPreset = PRESETS.find(
    (preset) =>
      parseNumber(form.annualReturn) === preset.return &&
      parseNumber(form.annualVolatility) === preset.volatility,
  )?.name;

  return (
    <div className="app-frame">
      <a className="skip-link" href="#main-content">
        Skip to forecast workspace
      </a>
      <header className="site-header">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">N</span>
          <div>
            <p className="wordmark">Northstar</p>
            <p className="brand-subtitle">Goal Resilience Lab</p>
          </div>
        </div>
        <p className="header-descriptor">Compare the range, not just the average.</p>
        <div className="disclosure-pill">
          <span aria-hidden="true" />
          5,000 scenarios <b>•</b> Local only
        </div>
      </header>

      <main id="main-content" tabIndex={-1}>
        <section className="intro" aria-labelledby="page-title">
          <p className="eyebrow">Local-first goal resilience</p>
          <h1 id="page-title">Pressure-test your portfolio goal.</h1>
          <p>
            Explore fees, inflation, and funding trade-offs across 5,000 reproducible market
            paths—without sending your financial inputs off-device.
          </p>
        </section>

        <div className="workspace-grid">
          <aside className="assumptions-card" aria-labelledby="assumptions-title">
            <div className="panel-heading">
              <div>
                <p className="section-kicker">Your plan</p>
                <h2 id="assumptions-title">Assumptions</h2>
              </div>
              <button type="button" className="text-button" onClick={resetAssumptions}>
                Reset
              </button>
            </div>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                runForecast();
              }}
              noValidate
            >
              <div className="fields-grid">
                <AssumptionField
                  field="startingBalance"
                  label="Starting balance (USD)"
                  value={form.startingBalance}
                  error={parsed.errors.startingBalance}
                  prefix="$"
                  min={0}
                  step="100"
                  onChange={handleFieldChange}
                />
                <AssumptionField
                  field="monthlyContribution"
                  label="Monthly contribution (USD/month)"
                  value={form.monthlyContribution}
                  error={parsed.errors.monthlyContribution}
                  prefix="$"
                  min={0}
                  step="25"
                  onChange={handleFieldChange}
                />
                <AssumptionField
                  field="years"
                  label="Time horizon (years)"
                  value={form.years}
                  error={parsed.errors.years}
                  suffix="years"
                  min={1}
                  max={50}
                  step="1"
                  onChange={handleFieldChange}
                />
                <AssumptionField
                  field="targetTodayValue"
                  label="Goal (today's USD)"
                  value={form.targetTodayValue}
                  error={parsed.errors.targetTodayValue}
                  prefix="$"
                  min={0}
                  step="1000"
                  onChange={handleFieldChange}
                />
              </div>

              <div className="planning-threshold">
                <p className="field-group-label">Decision rule</p>
                <AssumptionField
                  field="targetSuccessBps"
                  label="Modeled path threshold (percent)"
                  value={form.targetSuccessBps}
                  error={parsed.errors.targetSuccessBps}
                  suffix="%"
                  min={50}
                  max={99}
                  step="1"
                  help="Northstar solves for alternatives supported by at least this share of the executed paths. This is not a real-world confidence level."
                  onChange={handleFieldChange}
                />
              </div>

              <fieldset className="preset-fieldset">
                <legend>Illustrative return and variability pair</legend>
                <div className="preset-group">
                  {PRESETS.map((preset) => (
                    <button
                      key={preset.name}
                      type="button"
                      className={selectedPreset === preset.name ? "preset-active" : ""}
                      aria-pressed={selectedPreset === preset.name}
                      onClick={() => applyPreset(preset.return, preset.volatility, preset.name)}
                    >
                      <strong>{preset.name}</strong>
                      <span>{preset.return}% / {preset.volatility}%</span>
                    </button>
                  ))}
                </div>
              </fieldset>

              <div className="market-fields">
                <AssumptionField
                  field="annualReturn"
                  label="Expected annual return (percent)"
                  value={form.annualReturn}
                  error={parsed.errors.annualReturn}
                  suffix="%"
                  min={-20}
                  max={30}
                  step="0.1"
                  onChange={handleFieldChange}
                />
                <AssumptionField
                  field="annualVolatility"
                  label="Annual volatility (percent)"
                  value={form.annualVolatility}
                  error={parsed.errors.annualVolatility}
                  suffix="%"
                  min={0}
                  max={100}
                  step="0.1"
                  onChange={handleFieldChange}
                />
              </div>

              <div className="economic-assumptions">
                <p className="field-group-label">Purchasing power and costs</p>
                <div className="market-fields">
                  <AssumptionField
                    field="annualInflation"
                    label="Annual inflation (percent)"
                    value={form.annualInflation}
                    error={parsed.errors.annualInflation}
                    suffix="%"
                    min={0}
                    max={20}
                    step="0.1"
                    onChange={handleFieldChange}
                  />
                  <AssumptionField
                    field="annualFee"
                    label="Annual portfolio fee (percent)"
                    value={form.annualFee}
                    error={parsed.errors.annualFee}
                    suffix="%"
                    min={0}
                    max={10}
                    step="0.05"
                    onChange={handleFieldChange}
                  />
                </div>
              </div>

              <p className="model-note">
                Return is gross of fees. The annual fee is charged proportionally each month;
                inflation converts future balances back into today's purchasing power.
              </p>

              <div className="run-config-panel">
                <div className={`field ${parsedSeed.ok ? "" : "field-invalid"}`}>
                  <label htmlFor="simulation-seed">Path-set seed (uint32)</label>
                  <div className="input-shell">
                    <input
                      id="simulation-seed"
                      name="simulationSeed"
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={seedInput}
                      aria-invalid={!parsedSeed.ok}
                      aria-describedby={
                        parsedSeed.ok
                          ? "simulation-seed-help"
                          : "simulation-seed-help simulation-seed-error"
                      }
                      onChange={(event) => updateSeed(event.target.value)}
                    />
                  </div>
                  <span className="field-help" id="simulation-seed-help">
                    Reuse this value for the same modeled paths. A new seed changes only the sample.
                  </span>
                  {!parsedSeed.ok ? (
                    <span className="field-error" id="simulation-seed-error" role="alert">
                      {parsedSeed.error}
                    </span>
                  ) : null}
                </div>
                <button type="button" className="next-seed-button" onClick={useNextSeed}>
                  Use next seed
                </button>
              </div>

              <button
                className="run-button"
                type="submit"
                disabled={hasErrors || isRunning}
                aria-describedby={hasErrors ? "run-disabled-reason" : undefined}
              >
                <span aria-hidden="true" className="run-icon">✦</span>
                {isRunning ? "Running scenarios…" : "Run 5,000 scenarios"}
              </button>
              {hasErrors ? (
                <p id="run-disabled-reason" className="run-disabled-reason">
                  Fix the highlighted fields to continue.
                </p>
              ) : null}
              {runError ? (
                <p className="run-error">
                  {runError}
                </p>
              ) : null}
              <button type="button" className="reset-button" onClick={resetAssumptions}>
                Reset assumptions
              </button>
            </form>
          </aside>

          <section
            className={`results-column ${isStale ? "results-stale" : ""}`}
            aria-labelledby="results-title"
            aria-busy={isRunning}
          >
            <div className="results-heading">
              <div>
                <p className="section-kicker">Modeled outcomes</p>
                <h2 id="results-title">Your forecast</h2>
              </div>
              <div className="results-actions">
                <span className={`forecast-status ${forecastStatusClass}`}>
                  <i aria-hidden="true" />
                  {forecastStatusLabel}
                </span>
                {isRunning ? (
                  <button type="button" className="cancel-button" onClick={cancelForecast}>
                    Cancel run
                  </button>
                ) : null}
              </div>
            </div>

            <p className="sr-only" aria-live="polite" aria-atomic="true">
              {statusMessage}
            </p>

            {projection && lastRun && finalPoint && finalDistribution && displayedInvested !== undefined ? (
              <>
                <div className="metric-grid">
                  <MetricCard
                    label="Conditional goal-hit rate"
                    value={formatProbability(projection.successProbability)}
                    note={samplingSummary}
                    accent
                  />
                  <MetricCard
                    label="50th-percentile ending value"
                    value={formatCurrency(finalDistribution.p50)}
                    note={dollarMode === "real" ? "In today's purchasing power" : "In future nominal dollars"}
                  />
                  <MetricCard
                    label="10th-percentile ending value"
                    value={formatCurrency(finalDistribution.p10)}
                    note="A lower-tail modeled outcome, not a worst case"
                  />
                  <MetricCard
                    label="90th-percentile ending value"
                    value={formatCurrency(finalDistribution.p90)}
                    note="An upper-tail modeled outcome, not a guarantee"
                  />
                </div>

                <p className="sampling-disclosure">
                  The 95% conditional sampling-error interval estimates finite-path Monte Carlo
                  noise under these fixed model assumptions. It does not measure model,
                  assumption, or real-world uncertainty.
                </p>

                <dl className="run-metadata" aria-label="Executed forecast metadata">
                  <div>
                    <dt>Model version</dt>
                    <dd>{projection.modelVersion}</dd>
                  </div>
                  <div>
                    <dt>Path-set seed</dt>
                    <dd>{projection.seed.toLocaleString("en-US")}</dd>
                  </div>
                  <div>
                    <dt>Scenario paths</dt>
                    <dd>{projection.scenarioCount.toLocaleString("en-US")}</dd>
                  </div>
                  <div>
                    <dt>Execution</dt>
                    <dd>Dedicated Web Worker</dd>
                  </div>
                </dl>

                <section className="decision-panel" aria-labelledby="decision-title">
                  <div className="decision-heading">
                    <div>
                      <p className="section-kicker">Modeled funding trade-offs</p>
                      <h3 id="decision-title">
                        Trade-offs at the {formatProbability(planningThreshold)}
                        {" "}modeled path threshold
                      </h3>
                    </div>
                    <p>
                      Solved on this exact seeded path set. Change the threshold to test a different
                      planning rule.
                    </p>
                  </div>
                  <div className="decision-grid">
                    <DecisionCard
                      label="Modeled monthly contribution at this threshold"
                      value={
                        projection.planning.requiredMonthlyContribution === null
                          ? "Above model limit"
                          : formatExactCurrency(projection.planning.requiredMonthlyContribution)
                      }
                      note={
                        projection.planning.monthlyContributionGap === null
                          ? "No bounded solution is available under the model limits"
                          : projection.planning.monthlyContributionGap > 0
                            ? `With the current real-dollar goal held fixed: ${formatExactCurrency(projection.planning.monthlyContributionGap)} above the current constant nominal monthly contribution`
                            : "With the current real-dollar goal held fixed, the current constant nominal monthly contribution already meets this path threshold"
                      }
                    />
                    <DecisionCard
                      label="Goal supported in today's dollars"
                      value={formatExactCurrency(projection.planning.supportedGoalToday)}
                      note={`With the current constant nominal monthly contribution held fixed, at least ${formatProbability(planningThreshold)} of these paths finish at or above this real-dollar value`}
                    />
                    <DecisionCard
                      label="Average gap when the goal is missed"
                      value={
                        projection.planning.averageGoalShortfall === null
                          ? "No misses"
                          : formatCurrency(projection.planning.averageGoalShortfall)
                      }
                      note={`Worst-decile average ending value: ${formatCurrency(projection.planning.lowerTailAverage)}`}
                    />
                    <DecisionCard
                      label="90th-percentile net-return-index drawdown"
                      value={formatProbability(projection.planning.p90NetNominalMaxDrawdown)}
                      note={`Median: ${formatProbability(projection.planning.medianNetNominalMaxDrawdown)} · nominal growth index after fees; contributions excluded`}
                    />
                  </div>
                </section>

                <article className="chart-card">
                  <div className="chart-heading">
                    <div>
                      <h3>Range of possible outcomes</h3>
                      <p>Annual snapshots across {projection.scenarioCount.toLocaleString("en-US")} simulated paths</p>
                    </div>
                    <div className="dollar-toggle" role="group" aria-label="Forecast dollar display">
                      <button
                        type="button"
                        aria-pressed={dollarMode === "real"}
                        onClick={() => setDollarMode("real")}
                      >
                        Today's dollars
                      </button>
                      <button
                        type="button"
                        aria-pressed={dollarMode === "nominal"}
                        onClick={() => setDollarMode("nominal")}
                      >
                        Nominal dollars
                      </button>
                    </div>
                  </div>
                  <FanChart
                    points={projection.points}
                    target={displayedGoal}
                    mode={dollarMode}
                  />
                  <details className="annual-results-details">
                    <summary>View exact annual forecast data</summary>
                    <AnnualResultsTable points={projection.points} mode={dollarMode} />
                  </details>
                </article>

                <article className="summary-card">
                  <span className="summary-marker" aria-hidden="true">N</span>
                  <div>
                    <p className="section-kicker">Read this run literally</p>
                    <h3>
                      {formatProbability(projection.successProbability)} of the executed model paths
                      reached the purchasing-power goal.
                    </h3>
                    <p>
                      The 50th-percentile outcome is {formatCurrency(finalDistribution.p50)} and the
                      modeled 10th–90th percentile range is {formatCurrency(finalDistribution.p10)} to
                      {" "}{formatCurrency(finalDistribution.p90)} in {dollarMode === "real" ? "today's" : "nominal"}
                      {" "}dollars. The displayed invested-capital line is {formatCurrency(displayedInvested)}
                      {" "}at year {lastRun.years}. These results are conditional on the entered return,
                      volatility, inflation, fee, contribution, and Gaussian independence assumptions.
                    </p>
                  </div>
                </article>
              </>
            ) : (
              <article className="results-placeholder">
                <span className={isRunning ? "worker-spinner" : "worker-idle"} aria-hidden="true" />
                <div>
                  <p className="section-kicker">
                    {isRunning ? "Background worker active" : "Ready when you are"}
                  </p>
                  <h3>
                    {isRunning
                      ? "Building the first reproducible path set…"
                      : "No completed forecast yet."}
                  </h3>
                  <p>
                    {isRunning
                      ? "You can keep using the page while Northstar evaluates 5,000 monthly paths."
                      : "Run the current assumptions to create a forecast."}
                  </p>
                </div>
              </article>
            )}
          </section>
        </div>

        <footer className="disclaimer">
          <strong>For education, not prediction.</strong>
          <p>
            Northstar shows hypothetical outcomes in both nominal and today's dollars. It models a
            constant annual fee and inflation assumption, but excludes taxes, changing allocations,
            and changing contributions. Results are not guarantees and are not investment advice.
          </p>
        </footer>
      </main>
    </div>
  );
}
