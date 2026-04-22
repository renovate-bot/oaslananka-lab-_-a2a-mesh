import type { RegisteredAgent, AgentStatus } from './IAgentStorage.js';

export interface AgentListQuery {
  tenantId?: string | undefined;
  includePublic?: boolean | undefined;
  isPublic?: boolean | undefined;
  skill?: string | undefined;
  tag?: string | undefined;
  name?: string | undefined;
  transport?: 'http' | 'sse' | 'ws' | 'grpc' | undefined;
  status?: AgentStatus | undefined;
  mcpCompatible?: boolean | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
}

export interface AgentListResult {
  items: RegisteredAgent[];
  total: number;
  nextCursor: string | null;
}

export interface AgentStorageSummary {
  agentCount: number;
  healthyAgents: number;
  unhealthyAgents: number;
  unknownAgents: number;
  activeTenants: number;
  publicAgents: number;
}

export interface AgentIndexTerms {
  tenantId?: string | undefined;
  status: AgentStatus;
  isPublic: boolean;
  skills: string[];
  tags: string[];
  names: string[];
  transport: string;
  mcpCompatible: boolean;
}

export function buildAgentIndexTerms(agent: RegisteredAgent): AgentIndexTerms {
  return {
    tenantId: agent.tenantId,
    status: agent.status,
    isPublic: agent.isPublic === true,
    skills: uniqueTerms(
      [
        ...agent.skills,
        ...(agent.card.skills ?? []).flatMap((skill) => [skill.name, skill.description]),
      ].flatMap(tokenizeTerms),
    ),
    tags: uniqueTerms([
      ...tokenizeTerms(agent.tags.join(' ')),
      ...(agent.card.skills ?? []).flatMap((skill) => tokenizeTerms((skill.tags ?? []).join(' '))),
    ]),
    names: uniqueTerms(tokenizeTerms(agent.card.name)),
    transport: (agent.card.transport ?? 'http').toLowerCase(),
    mcpCompatible: agent.card.capabilities?.mcpCompatible === true,
  };
}

export function tokenizeTerms(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((term) => term.trim())
    .filter((term) => term.length > 0);
}

export function uniqueTerms(values: string[]): string[] {
  return Array.from(new Set(values));
}

export function termMatchesQuery(term: string, query: string): boolean {
  return term.includes(query.toLowerCase());
}
