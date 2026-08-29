const wholeDollarFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const compactDollarFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

const percentFormatter = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 1,
});

const percentageInputFormatter = new Intl.NumberFormat("en-US", {
  useGrouping: false,
  maximumFractionDigits: 12,
});

export function formatCurrency(value: number): string {
  return wholeDollarFormatter.format(Number.isFinite(value) ? value : 0);
}

export function formatCompactCurrency(value: number): string {
  return compactDollarFormatter.format(Number.isFinite(value) ? value : 0);
}

export function formatProbability(value: number): string {
  const safeValue = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  return percentFormatter.format(safeValue);
}

export function formatPercentageInput(value: number): string {
  const safeValue = Number.isFinite(value) ? value : 0;
  return percentageInputFormatter.format(safeValue * 100);
}
