import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { A2AServer, type A2AServerOptions } from '../src/server/A2AServer.js';
import { ErrorCodes } from '../src/types/jsonrpc.js';
import type { AgentCard } from '../src/types/agent-card.js';
import type { Artifact, Message, Task } from '../src/types/task.js';

const agentCard: AgentCard = {
  protocolVersion: '1.0',
  name: 'Edge Harness Agent',
  description: 'A2AServer edge-case test harness',
  url: 'http://localhost:0',
  version: '1.0.0',
  capabilities: {
    streaming: true,
    pushNotifications: true,
    stateTransitionHistory: true,
    extendedAgentCard: true,
  },
};

class EdgeHarnessServer extends A2AServer {
  constructor(options: A2AServerOptions = {}) {
    super(agentCard, options);
  }

  async handleTask(_task: Task, message: Message): Promise<Artifact[]> {
    const text = message.parts.find((part) => part.type === 'text');

    return [
      {
        artifactId: 'artifact-1',
        index: 0,
        lastChunk: true,
        parts: [
          {
            type: 'text',
            text: text?.type === 'text' ? `echo:${text.text}` : 'echo:',
          },
        ],
      },
    ];
  }
}

function createMessage(text: string): Message {
  return {
    role: 'user',
    parts: [{ type: 'text', text }],
    messageId: `message-${text}`,
    timestamp: new Date().toISOString(),
  };
}

