# Release State

`scripts/release-state.mjs` is a read-only release preflight helper.

It inspects:

- release-please manifest state
- release-please package configuration
- open release pull requests
- recent GitHub Releases
- draft release residue
- local tag count
- canonical repository identity

Example:

```bash
node scripts/release-state.mjs
```

The script prints `safe_to_publish`. A production publish workflow must stop when that value is `false`.
