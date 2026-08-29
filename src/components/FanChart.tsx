import { useId } from "react";
import { formatCompactCurrency, formatCurrency } from "../format";
import type { ForecastPoint } from "../simulation";

export type DollarMode = "real" | "nominal";

interface FanChartProps {
  points: ForecastPoint[];
  target: number;
  mode: DollarMode;
}

interface ChartPoint {
  year: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  invested: number;
}

const WIDTH = 840;
const HEIGHT = 390;
const MARGIN = { top: 55, right: 24, bottom: 52, left: 74 };
const INNER_WIDTH = WIDTH - MARGIN.left - MARGIN.right;
const INNER_HEIGHT = HEIGHT - MARGIN.top - MARGIN.bottom;

function linePath(
  points: ChartPoint[],
  x: (point: ChartPoint) => number,
  y: (point: ChartPoint) => number,
): string {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"}${x(point).toFixed(2)},${y(point).toFixed(2)}`)
    .join(" ");
}

function areaPath(
  points: ChartPoint[],
  x: (point: ChartPoint) => number,
  upper: (point: ChartPoint) => number,
  lower: (point: ChartPoint) => number,
): string {
  if (points.length === 0) {
    return "";
  }

  const top = points.map((point, index) =>
    `${index === 0 ? "M" : "L"}${x(point).toFixed(2)},${upper(point).toFixed(2)}`,
  );
  const bottom = [...points]
    .reverse()
    .map((point) => `L${x(point).toFixed(2)},${lower(point).toFixed(2)}`);
  return `${top.join(" ")} ${bottom.join(" ")} Z`;
}

function makeYearTicks(maxYear: number): number[] {
  const desiredIntervals = maxYear <= 10 ? Math.min(maxYear, 5) : 4;
  const step = Math.max(1, Math.ceil(maxYear / desiredIntervals / 5) * 5);
  const ticks: number[] = [];
  for (let year = 0; year < maxYear; year += step) {
    ticks.push(year);
  }
  ticks.push(maxYear);
  return [...new Set(ticks)];
}

export function FanChart({ points, target, mode }: FanChartProps) {
  const titleId = useId();
  const descriptionId = useId();
  const safePoints = points
    .map((point): ChartPoint => ({
      year: point.year,
      ...point[mode],
      invested: mode === "real" ? point.investedReal : point.investedNominal,
    }))
    .filter((point) =>
      [point.p10, point.p25, point.p50, point.p75, point.p90, point.invested].every(
        (value) => Number.isFinite(value) && value >= 0,
      ),
    );

  if (safePoints.length === 0) {
    return <p className="chart-empty">No valid forecast points are available.</p>;
  }

  const maxYear = Math.max(1, safePoints.at(-1)?.year ?? 1);
  const rawMax = Math.max(target, ...safePoints.map((point) => Math.max(point.p90, point.invested)), 1);
  const yMax = rawMax > Number.MAX_VALUE / 1.12 ? rawMax : rawMax * 1.12;
  const xScale = (point: ChartPoint) => MARGIN.left + (point.year / maxYear) * INNER_WIDTH;
  const yScaleValue = (value: number) => MARGIN.top + INNER_HEIGHT - (value / yMax) * INNER_HEIGHT;
  const yTicks = Array.from({ length: 5 }, (_, index) => yMax * (index / 4));
  const yearTicks = makeYearTicks(maxYear);
  const targetY = yScaleValue(target);
  const lastPoint = safePoints.at(-1);

  return (
    <div className="chart-shell">
      <svg
        className="fan-chart"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-labelledby={`${titleId} ${descriptionId}`}
        preserveAspectRatio="xMidYMid meet"
      >
        <title id={titleId}>
          Portfolio range over {maxYear} years in {mode === "real" ? "today's" : "nominal"} dollars
        </title>
        <desc id={descriptionId}>
          A fan chart showing the tenth through ninetieth percentile range, the interquartile
          range, median portfolio value, invested capital, and a goal of {formatCurrency(target)}
          {mode === "real" ? " in today's purchasing power" : " in future nominal dollars"}.
        </desc>

        <g className="chart-legend" aria-hidden="true">
          <rect x="76" y="15" width="24" height="10" rx="3" className="legend-outer" />
          <text x="106" y="25">10th–90th</text>
          <rect x="220" y="15" width="24" height="10" rx="3" className="legend-inner" />
          <text x="250" y="25">25th–75th</text>
          <line x1="366" y1="20" x2="392" y2="20" className="legend-median" />
          <text x="400" y="25">Median</text>
          <line x1="485" y1="20" x2="511" y2="20" className="legend-invested" />
          <text x="519" y="25">Invested</text>
          <line x1="612" y1="20" x2="638" y2="20" className="legend-goal" />
          <text x="646" y="25">Goal</text>
        </g>

        <g aria-hidden="true">
          {yTicks.map((tick) => {
            const y = yScaleValue(tick);
            return (
              <g key={tick}>
                <line x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={y} y2={y} className="grid-line" />
                <text x={MARGIN.left - 12} y={y + 4} textAnchor="end" className="axis-label">
                  {formatCompactCurrency(tick)}
                </text>
              </g>
            );
          })}

          {yearTicks.map((year) => {
            const x = MARGIN.left + (year / maxYear) * INNER_WIDTH;
            return (
              <g key={year}>
                <line x1={x} x2={x} y1={MARGIN.top + INNER_HEIGHT} y2={MARGIN.top + INNER_HEIGHT + 6} className="axis-tick" />
                <text x={x} y={MARGIN.top + INNER_HEIGHT + 25} textAnchor="middle" className="axis-label">
                  {year === 0 ? "Today" : `Yr ${year}`}
                </text>
              </g>
            );
          })}
        </g>

        <path
          d={areaPath(safePoints, xScale, (point) => yScaleValue(point.p90), (point) => yScaleValue(point.p10))}
          className="percentile-band percentile-band-outer"
        />
        <path
          d={areaPath(safePoints, xScale, (point) => yScaleValue(point.p75), (point) => yScaleValue(point.p25))}
          className="percentile-band percentile-band-inner"
        />

        <line
          x1={MARGIN.left}
          x2={WIDTH - MARGIN.right}
          y1={targetY}
          y2={targetY}
          className="goal-line"
        />
        <g className="goal-label" transform={`translate(${WIDTH - MARGIN.right - 77} ${Math.max(MARGIN.top + 2, targetY - 23)})`}>
          <rect width="76" height="20" rx="10" />
          <text x="38" y="14" textAnchor="middle">Your goal</text>
        </g>

        <path d={linePath(safePoints, xScale, (point) => yScaleValue(point.invested))} className="invested-line" />
        <path d={linePath(safePoints, xScale, (point) => yScaleValue(point.p50))} className="median-line" />

        {lastPoint ? (
          <circle cx={xScale(lastPoint)} cy={yScaleValue(lastPoint.p50)} r="4.5" className="median-dot" />
        ) : null}

        <text
          x={MARGIN.left + INNER_WIDTH / 2}
          y={HEIGHT - 8}
          textAnchor="middle"
          className="axis-title"
          aria-hidden="true"
        >
          Years from today
        </text>
      </svg>
    </div>
  );
}
