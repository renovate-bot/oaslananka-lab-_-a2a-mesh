/**
 * @file A2AServer.ts
 * Express/Fastify adapter serving agent.json + RPC endpoints.
 */

import { randomUUID } from 'node:crypto';
import type { Server as HttpServer } from 'node:http';
import express, {
  type ErrorRequestHandler,
  type Express,
  type Request,
  type Response,
} from 'express';
import { InMemoryTaskStorage } from '../storage/InMemoryTaskStorage.js';
import type { ITaskStorage } from '../storage/ITaskStorage.js';
import type { AgentCard, AnyAgentCard } from '../types/agent-card.js';
import type { A2AExtension } from '../types/extensions.js';
import { TaskManager } from './TaskManager.js';
import { SSEStreamer } from './SSEStreamer.js';
import type { JsonRpcRequest, JsonRpcResponse } from '../types/jsonrpc.js';
import { JsonRpcError, ErrorCodes } from '../types/jsonrpc.js';
import {
  type A2AHealthResponse,
  type Artifact,
  type ExtensibleArtifact,
  type Message,
  type MessageSendParams,
  type Task,
} from '../types/task.js';
import {
  validateMessageSendParams,
  validateTaskListParams,
  validateRequest,
  JsonRpcRequestSchema,
} from '../utils/schema-validator.js';
import { logger } from '../utils/logger.js';
import { PushNotificationService } from './PushNotificationService.js';
import { getDocsUrl } from '../config/docs.js';
import {
  createRateLimiter,
  type RateLimitConfig,
  type RateLimitStore,
} from '../middleware/rateLimiter.js';
import { JwtAuthMiddleware, type JwtAuthMiddlewareOptions } from '../auth/JwtAuthMiddleware.js';
import {
  attachRequestContext,
  createAnonymousRequestContext,
  getRequestContext,
} from '../auth/requestContext.js';
import { a2aMeshTracer, SpanStatusCode } from '../telemetry/tracer.js';
import { RuntimeMetrics } from '../telemetry/RuntimeMetrics.js';
import { validateSafeUrl } from '../security/url.js';
import type { RequestContext } from '../types/auth.js';
import {
  buildIdempotencyFingerprint,
  InMemoryIdempotencyStore,
  type IdempotencyStoredResult,
  type IdempotencyStore,
} from './IdempotencyStore.js';
import { TaskLifecycleError } from './TaskManager.js';
import type { TaskUpdatedEvent } from './TaskManager.js';

export interface A2AServerOptions {
  rateLimit?: Partial<RateLimitConfig>;
  rateLimitStore?: RateLimitStore;
  auth?: JwtAuthMiddlewareOptions;
  taskStorage?: ITaskStorage;
  allowLocalhost?: boolean;
  allowPrivateNetworks?: boolean;
  allowUnresolvedHostnames?: boolean;
  allowedOrigins?: string[];
  requireOrigin?: boolean;
  bodyLimit?: string;
  idempotencyStore?: IdempotencyStore;
  idempotencyTtlMs?: number;
}

interface RpcContext {
  req: Request;
  requestContext: RequestContext;
}

interface RequestWithRequestId extends Request {
  requestId?: string;
}

interface IdempotencyResolution {
  scope: string;
  key: string;
  fingerprint: string;
  replay?: IdempotencyStoredResult;
}

export abstract class A2AServer {
  protected app: Express;
  protected agentCard: AgentCard;
  protected taskManager: TaskManager;
  protected streamer: SSEStreamer;
  protected pushNotificationService: PushNotificationService;
  protected authMiddleware: JwtAuthMiddleware | undefined;
  private httpServer: HttpServer | undefined;
  private readonly startedAt = Date.now();
  private readonly runtimeMetrics: RuntimeMetrics;
  private readonly idempotencyStore: IdempotencyStore;

