# Registry Hardening

This document outlines the security hardening measures implemented in the `a2a-mesh` Registry.

## SSRF Prevention

The Registry must fetch health status from agents. Allowing users to register arbitrary URLs poses a Server-Side Request Forgery (SSRF) risk if those URLs point to internal infrastructure (e.g., `localhost`, `169.254.169.254`, `10.x.x.x`).

**Implementation:**
We use a specialized `validateSafeUrl` utility to parse incoming agent URLs during registration and before health checks:

1. Validates the protocol (`http:` or `https:`).
2. Parses the hostname.
3. If the hostname is an IP, checks against private/loopback/link-local ranges.
4. If it's a domain name, resolves it via DNS and verifies that none of the returned addresses are in a private range.
5. Fails closed when DNS resolution fails unless `allowUnresolvedHostnames` is explicitly enabled for development or an isolated private mesh.
6. Revalidates URLs before health checks so a stored registration cannot bypass the outbound-call policy.

_Note: For local development, loopback URLs can be enabled with `allowLocalhost: true`. Production deployments should keep `allowUnresolvedHostnames` disabled and use explicit network allowlists or private DNS controls for internal meshes._

## Origin and CORS

Production registry servers reject browser requests with unapproved `Origin` headers by default. Configure `allowedOrigins` for the operator UI or run the UI same-origin behind a reverse proxy. SSE endpoints use the same origin and authentication checks as the REST control-plane routes.

## Health Check Timeouts

Health check requests (`fetch`) are now wrapped with an `AbortController`. This prevents hanging requests from exhausting Registry resources if an agent stops responding but keeps the TCP connection open. The default timeout is 5 seconds.

## Authentication

The registry supports two authentication modes:

- `registrationToken` for simple service-token deployments.
- `auth` with `JwtAuthMiddleware` schemes for API-key, verified bearer JWT, or OIDC/JWKS deployments.

Public discovery can be exposed with `GET /agents?public=true`. Private catalog reads, registration, heartbeat, delete, SSE event streams, and task streams should require authenticated control-plane credentials.
