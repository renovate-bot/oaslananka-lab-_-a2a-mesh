# Review Thread Gate

The review-thread gate checks unresolved pull request review threads before merge.

It uses GitHub GraphQL `PullRequest.reviewThreads(first: 100)`, ignores resolved and outdated threads, ignores informational bot comments, and blocks actionable unresolved human or automated review threads.

The workflow writes `review-thread-summary.json` as an artifact and appends a short Markdown summary to the workflow run.

Local diagnostic usage:

```bash
GITHUB_REPOSITORY=oaslananka-lab/a2a-mesh PR_NUMBER=123 GITHUB_TOKEN=... node scripts/check-review-threads.mjs
```

Do not put token values in shell history, logs, pull requests, or issue comments.
