/**
 * @file auth.ts
 * Authentication and authorization related types.
 */

export interface BaseAuthScheme {
  id: string;
  description?: string;
}

export interface ApiKeyAuthScheme extends BaseAuthScheme {
  type: 'apiKey';
  in: 'header' | 'query';
  name: string;
}

export interface HttpAuthScheme extends BaseAuthScheme {
  type: 'http';
  scheme: 'bearer';
  bearerFormat?: string;
  /**
   * JWKS endpoint used to verify bearer JWTs for plain HTTP bearer schemes.
   * Bearer tokens are never decoded without signature verification.
   */
  jwksUri?: string;
  audience?: string | string[];
  issuer?: string;
  algorithms?: string[];
}

export interface OpenIdConnectAuthScheme extends BaseAuthScheme {
  type: 'openIdConnect';
  openIdConnectUrl: string;
  audience?: string | string[];
  issuer?: string;
  jwksUri?: string;
  algorithms?: string[];
}

export type AuthScheme = ApiKeyAuthScheme | HttpAuthScheme | OpenIdConnectAuthScheme;

export interface ApiKeyCredential {
  value: string;
  principalId?: string;
  tenantId?: string;
  scopes?: string[];
  roles?: string[];
  claims?: Record<string, unknown>;
}

export interface ApiKeyCredentialSource {
  [schemeId: string]: string | string[] | ApiKeyCredential | ApiKeyCredential[];
}

export interface AuthValidationResult {
  schemeId: string;
  authMethod: 'apiKey' | 'bearer' | 'oidc';
  subject?: string;
  principalId?: string;
  tenantId?: string;
  scopes?: string[];
  roles?: string[];
  issuer?: string;
  audience?: string | string[];
  claims?: Record<string, unknown>;
}

export interface RequestIdempotencyContext {
  key: string;
  scope: string;
  fingerprint: string;
  replayed: boolean;
}

export interface RequestContext {
  requestId: string;
  authMethod: 'anonymous' | 'apiKey' | 'bearer' | 'oidc';
  schemeId?: string;
  subject?: string;
  principalId?: string;
  tenantId?: string;
  scopes: string[];
  roles: string[];
  issuer?: string;
  audience?: string | string[];
  claims: Record<string, unknown>;
  idempotency?: RequestIdempotencyContext;
}
