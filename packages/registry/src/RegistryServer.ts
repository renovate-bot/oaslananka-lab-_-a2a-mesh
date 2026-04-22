/**
 * @file RegistryServer.ts
 * REST API for registering and discovering A2A agents.
 */

import { EventEmitter } from 'node:events';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { Server as HttpServer } from 'node:http';
import express, { type Express, type Request, type Response } from 'express';
import cors from 'cors';
import {
  attachRequestContext,
  createAnonymousRequestContext,
  logger,
  normalizeAgentCard,
  validateSafeUrl,
  fetchWithPolicy,
  getRequestContext,
  JwtAuthMiddleware,
  type AgentCard,
  type JwtAuthMiddlewareOptions,
  type RequestContext,
  type Task,
} from 'a2a-mesh';
import { InMemoryStorage } from './storage/InMemoryStorage.js';
import type { IAgentStorage, RegisteredAgent } from './storage/IAgentStorage.js';

export interface RegistryServerOptions {
  storage?: IAgentStorage;
  requireAuth?: boolean;
  registrationToken?: string;
  auth?: JwtAuthMiddlewareOptions;
  allowLocalhost?: boolean;
  allowPrivateNetworks?: boolean;
  allowUnresolvedHostnames?: boolean;
  allowedOrigins?: string[];
  requireOrigin?: boolean;
  bodyLimit?: string;
  taskPollingIntervalMs?: number;
  maxRecentTasks?: number;
  healthPollingIntervalMs?: number;
  healthCheckBatchSize?: number;
  taskPollingBatchSize?: number;
  healthCheckConcurrency?: number;
  taskPollingConcurrency?: number;
  healthyRecheckIntervalMs?: number;
  unhealthyRecheckIntervalMs?: number;
  unknownRecheckIntervalMs?: number;
  taskPollCooldownMs?: number;
}

/**
 * Registry service for agent registration, discovery, health, metrics, and live updates.
 *
 * @since 1.0.0
 */
export interface RegistryMetricsSummary {
  registrations: number;
  searches: number;
  heartbeats: number;
  agentCount: number;
  healthyAgents: number;
  unhealthyAgents: number;
  unknownAgents: number;
  activeTenants: number;
  publicAgents: number;
}

export interface RegistryTaskEvent {
  taskId: string;
  agentId: string;
  agentName: string;
  agentUrl: string;
  status: Task['status']['state'];
  updatedAt: string;
  contextId?: string;
  summary?: string;
  historyCount: number;
  artifactCount: number;
  task: Task;
}

export class RegistryServer {
  private readonly app: Express;
  private readonly store: IAgentStorage;
  private readonly events = new EventEmitter();
  private readonly taskEvents = new EventEmitter();
  private pingInterval: NodeJS.Timeout | null = null;
  private taskPollInterval: NodeJS.Timeout | null = null;
  private httpServer: HttpServer | undefined;
  private readonly sseClients = new Set<Response>();
  private readonly authMiddleware: JwtAuthMiddleware | undefined;
  private readonly options: RegistryServerOptions;
  private readonly recentTasks = new Map<string, RegistryTaskEvent>();
  private readonly taskVersions = new Map<string, string>();
  private healthCursor: string | null = null;
  private taskCursor: string | null = null;
  private readonly nextHealthCheckAt = new Map<string, number>();
  private readonly nextTaskPollAt = new Map<string, number>();
  private metrics = {
    registrations: 0,
    searches: 0,
    heartbeats: 0,
  };

  constructor(options: RegistryServerOptions = {}) {
    this.options = options;
    this.app = express();
    this.authMiddleware = options.auth ? new JwtAuthMiddleware(options.auth) : undefined;
    this.app.use(this.createCorsMiddleware());
    this.app.use(express.json({ limit: options.bodyLimit ?? '1mb' }));
    this.app.use((req, res, next) => {
      attachRequestContext(req, createAnonymousRequestContext(req));
      if (!this.isOriginAllowed(req)) {
        res.status(403).json({ error: 'Forbidden origin' });
        return;
      }
      next();
    });
    this.store = options.storage ?? new InMemoryStorage();

    this.setupRoutes();
  }

