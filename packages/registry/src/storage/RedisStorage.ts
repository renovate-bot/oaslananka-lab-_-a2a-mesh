import type { IAgentStorage, AgentStatus, RegisteredAgent } from './IAgentStorage.js';
import {
  buildAgentIndexTerms,
  type AgentListQuery,
  type AgentListResult,
  type AgentStorageSummary,
  termMatchesQuery,
} from './indexing.js';

export interface RegistryRedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  del(key: string): Promise<number>;
  scan?(
    cursor: string | number,
    matchOption: 'MATCH',
    pattern: string,
    countOption?: 'COUNT',
    count?: number,
  ): Promise<[string, string[]]>;
  keys?(pattern: string): Promise<string[]>;
}

export class RedisStorage implements IAgentStorage {
  constructor(
    private readonly client: RegistryRedisClient,
    private readonly prefix = 'a2a:registry',
  ) {}

  async upsert(agent: RegisteredAgent): Promise<RegisteredAgent> {
    const previous = await this.get(agent.id);
    if (previous) {
      await this.removeIndexes(previous);
    }

    await this.client.set(this.key(agent.id), JSON.stringify(agent));
    await this.addIndexes(agent);
    return agent;
  }

  async get(id: string): Promise<RegisteredAgent | null> {
    const value = await this.client.get(this.key(id));
    return value ? (JSON.parse(value) as RegisteredAgent) : null;
  }

  async getAll(): Promise<RegisteredAgent[]> {
    return (await this.list({ limit: Number.MAX_SAFE_INTEGER })).items;
  }

  async list(query: AgentListQuery = {}): Promise<AgentListResult> {
    const candidateIds = await this.findCandidateIds(query);
    const agents = await this.loadAgents(candidateIds);
    const filtered = agents.filter((agent) => this.matchesVisibility(agent, query));
    filtered.sort((left, right) => Date.parse(right.registeredAt) - Date.parse(left.registeredAt));

    const offset = parseCursor(query.cursor);
    const limit = query.limit ?? 50;
    const items = filtered.slice(offset, offset + limit);

    return {
      items,
      total: filtered.length,
      nextCursor: offset + items.length < filtered.length ? String(offset + items.length) : null,
    };
  }

  async summarize(
    query: Pick<AgentListQuery, 'tenantId' | 'includePublic' | 'isPublic'> = {},
  ): Promise<AgentStorageSummary> {
    const agents = (await this.list({ ...query, limit: Number.MAX_SAFE_INTEGER })).items;
    return {
      agentCount: agents.length,
      healthyAgents: agents.filter((agent) => agent.status === 'healthy').length,
      unhealthyAgents: agents.filter((agent) => agent.status === 'unhealthy').length,
      unknownAgents: agents.filter((agent) => agent.status === 'unknown').length,
      activeTenants: new Set(agents.map((agent) => agent.tenantId).filter(Boolean)).size,
      publicAgents: agents.filter((agent) => agent.isPublic).length,
    };
  }

  async delete(id: string): Promise<boolean> {
    const current = await this.get(id);
    if (!current) {
      return false;
    }

    await this.removeIndexes(current);
    return (await this.client.del(this.key(id))) > 0;
  }

  async updateStatus(
    id: string,
    status: AgentStatus,
    meta?: { consecutiveFailures?: number; lastSuccessAt?: string },
  ): Promise<void> {
    const current = await this.get(id);
    if (!current) {
      return;
    }

    await this.upsert({
      ...current,
      status,
      ...(meta?.consecutiveFailures !== undefined
        ? { consecutiveFailures: meta.consecutiveFailures }
        : {}),
      ...(meta?.lastSuccessAt !== undefined ? { lastSuccessAt: meta.lastSuccessAt } : {}),
    });
  }

  async findBySkill(skill: string): Promise<RegisteredAgent[]> {
    return (await this.list({ skill, limit: Number.MAX_SAFE_INTEGER })).items;
  }