  constructor(
    agentCard: AgentCard,
    private readonly options: A2AServerOptions = {},
  ) {
    this.app = express();
    this.app.use(express.json({ limit: options.bodyLimit ?? '1mb' }));
    this.app.use(this.jsonParseErrorHandler());
    this.agentCard = agentCard;
    this.taskManager = new TaskManager(options.taskStorage ?? new InMemoryTaskStorage());
    this.streamer = new SSEStreamer();
    this.pushNotificationService = new PushNotificationService();
    this.authMiddleware = options.auth ? new JwtAuthMiddleware(options.auth) : undefined;
    this.runtimeMetrics = new RuntimeMetrics({
      serviceName: agentCard.name,
      serviceVersion: agentCard.version,
    });
    this.idempotencyStore = options.idempotencyStore ?? new InMemoryIdempotencyStore();

    this.setupMiddleware();
    this.setupRoutes();
    this.bindTaskObservers();
  }

  private setupMiddleware() {
    this.app.use((req: RequestWithRequestId, _res, next) => {
      req.requestId = req.header('x-request-id') ?? randomUUID();
      attachRequestContext(req, createAnonymousRequestContext(req));
      next();
    });

    this.app.use((req, res, next) => {
      if (!this.isOriginAllowed(req)) {
        res.status(403).send('Forbidden origin');
        return;
      }
      next();
    });

    if (this.options.rateLimit) {
      this.app.use(createRateLimiter(this.options.rateLimit, this.options.rateLimitStore));
    }
  }

  private setupRoutes() {
    const serveCard = (_req: Request, res: Response) => {
      res.json(this.agentCard);
    };
    this.app.get('/.well-known/agent-card.json', serveCard);
    this.app.get('/.well-known/agent.json', serveCard);

    this.app.get('/health', (_req, res) => {
      const taskCounts = this.taskManager.getTaskCounts();
      const memoryUsage = process.memoryUsage();
      const payload: A2AHealthResponse = {
        status: 'healthy',
        version: this.agentCard.version,
        protocol: 'A2A/1.0',
        uptime: Math.floor((Date.now() - this.startedAt) / 1000),
        tasks: {
          active: taskCounts.active,
          completed: taskCounts.completed,
          failed: taskCounts.failed,
          total: taskCounts.total,
        },
        memory: {
          heapUsedMb: Number((memoryUsage.heapUsed / 1024 / 1024).toFixed(1)),
          heapTotalMb: Number((memoryUsage.heapTotal / 1024 / 1024).toFixed(1)),
        },
      };
      res.json(payload);
    });

    this.app.get('/metrics', (_req, res) => {
      res.setHeader('Content-Type', 'text/plain; version=0.0.4');
      res.send(this.runtimeMetrics.renderPrometheus(this.taskManager.getTaskCounts()));
    });

    this.app.get('/tasks', async (req: Request, res: Response) => {
      let requestContext = getRequestContext(req);
      if (this.authMiddleware) {
        try {
          requestContext = await this.authMiddleware.authenticateRequestContext(req);
        } catch {
          this.runtimeMetrics.recordAuthReject();
          res.status(401).send('Unauthorized');
          return;
        }
      }

      let tasks = this.taskManager.getAllTasks();
      tasks = this.filterTasksByContext(tasks, requestContext);

      // Sort newest first
      tasks.sort(
        (a, b) => new Date(b.status.timestamp).getTime() - new Date(a.status.timestamp).getTime(),
      );

      const limit = Number(req.query.limit) || 20;
      res.json(tasks.slice(0, limit));
    });

    const handleJsonRpc = async (req: Request, res: Response) => {
      let idempotency: IdempotencyResolution | null | undefined;
      try {
        const rpcReq = validateRequest(JsonRpcRequestSchema, req.body) as JsonRpcRequest;
        let requestContext = getRequestContext(req);
        if (this.authMiddleware) {
          try {
            requestContext = await this.authMiddleware.authenticateRequestContext(req);
          } catch (error: unknown) {
            this.runtimeMetrics.recordAuthReject();
            throw new JsonRpcError(ErrorCodes.Unauthorized, 'Unauthorized', {
              reason: String(error),
            });
          }
        }
        idempotency = await this.resolveIdempotency(
          req,
          rpcReq,
          requestContext,
          res,
          this.isStreamingRpcMethod(rpcReq.method),
        );
        if (idempotency === null) {
          return;
        }
        if (this.isStreamingRpcMethod(rpcReq.method)) {
          await this.handleStreamingRpc(rpcReq, { req, requestContext }, res, idempotency);
          return;
        }
        const result = await this.handleRpc(rpcReq, { req, requestContext });
        const responseResult = idempotency
          ? this.decorateIdempotentResult(result, idempotency, false)
          : result;
        if (idempotency) {
          await this.idempotencyStore.set(
            idempotency.scope,
            idempotency.key,
            idempotency.fingerprint,
            {
              kind: 'success',
              value: structuredClone(responseResult),
            },
            this.options.idempotencyTtlMs ?? 60 * 60 * 1000,
          );
        }
        const response: JsonRpcResponse = {
          jsonrpc: '2.0',
          result: responseResult,
          id: rpcReq.id ?? null,
        };
        res.json(response);
      } catch (err: unknown) {
        const responseId = this.extractJsonRpcId(req.body);
        if (err instanceof JsonRpcError) {
          if (idempotency && err.code !== ErrorCodes.IdempotencyConflict) {
            await this.idempotencyStore.set(
              idempotency.scope,
              idempotency.key,
              idempotency.fingerprint,
              {
                kind: 'error',
                error: { code: err.code, message: err.message, data: err.data },
              },
              this.options.idempotencyTtlMs ?? 60 * 60 * 1000,
            );
          }
          res.json({
            jsonrpc: '2.0',
            error: { code: err.code, message: err.message, data: err.data },
            id: responseId,
          });
        } else {
          logger.error('Unhandled internal error', { error: String(err) });
          res.json({
            jsonrpc: '2.0',
            error: { code: ErrorCodes.InternalError, message: 'Internal Error' },
            id: responseId,
          });
        }
      }
    };
    this.app.post('/', handleJsonRpc);
    this.app.post('/rpc', handleJsonRpc);
    this.app.post('/a2a/jsonrpc', handleJsonRpc);

    const handleStreamRequest = async (req: Request, res: Response) => {
      let requestContext = getRequestContext(req);
      if (this.authMiddleware) {
        try {
          requestContext = await this.authMiddleware.authenticateRequestContext(req);
        } catch {
          this.runtimeMetrics.recordAuthReject();
          res.status(401).send('Unauthorized');
          return;
        }
      }

      const taskId = req.query.taskId as string;
      if (!taskId) {
        res.status(400).send('Missing taskId query parameter');
        return;
      }

      const task = this.taskManager.getTask(taskId);
      if (!task) {
        res.status(404).send('Task not found');
        return;
      }

      if (!this.canAccessTask(task, requestContext)) {
        res.status(403).send('Forbidden');
        return;
      }

      this.runtimeMetrics.recordSseConnectionOpened(Boolean(req.header('last-event-id')));
      this.streamer.addClient(taskId, res, () => {
        this.runtimeMetrics.recordSseConnectionClosed();
      });
      this.streamer.sendTaskUpdate(taskId, task);
    };
    this.app.get('/stream', handleStreamRequest);
    this.app.get('/a2a/stream', handleStreamRequest);
  }