describe('A2AServer edge cases', () => {
  it('returns 429 when the JSON-RPC rate limit is exceeded', async () => {
    const server = new EdgeHarnessServer({
      rateLimit: { maxRequests: 2, windowMs: 60_000 },
    });

    const payload = {
      jsonrpc: '2.0' as const,
      method: 'message/send',
      params: { message: createMessage('rate-limit') },
    };

    await request(server.getExpressApp())
      .post('/rpc')
      .send({ ...payload, id: '1' })
      .expect(200);
    await request(server.getExpressApp())
      .post('/rpc')
      .send({ ...payload, id: '2' })
      .expect(200);

    const response = await request(server.getExpressApp())
      .post('/rpc')
      .send({ ...payload, id: '3' });

    expect(response.status).toBe(429);
    expect(response.body.error).toMatchObject({
      code: ErrorCodes.RateLimitExceeded,
      message: 'Too Many Requests',
    });
  });

  it('returns 401 for protected endpoints when auth headers are missing', async () => {
    const server = new EdgeHarnessServer({
      auth: {
        securitySchemes: [{ type: 'apiKey', id: 'api-key', in: 'header', name: 'x-api-key' }],
        apiKeys: { 'api-key': 'secret' },
      },
    });

    const response = await request(server.getExpressApp()).get('/tasks');

    expect(response.status).toBe(401);
    expect(response.text).toBe('Unauthorized');
  });

  it('returns 403 when a task stream is accessed from a different tenant', async () => {
    const server = new EdgeHarnessServer({
      auth: {
        securitySchemes: [{ type: 'apiKey', id: 'api-key', in: 'header', name: 'x-api-key' }],
        apiKeys: {
          'api-key': [
            { value: 'key-a', principalId: 'user-a', tenantId: 'tenant-1' },
            { value: 'key-a-tenant-2', principalId: 'user-a', tenantId: 'tenant-2' },
          ],
        },
      },
    });
    const task = server
      .getTaskManager()
      .createTask('session-edge', 'context-edge', 'user-a', 'tenant-1');

    const response = await request(server.getExpressApp())
      .get('/stream')
      .query({ taskId: task.id })
      .set('x-api-key', 'key-a-tenant-2');

    expect(response.status).toBe(403);
    expect(response.text).toBe('Forbidden');
  });

  it('returns a JSON-RPC TaskNotFound error envelope from the /rpc alias', async () => {
    const server = new EdgeHarnessServer();

    const response = await request(server.getExpressApp())
      .post('/rpc')
      .send({
        jsonrpc: '2.0',
        id: 'missing-task',
        method: 'tasks/get',
        params: { taskId: 'does-not-exist' },
      });

    expect(response.status).toBe(200);
    expect(response.body.error).toMatchObject({
      code: ErrorCodes.TaskNotFound,
      message: 'Task not found',
    });
  });

  it('preserves falsy JSON-RPC ids and returns protocol parse errors for invalid JSON', async () => {
    const server = new EdgeHarnessServer();

    const numericId = await request(server.getExpressApp())
      .post('/rpc')
      .send({
        jsonrpc: '2.0',
        id: 0,
        method: 'tasks/get',
        params: { taskId: 'does-not-exist' },
      });
    expect(numericId.status).toBe(200);
    expect(numericId.body.id).toBe(0);
    expect(numericId.body.error.code).toBe(ErrorCodes.TaskNotFound);

    const emptyStringId = await request(server.getExpressApp())
      .post('/rpc')
      .send({
        jsonrpc: '2.0',
        id: '',
        method: 'tasks/get',
        params: { taskId: 'does-not-exist' },
      });
    expect(emptyStringId.status).toBe(200);
    expect(emptyStringId.body.id).toBe('');

    const parseError = await request(server.getExpressApp())
      .post('/rpc')
      .set('Content-Type', 'application/json')
      .send('{"jsonrpc":"2.0","id":0,');
    expect(parseError.status).toBe(200);
    expect(parseError.body).toEqual({
      jsonrpc: '2.0',
      error: { code: ErrorCodes.ParseError, message: 'Parse error' },
      id: null,
    });
  });

  it('streams canonical JSON-RPC SSE responses for message/stream and tasks/resubscribe', async () => {
    const server = new EdgeHarnessServer();
    const message = createMessage('canonical-stream');

    const streamResponse = await request(server.getExpressApp())
      .post('/rpc')
      .set('Accept', 'text/event-stream')
      .set('Idempotency-Key', 'canonical-stream-key')
      .send({
        jsonrpc: '2.0',
        id: 0,
        method: 'message/stream',
        params: { message },
      });

    expect(streamResponse.status).toBe(200);
    expect(streamResponse.header['content-type']).toContain('text/event-stream');
    expect(streamResponse.text).toContain('"jsonrpc":"2.0"');
    expect(streamResponse.text).toContain('"id":0');
    expect(streamResponse.text).toContain('"state":"completed"');

    const taskId = /"id":"([^"]+)"/.exec(streamResponse.text)?.[1];
    expect(taskId).toBeDefined();

    const resubscribeResponse = await request(server.getExpressApp())
      .post('/rpc')
      .set('Accept', 'text/event-stream')
      .send({
        jsonrpc: '2.0',
        id: '',
        method: 'tasks/resubscribe',
        params: { taskId },
      });

    expect(resubscribeResponse.status).toBe(200);
    expect(resubscribeResponse.header['content-type']).toContain('text/event-stream');
    expect(resubscribeResponse.text).toContain('"id":""');
    expect(resubscribeResponse.text).toContain('"state":"completed"');

    const replayResponse = await request(server.getExpressApp())
      .post('/rpc')
      .set('Accept', 'text/event-stream')
      .set('Idempotency-Key', 'canonical-stream-key')
      .send({
        jsonrpc: '2.0',
        id: 'replay-stream',
        method: 'message/stream',
        params: { message },
      });

    expect(replayResponse.status).toBe(200);
    expect(replayResponse.header['content-type']).toContain('text/event-stream');
    expect(replayResponse.text).toContain(`"id":"${taskId}"`);
    expect(replayResponse.text).toContain('"key":"canonical-stream-key"');
    expect(replayResponse.text).toContain('"replayed":true');
  });

  it('rejects push notification webhook URLs that resolve to private networks', async () => {
    const server = new EdgeHarnessServer();
    const task = server.getTaskManager().createTask('session-ssrf', 'context-ssrf');

    const response = await request(server.getExpressApp())
      .post('/rpc')
      .send({
        jsonrpc: '2.0',
        id: 'push-block',
        method: 'tasks/pushNotification/set',
        params: {
          taskId: task.id,
          pushNotificationConfig: {
            url: 'http://169.254.169.254/hook',
          },
        },
      });

    expect(response.status).toBe(200);
    expect(response.body.error.code).toBe(ErrorCodes.InvalidParams);
    expect(response.body.error.message).toContain('Invalid push notification URL');
    expect(response.body.error.message).toContain('Private IP addresses are not allowed');
  });

  it('replays idempotent task creation requests and rejects conflicting payloads', async () => {
    const server = new EdgeHarnessServer();
    const payload = {
      jsonrpc: '2.0',
      id: 'idempotency-1',
      method: 'message/send',
      params: {
        message: createMessage('idempotent request'),
      },
    };

    const first = await request(server.getExpressApp())
      .post('/rpc')
      .set('Idempotency-Key', 'create-task-1')
      .send(payload);
    const second = await request(server.getExpressApp())
      .post('/rpc')
      .set('Idempotency-Key', 'create-task-1')
      .send({ ...payload, id: 'idempotency-2' });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.result.id).toBe(first.body.result.id);
    expect(second.body.result.metadata.idempotency).toMatchObject({
      key: 'create-task-1',
      replayed: true,
    });

    const conflict = await request(server.getExpressApp())
      .post('/rpc')
      .set('Idempotency-Key', 'create-task-1')
      .send({
        ...payload,
        id: 'idempotency-3',
        params: {
          message: createMessage('different body'),
        },
      });

    expect(conflict.status).toBe(200);
    expect(conflict.body.error.code).toBe(ErrorCodes.IdempotencyConflict);
  });

  it('exposes runtime metrics and rejects invalid terminal transitions', async () => {
    const server = new EdgeHarnessServer();

    const created = await request(server.getExpressApp())
      .post('/rpc')
      .send({
        jsonrpc: '2.0',
        id: 'task-for-metrics',
        method: 'message/send',
        params: {
          message: createMessage('metrics please'),
        },
      });
    expect(created.status).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 25));

    const cancelResponse = await request(server.getExpressApp())
      .post('/rpc')
      .send({
        jsonrpc: '2.0',
        id: 'cancel-terminal',
        method: 'tasks/cancel',
        params: {
          taskId: created.body.result.id,
        },
      });

    expect(cancelResponse.status).toBe(200);
    expect(cancelResponse.body.error.code).toBe(ErrorCodes.InvalidTaskTransition);

    const metricsResponse = await request(server.getExpressApp()).get('/metrics');
    expect(metricsResponse.status).toBe(200);
    expect(metricsResponse.text).toContain('a2a_runtime_task_created_total');
    expect(metricsResponse.text).toContain('a2a_runtime_task_completed_total');
    expect(metricsResponse.text).toContain('a2a_runtime_tasks_active');
  });
});
