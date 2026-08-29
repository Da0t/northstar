# ADR 0001: Run portfolio simulations locally

- **Status:** Accepted
- **Date:** 2026-08-28

## Context

Northstar is a focused educational portfolio-planning prototype. Its inputs are personal financial assumptions, while its current model needs no private market feed, shared state, durable record, or server-owned business rule. Adding an API would introduce data transfer, credentials, deployment, availability, and retention decisions without improving the core user decision: testing a savings plan across variable market paths.

The default run performs 1.2 million monthly balance updates, and the maximum UI horizon performs 3 million. The current implementation assigns this workload to the browser, performs it synchronously on the main thread, and has no measured responsiveness guarantee.

## Decision

Run validation, pseudo-random generation, simulation, aggregation, and rendering entirely in the browser. Keep inputs and results in React memory only. Do not add an account, backend, persistence layer, application secret, telemetry, or application-originated network request.

Use a supplied seed with a deterministic Mulberry32 stream so engine behavior is reproducible in tests. Keep the UI scenario count fixed at 5,000 and make the local/runtime boundary visible in the product and documentation.

## Consequences

### Positive

- Financial inputs do not leave application memory through Northstar code.
- The app can run without service credentials, provisioned infrastructure, or backend availability.
- The model is easy to inspect and test as one typed module.
- The architecture matches the prototype’s present collaboration and retention needs: none.

### Negative

- Main-thread computation can delay interaction, especially on slower devices or longer horizons.
- There is no cross-device sync, collaboration, recovery, durable audit trail, or server-side policy enforcement.
- Browser memory and compute limits bound the application.
- Local-only is not itself a security guarantee; browser extensions, developer tooling, the local server, dependencies, and the host device remain outside Northstar’s control.
- Adding persistence later will require explicit retention, encryption, authorization, deletion, and threat-model decisions.

## Revisit when

- Measured main-thread latency exceeds an agreed interaction budget; first consider a Web Worker, cancellation, and progress reporting rather than a backend.
- Users need saved, shared, or cross-device plans.
- The model requires licensed or frequently updated market data.
- Server-side compliance, policy, reporting, or audit requirements become real product constraints.
- Scenario volume or model complexity exceeds a measured browser compute/memory budget.