  private bindTaskObservers(): void {
    this.taskManager.on('taskUpdated', async ({ task, reason, previousState }) => {
      if (reason === 'created') {
        this.runtimeMetrics.recordTaskCreated();
      }
      if (reason === 'state') {
        this.runtimeMetrics.recordTaskStateChange(task, previousState);
      }

      if (reason !== 'push-config') {
        this.streamer.sendTaskUpdate(task.id, task);
      }

      if (reason === 'state') {
        const pushConfig = this.taskManager.getPushNotification(task.id);
        if (pushConfig) {
          try {
            await this.pushNotificationService.retryWithBackoff(() =>
              this.pushNotificationService.sendNotification(pushConfig, task),
            );
          } catch (error: unknown) {
            logger.error('Push notification delivery failed', {
              taskId: task.id,
              contextId: task.contextId,
              error,
            });
          }
        }
      }
    });
  }

  protected async handleRpc(req: JsonRpcRequest, context: RpcContext): Promise<unknown> {
    const span = a2aMeshTracer.startSpan('a2a.handleRpc', {
      attributes: {
        'rpc.method': req.method,
        'a2a.agent_name': this.agentCard.name,
      },
    });
    const requestId = (context.req as RequestWithRequestId).requestId;
    const startedAt = Date.now();
    let failed = false;

    try {
      const params = (req.params ?? {}) as Record<string, unknown>;
      switch (req.method) {
        case 'message/send':
          return await this.handleMessageRequest(
            validateMessageSendParams(params),
            req.method,
            context.req,
          );

        case 'message/stream':
        case 'tasks/resubscribe':
          throw new JsonRpcError(
            ErrorCodes.UnsupportedOperation,
            `${req.method} requires an SSE response transport`,
          );

        case 'tasks/get': {
          if (typeof params.taskId !== 'string') {
            throw new JsonRpcError(ErrorCodes.InvalidParams, 'Missing taskId');
          }
          const task = this.taskManager.getTask(params.taskId);
          if (!task) {
            throw new JsonRpcError(ErrorCodes.TaskNotFound, 'Task not found');
          }
          // Authorization check
          if (!this.canAccessTask(task, context.requestContext)) {
            throw new JsonRpcError(ErrorCodes.Unauthorized, 'Unauthorized task access');
          }
          return task;
        }

        case 'tasks/cancel': {
          if (typeof params.taskId !== 'string') {
            throw new JsonRpcError(ErrorCodes.InvalidParams, 'Missing taskId');
          }
          const existingTask = this.taskManager.getTask(params.taskId);
          if (!existingTask) {
            throw new JsonRpcError(ErrorCodes.TaskNotFound, 'Task not found');
          }
          if (!this.canAccessTask(existingTask, context.requestContext)) {
            throw new JsonRpcError(ErrorCodes.Unauthorized, 'Unauthorized task access');
          }
          const task = this.taskManager.cancelTask(params.taskId);
          if (!task) {
            throw new JsonRpcError(ErrorCodes.TaskNotFound, 'Task not found');
          }
          return task;
        }

        case 'tasks/pushNotification/set': {
          if (
            typeof params.taskId !== 'string' ||
            typeof params.pushNotificationConfig !== 'object'
          ) {
            throw new JsonRpcError(
              ErrorCodes.InvalidParams,
              'Missing taskId or pushNotificationConfig',
            );
          }
          const task = this.taskManager.getTask(params.taskId);
          if (!task) {
            throw new JsonRpcError(ErrorCodes.TaskNotFound, 'Task not found');
          }
          if (!this.canAccessTask(task, context.requestContext)) {
            throw new JsonRpcError(ErrorCodes.Unauthorized, 'Unauthorized task access');
          }
          const pushNotificationConfig = await this.normalizePushNotificationConfig(
            params.pushNotificationConfig as NonNullable<
              NonNullable<MessageSendParams['configuration']>['pushNotificationConfig']
            >,
          );
          const config = this.taskManager.setPushNotification(
            params.taskId,
            pushNotificationConfig,
          );
          return config;
        }

        case 'tasks/pushNotification/get': {
          if (typeof params.taskId !== 'string') {
            throw new JsonRpcError(ErrorCodes.InvalidParams, 'Missing taskId');
          }
          const task = this.taskManager.getTask(params.taskId);
          if (!task) {
            throw new JsonRpcError(ErrorCodes.TaskNotFound, 'Task not found');
          }
          if (!this.canAccessTask(task, context.requestContext)) {
            throw new JsonRpcError(ErrorCodes.Unauthorized, 'Unauthorized task access');
          }
          return this.taskManager.getPushNotification(params.taskId) ?? null;
        }

        case 'tasks/list': {
          const { contextId, limit = 50, offset = 0 } = validateTaskListParams(params);
          let tasks = contextId
            ? this.taskManager.getTasksByContext(contextId)
            : this.taskManager.getAllTasks();

          tasks = this.filterTasksByContext(tasks, context.requestContext);

          return {
            tasks: tasks.slice(offset, offset + limit),
            total: tasks.length,
          };
        }

        case 'agent/authenticatedExtendedCard': {
          if (!this.agentCard.capabilities?.extendedAgentCard) {
            throw new JsonRpcError(ErrorCodes.UnsupportedOperation, 'Extended card not supported');
          }
          return this.agentCard;
        }

        default:
          throw new JsonRpcError(ErrorCodes.MethodNotFound, `Method ${req.method} not found`);
      }
    } catch (error: unknown) {
      if (error instanceof TaskLifecycleError) {
        throw this.toLifecycleJsonRpcError(error);
      }
      failed = true;
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
      throw error;
    } finally {
      if (!failed) {
        span.setStatus({ code: SpanStatusCode.OK });
      }
      span.end();
      logger.info('Handled RPC request', {
        ...(requestId ? { requestId } : {}),
        ...(context.requestContext.principalId
          ? { principalId: context.requestContext.principalId }
          : {}),
        ...(context.requestContext.tenantId ? { tenantId: context.requestContext.tenantId } : {}),
        method: req.method,
        agentName: this.agentCard.name,
        durationMs: Date.now() - startedAt,
      });
    }
  }

