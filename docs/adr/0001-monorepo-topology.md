# 0001 - Monorepo Topology

**Status:** Accepted
**Date:** 2026-05-08
**Impacted Packages:** core, registry, adapters, ws, client, cli, testing, grpc, mcp-bridge, codex-bridge, create-a2a-agent

## Context

The project ships several related packages, demo apps, deployment assets, and documentation that need to evolve together.

## Decision

Keep the project as an npm workspaces monorepo with shared root linting, type checking, release, and CI policy.

## Consequences

Cross-package changes stay atomic, CI can validate the full mesh in one run, and release automation must remain workspace-aware.
