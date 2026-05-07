# 0002 - Transport Protocol

**Status:** Accepted
**Date:** 2026-05-08
**Impacted Packages:** core, client, ws, grpc, registry

## Context

A2A agents need interoperable request/response and streaming behavior across runtimes and deployment targets.

## Decision

Use JSON-RPC over HTTP for core request handling, HTTP-SSE for task streaming, and keep WebSocket/gRPC packages as optional transports.

## Consequences

The default protocol remains simple to deploy and test, while specialized packages can support lower-latency or infrastructure-specific needs.
