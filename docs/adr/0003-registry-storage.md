# 0003 - Registry Storage

**Status:** Accepted
**Date:** 2026-05-08
**Impacted Packages:** registry

## Context

The registry needs a fast local development path and a production-ready persistence option.

## Decision

Use in-memory storage for local and test scenarios, and Redis storage for shared production deployments.

## Consequences

Developers can run the registry without external services, while production deployments can use Redis for persistence and horizontal scaling.