  private setupRoutes() {
    this.app.get('/health', async (_req, res) => {
      const agents = await this.store.summarize();
      res.json({
        status: 'ok',
        agents: agents.agentCount,
        healthyAgents: agents.healthyAgents,
      });
    });

    this.app.get('/metrics', async (_req, res) => {
      const summary = await this.getMetricsSummary();
      res.setHeader('Content-Type', 'text/plain; version=0.0.4');

      res.send(
        [
          '# HELP a2a_registry_registrations_total Total agent registrations.',
          '# TYPE a2a_registry_registrations_total counter',
          `a2a_registry_registrations_total ${summary.registrations}`,
          '# HELP a2a_registry_searches_total Total registry searches.',
          '# TYPE a2a_registry_searches_total counter',
          `a2a_registry_searches_total ${summary.searches}`,
          '# HELP a2a_registry_heartbeats_total Total registry heartbeats.',
          '# TYPE a2a_registry_heartbeats_total counter',
          `a2a_registry_heartbeats_total ${summary.heartbeats}`,
          '# HELP a2a_registry_agents Number of known agents.',
          '# TYPE a2a_registry_agents gauge',
          `a2a_registry_agents ${summary.agentCount}`,
          '# HELP a2a_registry_healthy_agents Number of healthy agents.',
          '# TYPE a2a_registry_healthy_agents gauge',
          `a2a_registry_healthy_agents ${summary.healthyAgents}`,
          '# HELP a2a_registry_active_tenants Number of unique tenants with registered agents.',
          '# TYPE a2a_registry_active_tenants gauge',
          `a2a_registry_active_tenants ${summary.activeTenants}`,
          '# HELP a2a_registry_public_agents Number of public agents.',
          '# TYPE a2a_registry_public_agents gauge',
          `a2a_registry_public_agents ${summary.publicAgents}`,
        ].join('\n'),
      );
    });

    this.app.get('/metrics/summary', async (_req, res) => {
      res.json(await this.getMetricsSummary());
    });

    this.app.get('/events', async (req: Request, res: Response) => {
      if (await this.rejectUnauthenticatedControlPlane(req, res)) {
        return;
      }
      this.configureSse(res);
      const listener = (payload: unknown) => {
        res.write(`event: registry_update\ndata: ${JSON.stringify(payload)}\n\n`);
      };
      this.events.on('registry_update', listener);
      res.on('close', () => {
        this.events.off('registry_update', listener);
      });
    });

    this.app.get('/agents/stream', async (req: Request, res: Response) => {
      if (await this.rejectUnauthenticatedControlPlane(req, res)) {
        return;
      }
      this.configureSse(res);

      const listener = (payload: unknown) => {
        const normalized = this.normalizeAgentStreamPayload(payload);
        if (!normalized) {
          return;
        }
        res.write(`data: ${JSON.stringify(normalized)}\n\n`);
      };

      this.events.on('registry_update', listener);
      res.on('close', () => {
        this.events.off('registry_update', listener);
      });
    });

    const registerAgent = async (req: Request, res: Response) => {
      const requestContext = await this.authenticateControlPlane(req, res);
      if (!requestContext) {
        return;
      }

      const body = req.body as {
        agentUrl?: string;
        agentCard?: AgentCard;
        tenantId?: string;
        isPublic?: boolean;
      };
      const { agentUrl, agentCard, tenantId, isPublic } = body;
      if (!agentUrl || !agentCard) {
        res.status(400).json({ error: 'Missing agentUrl or agentCard' });
        return;
      }

      try {
        await validateSafeUrl(agentUrl, {
          allowLocalhost: this.options.allowLocalhost ?? false,
          allowPrivateNetworks: this.options.allowPrivateNetworks ?? false,
          allowUnresolvedHostnames: this.options.allowUnresolvedHostnames ?? false,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(400).json({ error: `Invalid agentUrl: ${message}` });
        return;
      }

      const authTenantId = requestContext.tenantId;
      const finalTenantId = authTenantId ?? tenantId;

      const registered = await this.store.upsert(
        this.toRegisteredAgent(agentUrl, normalizeAgentCard(agentCard), finalTenantId, isPublic),
      );
      this.metrics.registrations += 1;
      this.emitRegistryEvent({ type: 'registered', agent: registered });
      logger.audit('register_agent', finalTenantId, `agent:${registered.id}`, 'success', {
        url: registered.url,
      });
      logger.info('Agent registered', {
        id: registered.id,
        url: registered.url,
        ...(finalTenantId ? { tenantId: finalTenantId } : {}),
      });
      res.status(201).json(registered);
    };
    this.app.post('/agents/register', registerAgent);
    this.app.post('/admin/agents/register', registerAgent);

    this.app.get('/agents', async (req, res) => {
      if (req.query.public === 'true') {
        const result = await this.store.list({
          isPublic: true,
          limit: Number.MAX_SAFE_INTEGER,
        });
        res.json(result.items);
        return;
      }

      const requestContext = await this.authenticateControlPlane(req, res);
      if (!requestContext) {
        return;
      }

      const result = await this.store.list({
        ...(requestContext.tenantId
          ? { tenantId: requestContext.tenantId, includePublic: true }
          : {}),
        limit: Number.MAX_SAFE_INTEGER,
      });
      res.json(
        this.shouldEnforceTenantIsolation(requestContext)
          ? this.filterAgentsByContext(result.items, requestContext)
          : result.items,
      );
    });

    this.app.get('/tasks/recent', async (req, res) => {
      if (await this.rejectUnauthenticatedControlPlane(req, res)) {
        return;
      }
      if (this.recentTasks.size === 0) {
        await this.refreshTaskSnapshots();
      }

      const limitParam = Number(req.query.limit);
      const limit =
        Number.isFinite(limitParam) && limitParam > 0
          ? limitParam
          : (this.options.maxRecentTasks ?? 50);

      res.json(this.getRecentTasks(limit));
    });

    this.app.get('/tasks/stream', async (req, res) => {
      if (await this.rejectUnauthenticatedControlPlane(req, res)) {
        return;
      }
      this.configureSse(res);

      for (const taskEvent of this.getRecentTasks(10)) {
        res.write(`data: ${JSON.stringify(taskEvent)}\n\n`);
      }

      const listener = (payload: RegistryTaskEvent) => {
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      };

      this.taskEvents.on('task_updated', listener);
      res.on('close', () => {
        this.taskEvents.off('task_updated', listener);
      });
    });

    this.app.get('/agents/search', async (req, res) => {
      const skill = typeof req.query.skill === 'string' ? req.query.skill : '';
      const tag = typeof req.query.tag === 'string' ? req.query.tag : '';
      const name = typeof req.query.name === 'string' ? req.query.name : '';
      const transport = req.query.transport as 'http' | 'sse' | 'ws' | 'grpc' | undefined;
      const status = req.query.status as 'healthy' | 'unhealthy' | 'unknown' | undefined;
      const mcpCompatible =
        req.query.mcpCompatible === 'true'
          ? true
          : req.query.mcpCompatible === 'false'
            ? false
            : undefined;

      if (!skill && !tag && !name && !transport && !status && mcpCompatible === undefined) {
        res.status(400).json({
          error:
            'At least one filter (skill, tag, name, transport, status, mcpCompatible) is required',
        });
        return;
      }

      this.metrics.searches += 1;
      const query = {
        ...(skill ? { skill } : {}),
        ...(tag ? { tag } : {}),
        ...(name ? { name } : {}),
        ...(transport ? { transport } : {}),
        ...(status ? { status } : {}),
        ...(mcpCompatible !== undefined ? { mcpCompatible } : {}),
        limit: Number.MAX_SAFE_INTEGER,
      } as const;

      if (req.query.public === 'true') {
        res.json((await this.store.list({ ...query, isPublic: true })).items);
        return;
      }

      const requestContext = await this.authenticateControlPlane(req, res);
      if (!requestContext) {
        return;
      }

      const matches = await this.store.list({
        ...query,
        ...(requestContext.tenantId
          ? { tenantId: requestContext.tenantId, includePublic: true }
          : {}),
      });
      res.json(
        this.shouldEnforceTenantIsolation(requestContext)
          ? this.filterAgentsByContext(matches.items, requestContext)
          : matches.items,
      );
    });

    this.app.get('/agents/:id', async (req, res) => {
      const agentId = req.params.id;
      if (!agentId) {
        res.status(400).json({ error: 'Missing agent id' });
        return;
      }

      const agent = await this.store.get(agentId);
      if (!agent) {
        res.status(404).json({ error: 'Agent not found' });
        return;
      }
      if (!agent.isPublic) {
        const requestContext = await this.authenticateControlPlane(req, res);
        if (!requestContext) {
          return;
        }
        if (!this.canAccessAgent(agent, requestContext)) {
          res.status(403).json({ error: 'Forbidden' });
          return;
        }
      }
      res.json(agent);
    });

    const heartbeatAgent = async (req: Request, res: Response) => {
      const agentId = req.params.id;
      if (!agentId) {
        res.status(400).json({ error: 'Missing agent id' });
        return;
      }

      const requestContext = await this.authenticateControlPlane(req, res);
      if (!requestContext) {
        return;
      }
      const agent = await this.store.get(agentId);
      if (!agent) {
        res.status(404).json({ error: 'Agent not found' });
        return;
      }
      if (!this.canAccessAgent(agent, requestContext)) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }

      const updated: RegisteredAgent = {
        ...agent,
        status: 'healthy',
        lastHeartbeatAt: new Date().toISOString(),
        consecutiveFailures: 0,
        lastSuccessAt: new Date().toISOString(),
      };
      await this.store.upsert(updated);
      this.nextHealthCheckAt.set(
        updated.id,
        Date.now() + (this.options.healthyRecheckIntervalMs ?? 30_000),
      );
      this.metrics.heartbeats += 1;
      this.emitRegistryEvent({ type: 'heartbeat', agent: updated });
      res.json(updated);
    };
    this.app.post('/agents/:id/heartbeat', heartbeatAgent);
    this.app.post('/admin/agents/:id/heartbeat', heartbeatAgent);

    const deleteAgent = async (req: Request, res: Response) => {
      const agentId = req.params.id;
      if (!agentId) {
        res.status(400).json({ error: 'Missing agent id' });
        return;
      }

      const requestContext = await this.authenticateControlPlane(req, res);
      if (!requestContext) {
        return;
      }

      const agent = await this.store.get(agentId);
      if (!agent) {
        res.status(404).json({ error: 'Agent not found' });
        return;
      }
      if (!this.canAccessAgent(agent, requestContext)) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      const deleted = await this.store.delete(agentId);
      if (!deleted) {
        res.status(404).json({ error: 'Agent not found' });
        return;
      }
      const tenantIdStr = requestContext.tenantId;
      logger.audit('delete_agent', tenantIdStr, `agent:${agentId}`, 'success');
      this.purgeAgentTaskState(agentId);
      this.emitRegistryEvent({ type: 'deleted', id: agentId });
      res.status(204).send();
    };
    this.app.delete('/agents/:id', deleteAgent);
    this.app.delete('/admin/agents/:id', deleteAgent);
  }

  private async executeHealthChecks(agents: RegisteredAgent[]) {
    const concurrencyLimit = this.options.healthCheckConcurrency ?? 5;
    for (let i = 0; i < agents.length; i += concurrencyLimit) {
      const chunk = agents.slice(i, i + concurrencyLimit);

      await Promise.all(
        chunk.map(async (agent) => {
          const jitterMs = Math.random() * 500;
          await new Promise((resolve) => setTimeout(resolve, jitterMs));

          try {
            let validatedUrl: URL;
            try {
              validatedUrl = await validateSafeUrl(this.buildAgentUrl(agent.url, '/health'), {
                allowLocalhost: this.options.allowLocalhost ?? false,
                allowPrivateNetworks: this.options.allowPrivateNetworks ?? false,
                allowUnresolvedHostnames: this.options.allowUnresolvedHostnames ?? false,
              });
            } catch (e: unknown) {
              throw new Error('Unsafe URL during health check', { cause: e });
            }

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);

            const res = await fetchWithPolicy(
              validatedUrl.toString(),
              { signal: controller.signal },
              { timeoutMs: 5000, retries: 0 },
            );
            clearTimeout(timeoutId);

            const status = res.ok ? 'healthy' : 'unhealthy';
            const consecutiveFailures = res.ok ? 0 : (agent.consecutiveFailures ?? 0) + 1;
            const lastSuccessAt = res.ok ? new Date().toISOString() : agent.lastSuccessAt;

            await this.store.updateStatus(agent.id, status, {
              consecutiveFailures,
              ...(lastSuccessAt ? { lastSuccessAt } : {}),
            });
            this.scheduleNextHealthCheck({
              ...agent,
              status,
              consecutiveFailures,
              ...(lastSuccessAt ? { lastSuccessAt } : {}),
            });
          } catch (error) {
            const consecutiveFailures = (agent.consecutiveFailures ?? 0) + 1;
            await this.store.updateStatus(agent.id, 'unhealthy', { consecutiveFailures });
            this.scheduleNextHealthCheck({
              ...agent,
              status: 'unhealthy',
              consecutiveFailures,
            });
            logger.warn('Agent unreachable', {
              agentId: agent.id,
              error: String(error),
              consecutiveFailures,
            });
          }
        }),
      );
    }
  }

