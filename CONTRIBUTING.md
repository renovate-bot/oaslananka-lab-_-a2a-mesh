# Contributing

Thanks for helping improve `a2a-mesh`.

## Local workflow

1. Use Node `22.22.2` and npm `10.9.8` by default (`.node-version`, `.nvmrc`, and `packageManager` are the source of truth).
2. Install dependencies with `npm ci`.
3. Run `npm run check:pre-push` while iterating.
4. Run `npm run ui:install:browsers` once per machine before the full UI smoke path.
5. Run `npm run check` before opening a PR or cutting a release candidate.

## Pull requests

1. Open PRs against `main` on the public collaboration surface in use.
2. Add tests for every public behavior change.
3. Add or update docs when user-facing behavior changes.
4. Add a changeset for public package changes.
5. Keep PRs focused and release-note friendly.

## CI and releases

Local git hooks are intentionally tiered:

- `pre-commit`: staged formatting + staged lint only
- `pre-push`: `npm run check:pre-push`

To verify your change before submitting a PR, run the full check suite:

```bash
npm ci
npm run ui:install:browsers
npm run check
```

Releases are cut by the maintainer using [Changesets](https://github.com/changesets/changesets).
Add a changeset for any public package change with `npx changeset`.

Maintainers should version packages with:

```bash
npx changeset version
```

Then publish the stable npm package set with:

```bash
npm run release:stable
```

Use `npm run release:all` only when you intentionally want to publish additional
public workspaces beyond the stable package set.
CI release jobs use Doppler for publishing secrets. The CI platform should only
receive `DOPPLER_TOKEN`, `DOPPLER_PROJECT`, and `DOPPLER_CONFIG`; `NPM_TOKEN`
is read from Doppler at runtime.
You do not need CI/CD access to contribute — local test pass is sufficient.

## AI-assisted contributions

AI-assisted contributions are welcome, but contributors remain responsible for correctness,
security, licensing, and test coverage.

If you use tools such as Codex or Gemini while preparing a contribution, review the output
carefully and treat it as draft material that still needs human verification.

Detailed contributor guidance lives in [docs/contributing.md](./docs/contributing.md).
