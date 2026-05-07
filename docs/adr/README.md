# Architecture Decision Records

ADRs are numbered with the `NNNN-short-title.md` format.

## Format

```markdown
# NNNN - Title

**Status:** Proposed | Accepted | Deprecated | Superseded by [NNNN]
**Date:** YYYY-MM-DD
**Impacted Packages:** core, registry, adapters, ...

## Context

Why is this decision needed?

## Decision

What was decided?

## Consequences

What trade-offs follow from the decision?
```

## Index

| #                                    | Title                                     | Status   |
| ------------------------------------ | ----------------------------------------- | -------- |
| [0001](./0001-monorepo-topology.md)  | Monorepo topology and workspace structure | Accepted |
| [0002](./0002-transport-protocol.md) | A2A transport: HTTP-SSE + JSON-RPC        | Accepted |
| [0003](./0003-registry-storage.md)   | Registry storage: InMemory to Redis       | Accepted |

## Creating a New ADR

```bash
N=$(printf '%04d' $(( $(ls docs/adr/*.md 2>/dev/null | grep -v README | wc -l) + 1 )))
cp docs/adr/README.md docs/adr/${N}-short-title.md
```
