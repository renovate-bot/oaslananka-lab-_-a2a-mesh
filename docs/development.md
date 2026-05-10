# Development

Use the repository toolchain versions as the source of truth:

- Node.js `24.14.1` by default, with Node.js `22.22.2` retained as the supported LTS compatibility gate.
- pnpm `11.0.8`.

Bootstrap:

```bash
corepack enable
pnpm install --frozen-lockfile
```

Common local gates:

```bash
pnpm run format:check
pnpm run lint
pnpm run lint:md
pnpm run typecheck
pnpm run test:coverage
pnpm run test:integration
pnpm run check
```

The root package remains private. Public package publishing is scoped to the release-please manifest packages.
