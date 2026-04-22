import { describe, expect, it } from 'vitest';
import { RedisStorage } from '../src/storage/RedisStorage.js';
import type { AgentStatus, RegisteredAgent } from '../src/storage/IAgentStorage.js';

function createStorage() {
  const values = new Map<string, string>();
  const storage = new RedisStorage({
    async get(key) {
      return values.get(key) ?? null;
    },
    async set(key, value) {
      values.set(key, value);
    },
    async del(key) {
      return values.delete(key) ? 1 : 0;
    },
    async scan(_cursor, _matchOption, pattern, _countOption, _count) {
      const prefix = pattern.replace('*', '');
      return ['0', Array.from(values.keys()).filter((key) => key.startsWith(prefix))];
    },
    async keys(pattern) {
      const prefix = pattern.replace('*', '');
      return Array.from(values.keys()).filter((key) => key.startsWith(prefix));
    },
  });

  return { storage, values };
}

function agent(
  id: string,
  overrides: Partial<RegisteredAgent> & {
    name?: string;
    status?: AgentStatus;
    skillNames?: string[];
  } = {},
): RegisteredAgent {
  const skillNames = overrides.skillNames ?? overrides.skills ?? [];
  const result: RegisteredAgent = {
    id,
    url: `http://${id}`,
    card: {
      protocolVersion: '1.0',
      name: overrides.name ?? id,
      description: 'desc',
      url: `http://${id}`,
      version: '1.0',
      transport: overrides.card?.transport ?? 'http',
      capabilities: overrides.card?.capabilities ?? { streaming: true },
      skills: skillNames.map((name, index) => ({
        id: `${id}-skill-${index}`,
        name,
        description: `${name} skill`,
        tags: overrides.tags ?? [],
      })),
    },
    status: overrides.status ?? 'unknown',
    tags: overrides.tags ?? [],
    skills: skillNames,
    registeredAt: overrides.registeredAt ?? new Date().toISOString(),
  };
  if (overrides.isPublic !== undefined) {
    result.isPublic = overrides.isPublic;
  }
  if (overrides.tenantId !== undefined) {
    result.tenantId = overrides.tenantId;
  }
  return result;
}

describe('RedisStorage', () => {
  it('persists and retrieves JSON records through a redis-like client', async () => {
    const { storage } = createStorage();

    await storage.upsert({
      id: 'agent-1',
      url: 'http://agent-1',
      card: {
        protocolVersion: '1.0',
        name: 'Agent 1',
        description: 'desc',
        url: 'http://agent-1',
        version: '1.0',
      },
      status: 'healthy',
      tags: [],
      skills: ['Search'],
      registeredAt: new Date().toISOString(),
    });

    expect(await storage.getAll()).toHaveLength(1);
    expect((await storage.findBySkill('sea'))[0]?.id).toBe('agent-1');
  });

  it('updates statuses, ignores missing agents and reports failed deletes', async () => {
    const { storage } = createStorage();

    await storage.upsert({
      id: 'agent-1',
      url: 'http://agent-1',
      card: {
        protocolVersion: '1.0',
        name: 'Agent 1',
        description: 'desc',
        url: 'http://agent-1',
        version: '1.0',
      },
      status: 'unknown',
      tags: [],
      skills: [],
      registeredAt: new Date().toISOString(),
    });

    await storage.updateStatus('agent-1', 'healthy');
    await storage.updateStatus('missing', 'unhealthy');

    expect((await storage.get('agent-1'))?.status).toBe('healthy');
    expect(await storage.delete('missing')).toBe(false);
  });

  it('maintains indexed list and summary queries across upserts and deletes', async () => {
    const { storage } = createStorage();
    await storage.upsert(
      agent('agent-a', {
        name: 'Alpha Researcher',
        status: 'healthy',
        skillNames: ['Research'],
        tags: ['web'],
        tenantId: 'tenant-a',
        registeredAt: '2026-04-06T10:00:00.000Z',
        card: {
          protocolVersion: '1.0',
          name: 'Alpha Researcher',
          description: 'desc',
          url: 'http://agent-a',
          version: '1.0',
          transport: 'http',
          capabilities: { streaming: true, mcpCompatible: true },
        },
      }),
    );
    await storage.upsert(
      agent('agent-b', {
        name: 'Public Writer',
        status: 'unknown',
        skillNames: ['Write'],
        tags: ['text'],
        isPublic: true,
        registeredAt: '2026-04-06T10:01:00.000Z',
      }),
    );
    await storage.upsert(
      agent('agent-c', {
        name: 'Tenant B Analyzer',
        status: 'unhealthy',
        skillNames: ['Analyze'],
        tags: ['data'],
        tenantId: 'tenant-b',
        registeredAt: '2026-04-06T10:02:00.000Z',
      }),
    );

    await expect(storage.list({ tenantId: 'tenant-a', includePublic: true })).resolves.toEqual(
      expect.objectContaining({ total: 2 }),
    );
    await expect(storage.list({ isPublic: true })).resolves.toEqual(
      expect.objectContaining({ items: [expect.objectContaining({ id: 'agent-b' })] }),
    );
    await expect(storage.list({ status: 'healthy', skill: 'rese', tag: 'web' })).resolves.toEqual(
      expect.objectContaining({ items: [expect.objectContaining({ id: 'agent-a' })] }),
    );
    await expect(storage.list({ name: 'writer', transport: 'http' })).resolves.toEqual(
      expect.objectContaining({ items: [expect.objectContaining({ id: 'agent-b' })] }),
    );
    await expect(storage.list({ mcpCompatible: true })).resolves.toEqual(
      expect.objectContaining({ items: [expect.objectContaining({ id: 'agent-a' })] }),
    );
    await expect(storage.list({ mcpCompatible: false, cursor: 'bad', limit: 1 })).resolves.toEqual(
      expect.objectContaining({ total: 2, nextCursor: '1' }),
    );
    await expect(storage.summarize({ tenantId: 'tenant-a', includePublic: true })).resolves.toEqual(
      expect.objectContaining({
        agentCount: 2,
        healthyAgents: 1,
        unknownAgents: 1,
        activeTenants: 1,
        publicAgents: 1,
      }),
    );

    await storage.upsert(agent('agent-a', { status: 'unhealthy', skillNames: ['Research'] }));
    expect((await storage.list({ status: 'healthy' })).items.map((item) => item.id)).not.toContain(
      'agent-a',
    );
    await expect(storage.delete('agent-a')).resolves.toBe(true);
    await expect(storage.findBySkill('rese')).resolves.toEqual([]);
  });
});
