import { describe, expect, it } from "vitest";
import {
  formatCompactCurrency,
  formatCurrency,
  formatPercentageInput,
  formatProbability,
} from "./format";

describe("formatting", () => {
  it("formats whole-dollar currency", () => {
    expect(formatCurrency(25_000)).toBe("$25,000");
    expect(formatCurrency(500_000.49)).toBe("$500,000");
  });

  it("formats compact chart currency", () => {
    expect(formatCompactCurrency(1_200_000)).toBe("$1.2M");
    expect(formatCompactCurrency(25_000)).toBe("$25K");
  });

  it("formats and bounds probabilities", () => {
    expect(formatProbability(0.6234)).toBe("62.3%");
    expect(formatProbability(2)).toBe("100%");
    expect(formatProbability(-1)).toBe("0%");
  });

  it("formats assumption fractions as clean percentage inputs", () => {
    expect(formatPercentageInput(0.07)).toBe("7");
    expect(formatPercentageInput(0.15)).toBe("15");
    expect(formatPercentageInput(0.07333)).toBe("7.333");
  });
});