  private startHealthChecks() {
    this.pingInterval = setInterval(async () => {
      try {
        const result = await this.store.list({
          cursor: this.healthCursor ?? undefined,
          limit: this.options.healthCheckBatchSize ?? 50,
        });
        this.healthCursor = result.nextCursor;
        await this.executeHealthChecks(
          result.items.filter((agent) => this.isHealthCheckDue(agent)),
        );
      } catch (err) {
        logger.error('Failed to run health checks', { error: String(err) });
      }
    }, this.options.healthPollingIntervalMs ?? 30_000);
  }

  private async refreshTaskSnapshots(): Promise<void> {
    const result = await this.store.list({
      cursor: this.taskCursor ?? undefined,
      limit: this.options.taskPollingBatchSize ?? 50,
    });
    this.taskCursor = result.nextCursor;
    const agents = result.items.filter((agent) => this.isTaskPollDue(agent));
    if (agents.length === 0) {
      return;
    }

    await this.executeTaskPolling(agents);
  }

  private async executeTaskPolling(agents: RegisteredAgent[]) {
    const concurrencyLimit = this.options.taskPollingConcurrency ?? 5;

    for (let index = 0; index < agents.length; index += concurrencyLimit) {
      const chunk = agents.slice(index, index + concurrencyLimit);
      await Promise.all(chunk.map(async (agent) => this.pollAgentTasks(agent)));
    }
  }