  private async handleMessageRequest(
    params: MessageSendParams,
    method: string,
    req?: Request,
  ): Promise<Task> {
    const requestContext = req ? getRequestContext(req) : undefined;
    const principalId = requestContext?.principalId;
    const tenantId = requestContext?.tenantId;

    let task: Task | null = null;

    if (params.taskId) {
      task = this.taskManager.getTask(params.taskId) ?? null;
      if (!task) {
        throw new JsonRpcError(ErrorCodes.TaskNotFound, 'Task not found');
      }
      if (requestContext && !this.canAccessTask(task, requestContext)) {
        throw new JsonRpcError(ErrorCodes.Unauthorized, 'Unauthorized task access');
      }
    } else {
      task = this.taskManager.createTask(
        params.sessionId,
        params.contextId ?? params.message.contextId,
        principalId,
        tenantId,
      );
      logger.audit(
        'task_created',
        principalId,
        `task:${task.id}`,
        'success',
        tenantId ? { tenantId } : {},
      );
    }

    const pushNotificationConfig = params.configuration?.pushNotificationConfig
      ? await this.normalizePushNotificationConfig(params.configuration.pushNotificationConfig)
      : undefined;

    if (!task) {
      throw new JsonRpcError(ErrorCodes.TaskNotFound, 'Task not found');
    }

    const appliedExtensions = this.negotiateExtensions(params.configuration?.extensions ?? []);
    this.taskManager.setTaskExtensions(task.id, appliedExtensions);
    if (pushNotificationConfig) {
      this.taskManager.setPushNotification(task.id, pushNotificationConfig);
    }

    const message: Message = {
      ...params.message,
      kind: params.message.kind ?? 'message',
      ...((params.message.contextId ?? task.contextId)
        ? { contextId: params.message.contextId ?? task.contextId }
        : {}),
    };
    this.taskManager.addHistoryMessage(task.id, message);
    this.taskManager.updateTaskState(task.id, 'working');

    this.processTaskInternal(task, message).catch((error) => {
      logger.error('Task processing failed', {
        taskId: task.id,
        ...(task.contextId ? { contextId: task.contextId } : {}),
        error,
      });
    });

    if (method === 'message/stream') {
      return this.taskManager.getTask(task.id) ?? task;
    }

    return this.taskManager.getTask(task.id) ?? task;
  }

