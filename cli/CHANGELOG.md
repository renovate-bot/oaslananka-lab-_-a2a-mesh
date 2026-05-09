# a2a-mesh-cli

## [1.3.1](https://github.com/oaslananka-lab/a2a-mesh/compare/a2a-mesh-cli-v1.3.0...a2a-mesh-cli-v1.3.1) (2026-05-09)


### Bug Fixes

* **ci:** stabilize release generated checks ([7c7cfe5](https://github.com/oaslananka-lab/a2a-mesh/commit/7c7cfe52dc9387c9d64e60505527e7b1a2b5bcbd))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * a2a-mesh bumped to 1.3.1
    * a2a-mesh-registry bumped to 1.3.1

## [1.3.0](https://github.com/oaslananka-lab/a2a-mesh/compare/a2a-mesh-cli-v1.2.0...a2a-mesh-cli-v1.3.0) (2026-05-08)

### Features

- **tests:** add integration tests for Azure DevOps script and client-server interactions ([58e4f1e](https://github.com/oaslananka-lab/a2a-mesh/commit/58e4f1e70f44c35b10130d850c94fbb64acebdd1))

### Bug Fixes

- **cli:** keep scaffold package manager consistent ([c13345e](https://github.com/oaslananka-lab/a2a-mesh/commit/c13345ea13383efe16e2de57b933c9448b422396))
- **release:** close publish and docker review gaps ([fd04d75](https://github.com/oaslananka-lab/a2a-mesh/commit/fd04d75a3c247db8f85585851d1a326863507922))

### Dependencies

- The following workspace dependencies were updated
  - dependencies
    - a2a-mesh bumped to 1.3.0
    - a2a-mesh-registry bumped to 1.3.0

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
  - a2a-mesh-registry@1.2.0

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
  - a2a-mesh-registry@1.1.0
