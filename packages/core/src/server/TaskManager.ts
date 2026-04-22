/**
 * @file TaskManager.ts
 * Task lifecycle manager backed by a pluggable storage engine.
 */

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { InMemoryTaskStorage } from '../storage/InMemoryTaskStorage.js';
import type { ITaskStorage } from '../storage/ITaskStorage.js';
import type {
  ExtensibleArtifact,
  Message,
  PushNotificationConfig,
  Task,
  TaskCounts,
  TaskState,
  TaskStatus,
  TerminalTaskState,
} from '../types/task.js';

export type TaskUpdateReason = 'created' | 'message' | 'artifact' | 'state' | 'push-config';

export type TaskLifecycleErrorCode = 'INVALID_TASK_TRANSITION' | 'TASK_TERMINAL' | 'TASK_NOT_FOUND';

export class TaskLifecycleError extends Error {
  constructor(
    readonly code: TaskLifecycleErrorCode,
    message: string,
    readonly taskId?: string,
    readonly currentState?: TaskState,
    readonly nextState?: TaskState,
  ) {
    super(message);
  }
}

export interface TaskUpdatedEvent {
  task: Task;
  reason: TaskUpdateReason;
  previousState?: TaskState;
}

const TERMINAL_TASK_STATES = new Set<TerminalTaskState>(['completed', 'failed', 'canceled']);

const TASK_TRANSITIONS: Record<TaskState, ReadonlySet<TaskState>> = {
  submitted: new Set([
    'submitted',
    'queued',
    'working',
    'input-required',
    'waiting_on_external',
    'completed',
    'failed',
    'canceled',
  ]),
  queued: new Set([
    'queued',
    'working',
    'input-required',
    'waiting_on_external',
    'completed',
    'failed',
    'canceled',
  ]),
  working: new Set([
    'working',
    'input-required',
    'waiting_on_external',
    'completed',
    'failed',
    'canceled',
  ]),
  'input-required': new Set([
    'input-required',
    'working',
    'waiting_on_external',
    'completed',
    'failed',
    'canceled',
  ]),
  waiting_on_external: new Set([
    'waiting_on_external',
    'working',
    'input-required',
    'completed',
    'failed',
    'canceled',
  ]),
  completed: new Set(),
  failed: new Set(),
  canceled: new Set(),
};

function isTerminalTaskState(state: TaskState): state is TerminalTaskState {
  return TERMINAL_TASK_STATES.has(state as TerminalTaskState);
}

export class TaskManager extends EventEmitter {
  constructor(private readonly storage: ITaskStorage = new InMemoryTaskStorage()) {
    super();
  }

  /**
   * Creates a new task and stores it in memory.
   *
   * @param sessionId Optional session identifier.
   * @param contextId Optional conversation context identifier.
   * @returns Newly created task.
   */
  createTask(
    sessionId?: string,
    contextId?: string,
    principalId?: string,
    tenantId?: string,
  ): Task {
    const createdAt = new Date().toISOString();
    const task: Task = {
      kind: 'task',
      id: randomUUID(),
      status: {
        state: 'submitted',
        timestamp: createdAt,
      },
      history: [],
      artifacts: [],
      extensions: [],
      metadata: {
        createdAt,
      },
      ...(sessionId ? { sessionId } : {}),
      ...(contextId ? { contextId } : {}),
      ...(principalId ? { principalId } : {}),
      ...(tenantId ? { tenantId } : {}),
    };

    const storedTask = this.storage.insertTask(task);
    this.emitTaskUpdated(storedTask, 'created');
    return storedTask;
  }

  getTask(taskId: string): Task | undefined {
    return this.storage.getTask(taskId);
  }

  getAllTasks(): Task[] {
    return this.storage.getAllTasks();
  }

  getTasksByContext(contextId: string): Task[] {
    return this.storage.getTasksByContextId(contextId);
  }

  getTasksByContextId(contextId: string): Task[] {
    return this.getTasksByContext(contextId);
  }

  addHistoryMessage(taskId: string, message: Message): Task | undefined {
    const task = this.storage.getTask(taskId);
    if (!task) {
      return undefined;
    }
    this.assertTaskMutable(task, 'append history');

    task.history.push({
      ...message,
      ...((message.contextId ?? task.contextId)
        ? { contextId: message.contextId ?? task.contextId }
        : {}),
    });
    this.storage.saveTask(task);
    this.emitTaskUpdated(task, 'message');
    return task;
  }

  addArtifact(taskId: string, artifact: ExtensibleArtifact): Task | undefined {
    const task = this.storage.getTask(taskId);
    if (!task) {
      return undefined;
    }
    this.assertTaskMutable(task, 'append artifact');

    const nextArtifact: ExtensibleArtifact = {
      ...artifact,
      ...((artifact.extensions ?? task.extensions)
        ? { extensions: artifact.extensions ?? task.extensions }
        : {}),
      metadata: {
        ...(artifact.metadata ?? {}),
        ...(task.contextId ? { contextId: task.contextId } : {}),
      },
    };
    task.artifacts = [...(task.artifacts ?? []), nextArtifact];
    this.storage.saveTask(task);
    this.emitTaskUpdated(task, 'artifact');
    return task;
  }

