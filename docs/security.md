# Security

Security-sensitive areas include:

- Agent card and webhook outbound fetches.
- Registry registration, heartbeat, search, and health checks.
- JSON-RPC authentication and tenant-aware task access.
- Push notification delivery.
- Release and publish workflows.

Local security checks:

```bash
pnpm audit --audit-level high --prod
gitleaks detect --source . --config .gitleaks.toml --redact --verbose
```

Registry hardening details:

- [Registry hardening](./security/registry-hardening.md)
- [Security configuration](./security/configuration.md)
- [Authentication](./authentication.md)

Do not commit or expose secret values in repository files, logs, issues, pull requests, release notes, workflow summaries, or build artifacts. Local untracked `.env` files are allowed for development.
