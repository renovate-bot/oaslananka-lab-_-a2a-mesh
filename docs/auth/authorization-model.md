# Authorization Model

This document explains how `a2a-mesh` applies tenant isolation and principal ownership validation when authentication is configured.

## Concepts

- **Principal ID:** Typically the user ID or service account ID of the caller initiating a task.
- **Tenant ID:** Represents an isolated organizational boundary or workspace.

## Task Ownership

When `a2a-mesh` runs with the `JwtAuthMiddleware` configured, successful authentication creates a typed request context. JWTs are verified before claims are read; API keys can also carry explicit credential metadata.

The context can include:

- `principalId` from API-key metadata, `principalId`, `sub`, `client_id`, or `azp`
- `tenantId` from API-key metadata, `tenantId`, `tenant_id`, or `org_id`
- `scopes` from API-key metadata, `scope`, `scp`, or `scopes`
- `roles` from API-key metadata, `role`, or `roles`

- During `message/send`, the newly created Task records the `principalId` and `tenantId`.
- Future requests to `tasks/get`, `tasks/list`, `tasks/cancel`, or `/stream` will **block** access if the caller's request context does not match the task's recorded ownership.

## Registry Isolation

The Registry Server also supports tenant isolation.

- Agents registered while authenticated inherit the `tenantId` of the registrar unless an explicitly authorized service policy sets one.
- Optionally, agents can be marked as `isPublic: true`.
- When searching or listing agents via the Registry API, authenticated users will only see:
  - Public agents (`isPublic: true`)
  - Agents with no tenant bound (Global / Legacy)
  - Agents belonging to their own `tenantId`

Production deployments should enable registry auth and origin policy together. Public discovery can be exposed with `?public=true`; administrative registration, heartbeat, delete, and private catalog routes should be called with authenticated service credentials.
