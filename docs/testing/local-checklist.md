# Local Testing Checklist

Before opening a PR or marking a Phase as "READY", you **must** run the following Quality Gates locally to ensure you haven't broken the platform:

```bash
# 1. Dependency alignment
pnpm install --frozen-lockfile

# 2. Static Analysis
pnpm run lint

# 3. Type Checking
pnpm run typecheck

# 4. Monorepo Build (CJS/ESM compatibility check)
pnpm run build

# 5. Core Unit Tests & Fast Integration Tests
pnpm run test

# 6. E2E Browser Smoke Tests
pnpm run ui:install:browsers
pnpm run ui:test:e2e
```

## Troubleshooting Flakes

If a test fails randomly (flake), you must:

1. Identify if it's using an async network call (e.g. `AgentRegistryClient`).
2. Identify if an `afterEach` hook failed to call `server.stop()`.
3. Wrap assertions in retry mechanisms or use `vi.advanceTimersByTimeAsync()` correctly instead of `await new Promise(...)` delays in the unit tests.