  private async pollAgentTasks(agent: RegisteredAgent): Promise<void> {
    try {
      const validatedUrl = await validateSafeUrl(this.buildAgentUrl(agent.url, '/tasks?limit=20'), {
        allowLocalhost: this.options.allowLocalhost ?? false,
        allowPrivateNetworks: this.options.allowPrivateNetworks ?? false,
        allowUnresolvedHostnames: this.options.allowUnresolvedHostnames ?? false,
      });
      const response = await fetchWithPolicy(validatedUrl.toString(), undefined, {
        timeoutMs: 5_000,
        retries: 0,
      });

      if (!response.ok) {
        return;
      }

      const tasks = (await response.json()) as Task[];
      for (const task of tasks) {
        const taskEvent = this.toTaskEvent(agent, task);
        const version = this.buildTaskVersion(taskEvent);
        const key = `${agent.id}:${task.id}`;

        if (this.taskVersions.get(key) === version) {
          continue;
        }

        this.taskVersions.set(key, version);
        this.recentTasks.set(key, taskEvent);
        this.trimRecentTasks();
        this.taskEvents.emit('task_updated', taskEvent);
      }
      this.scheduleNextTaskPoll(agent);
    } catch (error) {
      this.scheduleNextTaskPoll(agent);
      logger.debug('Skipping task poll for agent', {
        agentId: agent.id,
        error: String(error),
      });
    }
  }

