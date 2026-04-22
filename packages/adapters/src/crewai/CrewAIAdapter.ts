/**
 * @file CrewAIAdapter.ts
 * Thin HTTP bridge adapter for CrewAI Python services.
 *
 * @beta
 */

import { BaseAdapter } from '../custom/BaseAdapter.js';
import { fetchWithPolicy } from 'a2a-mesh';
import { logger, normalizeAgentCard } from 'a2a-mesh';
import type { AnyAgentCard, ExtensibleArtifact, Message, Task } from 'a2a-mesh';
import { createTextArtifact, extractText } from '../custom/contract.js';

/**
 * Thin HTTP bridge adapter for CrewAI Python services.
 *
 * @beta
 * @since 1.0.0
 */
export class CrewAIAdapter extends BaseAdapter {
  constructor(
    card: AnyAgentCard,
    private readonly bridgeUrl: string,
  ) {
    super(normalizeAgentCard(card));
  }

  async handleTask(task: Task, message: Message): Promise<ExtensibleArtifact[]> {
    logger.info('CrewAI bridge processing task', {
      taskId: task.id,
      ...(task.contextId ? { contextId: task.contextId } : {}),
    });

    const response = await fetchWithPolicy(
      this.bridgeUrl,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          taskId: task.id,
          contextId: task.contextId,
          message: extractText(message.parts),
          history: task.history.map((entry) => ({
            role: entry.role,
            content: extractText(entry.parts),
          })),
        }),
      },
      { timeoutMs: 60000, retries: 2 },
    );

    if (!response.ok) {
      throw new Error(`CrewAI bridge failed with status ${response.status}`);
    }

    const json = (await response.json()) as {
      output?: string;
      metadata?: Record<string, unknown>;
    };

    const artifact = createTextArtifact(task, {
      artifactId: `crewai-${Date.now()}`,
      name: 'CrewAI Response',
      text: json.output ?? '',
      provider: 'crewai',
      compatibility: 'beta',
      supportsStreaming: false,
      metadata: {
        ...(json.metadata ?? {}),
      },
    }) as ExtensibleArtifact;
    return [artifact];
  }
}
