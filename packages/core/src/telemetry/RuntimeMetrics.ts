import type { Task, TaskCounts, TaskState } from '../types/task.js';

export interface RuntimeMetricsOptions {
  serviceName: string;
  serviceVersion: string;
}

const DURATION_BUCKETS_MS = [50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000];

function escapeLabel(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

export class RuntimeMetrics {
  private readonly counters = new Map<string, number>();
  private readonly durationBuckets = new Map<number, number>();
  private durationCount = 0;
  private durationSum = 0;
  private sseActiveConnections = 0;

  constructor(private readonly options: RuntimeMetricsOptions) {
    for (const bucket of DURATION_BUCKETS_MS) {
      this.durationBuckets.set(bucket, 0);
    }
  }

  recordTaskCreated(): void {
    this.increment('a2a_runtime_task_created_total');
  }

  recordTaskStateChange(task: Task, previousState?: TaskState): void {
    if (task.status.state !== previousState) {
      this.increment(`a2a_runtime_task_state_transitions_total{state="${task.status.state}"}`);
    }

    switch (task.status.state) {
      case 'working':
        if (previousState !== 'working') {
          this.increment('a2a_runtime_task_started_total');
        }
        break;
      case 'completed':
        this.increment('a2a_runtime_task_completed_total');
        this.observeDuration(task);
        break;
      case 'failed':
        this.increment('a2a_runtime_task_failed_total');
        this.observeDuration(task);
        break;
      case 'canceled':
        this.increment('a2a_runtime_task_canceled_total');
        this.observeDuration(task);
        break;
      default:
        break;
    }
  }

  recordAuthReject(): void {
    this.increment('a2a_runtime_auth_rejected_total');
  }

  recordSseConnectionOpened(isReconnect = false): void {
    this.increment('a2a_runtime_sse_connections_total');
    if (isReconnect) {
      this.increment('a2a_runtime_sse_reconnect_total');
    }
    this.sseActiveConnections += 1;
  }

  recordSseConnectionClosed(): void {
    this.sseActiveConnections = Math.max(this.sseActiveConnections - 1, 0);
  }

  renderPrometheus(taskCounts: TaskCounts): string {
    const serviceLabels = `service_name="${escapeLabel(this.options.serviceName)}",service_version="${escapeLabel(this.options.serviceVersion)}"`;
    const lines = [
      '# HELP a2a_runtime_task_created_total Total tasks created by the runtime.',
      '# TYPE a2a_runtime_task_created_total counter',
      `${this.renderCounter('a2a_runtime_task_created_total')} `,
      '# HELP a2a_runtime_task_started_total Total tasks that entered working state.',
      '# TYPE a2a_runtime_task_started_total counter',
      `${this.renderCounter('a2a_runtime_task_started_total')} `,
      '# HELP a2a_runtime_task_completed_total Total tasks completed successfully.',
      '# TYPE a2a_runtime_task_completed_total counter',
      `${this.renderCounter('a2a_runtime_task_completed_total')} `,
      '# HELP a2a_runtime_task_failed_total Total tasks that failed.',
      '# TYPE a2a_runtime_task_failed_total counter',
      `${this.renderCounter('a2a_runtime_task_failed_total')} `,
      '# HELP a2a_runtime_task_canceled_total Total tasks canceled.',
      '# TYPE a2a_runtime_task_canceled_total counter',
      `${this.renderCounter('a2a_runtime_task_canceled_total')} `,
      '# HELP a2a_runtime_auth_rejected_total Total rejected authenticated requests.',
      '# TYPE a2a_runtime_auth_rejected_total counter',
      `${this.renderCounter('a2a_runtime_auth_rejected_total')} `,
      '# HELP a2a_runtime_sse_connections_total Total SSE connections opened.',
      '# TYPE a2a_runtime_sse_connections_total counter',
      `${this.renderCounter('a2a_runtime_sse_connections_total')} `,
      '# HELP a2a_runtime_sse_reconnect_total Total SSE reconnects detected.',
      '# TYPE a2a_runtime_sse_reconnect_total counter',
      `${this.renderCounter('a2a_runtime_sse_reconnect_total')} `,
      '# HELP a2a_runtime_sse_connections_active Active SSE connections.',
      '# TYPE a2a_runtime_sse_connections_active gauge',
      `a2a_runtime_sse_connections_active{${serviceLabels}} ${this.sseActiveConnections}`,
      '# HELP a2a_runtime_tasks_active Active tasks.',
      '# TYPE a2a_runtime_tasks_active gauge',
      `a2a_runtime_tasks_active{${serviceLabels}} ${taskCounts.active}`,
      '# HELP a2a_runtime_task_duration_ms Task duration in milliseconds.',
      '# TYPE a2a_runtime_task_duration_ms histogram',
      ...this.renderDurationHistogram(serviceLabels),
    ];

    return lines.join('\n').replaceAll(' \n', '\n');
  }

  private increment(metricName: string): void {
    this.counters.set(metricName, (this.counters.get(metricName) ?? 0) + 1);
  }

  private renderCounter(metricName: string): string {
    const serviceLabels = `service_name="${escapeLabel(this.options.serviceName)}",service_version="${escapeLabel(this.options.serviceVersion)}"`;
    return `${metricName}{${serviceLabels}} ${this.counters.get(metricName) ?? 0}`;
  }

  private observeDuration(task: Task): void {
    const durationMs =
      typeof task.metadata?.durationMs === 'number'
        ? task.metadata.durationMs
        : typeof task.metadata?.durationMs === 'string'
          ? Number(task.metadata.durationMs)
          : Number.NaN;
    if (!Number.isFinite(durationMs)) {
      return;
    }

    this.durationCount += 1;
    this.durationSum += durationMs;
    for (const bucket of DURATION_BUCKETS_MS) {
      if (durationMs <= bucket) {
        this.durationBuckets.set(bucket, (this.durationBuckets.get(bucket) ?? 0) + 1);
      }
    }
  }

  private renderDurationHistogram(serviceLabels: string): string[] {
    const lines = Array.from(this.durationBuckets.entries()).map(
      ([bucket, count]) =>
        `a2a_runtime_task_duration_ms_bucket{${serviceLabels},le="${bucket}"} ${count}`,
    );
    lines.push(
      `a2a_runtime_task_duration_ms_bucket{${serviceLabels},le="+Inf"} ${this.durationCount}`,
      `a2a_runtime_task_duration_ms_sum{${serviceLabels}} ${this.durationSum}`,
      `a2a_runtime_task_duration_ms_count{${serviceLabels}} ${this.durationCount}`,
    );
    return lines;
  }
}
