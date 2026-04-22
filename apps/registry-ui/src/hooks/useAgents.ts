import { useCallback, useEffect, useState } from 'react';
import {
  fetchAgents,
  subscribeToAgentUpdates,
  type AgentFetchResult,
  type AgentStreamPayload,
  type RegisteredAgent,
  type RegistryAccessMode,
} from '../api/registry';

function applyAgentUpdate(
  currentAgents: RegisteredAgent[],
  payload: AgentStreamPayload,
): RegisteredAgent[] {
  if ('deleted' in payload) {
    return currentAgents.filter((agent) => agent.id !== payload.id);
  }

  const index = currentAgents.findIndex((agent) => agent.id === payload.id);
  if (index === -1) {
    return [payload, ...currentAgents];
  }

  const nextAgents = [...currentAgents];
  nextAgents[index] = payload;
  return nextAgents;
}

export function useAgents(pollIntervalMs = 5_000) {
  const [agents, setAgents] = useState<RegisteredAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accessMode, setAccessMode] = useState<RegistryAccessMode>('readonly-public');

  const load = useCallback(async (): Promise<AgentFetchResult | null> => {
    try {
      const nextAgents = await fetchAgents();
      setAgents(nextAgents.agents);
      setAccessMode(nextAgents.accessMode);
      setError(null);
      return nextAgents;
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load agents');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let unsubscribe: () => void = () => {};
    let stopped = false;

    void load().then((result) => {
      if (stopped || result?.accessMode !== 'authenticated') {
        return;
      }

      unsubscribe = subscribeToAgentUpdates(
        (payload) => {
          setAgents((currentAgents) => applyAgentUpdate(currentAgents, payload));
        },
        () => {
          setError((currentError) => currentError ?? 'Live registry updates disconnected');
        },
      );
    });

    const interval = window.setInterval(() => {
      void load();
    }, pollIntervalMs);

    return () => {
      stopped = true;
      window.clearInterval(interval);
      unsubscribe();
    };
  }, [load, pollIntervalMs]);

  return {
    agents,
    loading,
    error,
    accessMode,
    refresh: load,
  };
}