  private async findCandidateIds(query: AgentListQuery): Promise<string[]> {
    const candidateSets: string[][] = [];

    if (query.isPublic === true) {
      candidateSets.push(await this.readIndex(this.indexKey('public', 'true')));
    } else if (query.tenantId && query.includePublic) {
      candidateSets.push(
        uniqueValues([
          ...(await this.readIndex(this.indexKey('tenant', query.tenantId))),
          ...(await this.readIndex(this.indexKey('public', 'true'))),
        ]),
      );
    } else if (query.tenantId) {
      candidateSets.push(await this.readIndex(this.indexKey('tenant', query.tenantId)));
    }

    if (query.status) {
      candidateSets.push(await this.readIndex(this.indexKey('status', query.status)));
    }

    if (query.skill) {
      candidateSets.push(await this.lookupTerms('skill-terms', 'skill', query.skill));
    }

    if (query.tag) {
      candidateSets.push(await this.lookupTerms('tag-terms', 'tag', query.tag));
    }

    if (query.name) {
      candidateSets.push(await this.lookupTerms('name-terms', 'name', query.name));
    }

    if (query.transport) {
      candidateSets.push(await this.readIndex(this.indexKey('transport', query.transport)));
    }

    if (query.mcpCompatible === true) {
      candidateSets.push(await this.readIndex(this.indexKey('mcp', 'true')));
    }

    if (query.mcpCompatible === false) {
      const allIds = await this.readMetaIds('agent-ids');
      const mcpIds = new Set(await this.readIndex(this.indexKey('mcp', 'true')));
      candidateSets.push(allIds.filter((id) => !mcpIds.has(id)));
    }

    if (candidateSets.length === 0) {
      return await this.readMetaIds('agent-ids');
    }

    return intersectArrays(candidateSets);
  }

  private async lookupTerms(metaKey: string, namespace: string, query: string): Promise<string[]> {
    const terms = await this.readMetaIds(metaKey);
    const matchingTerms = terms.filter((term) => termMatchesQuery(term, query.toLowerCase()));
    const matches = await Promise.all(
      matchingTerms.map((term) => this.readIndex(this.indexKey(namespace, term))),
    );
    return uniqueValues(matches.flat());
  }

  private async loadAgents(ids: string[]): Promise<RegisteredAgent[]> {
    if (ids.length === 0) {
      return [];
    }

    const agents = await Promise.all(ids.map((id) => this.get(id)));
    return agents.filter((agent): agent is RegisteredAgent => agent !== null);
  }

  private matchesVisibility(
    agent: RegisteredAgent,
    query: Pick<AgentListQuery, 'tenantId' | 'includePublic' | 'isPublic'>,
  ): boolean {
    if (query.isPublic === true) {
      return agent.isPublic === true;
    }
    if (query.tenantId && query.includePublic) {
      return agent.tenantId === query.tenantId || agent.isPublic === true;
    }
    if (query.tenantId) {
      return agent.tenantId === query.tenantId;
    }
    return true;
  }

  private async addIndexes(agent: RegisteredAgent): Promise<void> {
    const terms = buildAgentIndexTerms(agent);
    await this.addMetaValue('agent-ids', agent.id);
    await this.addIndexValue('status', terms.status, agent.id);
    if (terms.tenantId) {
      await this.addMetaValue('tenant-terms', terms.tenantId);
      await this.addIndexValue('tenant', terms.tenantId, agent.id);
    }
    if (terms.isPublic) {
      await this.addIndexValue('public', 'true', agent.id);
    }
    for (const term of terms.skills) {
      await this.addMetaValue('skill-terms', term);
      await this.addIndexValue('skill', term, agent.id);
    }
    for (const term of terms.tags) {
      await this.addMetaValue('tag-terms', term);
      await this.addIndexValue('tag', term, agent.id);
    }
    for (const term of terms.names) {
      await this.addMetaValue('name-terms', term);
      await this.addIndexValue('name', term, agent.id);
    }
    await this.addMetaValue('transport-terms', terms.transport);
    await this.addIndexValue('transport', terms.transport, agent.id);
    if (terms.mcpCompatible) {
      await this.addIndexValue('mcp', 'true', agent.id);
    }
  }

