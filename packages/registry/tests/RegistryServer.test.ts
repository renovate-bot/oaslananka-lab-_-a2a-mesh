import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import { RegistryServer } from '../src/RegistryServer.js';

describe('RegistryServer', () => {
  let server: RegistryServer;
  const previousNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    vi.restoreAllMocks();
    process.env.NODE_ENV = previousNodeEnv;
  });

  it('validates agent URL during registration', async () => {
    server = new RegistryServer({ allowLocalhost: false });

    const response = await request(server['app'])
      .post('/agents/register')
      .send({
        agentUrl: 'http://127.0.0.1:3000',
        agentCard: { name: 'Test', version: '1.0', protocolVersion: '1.0' },
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Invalid agentUrl');
  });

  it('allows registration with safe URL', async () => {
    server = new RegistryServer({ allowLocalhost: false, allowUnresolvedHostnames: true });

    const response = await request(server['app'])
      .post('/agents/register')
      .send({
        agentUrl: 'https://example.com/agent',
        agentCard: { name: 'Test', version: '1.0', protocolVersion: '1.0' },
      });

    expect(response.status).toBe(201);
    expect(response.body.url).toBe('https://example.com/agent');
  });

  it('enforces authentication when required', async () => {
    server = new RegistryServer({
      requireAuth: true,
      registrationToken: 'secret123',
      allowLocalhost: true,
      allowUnresolvedHostnames: true,
    });

    // Without token
    let response = await request(server['app'])
      .post('/agents/register')
      .send({
        agentUrl: 'https://example.com',
        agentCard: { name: 'Test', version: '1.0', protocolVersion: '1.0' },
      });
    expect(response.status).toBe(401);

    // With wrong token
    response = await request(server['app'])
      .post('/agents/register')
      .set('Authorization', 'Bearer wrong')
      .send({
        agentUrl: 'https://example.com',
        agentCard: { name: 'Test', version: '1.0', protocolVersion: '1.0' },
      });
    expect(response.status).toBe(401);

    // With correct token
    response = await request(server['app'])
      .post('/agents/register')
      .set('Authorization', 'Bearer secret123')
      .send({
        agentUrl: 'https://example.com',
        agentCard: { name: 'Test', version: '1.0', protocolVersion: '1.0' },
      });
    expect(response.status).toBe(201);
  });

  it('restricts non-public catalog access when registry auth is enabled', async () => {
    server = new RegistryServer({
      requireAuth: true,
      registrationToken: 'secret123',
      allowLocalhost: true,
      allowUnresolvedHostnames: true,
    });

    await request(server['app'])
      .post('/agents/register')
      .set('Authorization', 'Bearer secret123')
      .send({
        agentUrl: 'https://example.com/private',
        tenantId: 'tenant-a',
        agentCard: { name: 'Private', version: '1.0', protocolVersion: '1.0' },
      })
      .expect(201);

    await request(server['app'])
      .post('/agents/register')
      .set('Authorization', 'Bearer secret123')
      .send({
        agentUrl: 'https://example.com/public',
        isPublic: true,
        agentCard: { name: 'Public', version: '1.0', protocolVersion: '1.0' },
      })
      .expect(201);

    await request(server['app']).get('/agents').expect(401);

    const publicResponse = await request(server['app']).get('/agents').query({ public: 'true' });
    expect(publicResponse.status).toBe(200);
    expect(publicResponse.body).toHaveLength(1);
    expect(publicResponse.body[0].card.name).toBe('Public');
  });

  it('rejects browser origins in production unless explicitly allowed', async () => {
    process.env.NODE_ENV = 'production';
    server = new RegistryServer();

    await request(server['app']).get('/health').set('Origin', 'https://evil.example').expect(403);

    server = new RegistryServer({ allowedOrigins: ['https://ui.example'] });
    await request(server['app']).get('/health').set('Origin', 'https://ui.example').expect(200);
  });
});