  private negotiateExtensions(requestedExtensions: A2AExtension[]): string[] {
    if (requestedExtensions.length === 0) {
      return [];
    }

    const supported = new Set((this.agentCard.extensions ?? []).map((extension) => extension.uri));
    const applied: string[] = [];
    for (const extension of requestedExtensions) {
      if (supported.has(extension.uri)) {
        applied.push(extension.uri);
        continue;
      }

      if (extension.required) {
        throw new JsonRpcError(
          ErrorCodes.ExtensionRequired,
          `Required extension not supported: ${extension.uri}. See: ${getDocsUrl('protocol/extensions')}`,
        );
      }
    }

    return applied;
  }

  private async normalizePushNotificationConfig(
    config: NonNullable<NonNullable<MessageSendParams['configuration']>['pushNotificationConfig']>,
  ): Promise<
    NonNullable<NonNullable<MessageSendParams['configuration']>['pushNotificationConfig']>
  > {
    try {
      await validateSafeUrl(config.url, {
        allowLocalhost: this.options.allowLocalhost ?? process.env.NODE_ENV !== 'production',
        allowPrivateNetworks: this.options.allowPrivateNetworks ?? false,
        allowUnresolvedHostnames: this.options.allowUnresolvedHostnames ?? false,
      });

      return { ...config };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new JsonRpcError(ErrorCodes.InvalidParams, `Invalid push notification URL: ${message}`);
    }
  }

