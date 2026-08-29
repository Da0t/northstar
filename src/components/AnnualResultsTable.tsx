import { formatExactCurrency } from "../format";
import type { ForecastPoint } from "../simulation";
import type { DollarMode } from "./FanChart";

interface AnnualResultsTableProps {
  points: ForecastPoint[];
  mode: DollarMode;
}

export function AnnualResultsTable({ points, mode }: AnnualResultsTableProps) {
  if (points.length === 0) {
    return <p className="annual-results-empty">No annual forecast results are available.</p>;
  }

  const dollarDescription = mode === "real" ? "today's dollars" : "future nominal dollars";

  return (
    <div
      className="annual-results-table-scroll"
      role="region"
      aria-label={`Annual forecast results in ${dollarDescription}`}
      tabIndex={0}
    >
      <table className="annual-results-table">
        <caption>
          Annual invested capital and modeled percentile outcomes in {dollarDescription}
        </caption>
        <thead>
          <tr>
            <th scope="col">Year</th>
            <th scope="col">Invested capital</th>
            <th scope="col">P10 (10th percentile)</th>
            <th scope="col">P25 (25th percentile)</th>
            <th scope="col">P50 (median)</th>
            <th scope="col">P75 (75th percentile)</th>
            <th scope="col">P90 (90th percentile)</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => {
            const distribution = point[mode];
            const invested = mode === "real" ? point.investedReal : point.investedNominal;

            return (
              <tr key={point.year}>
                <th scope="row">{point.year === 0 ? "Today (year 0)" : `Year ${point.year}`}</th>
                <td>{formatExactCurrency(invested)}</td>
                <td>{formatExactCurrency(distribution.p10)}</td>
                <td>{formatExactCurrency(distribution.p25)}</td>
                <td>{formatExactCurrency(distribution.p50)}</td>
                <td>{formatExactCurrency(distribution.p75)}</td>
                <td>{formatExactCurrency(distribution.p90)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
