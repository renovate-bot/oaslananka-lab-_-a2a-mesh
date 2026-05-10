# Operations

Production deployments should configure:

- A durable registry storage backend when registry state must survive restarts.
- Explicit authentication for registry control-plane routes.
- Tenant-aware API key or bearer token metadata.
- Egress controls at both application and network layers.
- When enabling the Helm `networkPolicy`, keep DNS egress and add explicit registry/provider/webhook allow rules for the deployment environment.
- Rate limits for public discovery, task creation, task streaming, and registry mutation routes.
- Structured logs, audit events, metrics, and tracing.

Operational checks:

```bash
pnpm run release:state
pnpm run check:bundle
pnpm audit --audit-level high --prod
```

Container and Kubernetes deployment guidance lives in [deployment.md](./deployment.md) and [security/registry-hardening.md](./security/registry-hardening.md).
