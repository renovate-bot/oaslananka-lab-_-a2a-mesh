import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import type { AuthValidationResult, RequestContext } from '../types/auth.js';

export interface RequestWithContext extends Request {
  requestId?: string;
  a2aContext?: RequestContext;
  auth?: AuthValidationResult;
}

export function createAnonymousRequestContext(req: Request): RequestContext {
  const requestId =
    (req as RequestWithContext).requestId ?? req.header('x-request-id') ?? randomUUID();
  return {
    requestId,
    authMethod: 'anonymous',
    scopes: [],
    roles: [],
    claims: {},
  };
}

export function createAuthenticatedRequestContext(
  req: Request,
  auth: AuthValidationResult,
): RequestContext {
  const requestId =
    (req as RequestWithContext).requestId ?? req.header('x-request-id') ?? randomUUID();
  return {
    requestId,
    authMethod: auth.authMethod,
    schemeId: auth.schemeId,
    ...(auth.subject ? { subject: auth.subject } : {}),
    ...((auth.principalId ?? auth.subject)
      ? { principalId: auth.principalId ?? auth.subject }
      : {}),
    ...(auth.tenantId ? { tenantId: auth.tenantId } : {}),
    scopes: auth.scopes ?? [],
    roles: auth.roles ?? [],
    ...(auth.issuer ? { issuer: auth.issuer } : {}),
    ...(auth.audience ? { audience: auth.audience } : {}),
    claims: auth.claims ?? {},
  };
}

export function attachRequestContext(req: Request, context: RequestContext): void {
  const request = req as RequestWithContext;
  request.a2aContext = context;
  request.requestId = context.requestId;
}

export function getRequestContext(req: Request): RequestContext {
  return (req as RequestWithContext).a2aContext ?? createAnonymousRequestContext(req);
}
