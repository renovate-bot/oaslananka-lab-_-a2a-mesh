# a2a-mesh-adapters

## [1.3.0](https://github.com/oaslananka-lab/a2a-mesh/compare/a2a-mesh-adapters-v1.2.0...a2a-mesh-adapters-v1.3.0) (2026-05-08)


### Features

* enhance registry server with unresolved hostname support and authentication checks ([d740ec8](https://github.com/oaslananka-lab/a2a-mesh/commit/d740ec8de62f4451f1aaed7113e49b81da2e7ab6))
* **tests:** add integration tests for Azure DevOps script and client-server interactions ([58e4f1e](https://github.com/oaslananka-lab/a2a-mesh/commit/58e4f1e70f44c35b10130d850c94fbb64acebdd1))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * a2a-mesh bumped to 1.3.0

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
