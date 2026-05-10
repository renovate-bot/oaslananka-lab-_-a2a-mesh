# Release

Releases are managed by release-please manifest mode.

Normal release flow:

1. Conventional Commits land on `main`.
2. release-please opens or updates the release pull request.
3. Merging the release pull request creates GitHub Releases for changed manifest packages.
4. Release assets, SBOM, checksums, and provenance are generated in GitHub Actions.

Local release preflight:

```bash
pnpm run release:dry-run
pnpm run release:state
```

Manual version inputs, manual tags, and local production publishing are not part of the supported release path.

The organization repository `oaslananka-lab/a2a-mesh` is the canonical release authority. The personal repository is a showcase mirror.
