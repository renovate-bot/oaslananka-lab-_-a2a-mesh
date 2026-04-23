# Contributing Guide

## Branching

- `feature/*` for new work
- `fix/*` for bug fixes
- `main` as the release branch

## Required checks

Every contribution should pass:

```bash
npm ci
npm run ui:install:browsers
npm run check
```

Git hooks are intentionally layered:

- `pre-commit`: only staged formatting and staged linting
- `pre-push`: `npm run check:pre-push`

## Tests

- Add unit tests for new public APIs.
- Add integration tests for protocol flows, auth, registry interactions, or CLI changes when behavior crosses package boundaries.
- Keep coverage thresholds aligned with `vitest.config.ts`.

## Documentation

Update docs whenever a user-facing workflow, command, adapter behavior, auth model, or release process changes.

## Releases

- Use Changesets for package changes.
- Maintainers cut releases manually after the local verification suite passes.
- Public docs can be deployed from `docs-site` with Vercel, Netlify, or any static host.
- Contributors do not need CI/CD access to submit changes successfully.
