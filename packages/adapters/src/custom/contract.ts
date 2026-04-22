import type { Artifact, ExtensibleArtifact, Message, Part, Task, TextPart } from 'a2a-mesh';

export type AdapterCompatibility = 'stable' | 'beta';

export interface AdapterContractMetadata {
  provider: string;
  compatibility: AdapterCompatibility;
  supportsStreaming: boolean;
  supportsCancellation: boolean;
  outputType: 'text';
}

export class AdapterContractError extends Error {
  constructor(
    readonly code: 'UNSUPPORTED_INPUT' | 'PROVIDER_ERROR',
    message: string,
  ) {
    super(message);
  }
}

export function extractRequiredText(parts: Part[], provider: string): string {
  const text = extractText(parts);
  if (!text) {
    throw new AdapterContractError('UNSUPPORTED_INPUT', `${provider} adapter requires text input`);
  }
  return text;
}

export function extractText(parts: Part[]): string {
  return parts
    .filter((part): part is TextPart => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
}

export function normalizeConversation(task: Task, message: Message) {
  return {
    history: task.history
      .filter((entry) => entry.messageId !== message.messageId)
      .map((entry) => ({
        role: entry.role === 'agent' ? 'assistant' : 'user',
        content: extractText(entry.parts),
      }))
      .filter((entry) => entry.content.length > 0),
    inputText: extractRequiredText(message.parts, 'Provider'),
  };
}

export function createTextArtifact(
  task: Task,
  options: {
    artifactId: string;
    name: string;
    description?: string;
    text: string;
    provider: string;
    compatibility: AdapterCompatibility;
    model?: string;
    streamed?: boolean;
    supportsStreaming: boolean;
    supportsCancellation?: boolean;
    extensions?: string[];
    metadata?: Record<string, unknown>;
  },
): Artifact | ExtensibleArtifact {
  return {
    artifactId: options.artifactId,
    name: options.name,
    ...(options.description ? { description: options.description } : {}),
    parts: [{ type: 'text', text: options.text }],
    index: 0,
    lastChunk: true,
    metadata: {
      ...(options.metadata ?? {}),
      provider: options.provider,
      ...(options.model ? { model: options.model } : {}),
      taskId: task.id,
      ...(task.contextId ? { contextId: task.contextId } : {}),
      contract: {
        provider: options.provider,
        compatibility: options.compatibility,
        supportsStreaming: options.supportsStreaming,
        supportsCancellation: options.supportsCancellation ?? false,
        outputType: 'text',
        ...(options.streamed !== undefined ? { streamed: options.streamed } : {}),
      } satisfies AdapterContractMetadata & { streamed?: boolean },
    },
    ...(options.extensions?.length ? { extensions: options.extensions } : {}),
  };
}