  private async removeIndexes(agent: RegisteredAgent): Promise<void> {
    const terms = buildAgentIndexTerms(agent);
    await this.removeMetaValue('agent-ids', agent.id);
    await this.removeIndexValue('status', terms.status, agent.id);
    if (terms.tenantId) {
      await this.removeIndexValue('tenant', terms.tenantId, agent.id);
      if ((await this.readIndex(this.indexKey('tenant', terms.tenantId))).length === 0) {
        await this.removeMetaValue('tenant-terms', terms.tenantId);
      }
    }
    if (terms.isPublic) {
      await this.removeIndexValue('public', 'true', agent.id);
    }
    for (const term of terms.skills) {
      await this.removeIndexValue('skill', term, agent.id);
      if ((await this.readIndex(this.indexKey('skill', term))).length === 0) {
        await this.removeMetaValue('skill-terms', term);
      }
    }
    for (const term of terms.tags) {
      await this.removeIndexValue('tag', term, agent.id);
      if ((await this.readIndex(this.indexKey('tag', term))).length === 0) {
        await this.removeMetaValue('tag-terms', term);
      }
    }
    for (const term of terms.names) {
      await this.removeIndexValue('name', term, agent.id);
      if ((await this.readIndex(this.indexKey('name', term))).length === 0) {
        await this.removeMetaValue('name-terms', term);
      }
    }
    await this.removeIndexValue('transport', terms.transport, agent.id);
    if ((await this.readIndex(this.indexKey('transport', terms.transport))).length === 0) {
      await this.removeMetaValue('transport-terms', terms.transport);
    }
    if (terms.mcpCompatible) {
      await this.removeIndexValue('mcp', 'true', agent.id);
    }
  }

  private async addIndexValue(namespace: string, value: string, id: string): Promise<void> {
    const key = this.indexKey(namespace, value);
    const ids = uniqueValues([...(await this.readIndex(key)), id]);
    await this.client.set(key, JSON.stringify(ids));
  }

  private async removeIndexValue(namespace: string, value: string, id: string): Promise<void> {
    const key = this.indexKey(namespace, value);
    const ids = (await this.readIndex(key)).filter((candidate) => candidate !== id);
    if (ids.length === 0) {
      await this.client.del(key);
      return;
    }
    await this.client.set(key, JSON.stringify(ids));
  }

  private async addMetaValue(metaKey: string, value: string): Promise<void> {
    const values = uniqueValues([...(await this.readMetaIds(metaKey)), value]);
    await this.client.set(this.metaKey(metaKey), JSON.stringify(values));
  }

  private async removeMetaValue(metaKey: string, value: string): Promise<void> {
    const values = (await this.readMetaIds(metaKey)).filter((entry) => entry !== value);
    if (values.length === 0) {
      await this.client.del(this.metaKey(metaKey));
      return;
    }
    await this.client.set(this.metaKey(metaKey), JSON.stringify(values));
  }

  private async readMetaIds(metaKey: string): Promise<string[]> {
    return this.readJsonArray(this.metaKey(metaKey));
  }

  private async readIndex(key: string): Promise<string[]> {
    return this.readJsonArray(key);
  }

  private async readJsonArray(key: string): Promise<string[]> {
    const value = await this.client.get(key);
    if (!value) {
      return [];
    }

    return JSON.parse(value) as string[];
  }

  private key(id: string): string {
    return `${this.prefix}:${id}`;
  }

  private metaKey(name: string): string {
    return `${this.prefix}:meta:${name}`;
  }

  private indexKey(namespace: string, value: string): string {
    return `${this.prefix}:idx:${namespace}:${value}`;
  }
}

function parseCursor(cursor: string | undefined): number {
  const parsed = Number(cursor ?? '0');
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function uniqueValues(values: string[]): string[] {
  return Array.from(new Set(values));
}

function intersectArrays(values: string[][]): string[] {
  const [first, ...rest] = values.sort((left, right) => left.length - right.length);
  if (!first) {
    return [];
  }
  return first.filter((value) => rest.every((entry) => entry.includes(value)));
}