  private startTaskPolling(): void {
    const intervalMs = this.options.taskPollingIntervalMs ?? 5_000;
    this.taskPollInterval = setInterval(() => {
      void this.refreshTaskSnapshots().catch((error: unknown) => {
        logger.warn('Failed to refresh registry task snapshots', {
          error: String(error),
        });
      });
    }, intervalMs);
  }

  private isHealthCheckDue(agent: RegisteredAgent): boolean {
    return (this.nextHealthCheckAt.get(agent.id) ?? 0) <= Date.now();
  }

  private scheduleNextHealthCheck(agent: RegisteredAgent): void {
    const intervalMs =
      agent.status === 'healthy'
        ? (this.options.healthyRecheckIntervalMs ?? 30_000)
        : agent.status === 'unhealthy'
          ? (this.options.unhealthyRecheckIntervalMs ?? 60_000)
          : (this.options.unknownRecheckIntervalMs ?? 15_000);
    this.nextHealthCheckAt.set(agent.id, Date.now() + intervalMs);
  }

  private isTaskPollDue(agent: RegisteredAgent): boolean {
    return (this.nextTaskPollAt.get(agent.id) ?? 0) <= Date.now();
  }

  private scheduleNextTaskPoll(agent: RegisteredAgent): void {
    const baseIntervalMs = this.options.taskPollCooldownMs ?? 5_000;
    const multiplier = agent.status === 'unhealthy' ? 3 : 1;
    this.nextTaskPollAt.set(agent.id, Date.now() + baseIntervalMs * multiplier);
  }

