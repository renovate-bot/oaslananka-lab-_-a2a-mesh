# a2a-mesh-adapters

## 1.2.0

### Minor Changes

- Ship the production hardening release for the stable package set.

  Highlights:
  - enforce verify-first auth and typed request context propagation
  - harden SSRF, CORS/origin, SSE, and registry control-plane access paths
  - add explicit task FSM, idempotency/replay protection, and runtime metrics
  - add telemetry bootstrap helpers and emitted metrics aligned with dashboards
  - improve registry indexing, filtering, polling behavior, and scale tests
  - refresh the operator UI, docs, demo smoke flow, and local quality gates
  - pin the deterministic npm toolchain and update GitHub Actions to current stable runtimes

### Patch Changes

- Updated dependencies
  - a2a-mesh@1.2.0

## 1.1.0

### Minor Changes

- Promote the post-1.0 engineering baseline and control-plane improvements as the
  first minor release after v1.0.

  Highlights:
  - Harden Azure Pipelines and the manual release flow
  - Add formatting, markdown, and link quality gates
  - Improve registry UI and docs-site release readiness
  - Require explicit maintainer approval before npm publish runs

### Patch Changes

- Updated dependencies
  - a2a-mesh@1.1.0
