# GitHub Failure Classifier

`scripts/classify-gh-failure.mjs` maps failed workflow text to a stable failure class.

It returns:

- `class`
- `root_cause`
- `recommended_fix`
- `auto_fix_allowed`
- `human_approval_required`
- `publish_must_stop`

Example:

```bash
node scripts/classify-gh-failure.mjs "actionlint failed on release.yml"
```

The classifier is intentionally conservative. Unknown failures stop publish paths until the exact logs, API metadata, and official documentation are inspected.
