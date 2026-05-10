# Testing

The main local gates are:

```bash
pnpm run test:unit
pnpm run test:coverage
pnpm run test:integration
pnpm run ui:install:browsers
pnpm run ui:test:e2e
```

Protocol coverage lives in `tests/integration/a2a-protocol-compliance.test.ts`.
Security regression coverage lives under `packages/core/tests`, `packages/registry/tests`, and integration tests.

Additional detail:

- [Testing strategy](./testing/strategy.md)
- [Local checklist](./testing/local-checklist.md)