  protected normalizeArtifacts(task: Task, artifacts: Artifact[]): ExtensibleArtifact[] {
    return artifacts.map((artifact) => ({
      ...artifact,
      ...(((artifact as ExtensibleArtifact).extensions ?? task.extensions)
        ? { extensions: (artifact as ExtensibleArtifact).extensions ?? task.extensions }
        : {}),
      metadata: {
        ...((artifact as ExtensibleArtifact).metadata ?? {}),
        taskId: task.id,
        ...(task.contextId ? { contextId: task.contextId } : {}),
        appliedExtensions: task.extensions ?? [],
      },
    }));
  }

  public getExpressApp(): Express {
    return this.app;
  }

  public getAgentCard(): AgentCard {
    return this.agentCard;
  }

  public getTaskManager(): TaskManager {
    return this.taskManager;
  }

  public static fromCard(card: AnyAgentCard): AgentCard {
    return card.protocolVersion === '1.0'
      ? card
      : ({ ...card, protocolVersion: '1.0' } as AgentCard);
  }

  protected async processTaskInternal(task: Task, message: Message): Promise<void> {
    const span = a2aMeshTracer.startSpan('a2a.processTask', {
      attributes: {
        'a2a.task_id': task.id,
        'a2a.context_id': task.contextId ?? '',
      },
    });
    try {
      const artifacts = await this.handleTask(task, message);
      this.normalizeArtifacts(task, artifacts).forEach((artifact) => {
        this.taskManager.addArtifact(task.id, artifact);
      });
      this.taskManager.updateTaskState(task.id, 'completed');
      span.setStatus({ code: SpanStatusCode.OK });
    } catch (error: unknown) {
      try {
        this.taskManager.updateTaskState(task.id, 'failed');
      } catch (lifecycleError) {
        if (
          lifecycleError instanceof TaskLifecycleError &&
          lifecycleError.code === 'TASK_TERMINAL'
        ) {
          span.setStatus({ code: SpanStatusCode.OK, message: 'Task already terminal' });
          return;
        }
        throw lifecycleError;
      }
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
      throw error;
    } finally {
      span.end();
    }
  }

  /**
   * Adapter implementation entry point. Must be implemented by specific adapters.
   */
  abstract handleTask(task: Task, message: Message): Promise<Artifact[]>;

  public start(port: number): HttpServer {
    this.httpServer = this.app.listen(port, () => {
      logger.info(`A2A Server listening on port ${port}`);
    });
    return this.httpServer;
  }

  public async stop(): Promise<void> {
    this.streamer.stop();
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
    const storage = this.options.taskStorage as { close?: () => void } | undefined;
    storage?.close?.();
  }

  private isOriginAllowed(req: Request): boolean {
    const origin = req.header('origin');
    if (!origin) {
      return !this.options.requireOrigin;
    }

    const allowedOrigins = this.options.allowedOrigins ?? [];
    if (allowedOrigins.length === 0) {
      return process.env.NODE_ENV !== 'production';
    }

    return allowedOrigins.includes(origin);
  }

  private filterTasksByContext(tasks: Task[], context: RequestContext): Task[] {
    if (!this.shouldEnforceTaskOwnership(context)) {
      return tasks;
    }

    return tasks.filter((task) => this.canAccessTask(task, context));
  }

  private canAccessTask(task: Task, context: RequestContext): boolean {
    if (!this.shouldEnforceTaskOwnership(context)) {
      return true;
    }

    if (task.principalId && task.principalId !== context.principalId) {
      return false;
    }
    if (task.tenantId && task.tenantId !== context.tenantId) {
      return false;
    }

    return true;
  }

  private shouldEnforceTaskOwnership(context: RequestContext): boolean {
    return Boolean(this.authMiddleware) || context.authMethod !== 'anonymous';
  }

