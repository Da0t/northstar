# ADR 0002: Use a fixed seeded path set for planning comparisons

- **Status:** Accepted
- **Date:** 2026-08-29
- **Decision scope:** UI forecast execution and model-version 2.2 planning alternatives
- **Related decision:** [ADR 0001](0001-local-first-simulation.md) remains the local-execution decision and is not superseded.

## Context

Northstar compares an entered savings plan with modeled contribution and goal alternatives. If each rerun draws a different sample, a user cannot tell whether a changed result came from an edited assumption or sampling jitter. The contribution and supported-goal solvers also need one explicit reference path set if their threshold claims are to be replayed exactly.

The model is not calibrated to real outcomes. Reproducibility can improve comparison and debugging, but it must not be presented as predictive certainty.

## Decision drivers

1. Isolate assumption changes from changes in the pseudo-random sample.
2. Make threshold-based alternatives reproducible and testable to the cent.
3. Preserve an explicit execution boundary and bounded local workload.
4. Record enough metadata to distinguish results from different model contracts.
5. Keep Monte Carlo sampling error separate from model and real-world uncertainty.

## Decision

The UI will run 5,000 scenarios with a visible unsigned 32-bit decimal seed, defaulting to `1313821268` (`0x4e4f5254`). A normal forecast submission reuses the visible seed. “Use next seed” advances the visible value but never runs silently, making resampling an explicit user action. The framework-independent engine continues to accept an explicit bounded scenario count and seed for tests and other callers.

Each successful result records its seed, scenario count, and model version. Model version 2.2 derives the following alternatives from the same executed paths used for the displayed forecast:

- the constant nominal monthly contribution supported by the selected modeled-path threshold;
- the largest goal in today's dollars supported by that threshold;
- the gap from the entered monthly contribution;
- missed-goal and lower-tail summaries; and
- return-index drawdown summaries.

Changing only the modeled-path threshold changes the order-statistic selection; it does not redraw market paths. Required contribution is rounded upward to cents and supported goal downward to cents so the displayed boundary is directionally safe on the reference sample.

The UI must describe the threshold as a share of the executed paths, not a real-world confidence level. A Wilson interval may describe conditional finite-sample noise in the goal-hit count, but not model error, assumption uncertainty, calibration, or future-market likelihood.

Execution occurs in a dedicated browser Worker. Each request carries an ID, assumptions, scenario count, and seed; cancellation terminates the Worker, and stale or malformed responses cannot replace a newer completed result. Workload ceilings remain a second responsiveness and resource control.

## Alternatives considered

### Advance the seed on every run

Rejected for the primary planning workflow. It demonstrates resampling, but it confounds an assumption comparison with a different random sample and makes a threshold-derived alternative harder to replay.

### Use ambient or cryptographic randomness

Rejected. Ambient randomness prevents exact replay. Cryptographic randomness adds no benefit to an educational simulation; the generator is not used for a security decision.

### Average multiple independent batches

Deferred. Ensembles could expose between-seed variation and convergence, but they increase work and explanation surface even with Worker execution. They should be added only with an explicit precision goal and measured performance budget.

### Persist generated paths

Rejected. The current path set is reproducible from model version, assumptions, scenario count, and seed. Persisting path arrays would expand the privacy, storage, migration, and recovery surface without a current product need.

## Consequences

### Positive

- Identical inputs produce identical results in the UI.
- Same-horizon assumption comparisons reuse a common pseudo-random draw stream, while threshold-only comparisons preserve the identical forecast points.
- Contribution and supported-goal boundaries can be replayed in deterministic tests.
- No persistence, backend, or new data-transfer boundary is introduced.

### Negative

- One fixed sample can hide sensitivity to seed choice.
- Exact repeatability can make an uncalibrated model appear more authoritative than it is.
- The UI can advance one seed explicitly but has no multi-seed comparison or convergence workflow.
- The pseudo-random stream and path ordering become part of the versioned model contract.
- Additional path-derived metrics increase Worker compute time even though execution remains bounded and cancellable.

## Controls and evidence

- The result includes model version, seed, scenario count, and exact hit count.
- UI copy says alternatives are solved on the exact seeded path set and that the threshold is not a real-world confidence level.
- Tests pin the random stream, replay equal inputs, verify threshold-only changes preserve forecast points, and rerun cent-rounded contribution and goal boundaries on the same paths.
- The model card separates conditional sampling error from unsupported predictive claims.

These controls do not establish calibration, convergence, browser performance, or production suitability.

## Revisit when

- Users need an explicit resampling or convergence comparison.
- Measured Worker latency or memory use requires progressive batches, pooling, or a revised workload ceiling.
- The PRNG, path ordering, scenario policy, or model equations change.
- Calibrated historical evidence supports a different uncertainty contract.
- A saved or shared plan requires durable run identifiers and migration policy.

## Related material

- [Northstar model card](../model-card.md)
- [ADR 0001: Run portfolio simulations locally](0001-local-first-simulation.md)
