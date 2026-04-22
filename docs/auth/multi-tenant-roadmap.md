# Multi-Tenant Roadmap

This document outlines the strategic future of multi-tenant environments within the `a2a-mesh` platform.

## Current State

- **Principal Awareness:** Tasks are bound to `principalId` and `tenantId` from verified JWT claims or API-key credential metadata.
- **Registry Namespacing:** Agents can be associated with a specific tenant namespace, allowing the Registry to hide private agents from other tenants while exposing `isPublic` agents.
- **Agent Call Authorization:** The `A2AServer` blocks access to another principal's tasks through JSON-RPC unauthorized errors and stream HTTP 403 responses.

## Next Steps

In future phases, the following aspects will be extended:

1. **API Keys per Tenant:** API-key credential metadata exists today; future work should add rotation, revocation, and hierarchical tenant-scoped key management.
2. **Billing and Quotas:** The existing RateLimiter middleware will be mapped per-tenant instead of merely globally per IP or API key.
3. **Admin/Service Roles:** Roles are normalized into request context today; future work should add explicit policy hooks for platform administrators to list tasks and agents across tenants.