  private async resolveIdempotency(
    req: Request,
    rpcReq: JsonRpcRequest,
    requestContext: RequestContext,
    res: Response,
    deferReplay = false,
  ): Promise<IdempotencyResolution | null | undefined> {
    if (!this.isIdempotentMethod(rpcReq.method)) {
      return undefined;
    }

    const key = req.header('idempotency-key');
    if (!key) {
      return undefined;
    }

    const scope = this.buildIdempotencyScope(req, rpcReq.method, requestContext);
    const fingerprint = buildIdempotencyFingerprint({
      method: rpcReq.method,
      params: rpcReq.params ?? null,
    });

    const nextContext: RequestContext = {
      ...requestContext,
      idempotency: {
        key,
        scope,
        fingerprint,
        replayed: false,
      },
    };
    attachRequestContext(req, nextContext);

    const existing = await this.idempotencyStore.get(scope, key);
    if (!existing) {
      return { scope, key, fingerprint };
    }

    if (existing.fingerprint !== fingerprint) {
      throw new JsonRpcError(ErrorCodes.IdempotencyConflict, 'Idempotency key reuse conflict', {
        key,
        scope,
      });
    }

    if (deferReplay) {
      return { scope, key, fingerprint, replay: existing.result };
    }

    if (existing.result.kind === 'error') {
      res.json({
        jsonrpc: '2.0',
        error: existing.result.error,
        id: rpcReq.id ?? null,
      });
      return null;
    }

    res.json({
      jsonrpc: '2.0',
      result: this.decorateIdempotentResult(
        existing.result.value,
        { scope, key, fingerprint },
        true,
      ),
      id: rpcReq.id ?? null,
    });
    return null;
  }

  private decorateIdempotentResult(
    result: unknown,
    idempotency: IdempotencyResolution,
    replayed: boolean,
  ): unknown {
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      return result;
    }

    const record = {
      key: idempotency.key,
      scope: idempotency.scope,
      fingerprint: idempotency.fingerprint,
      replayed,
    };
    const currentMetadata =
      'metadata' in result && result.metadata && typeof result.metadata === 'object'
        ? (result.metadata as Record<string, unknown>)
        : {};

