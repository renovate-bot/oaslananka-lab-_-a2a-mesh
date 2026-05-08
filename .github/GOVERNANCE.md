# Governance

## Roles

- **Maintainer**: @oaslananka — final decisions on direction, releases and security.
- **Contributor**: Anyone with a merged pull request.
- **Adapter Champion**: Responsible for the quality and roadmap of a specific adapter.

## Decision Making

Significant changes such as breaking API changes, new packages or architectural shifts should be proposed as an RFC in GitHub Discussions under Ideas.

- Consensus period: 7 days
- Final decision: maintainer

## Release Process

1. release-please derives release pull requests from Conventional Commits merged to `main`.
2. Contributors verify changes locally with `pnpm run lint`, `pnpm run typecheck`, `pnpm run build`, and `pnpm run test`.
3. Merging a release pull request creates the GitHub Release and CI-generated assets.
4. Optional external pipelines may be used for additional validation, docs packaging, or artifact preparation, but they are not required for open source contributions.
