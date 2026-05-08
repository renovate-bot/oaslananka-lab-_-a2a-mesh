# Deployment

## Docker

Recommended container flow:

1. Install dependencies with `pnpm install --frozen-lockfile`.
2. Build the monorepo with `pnpm run build`.
3. Start the required package or app using the generated `dist` entrypoint.

For local orchestration, `docker-compose.yml` provides the quickest path for demo services.

## Cloud Run

Cloud Run works best for stateless HTTP/SSE agents.

- Expose the A2A HTTP endpoint on the service port expected by Cloud Run.
- Ensure push notification targets are publicly reachable or routed through a gateway.
- Keep secrets in Secret Manager or the platform equivalent instead of baking them into images.

## Kubernetes

Recommended split:

- Deploy each agent as its own deployment and service.
- Deploy the registry separately so it can scale independently.
- Wire liveness and readiness probes to `/health`.
- Scrape the registry `/metrics` endpoint for fleet visibility.
- Use ConfigMaps and Secrets for auth and adapter configuration.

## Release workflow

The personal GitHub repository (`oaslananka/a2a-mesh`) is the source
repository. The organization repository (`oaslananka-lab/a2a-mesh`) is the
CI/CD mirror where GitHub Actions run. The organization mirror syncs from the
personal `main` branch on schedule or manual dispatch, opens a sync pull
request when the repositories diverge, and runs the required checks before the
mirror is updated.

Release jobs run in the organization repository and pull publish credentials
from Doppler at runtime instead of storing the final publishing tokens in each
CI platform. Azure DevOps and GitLab remain manual fallback targets.

Required bootstrap variables for manual release jobs:

- `DOPPLER_TOKEN`
- `DOPPLER_PROJECT`
- `DOPPLER_CONFIG`

Required Doppler secret for npm publishing:

- `NPM_TOKEN`

### Package release

Use release-please to prepare versions:

```bash
pnpm run release:dry-run
pnpm run build
pnpm run test
```

In CI, release-please creates GitHub releases after release pull requests merge.
Manual Azure and GitLab publish jobs remain fallback paths; they install the
Doppler CLI, verify required secrets without printing their values, and publish
with `scripts/ci/publish-with-doppler.sh`.

### Docs deployment

For Vercel:

```bash
cd docs-site
pnpm install
pnpm run build
vercel
vercel --prod
```

For Netlify:

```bash
cd docs-site
pnpm install
pnpm run build
netlify deploy --dir .vitepress/dist --prod
```

For Railway or another container host, build the docs statically and serve `.vitepress/dist`
behind any CDN or static file service.
