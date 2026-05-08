# Contributing

Thanks for helping improve `a2a-mesh`.

## Local workflow

1. Use Node `24.14.1` and pnpm `11.0.8` by default (`.node-version`, `.nvmrc`, and `packageManager` are the source of truth).
2. Install dependencies with `pnpm install --frozen-lockfile`.
3. Run `pnpm run check:pre-push` while iterating.
4. Run `pnpm run ui:install:browsers` once per machine before the full UI smoke path.
5. Run `pnpm run check` before opening a PR.

## Pull requests

1. Open PRs against `main` on the public collaboration surface in use.
2. Add tests for every public behavior change.
3. Add or update docs when user-facing behavior changes.
4. Use Conventional Commit messages so release-please can derive versions.
5. Keep PRs focused and release-note friendly.

## CI and releases

Local git hooks are intentionally tiered:

- `pre-commit`: staged formatting + staged lint only
- `pre-push`: `pnpm run check:pre-push`

To verify your change before submitting a PR, run the full check suite:

```bash
pnpm install --frozen-lockfile
pnpm run ui:install:browsers
pnpm run check
```

Releases are cut by release-please manifest mode after changes merge to `main`.
Version numbers are derived from Conventional Commit history and the
`.release-please-manifest.json` state.

Maintainers can validate the release configuration with:

```bash
pnpm run release:dry-run
```

Detailed contributor guidance lives in [docs/contributing.md](./docs/contributing.md).
