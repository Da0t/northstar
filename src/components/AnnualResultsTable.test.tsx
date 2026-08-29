import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AnnualResultsTable } from "./AnnualResultsTable";
import type { ForecastPoint } from "../simulation";

const POINT: ForecastPoint = {
  year: 1,
  nominal: { p10: 110, p25: 120, p50: 130, p75: 140, p90: 150 },
  real: { p10: 100, p25: 109, p50: 118, p75: 127, p90: 136 },
  investedNominal: 125,
  investedReal: 114,
};

describe("AnnualResultsTable", () => {
  it("renders scoped headers and exact values for the selected dollar mode", () => {
    const markup = renderToStaticMarkup(
      <AnnualResultsTable points={[POINT]} mode="real" />,
    );

    expect(markup).toContain('scope="col"');
    expect(markup).toContain('scope="row"');
    expect(markup).toContain("Year 1");
    expect(markup).toContain("$114.00");
    expect(markup).toContain("$100.00");
    expect(markup).toContain("$136.00");
    expect(markup).not.toContain("$150.00");
  });

  it("renders a readable empty state", () => {
    expect(
      renderToStaticMarkup(<AnnualResultsTable points={[]} mode="nominal" />),
    ).toContain("No annual forecast results are available.");
  });
});
