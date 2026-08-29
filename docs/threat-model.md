# Northstar threat model

- **Scope:** Current browser-only educational application
- **Model version reviewed:** `northstar-monte-carlo/2.2.1`
- **Last reviewed:** 2026-08-29

## Purpose and assets

Northstar accepts personal financial assumptions and produces hypothetical planning results. The assets considered here are:

- confidentiality of entered balances, contributions, goals, and assumptions;
- integrity of the delivered application, model inputs, and displayed results;
- availability of the current browser interaction; and
- clarity that modeled outputs are not advice, guarantees, or calibrated predictions.

This is a scoped design review, not a penetration test, security certification, privacy guarantee, or regulatory assessment.

## Current architecture and trust boundary

```text
User-controlled numeric form
  -> React memory
  -> typed request to a dedicated same-origin simulation Worker
  -> validated complete result or structured failure
  -> in-memory result presentation
```

Northstar application code has no account, backend, database, cookie, local-storage repository, telemetry client, upload, runtime secret, external API request, or data-egress request. The browser loads same-origin static application assets, including a separate Worker chunk. Inputs and results are held in React, Worker, and JavaScript memory and are discarded when the application reloads.

The trusted computing base still includes the delivered JavaScript bundle, direct and transitive dependencies, build and hosting pipeline, browser, operating system, and device. Browser extensions, developer tools, assistive software, screen capture, autofill behavior, and host-level monitoring are outside the application boundary and may observe displayed or in-memory data.

## Threats and current controls

| Threat | Current controls | Residual risk |
| --- | --- | --- |
| Application-originated disclosure | No persistence, telemetry, backend, upload, external API call, or data-egress request; runtime fetches are same-origin static assets | The static host, browser, device, extensions, development tooling, screenshots, and surrounding infrastructure can still expose data |
| Unauthorized account or stored-data access | No account or application data store exists | Northstar provides no authentication, authorization, device access control, encryption, remote deletion, or recovery |
| Untrusted or malformed numeric input | Typed parsing, field validation, bounded ranges, whole-number contracts, and explicit error states | Native numeric parsing and browser behavior remain part of the input boundary; there is no hostile-client/server boundary |
| Excessive local work | Scenario, horizon, monthly-update, and snapshot-cell ceilings; one dedicated Worker per run; hard cancellation by termination | Valid maximum work has no measured latency or memory guarantee, progress reporting, or Worker pool |
| Numerical corruption or misleading overflow | Nonnegative cent-precision boundary, safe directional cent rounding for planning outputs, and explicit numerical errors | IEEE-754 behavior remains part of the continuous stochastic model; this is not ledger arithmetic |
| Partial, stale, or malformed result presented as current | Invalid inputs cannot execute; request IDs reject stale responses; result shape and run metadata are validated; failures do not replace the last valid result; edited assumptions or seed mark results stale | No automated browser test currently establishes every focus, announcement, or concurrent-edit transition |
| Model misuse | Literal modeled-path language, real/nominal distinction, conditional sampling-error disclosure, documented assumptions, and an education/not-advice disclaimer | Users can still over-trust a polished result from an uncalibrated model |
| Predictable randomness used as a security primitive | Seeded Mulberry32 is documented as reproducible and non-cryptographic | The generator must never be reused for secrets, tokens, identifiers requiring unpredictability, or adversarial draws |
| Dependency, build, or hosting compromise | Frozen lockfile installation and CI quality gates improve repeatability | There is no claim of dependency attestation, signed releases, runtime integrity verification, CSP assurance, penetration testing, or a hardened deployment |

## Privacy properties

- Northstar does not intentionally collect identity, account, transaction, or portfolio-holding data.
- Values typed into the form can still be sensitive personal financial information.
- Reloading clears application-managed state because the app has no persistence layer.
- Local-only describes application data flow; it does not make an untrusted browser or device safe.
- The repository screenshot and bundled defaults use illustrative values and should not contain user data.

## Availability and failure behavior

The current simulation runs in one dedicated Worker per request. Cancellation terminates that Worker because a posted cancel message could not interrupt its synchronous calculation. Request tokens prevent a canceled or superseded promise from mutating newer UI state. Workload limits reduce accidental resource exhaustion; they do not constitute a measured responsiveness or memory budget or protect against a compromised bundle.

Validation failures remain associated with their fields. Unsafe workload, seed, or numerical states fail without returning partial simulation output. The UI retains the prior valid projection and exposes the failure message. There is no durable recovery requirement because there is no application-managed persistence.

## Explicitly out of scope

- operating-system, device, browser-profile, extension, or physical-access compromise;
- source-host, package-registry, CI, deployment, or dependency compromise;
- authentication, authorization, tenancy, account recovery, fraud, or transaction controls;
- server availability, rate limiting, audit logging, key management, and data-retention enforcement;
- licensed market-data integrity and freshness;
- production financial-planning, regulatory, legal, tax, or suitability review; and
- empirical validation of the model's probabilities or assumptions.

Out of scope means Northstar does not control or establish these properties, not that the risks are absent.

## Scope-expansion triggers

Revisit this threat model before adding:

- **Persistence or sync:** define data classification, retention, deletion, encryption, key management, schema migration, backup, and recovery.
- **Accounts or a backend:** define authentication, authorization, session protection, tenant isolation, abuse controls, auditability, privacy notices, and incident response.
- **Export or import:** define file limits, schema/version validation, formula and content handling, provenance, and safe failure behavior.
- **External market data:** define credential storage, licensing, source authenticity, staleness, availability, retries, and reconciliation.
- **Telemetry:** minimize collected fields, prohibit financial-input capture by default, document consent and retention, and provide deletion behavior.
- **Worker pooling or progressive batches:** define scheduling, memory ceilings, partial-result semantics, cancellation granularity, and cross-batch reproducibility.
- **Recommendations or allocation guidance:** require a separate product, legal, calibration, suitability, and explanation review.

## Evidence gaps

The project currently has domain, formatting, Worker protocol/client, seed-contract, and table-rendering tests plus CI lint, test, type-check, and build gates. It does not have automated browser security tests, dependency-policy enforcement, a CSP test, penetration testing, threat-model review by an independent assessor, a measured performance budget, or production monitoring. Accessibility and browser testing are separate quality requirements and are not established by this document.

## Related material

- [Northstar model card](model-card.md)
- [ADR 0001: Run portfolio simulations locally](adr/0001-local-first-simulation.md)
- [ADR 0002: Use a fixed seeded path set for planning comparisons](adr/0002-fixed-path-planning-comparisons.md)
