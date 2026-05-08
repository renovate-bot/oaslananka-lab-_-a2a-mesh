# Changelog Policy

## Versioning model

The repository uses release-please manifest mode for package versioning and changelog generation.

## Semantic intent

- `feat:` maps to a minor release
- `fix:` maps to a patch release
- `feat!:` or `BREAKING CHANGE:` maps to a major release
- `chore:`, `docs:`, and `test:` normally do not require a release on their own

## Linked packages

These packages are linked for coordinated releases:

- `a2a-mesh`
- `a2a-mesh-adapters`
- `a2a-mesh-registry`
- `a2a-mesh-cli`

## Author workflow

```bash
pnpm run release:dry-run
```

Use Conventional Commits so release-please can derive SemVer changes from merged history.

## Release workflow

- Release pull requests apply version and changelog updates.
- GitHub Actions builds release assets, SBOM, checksums, and provenance after a release is created.
- The root `CHANGELOG.md` remains the canonical public release log.
