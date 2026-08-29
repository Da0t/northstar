import { useEffect, useMemo, useRef, useState } from "react";
import { FanChart } from "./components/FanChart";
import { formatCurrency, formatPercentageInput, formatProbability } from "./format";
import {
  UI_SCENARIO_COUNT,
  assumptionsEqual,
  runSimulation,
  validateAssumptions,
  type AssumptionField,
  type PortfolioAssumptions,
  type SimulationResult,
} from "./simulation";

const INITIAL_SEED = 0x4e4f5254;

const DEFAULT_ASSUMPTIONS: PortfolioAssumptions = {
  startingBalance: 25_000,
  monthlyContribution: 750,
  years: 20,
  annualReturn: 0.07,
  annualVolatility: 0.15,
  targetEndingValue: 500_000,
};

const PRESETS = [
  { name: "Conservative", return: 4, volatility: 8 },
  { name: "Balanced", return: 7, volatility: 15 },
  { name: "Growth", return: 9, volatility: 22 },
] as const;

type FormState = Record<AssumptionField, string>;
type FormErrors = Partial<Record<AssumptionField, string>>;

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
  onChange: (field: AssumptionField, value: string) => void;
}

function assumptionsToForm(assumptions: PortfolioAssumptions): FormState {
  return {
    startingBalance: String(assumptions.startingBalance),
    monthlyContribution: String(assumptions.monthlyContribution),
    years: String(assumptions.years),
    annualReturn: formatPercentageInput(assumptions.annualReturn),
    annualVolatility: formatPercentageInput(assumptions.annualVolatility),
    targetEndingValue: String(assumptions.targetEndingValue),
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
    targetEndingValue: parseNumber(form.targetEndingValue),
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
  onChange,
}: FieldProps) {
  const errorId = `${field}-error`;
  return (
    <div className={`field ${error ? "field-invalid" : ""}`}>
      <label htmlFor={field}>{label}</label>
      <div className="input-shell">
        {prefix ? <span className="input-adornment input-prefix">{prefix}</span> : null}
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
          aria-describedby={error ? errorId : undefined}
          onChange={(event) => onChange(field, event.target.value)}
        />
        {suffix ? <span className="input-adornment input-suffix">{suffix}</span> : null}
      </div>
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

function outcomeLabel(probability: number): string {
  if (probability >= 0.8) return "a strong modeled likelihood";
  if (probability >= 0.6) return "a better-than-even modeled likelihood";
  if (probability >= 0.4) return "a roughly even modeled likelihood";
  if (probability >= 0.2) return "a lower modeled likelihood";
  return "a limited modeled likelihood";
}

export default function App() {
  const [form, setForm] = useState<FormState>(() => assumptionsToForm(DEFAULT_ASSUMPTIONS));
  const [projection, setProjection] = useState<SimulationResult>(() =>
    runSimulation(DEFAULT_ASSUMPTIONS, { scenarios: UI_SCENARIO_COUNT, seed: INITIAL_SEED }),
  );
  const [lastRun, setLastRun] = useState<PortfolioAssumptions>(DEFAULT_ASSUMPTIONS);
  const [isRunning, setIsRunning] = useState(false);
  const [statusMessage, setStatusMessage] = useState("Initial forecast ready.");
  const formRef = useRef(form);
  const nextSeedRef = useRef(INITIAL_SEED + 1);
  const timerRef = useRef<number | undefined>(undefined);
  const parsed = useMemo(() => parseForm(form), [form]);
  const hasErrors = Object.keys(parsed.errors).length > 0;
  const isStale = hasErrors || !assumptionsEqual(parsed.assumptions, lastRun);
  const finalPoint = projection.points.at(-1);

  useEffect(
    () => () => {
      if (timerRef.current !== undefined) {
        window.clearTimeout(timerRef.current);
      }
    },
    [],
  );

  const updateForm = (nextForm: FormState, changedMessage: string, currentMessage: string) => {
    formRef.current = nextForm;
    setForm(nextForm);
    const next = parseForm(nextForm);
    const nextHasErrors = Object.keys(next.errors).length > 0;
    setStatusMessage(
      nextHasErrors || !assumptionsEqual(next.assumptions, lastRun)
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

  const runForecast = () => {
    const current = parseForm(formRef.current);
    if (Object.keys(current.errors).length > 0) {
      setStatusMessage("Fix the highlighted assumptions before running the forecast.");
      return;
    }

    const seed = nextSeedRef.current >>> 0;
    nextSeedRef.current = (nextSeedRef.current + 1) >>> 0;
    setIsRunning(true);
    setStatusMessage(`Running ${UI_SCENARIO_COUNT.toLocaleString("en-US")} local scenarios…`);

    timerRef.current = window.setTimeout(() => {
      const result = runSimulation(current.assumptions, {
        scenarios: UI_SCENARIO_COUNT,
        seed,
      });
      const latest = parseForm(formRef.current);
      const latestHasErrors = Object.keys(latest.errors).length > 0;
      const resultsAreCurrent =
        !latestHasErrors && assumptionsEqual(latest.assumptions, current.assumptions);
      setProjection(result);
      setLastRun(current.assumptions);
      setIsRunning(false);
      setStatusMessage(
        resultsAreCurrent
          ? `Forecast updated with ${UI_SCENARIO_COUNT.toLocaleString("en-US")} scenarios.`
          : "Forecast finished, but current assumptions differ from this run. Run it again to refresh.",
      );
      timerRef.current = undefined;
    }, 20);
  };

  const selectedPreset = PRESETS.find(
    (preset) =>
      parseNumber(form.annualReturn) === preset.return &&
      parseNumber(form.annualVolatility) === preset.volatility,
  )?.name;

  return (
    <div className="app-frame">
      <header className="site-header">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">N</span>
          <div>
            <p className="wordmark">Northstar</p>
            <p className="brand-subtitle">Portfolio Forecast</p>
          </div>
        </div>
        <p className="header-descriptor">See the range, not just the average.</p>
        <div className="disclosure-pill">
          <span aria-hidden="true" />
          5,000 scenarios <b>•</b> Local only
        </div>
      </header>

      <main>
        <section className="intro" aria-labelledby="page-title">
          <p className="eyebrow">Long-range planning, made tangible</p>
          <h1 id="page-title">Explore where your portfolio could go.</h1>
          <p>
            Test a set of assumptions against thousands of possible market paths. Northstar keeps
            the math on your device and puts uncertainty front and center.
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
                  label="Starting balance"
                  value={form.startingBalance}
                  error={parsed.errors.startingBalance}
                  prefix="$"
                  min={0}
                  step="100"
                  onChange={handleFieldChange}
                />
                <AssumptionField
                  field="monthlyContribution"
                  label="Monthly contribution"
                  value={form.monthlyContribution}
                  error={parsed.errors.monthlyContribution}
                  prefix="$"
                  min={0}
                  step="25"
                  onChange={handleFieldChange}
                />
                <AssumptionField
                  field="years"
                  label="Time horizon"
                  value={form.years}
                  error={parsed.errors.years}
                  suffix="years"
                  min={1}
                  max={50}
                  step="1"
                  onChange={handleFieldChange}
                />
                <AssumptionField
                  field="targetEndingValue"
                  label="Target ending value"
                  value={form.targetEndingValue}
                  error={parsed.errors.targetEndingValue}
                  prefix="$"
                  min={0}
                  step="1000"
                  onChange={handleFieldChange}
                />
              </div>

              <fieldset className="preset-fieldset">
                <legend>Market profile</legend>
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
                  label="Expected annual return"
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
                  label="Annual volatility"
                  value={form.annualVolatility}
                  error={parsed.errors.annualVolatility}
                  suffix="%"
                  min={0}
                  max={100}
                  step="0.1"
                  onChange={handleFieldChange}
                />
              </div>

              <p className="model-note">
                Return is the long-run average; volatility controls how widely paths can vary.
              </p>

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
              <span className={`forecast-status ${isStale ? "status-stale" : "status-current"}`}>
                <i aria-hidden="true" />
                {isStale ? "Assumptions changed" : "Forecast current"}
              </span>
            </div>

            <p className="sr-only" aria-live="polite" aria-atomic="true">
              {statusMessage}
            </p>

            {finalPoint ? (
              <>
                <div className="metric-grid">
                  <MetricCard
                    label="Chance of reaching goal"
                    value={formatProbability(projection.successProbability)}
                    note={`Goal: ${formatCurrency(lastRun.targetEndingValue)}`}
                    accent
                  />
                  <MetricCard
                    label="Median ending value"
                    value={formatCurrency(finalPoint.p50)}
                    note="Half of paths finish above"
                  />
                  <MetricCard
                    label="10th percentile"
                    value={formatCurrency(finalPoint.p10)}
                    note="A cautious downside case"
                  />
                  <MetricCard
                    label="90th percentile"
                    value={formatCurrency(finalPoint.p90)}
                    note="An optimistic upside case"
                  />
                </div>

                <article className="chart-card">
                  <div className="chart-heading">
                    <div>
                      <h3>Range of possible outcomes</h3>
                      <p>Annual snapshots across {projection.scenarioCount.toLocaleString("en-US")} simulated paths</p>
                    </div>
                    <span>Nominal dollars</span>
                  </div>
                  <FanChart points={projection.points} target={lastRun.targetEndingValue} />
                </article>

                <article className="summary-card">
                  <span className="summary-marker" aria-hidden="true">N</span>
                  <div>
                    <p className="section-kicker">What this suggests</p>
                    <h3>{outcomeLabel(projection.successProbability)} of meeting your goal.</h3>
                    <p>
                      In this run, {formatProbability(projection.successProbability)} of paths reached
                      {" "}{formatCurrency(lastRun.targetEndingValue)} or more. The middle path ended at
                      {" "}{formatCurrency(finalPoint.p50)}, compared with {formatCurrency(finalPoint.invested)}
                      {" "}of total invested capital. Eight in ten modeled outcomes landed between
                      {" "}{formatCurrency(finalPoint.p10)} and {formatCurrency(finalPoint.p90)}.
                    </p>
                  </div>
                </article>
              </>
            ) : null}
          </section>
        </div>

        <footer className="disclaimer">
          <strong>For education, not prediction.</strong>
          <p>
            Northstar shows hypothetical outcomes in nominal dollars. It excludes taxes, fees,
            inflation, and changing allocations, and assumes contributions stay constant. Results
            are not guarantees and are not investment advice.
          </p>
        </footer>
      </main>
    </div>
  );
}
