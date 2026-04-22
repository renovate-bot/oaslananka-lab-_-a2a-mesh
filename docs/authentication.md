# Authentication

## Supported schemes

`a2a-mesh` supports the following `AgentCard.securitySchemes`:

- `apiKey`
- `http` bearer
- `openIdConnect`

## API keys

API keys can be validated from either headers or query parameters. Prefer headers for anything beyond local tooling. A key can be a plain string or a credential object that binds the request to a principal, tenant, scopes, and roles.

```ts
const server = new MyServer(card, {
  auth: {
    securitySchemes: [{ type: 'apiKey', id: 'api-key', in: 'header', name: 'x-api-key' }],
    apiKeys: {
      'api-key': [
        {
          value: 'dev-secret',
          principalId: 'svc-demo',
          tenantId: 'tenant-demo',
          scopes: ['tasks:write'],
          roles: ['agent'],
        },
      ],
    },
  },
});
```

## Bearer tokens

HTTP bearer schemes verify JWTs before any claims are trusted. Bearer auth requires a `jwksUri`; decode-only bearer tokens are rejected.

```ts
const server = new MyServer(card, {
  auth: {
    securitySchemes: [
      {
        type: 'http',
        id: 'bearer',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        jwksUri: 'https://issuer.example/.well-known/jwks.json',
        issuer: 'https://issuer.example/',
        audience: 'a2a-mesh',
      },
    ],
  },
});
```

Verified JWT claims are normalized into a typed request context:

- `principalId`: `principalId`, `sub`, `client_id`, or `azp`; tokens without a principal claim are rejected
- `tenantId`: `tenantId`, `tenant_id`, or `org_id`
- `scopes`: `scope`, `scp`, or `scopes`
- `roles`: `role` or `roles`

## OIDC

OIDC support uses discovery and JWKS resolution.

- Discovery starts from `openIdConnectUrl`.
- `jwks_uri` is taken from discovery unless overridden.
- Accepted algorithms default to `RS256` and `ES256`.
- Audience and issuer validation are enforced when configured.

## Protected endpoint

`agent/authenticatedExtendedCard` is protected when auth middleware is configured and the card declares `capabilities.extendedAgentCard`.

## Registry and client notes

- Use `a2a-mesh` client interceptors to attach and refresh auth headers.
- Prefer short-lived bearer tokens in production.
- Configure issuer and audience checks for every production bearer or OIDC scheme.
- Avoid query-parameter API keys except for tightly controlled internal tooling.
