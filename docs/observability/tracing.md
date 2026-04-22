# Tracing

This document describes the OpenTelemetry (OTel) hooks exposed by `a2a-mesh`.

## Span Coverage

When an RPC request is handled, `A2AServer` starts spans for:

- JSON-RPC handling
- task processing
- outbound HTTP through `fetchWithPolicy`
- SSE event delivery

Applications are responsible for installing the OTel provider/exporters before starting agents. Inbound W3C Trace Context extraction and cross-process propagation should be handled by your HTTP instrumentation or reverse proxy until the runtime grows a first-class bootstrap helper.

**Correlated Properties:**

- `traceId`: Available from the active OTel context when a provider/instrumentation is installed.
- `spanId`: Represents the current operation (e.g., `rpc.message/send`).
- `a2a.task_id`: Captured in baggage to trace a task across multiple agent hops.
- `a2a.context_id`: Used to relate multiple tasks participating in the same orchestration conversation.

Use these fields consistently in application logs and task metadata to correlate registry, client, and agent activity in systems like Jaeger, Datadog, or New Relic.