  updateTaskState(
    taskId: string,
    state: TaskStatus['state'],
    historyMessage?: Message,
    metadata?: Record<string, unknown>,
  ): Task | undefined {
    const task = this.storage.getTask(taskId);
    if (!task) {
      return undefined;
    }
    const previousState = task.status.state;
    this.assertTransition(task, state);

    const timestamp = new Date().toISOString();
    task.status = {
      state,
      timestamp,
      ...(typeof metadata?.message === 'string' ? { message: metadata.message } : {}),
    };
    if (historyMessage) {
      task.history.push({
        ...historyMessage,
        ...((historyMessage.contextId ?? task.contextId)
          ? { contextId: historyMessage.contextId ?? task.contextId }
          : {}),
      });
    }
    const nextMetadata = { ...(task.metadata ?? {}), ...(metadata ?? {}) };
    if (state === 'working' && typeof nextMetadata.startedAt !== 'string') {
      nextMetadata.startedAt = timestamp;
    }
    if (isTerminalTaskState(state)) {
      nextMetadata.endedAt = timestamp;
      nextMetadata[`${state}At`] = timestamp;
      const startedAtValue =
        typeof nextMetadata.startedAt === 'string'
          ? Date.parse(nextMetadata.startedAt)
          : typeof nextMetadata.createdAt === 'string'
            ? Date.parse(nextMetadata.createdAt)
            : Number.NaN;
      const endedAtValue = Date.parse(timestamp);
      if (Number.isFinite(startedAtValue) && Number.isFinite(endedAtValue)) {
        nextMetadata.durationMs = Math.max(endedAtValue - startedAtValue, 0);
      }
    }
    task.metadata = nextMetadata;
    this.storage.saveTask(task);
    this.emitTaskUpdated(task, 'state', previousState);
    return task;
  }

  cancelTask(taskId: string): Task | undefined {
    return this.updateTaskState(taskId, 'canceled');
  }

  setPushNotification(
    taskId: string,
    config: PushNotificationConfig,
  ): PushNotificationConfig | undefined {
    const task = this.storage.getTask(taskId);
    if (!task) {
      return undefined;
    }
    this.assertTaskMutable(task, 'set push notification');

    const storedConfig = this.storage.setPushNotification(taskId, config);
    this.emitTaskUpdated(task, 'push-config');
    return storedConfig;
  }

  getPushNotification(taskId: string): PushNotificationConfig | undefined {
    return this.storage.getPushNotification(taskId);
  }

  setTaskExtensions(taskId: string, extensions: string[]): Task | undefined {
    const task = this.storage.getTask(taskId);
    if (!task) {
      return undefined;
    }
    this.assertTaskMutable(task, 'set extensions');

    task.extensions = extensions;
    this.storage.saveTask(task);
    return task;
  }

  getTaskCounts(): TaskCounts {
    return this.storage.getAllTasks().reduce<TaskCounts>(
      (counts, task) => {
        counts.total += 1;
        switch (task.status.state) {
          case 'submitted':
            counts.submitted += 1;
            counts.active += 1;
            break;
          case 'queued':
            counts.queued += 1;
            counts.active += 1;
            break;
          case 'working':
            counts.working += 1;
            counts.active += 1;
            break;
          case 'waiting_on_external':
            counts.waitingOnExternal += 1;
            counts.active += 1;
            break;
          case 'input-required':
            counts.inputRequired += 1;
            counts.active += 1;
            break;
          case 'completed':
            counts.completed += 1;
            break;
          case 'failed':
            counts.failed += 1;
            break;
          case 'canceled':
            counts.canceled += 1;
            break;
        }
        return counts;
      },
      {
        total: 0,
        active: 0,
        completed: 0,
        failed: 0,
        canceled: 0,
        submitted: 0,
        queued: 0,
        inputRequired: 0,
        waitingOnExternal: 0,
        working: 0,
      },
    );
  }

  private emitTaskUpdated(task: Task, reason: TaskUpdateReason, previousState?: TaskState): void {
    this.emit('taskUpdated', {
      task: structuredClone(task),
      reason,
      ...(previousState ? { previousState } : {}),
    } satisfies TaskUpdatedEvent);
  }

  private assertTaskMutable(task: Task, action: string): void {
    if (isTerminalTaskState(task.status.state)) {
      throw new TaskLifecycleError(
        'TASK_TERMINAL',
        `Cannot ${action} for terminal task ${task.id} in state ${task.status.state}`,
        task.id,
        task.status.state,
      );
    }
  }

  private assertTransition(task: Task, nextState: TaskState): void {
    const currentState = task.status.state;
    if (isTerminalTaskState(currentState)) {
      throw new TaskLifecycleError(
        'TASK_TERMINAL',
        `Task ${task.id} is already terminal in state ${currentState}`,
        task.id,
        currentState,
        nextState,
      );
    }

    if (TASK_TRANSITIONS[currentState].has(nextState)) {
      return;
    }

    throw new TaskLifecycleError(
      'INVALID_TASK_TRANSITION',
      `Invalid task transition from ${currentState} to ${nextState} for task ${task.id}`,
      task.id,
      currentState,
      nextState,
    );
  }
}
