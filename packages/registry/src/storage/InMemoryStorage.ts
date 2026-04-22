import type { IAgentStorage, AgentStatus, RegisteredAgent } from './IAgentStorage.js';
import {
  buildAgentIndexTerms,
  type AgentListQuery,
  type AgentListResult,
  type AgentStorageSummary,
  termMatchesQuery,
} from './indexing.js';

export class InMemoryStorage implements IAgentStorage {
  private readonly agents = new Map<string, RegisteredAgent>();
  private readonly statusIndex = new Map<AgentStatus, Set<string>>([
    ['healthy', new Set()],
    ['unhealthy', new Set()],
    ['unknown', new Set()],
  ]);
  private readonly tenantIndex = new Map<string, Set<string>>();
  private readonly publicIndex = new Set<string>();
  private readonly skillIndex = new Map<string, Set<string>>();
  private readonly tagIndex = new Map<string, Set<string>>();
  private readonly nameIndex = new Map<string, Set<string>>();
  private readonly transportIndex = new Map<string, Set<string>>();
  private readonly mcpCompatibleIndex = new Set<string>();

  async upsert(agent: RegisteredAgent): Promise<RegisteredAgent> {
    const previous = this.agents.get(agent.id);
    if (previous) {
      this.removeFromIndexes(previous);
    }

    this.agents.set(agent.id, agent);
    this.addToIndexes(agent);
    return agent;
  }

  async get(id: string): Promise<RegisteredAgent | null> {
    return this.agents.get(id) ?? null;
  }

  async getAll(): Promise<RegisteredAgent[]> {
    return this.sortAgents(Array.from(this.agents.values()));
  }

  async list(query: AgentListQuery = {}): Promise<AgentListResult> {
    const candidateIds = this.findCandidateIds(query);
    let agents = Array.from(candidateIds)
      .map((id) => this.agents.get(id))
      .filter((agent): agent is RegisteredAgent => agent !== undefined);

    agents = agents.filter((agent) => this.matchesAgent(agent, query));
    const sortedAgents = this.sortAgents(agents);
    const offset = parseCursor(query.cursor);
    const limit = query.limit ?? 50;
    const items = sortedAgents.slice(offset, offset + limit);

    return {
      items,
      total: sortedAgents.length,
      nextCursor:
        offset + items.length < sortedAgents.length ? String(offset + items.length) : null,
    };
  }

  async summarize(
    query: Pick<AgentListQuery, 'tenantId' | 'includePublic' | 'isPublic'> = {},
  ): Promise<AgentStorageSummary> {
    const filteredIds = this.findCandidateIds(query);
    const agents = Array.from(filteredIds)
      .map((id) => this.agents.get(id))
      .filter((agent): agent is RegisteredAgent => agent !== undefined)
      .filter((agent) => this.matchesVisibility(agent, query));

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
    const current = this.agents.get(id);
    if (!current) {
      return false;
    }

    this.removeFromIndexes(current);
    return this.agents.delete(id);
  }

