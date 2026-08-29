# Northstar model card

- **Model version:** `northstar-monte-carlo/2.2.0`
- **Status:** Educational, experimental planning model
- **Last reviewed:** 2026-08-29
- **Implementation:** [`src/simulation.ts`](../src/simulation.ts) and [`src/planningMetrics.ts`](../src/planningMetrics.ts)

## Intended use

Northstar explores whether a constant-contribution savings plan reaches a real-dollar goal across a reproducible set of modeled market paths. It also calculates contribution and goal alternatives supported by a user-selected share of those same paths.

The model is suitable for education, implementation review, deterministic testing, and comparing entered assumptions inside its documented bounds. It is not calibrated to a person, portfolio, asset allocation, or historical outcome set.

## Prohibited interpretation

Northstar does not provide investment, tax, legal, or accounting advice. Its path shares are not real-world probabilities, guarantees, recommendations, or evidence that a planning threshold is appropriate. The conditional sampling interval measures finite-path Monte Carlo noise under fixed assumptions; it does not measure model error or market uncertainty.

## Inputs and execution contract

| Input | Current contract |
| --- | --- |
| Starting balance | Finite USD value from $0 through $1 trillion |
| Monthly contribution | Constant nominal end-of-month USD value from $0 through $100 million |
| Horizon | Whole years from 1 through 50 |
| Expected annual return | Engine accepts greater than -100% through 100%; UI limits entries to -20% through 30% |
| Annual volatility | 0% through 100% |
| Annual inflation | Constant 0% through 20% |
| Annual fee | Constant 0% through 10%, applied proportionally each month |
| Goal | $0 through $10 trillion in today's dollars, subject to the cent-precision boundary after inflation |
| Modeled path threshold | A whole percentage from 50% through 99% |
| Scenario count | Engine accepts 1 through 10,000; UI executes exactly 5,000 |
| Seed | Decimal unsigned 32-bit integer; the UI defaults to `1313821268` (`0x4e4f5254`) and exposes explicit next-seed sampling |

The engine also limits a request to 6,000,000 monthly updates and 510,000 annual snapshot cells. A valid result records its model version, normalized seed, scenario count, and successful-path count. The caller remains responsible for retaining the assumptions needed to reproduce that result.

## Method

For month `m`, expected annual gross return before fees `r`, annualized volatility `sigma`, annual fee `f`, and independent standard-normal draw `z_m`, the net monthly factor is:

```text
factor_m = exp((ln(1 + r) - sigma^2 / 2) / 12 + sigma * z_m / sqrt(12))
           * (1 - f)^(1 / 12)

balance_m = balance_(m-1) * factor_m + monthly_contribution
```

Contributions enter after that month's market movement and fee. `z_m` comes from Box-Muller transforms over a seeded Mulberry32 stream. Mulberry32 is reproducible and non-cryptographic.

For year `y` and constant annual inflation `i`:

```text
real_balance_y = nominal_balance_y / (1 + i)^y
nominal_goal_Y = goal_in_today's_dollars * (1 + i)^Y
```

The engine records year zero and annual snapshots. At each year it sorts cross-sectional balances and calculates P10, P25, P50, P75, and P90 using linear interpolation at position `(n - 1) * q`. A percentile boundary is not one continuous scenario path.

A path hits the goal when its final nominal balance is at least the inflation-adjusted nominal goal. The displayed goal-hit rate is `successful paths / executed paths`.

Nominal invested capital is the starting balance plus nominal contributions. Real invested capital discounts each contribution at its deposit date; it is not the final nominal contribution total divided by the ending inflation index.

## Planning outputs

- **Required monthly contribution:** solve the contribution required on each executed path, select the requirement supported by the chosen path share, then round upward to a cent. A rounded result that violates either the monthly-input ceiling or the balance boundary on any executed path is reported as unavailable.
- **Supported goal:** select the largest final real-dollar value supported by the chosen path share, then round downward to a cent.
- **Contribution gap:** the nonnegative difference between the solved and entered constant nominal monthly contributions.
- **Average missed-goal gap:** average real-dollar shortfall across paths that finish below the goal; unavailable when no path misses.
- **Lower-tail average:** arithmetic mean of the lowest 10% of final real-dollar outcomes, using a nonempty nearest-rank tail.
- **Drawdown:** maximum peak-to-trough decline of the net nominal return index after fees. Contributions and inflation are excluded. Results expose the median and 90th percentile across paths.
- **Sampling interval:** a 95% Wilson interval for the executed goal-hit count, presented only as conditional sampling-error context.

All alternatives are conditional on the exact executed path set. Rerunning after only a planning-threshold change reuses the same pseudo-random draws and therefore the same market paths.

## Numerical and failure behavior

The stochastic model intentionally uses IEEE-754 numbers for continuous growth. Northstar is not a ledger. Modeled balances must remain nonnegative and no greater than `Number.MAX_SAFE_INTEGER / 100`, preserving a safe cent-precision boundary for decision outputs.

Invalid assumptions, invalid seeds or workloads, and unsafe numerical intermediates fail explicitly. The engine does not convert overflow into apparent wealth. A dedicated Worker returns either one complete clone-safe result or a structured failure. The UI reports the failure through its status channel and retains the previous valid result rather than replacing it with partial output. Result freshness includes both the displayed assumptions and the path-set seed.

## Known limitations

- Monthly shocks are independent and Gaussian; the resulting growth process is lognormal with constant inputs.
- There is one aggregate return process, not holdings, asset classes, correlations, allocation, or rebalancing.
- The model excludes taxes, withdrawals, changing contributions, changing fees, serial correlation, fat tails, liquidity events, and market regimes.
- Return, volatility, inflation, and fee inputs are user-entered assumptions, not estimates or recommendations.
- Five thousand UI paths leave sampling noise. A fixed seed supports comparison but does not prove convergence or eliminate model risk.
- Each run owns a dedicated browser Worker with request-ID validation and hard cancellation by termination. There is no measured interaction-time guarantee, progress protocol, or Worker pool.
- Results have not been backtested or calibrated against permissioned historical outcomes.

## Verification and versioning

Automated tests cover deterministic replay, the pinned random stream, zero-volatility finance fixtures, fee and inflation mechanics, percentile invariants, goal boundaries, threshold solvers, directional cent rounding, drawdown definitions, conditional Wilson intervals, validation, numerical failures, workload ceilings, Worker protocol failures, cancellation, stale-response isolation, strict seed parsing, and the annual table fallback.

The current suite does not establish empirical calibration, browser compatibility, accessibility conformance, performance targets, or production security. Change the model version when a change can alter generated paths, balances, goal classification, percentile selection, planning outputs, or their financial interpretation. Reproducing a result requires the model version, complete assumptions, scenario count, and seed.
