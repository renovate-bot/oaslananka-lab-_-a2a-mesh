import { describe, expect, it } from 'vitest';
import { RuntimeMetrics } from '../src/telemetry/RuntimeMetrics.js';
import type { Task, TaskState } from '../src/types/task.js';

function task(state: TaskState, durationMs?: number | string): Task {
  const result: Task = {
    id: `task-${state}`,
    contextId: 'ctx',
    status: { state, timestamp: new Date().toISOString() },
    history: [],
    artifacts: [],
  };
  if (durationMs !== undefined) {
    result.metadata = { durationMs };
  }
  return result;
}

describe('RuntimeMetrics', () => {
  it('records task transitions, durations, SSE lifecycle and escaped labels', () => {
    const metrics = new RuntimeMetrics({
      serviceName: 'svc"quoted',
      serviceVersion: '1\\2',
    });

    metrics.recordTaskCreated();
    metrics.recordTaskStateChange(task('working'), 'submitted');
    metrics.recordTaskStateChange(task('working'), 'working');
    metrics.recordTaskStateChange(task('completed', 75), 'working');
    metrics.recordTaskStateChange(task('failed', '250'), 'working');
    metrics.recordTaskStateChange(task('canceled'), 'working');
    metrics.recordTaskStateChange(task('input-required'), 'submitted');
    metrics.recordAuthReject();
    metrics.recordSseConnectionOpened();
    metrics.recordSseConnectionOpened(true);
    metrics.recordSseConnectionClosed();
    metrics.recordSseConnectionClosed();
    metrics.recordSseConnectionClosed();

    const output = metrics.renderPrometheus({
      total: 4,
      active: 2,
      completed: 1,
      failed: 1,
      canceled: 1,
      submitted: 0,
      queued: 0,
      inputRequired: 0,
      waitingOnExternal: 0,
      working: 1,
    });

    expect(output).toContain('service_name="svc\\"quoted",service_version="1\\\\2"');
    expect(output).toContain('a2a_runtime_task_created_total');
    expect(output).toContain('a2a_runtime_task_started_total');
    expect(output).toContain('a2a_runtime_task_completed_total');
    expect(output).toContain('a2a_runtime_task_failed_total');
    expect(output).toContain('a2a_runtime_task_canceled_total');
    expect(output).toContain('a2a_runtime_auth_rejected_total');
    expect(output).toContain('a2a_runtime_sse_reconnect_total');
    expect(output).toContain('a2a_runtime_sse_connections_active');
    expect(output).toContain('a2a_runtime_tasks_active');
    expect(output).toContain('a2a_runtime_task_duration_ms_bucket');
    expect(output).toContain('a2a_runtime_task_duration_ms_sum');
    expect(output).toContain('a2a_runtime_task_duration_ms_count');
  });
});