  public start(port: number) {
    this.startHealthChecks();
    this.startTaskPolling();
    void this.refreshTaskSnapshots();
    this.httpServer = this.app.listen(port, () => {
      logger.info('Registry Server listening', { port });
    });
    return this.httpServer;
  }

  public async stop(): Promise<void> {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.taskPollInterval) {
      clearInterval(this.taskPollInterval);
      this.taskPollInterval = null;
    }
    for (const client of this.sseClients) {
      try {
        client.end();
      } catch {
        /* ignore */
      }
    }
    this.sseClients.clear();
    if (this.httpServer) {
      await new Promise<void>((resolve, reject) => {
        this.httpServer?.close((error?: Error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }).catch((error: unknown) => {
        if (!(error instanceof Error) || !error.message.includes('Server is not running')) {
          throw error;
        }
      });
      this.httpServer = undefined;
    }
  }

  private createCorsMiddleware() {
    return cors({
      origin: (origin, callback) => {
        callback(null, origin ? this.isOriginValueAllowed(origin) : true);
      },
    });
  }

  private isOriginAllowed(req: Request): boolean {
    const origin = req.header('origin');
    if (!origin) {
      return !this.options.requireOrigin;
    }

    return this.isOriginValueAllowed(origin);
  }

  private isOriginValueAllowed(origin: string): boolean {
    const allowedOrigins = this.options.allowedOrigins ?? [];
    if (allowedOrigins.length === 0) {
      return process.env.NODE_ENV !== 'production';
    }

    return allowedOrigins.includes(origin);
  }

  private async rejectUnauthenticatedControlPlane(req: Request, res: Response): Promise<boolean> {
    return (await this.authenticateControlPlane(req, res)) === null;
  }

  private async authenticateControlPlane(
    req: Request,
    res: Response,
  ): Promise<RequestContext | null> {
    if (this.authMiddleware) {
      try {
        return await this.authMiddleware.authenticateRequestContext(req);
      } catch (error: unknown) {
        res.status(401).json({ error: 'Unauthorized', reason: String(error) });
        return null;
      }
    }

    if (this.options.registrationToken) {
      const authHeader = req.headers.authorization;
      const expected = `Bearer ${this.options.registrationToken}`;
      if (!authHeader || !this.safeStringEquals(authHeader, expected)) {
        res.status(401).json({ error: 'Unauthorized' });
        return null;
      }

      const body = req.body as { tenantId?: unknown } | undefined;
      const tenantId =
        req.header('x-tenant-id') ??
        (typeof body?.tenantId === 'string' ? body.tenantId : undefined);
      const principalId = req.header('x-principal-id') ?? 'registry-token';
      const context: RequestContext = {
        requestId: getRequestContext(req).requestId,
        authMethod: 'bearer',
        schemeId: 'registry-token',
        subject: principalId,
        principalId,
        ...(tenantId ? { tenantId } : {}),
        scopes: ['registry:admin'],
        roles: ['registry-admin'],
        claims: {},
      };
      attachRequestContext(req, context);
      return context;
    }

    if (this.options.requireAuth) {
      res.status(401).json({ error: 'Unauthorized' });
      return null;
    }

    return getRequestContext(req);
  }

  private filterAgentsByContext(
    agents: RegisteredAgent[],
    context: RequestContext,
  ): RegisteredAgent[] {
    if (!this.shouldEnforceTenantIsolation(context)) {
      return agents;
    }

    return agents.filter((agent) => this.canAccessAgent(agent, context));
  }

  private canAccessAgent(agent: RegisteredAgent, context: RequestContext): boolean {
    if (agent.isPublic) {
      return true;
    }
    if (!this.shouldEnforceTenantIsolation(context)) {
      return true;
    }
    if (!agent.tenantId) {
      return true;
    }

    return agent.tenantId === context.tenantId;
  }

  private shouldEnforceTenantIsolation(context: RequestContext): boolean {
    return (
      Boolean(this.authMiddleware) ||
      Boolean(this.options.registrationToken) ||
      this.options.requireAuth === true ||
      context.authMethod !== 'anonymous'
    );
  }

  private safeStringEquals(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    if (leftBuffer.length !== rightBuffer.length) {
      return false;
    }
    return timingSafeEqual(leftBuffer, rightBuffer);
  }

  private emitRegistryEvent(payload: unknown): void {
    this.events.emit('registry_update', payload);
  }

  private configureSse(res: Response): void {
    this.sseClients.add(res);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.on('close', () => {
      this.sseClients.delete(res);
    });
  }

  private normalizeAgentStreamPayload(
    payload: unknown,
  ): RegisteredAgent | { id: string; deleted: true } | null {
    if (
      payload &&
      typeof payload === 'object' &&
      'type' in payload &&
      typeof payload.type === 'string'
    ) {
      if ((payload.type === 'registered' || payload.type === 'heartbeat') && 'agent' in payload) {
        return payload.agent as RegisteredAgent;
      }

      if (payload.type === 'deleted' && 'id' in payload && typeof payload.id === 'string') {
        return { id: payload.id, deleted: true };
      }
    }

    return null;
  }

  private getRecentTasks(limit: number): RegistryTaskEvent[] {
    return [...this.recentTasks.values()]
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
      .slice(0, limit);
  }

  private trimRecentTasks(): void {
    const maxRecentTasks = this.options.maxRecentTasks ?? 50;
    const recentEntries = [...this.recentTasks.entries()].sort(
      (left, right) => Date.parse(right[1].updatedAt) - Date.parse(left[1].updatedAt),
    );

    for (const [key] of recentEntries.slice(maxRecentTasks)) {
      this.recentTasks.delete(key);
      this.taskVersions.delete(key);
    }
  }

  private buildTaskVersion(taskEvent: RegistryTaskEvent): string {
    return JSON.stringify({
      status: taskEvent.status,
      updatedAt: taskEvent.updatedAt,
      historyCount: taskEvent.historyCount,
      artifactCount: taskEvent.artifactCount,
      summary: taskEvent.summary,
    });
  }

  private toTaskEvent(agent: RegisteredAgent, task: Task): RegistryTaskEvent {
    const summary = this.extractTaskSummary(task);

    return {
      taskId: task.id,
      agentId: agent.id,
      agentName: agent.card.name,
      agentUrl: agent.url,
      status: task.status.state,
      updatedAt: task.status.timestamp,
      ...(task.contextId ? { contextId: task.contextId } : {}),
      ...(summary ? { summary } : {}),
      historyCount: task.history.length,
      artifactCount: task.artifacts?.length ?? 0,
      task,
    };
  }

  private extractTaskSummary(task: Task): string | undefined {
    const artifactText = task.artifacts
      ?.flatMap((artifact) => artifact.parts)
      .find((part) => part.type === 'text');

    if (artifactText?.type === 'text') {
      return artifactText.text.slice(0, 180);
    }

    const latestHistory = [...task.history]
      .reverse()
      .find((message) => message.parts.some((part) => part.type === 'text'));
    const latestText = latestHistory?.parts.find((part) => part.type === 'text');

    return latestText?.type === 'text' ? latestText.text.slice(0, 180) : undefined;
  }

  private purgeAgentTaskState(agentId: string): void {
    this.nextHealthCheckAt.delete(agentId);
    this.nextTaskPollAt.delete(agentId);
    for (const key of [...this.recentTasks.keys()]) {
      if (key.startsWith(`${agentId}:`)) {
        this.recentTasks.delete(key);
        this.taskVersions.delete(key);
      }
    }
  }

  private async getMetricsSummary(): Promise<RegistryMetricsSummary> {
    const agents = await this.store.summarize();

    return {
      registrations: this.metrics.registrations,
      searches: this.metrics.searches,
      heartbeats: this.metrics.heartbeats,
      agentCount: agents.agentCount,
      healthyAgents: agents.healthyAgents,
      unhealthyAgents: agents.unhealthyAgents,
      unknownAgents: agents.unknownAgents,
      activeTenants: agents.activeTenants,
      publicAgents: agents.publicAgents,
    };
  }

  private toRegisteredAgent(
    agentUrl: string,
    card: AgentCard,
    tenantId?: string,
    isPublic?: boolean,
  ): RegisteredAgent {
    const tags = (card.skills ?? []).flatMap((skill) => skill.tags ?? []);
    const skills = (card.skills ?? []).map((skill) => skill.name);
    return {
      id: randomUUID(),
      url: agentUrl,
      card,
      status: 'unknown',
      tags,
      skills,
      registeredAt: new Date().toISOString(),
      ...(tenantId ? { tenantId } : {}),
      ...(typeof isPublic === 'boolean' ? { isPublic } : {}),
    };
  }

  private buildAgentUrl(baseUrl: string, path: string): string {
    return new URL(path, baseUrl).toString();
  }
}
