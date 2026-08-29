# ADR 0001: Run portfolio simulations locally

- **Status:** Accepted
- **Date:** 2026-08-28

## Context

Northstar is a focused educational portfolio-planning prototype. Its inputs are personal financial assumptions, while its current model needs no private market feed, shared state, durable record, or server-owned business rule. Adding an API would introduce data transfer, credentials, deployment, availability, and retention decisions without improving the core user decision: testing a savings plan across variable market paths.

The default run performs 1.2 million monthly balance updates, and the maximum UI horizon performs 3 million. At this decision's acceptance, the browser performed that work synchronously on the main thread without a measured responsiveness guarantee.

## Decision

Run validation, pseudo-random generation, simulation, aggregation, and rendering entirely in the browser. Keep inputs and results in ephemeral browser memory only. Do not add an account, backend, persistence layer, application secret, telemetry, external API request, or data-egress request. Same-origin static application assets remain inside this boundary.

Use a supplied seed with a deterministic Mulberry32 stream so engine behavior is reproducible in tests. Keep the UI scenario count fixed at 5,000 and make the local/runtime boundary visible in the product and documentation.

## Consequences

### Positive

- Financial inputs do not leave application memory through Northstar code.
- The app can run without service credentials, provisioned infrastructure, or backend availability.
- The model is easy to inspect and test as one typed module.
- The architecture matches the prototype’s present collaboration and retention needs: none.

### Negative

- Browser computation can consume CPU and memory, especially on slower devices or longer horizons.
- There is no cross-device sync, collaboration, recovery, durable audit trail, or server-side policy enforcement.
- Browser memory and compute limits bound the application.
- Local-only is not itself a security guarantee; browser extensions, developer tooling, the local server, dependencies, and the host device remain outside Northstar’s control.
- Adding persistence later will require explicit retention, encryption, authorization, deletion, and threat-model decisions.

## Revisit when

- Measured Worker latency or memory use exceeds an agreed browser budget; first consider progressive batches or pooling rather than a backend.
- Users need saved, shared, or cross-device plans.
- The model requires licensed or frequently updated market data.
- Server-side compliance, policy, reporting, or audit requirements become real product constraints.
- Scenario volume or model complexity exceeds a measured browser compute/memory budget.

## Implementation update — 2026-08-29

Simulation now runs in one cancellable dedicated Worker per request. Typed request IDs reject stale responses, result metadata and shape are validated before presentation, and failures preserve the last completed result. The Worker is a same-origin static asset and does not change this ADR's local-data decision. Fixed-path comparison and explicit seed advancement are recorded separately in [ADR 0002](0002-fixed-path-planning-comparisons.md).