    return {
      ...result,
      metadata: {
        ...currentMetadata,
        idempotency: record,
      },
    };
  }

  private buildIdempotencyScope(
    req: Request,
    method: string,
    requestContext: RequestContext,
  ): string {
    const principalScope =
      requestContext.principalId ??
      requestContext.subject ??
      req.ip ??
      req.socket?.remoteAddress ??
      'anonymous';
    return [
      'rpc',
      method,
      requestContext.tenantId ?? 'global',
      principalScope,
      requestContext.authMethod,
    ].join(':');
  }

  private isIdempotentMethod(method: string): boolean {
    return (
      method === 'message/send' ||
      method === 'message/stream' ||
      method === 'tasks/cancel' ||
      method === 'tasks/pushNotification/set'
    );
  }

  private jsonParseErrorHandler(): ErrorRequestHandler {
    return (err, _req, res, next) => {
      if (err instanceof SyntaxError && 'body' in err) {
        res.status(200).json({
          jsonrpc: '2.0',
          error: {
            code: ErrorCodes.ParseError,
            message: 'Parse error',
          },
          id: null,
        } satisfies JsonRpcResponse);
        return;
      }

      next(err);
    };
  }

  private isStreamingRpcMethod(method: string): boolean {
    return method === 'message/stream' || method === 'tasks/resubscribe';
  }

  private async handleStreamingRpc(
    rpcReq: JsonRpcRequest,
    context: RpcContext,
    res: Response,
    idempotency?: IdempotencyResolution,
  ): Promise<void> {
    const responseId = rpcReq.id ?? null;
    const replay = idempotency?.replay;
    if (idempotency && replay) {
      this.writeStreamingReplay(rpcReq, context, res, { ...idempotency, replay });
      return;
    }

    let task: Task;
    if (rpcReq.method === 'message/stream') {
      task = await this.handleMessageRequest(
        validateMessageSendParams((rpcReq.params ?? {}) as Record<string, unknown>),
        rpcReq.method,
        context.req,
      );
      if (idempotency) {
        await this.idempotencyStore.set(
          idempotency.scope,
          idempotency.key,
          idempotency.fingerprint,
          {
            kind: 'success',
            value: structuredClone(this.decorateIdempotentResult(task, idempotency, false)),
          },
          this.options.idempotencyTtlMs ?? 60 * 60 * 1000,
        );
      }
    } else {
      const params = (rpcReq.params ?? {}) as Record<string, unknown>;
      if (typeof params.taskId !== 'string') {
        throw new JsonRpcError(ErrorCodes.InvalidParams, 'Missing taskId');
      }
      const existingTask = this.taskManager.getTask(params.taskId);
      if (!existingTask) {
        throw new JsonRpcError(ErrorCodes.TaskNotFound, 'Task not found');
      }
      if (!this.canAccessTask(existingTask, context.requestContext)) {
        throw new JsonRpcError(ErrorCodes.Unauthorized, 'Unauthorized task access');
      }
      task = existingTask;
    }

    this.runtimeMetrics.recordSseConnectionOpened(Boolean(context.req.header('last-event-id')));
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    let closed = false;
    const close = () => {
      if (closed) {
        return;
      }
      closed = true;
      this.runtimeMetrics.recordSseConnectionClosed();
      this.taskManager.off('taskUpdated', onTaskUpdated);
      res.end();
    };

    const writeTask = (nextTask: Task): void => {
      if (closed) {
        return;
      }
      const response: JsonRpcResponse<Task> = {
        jsonrpc: '2.0',
        result: nextTask,
        id: responseId,
      };
      try {
        res.write(`event: message\n`);
        res.write(`data: ${JSON.stringify(response)}\n\n`);
      } catch {
        close();
        return;
      }
      if (this.isTerminalTaskState(nextTask.status.state)) {
        close();
      }
    };

    const onTaskUpdated = ({ task: updatedTask }: TaskUpdatedEvent) => {
      if (updatedTask.id === task.id) {
        writeTask(updatedTask);
      }
    };

    context.req.on('close', close);
    this.taskManager.on('taskUpdated', onTaskUpdated);
    writeTask(this.taskManager.getTask(task.id) ?? task);
  }

  private writeStreamingReplay(
    rpcReq: JsonRpcRequest,
    context: RpcContext,
    res: Response,
    idempotency: IdempotencyResolution & { replay: IdempotencyStoredResult },
  ): void {
    this.runtimeMetrics.recordSseConnectionOpened(Boolean(context.req.header('last-event-id')));
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const response: JsonRpcResponse =
      idempotency.replay.kind === 'error'
        ? {
            jsonrpc: '2.0',
            error: idempotency.replay.error,
            id: rpcReq.id ?? null,
          }
        : {
            jsonrpc: '2.0',
            result: this.decorateIdempotentResult(idempotency.replay.value, idempotency, true),
            id: rpcReq.id ?? null,
          };

    try {
      try {
        res.write(`event: message\n`);
        res.write(`data: ${JSON.stringify(response)}\n\n`);
      } catch (error) {
        logger.warn('Failed to write JSON-RPC SSE replay', { error });
      }
    } finally {
      this.runtimeMetrics.recordSseConnectionClosed();
      res.end();
    }
  }

  private extractJsonRpcId(body: unknown): JsonRpcRequest['id'] {
    if (!body || typeof body !== 'object' || !('id' in body)) {
      return null;
    }

    const id = (body as { id?: unknown }).id;
    return typeof id === 'string' || typeof id === 'number' || id === null ? id : null;
  }

  private isTerminalTaskState(state: Task['status']['state']): boolean {
    return state === 'completed' || state === 'failed' || state === 'canceled';
  }

  private toLifecycleJsonRpcError(error: TaskLifecycleError): JsonRpcError {
    if (error.code === 'INVALID_TASK_TRANSITION' || error.code === 'TASK_TERMINAL') {
      return new JsonRpcError(ErrorCodes.InvalidTaskTransition, error.message, {
        taskId: error.taskId,
        currentState: error.currentState,
        nextState: error.nextState,
      });
    }

    return new JsonRpcError(ErrorCodes.InternalError, error.message, {
      taskId: error.taskId,
    });
  }
}