  async updateStatus(
    id: string,
    status: AgentStatus,
    meta?: { consecutiveFailures?: number; lastSuccessAt?: string },
  ): Promise<void> {
    const current = this.agents.get(id);
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

  private addToIndexes(agent: RegisteredAgent): void {
    const terms = buildAgentIndexTerms(agent);
    this.statusIndex.get(terms.status)?.add(agent.id);
    if (terms.tenantId) {
      this.addIndexValue(this.tenantIndex, terms.tenantId, agent.id);
    }
    if (terms.isPublic) {
      this.publicIndex.add(agent.id);
    }
    terms.skills.forEach((term) => this.addIndexValue(this.skillIndex, term, agent.id));
    terms.tags.forEach((term) => this.addIndexValue(this.tagIndex, term, agent.id));
    terms.names.forEach((term) => this.addIndexValue(this.nameIndex, term, agent.id));
    this.addIndexValue(this.transportIndex, terms.transport, agent.id);
    if (terms.mcpCompatible) {
      this.mcpCompatibleIndex.add(agent.id);
    }
  }

  private removeFromIndexes(agent: RegisteredAgent): void {
    const terms = buildAgentIndexTerms(agent);
    this.statusIndex.get(terms.status)?.delete(agent.id);
    if (terms.tenantId) {
      this.removeIndexValue(this.tenantIndex, terms.tenantId, agent.id);
    }
    this.publicIndex.delete(agent.id);
    terms.skills.forEach((term) => this.removeIndexValue(this.skillIndex, term, agent.id));
    terms.tags.forEach((term) => this.removeIndexValue(this.tagIndex, term, agent.id));
    terms.names.forEach((term) => this.removeIndexValue(this.nameIndex, term, agent.id));
    this.removeIndexValue(this.transportIndex, terms.transport, agent.id);
    this.mcpCompatibleIndex.delete(agent.id);
  }

  private findCandidateIds(query: Pick<AgentListQuery, keyof AgentListQuery>): Set<string> {
    const candidateSets: Set<string>[] = [];

    if (query.isPublic === true) {
      candidateSets.push(new Set(this.publicIndex));
    } else if (query.tenantId && query.includePublic) {
      candidateSets.push(
        unionSets(this.tenantIndex.get(query.tenantId) ?? new Set(), this.publicIndex),
      );
    } else if (query.tenantId) {
      candidateSets.push(new Set(this.tenantIndex.get(query.tenantId) ?? []));
    }

    if (query.status) {
      candidateSets.push(new Set(this.statusIndex.get(query.status) ?? []));
    }

    if (query.skill) {
      candidateSets.push(this.lookupQueryTerms(this.skillIndex, query.skill));
    }

    if (query.tag) {
      candidateSets.push(this.lookupQueryTerms(this.tagIndex, query.tag));
    }

    if (query.name) {
      candidateSets.push(this.lookupQueryTerms(this.nameIndex, query.name));
    }

    if (query.transport) {
      candidateSets.push(new Set(this.transportIndex.get(query.transport) ?? []));
    }

    if (query.mcpCompatible === true) {
      candidateSets.push(new Set(this.mcpCompatibleIndex));
    }
    if (query.mcpCompatible === false) {
      candidateSets.push(
        new Set(Array.from(this.agents.keys()).filter((id) => !this.mcpCompatibleIndex.has(id))),
      );
    }

    if (candidateSets.length === 0) {
      return new Set(this.agents.keys());
    }

    return intersectSets(candidateSets);
  }

  private lookupQueryTerms(index: Map<string, Set<string>>, query: string): Set<string> {
    const normalized = query.toLowerCase();
    const matches = Array.from(index.entries())
      .filter(([term]) => termMatchesQuery(term, normalized))
      .map(([, ids]) => ids);

    return unionMany(matches);
  }

  private matchesAgent(agent: RegisteredAgent, query: AgentListQuery): boolean {
    return this.matchesVisibility(agent, query);
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

  private addIndexValue(index: Map<string, Set<string>>, key: string, id: string): void {
    const values = index.get(key) ?? new Set<string>();
    values.add(id);
    index.set(key, values);
  }

  private removeIndexValue(index: Map<string, Set<string>>, key: string, id: string): void {
    const values = index.get(key);
    values?.delete(id);
    if (values?.size === 0) {
      index.delete(key);
    }
  }

  private sortAgents(agents: RegisteredAgent[]): RegisteredAgent[] {
    return agents.sort((left, right) => {
      const leftTime = Date.parse(left.registeredAt);
      const rightTime = Date.parse(right.registeredAt);
      return rightTime - leftTime;
    });
  }
}

function parseCursor(cursor: string | undefined): number {
  const parsed = Number(cursor ?? '0');
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function intersectSets(sets: Set<string>[]): Set<string> {
  const [first, ...rest] = sets.sort((left, right) => left.size - right.size);
  const result = new Set(first);

  for (const value of Array.from(result)) {
    if (!rest.every((set) => set.has(value))) {
      result.delete(value);
    }
  }

  return result;
}

function unionSets(left: Set<string>, right: Set<string>): Set<string> {
  return new Set([...left, ...right]);
}

function unionMany(sets: Set<string>[]): Set<string> {
  const values = new Set<string>();
  for (const set of sets) {
    for (const value of set) {
      values.add(value);
    }
  }
  return values;
}
