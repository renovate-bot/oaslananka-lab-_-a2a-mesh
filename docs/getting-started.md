# Getting Started

## Prerequisites

- Node.js 22.13 or newer
- pnpm workspaces enabled through the repository root
- An A2A-compatible agent URL for local testing

## Install and build

```bash
pnpm install
pnpm run build
```

## Start a local agent

Create an agent using `BaseAdapter` from `a2a-mesh-adapters` and expose it on port `3000`.

```ts
import { BaseAdapter } from 'a2a-mesh-adapters';
import type { Artifact, Message, Task } from 'a2a-mesh';

class HelloAgent extends BaseAdapter {
  async handleTask(_task: Task, message: Message): Promise<Artifact[]> {
    const text = message.parts.find((part) => part.type === 'text');
    return [
      {
        artifactId: 'hello-1',
        parts: [{ type: 'text', text: `Hello: ${text?.type === 'text' ? text.text : 'empty'}` }],
        index: 0,
        lastChunk: true,
      },
    ];
  }
}
```

## Discover the agent

```bash
pnpm dlx a2a-mesh-cli discover http://localhost:3000
```

This fetches `/.well-known/agent-card.json` and prints the normalized agent card.

## Send a task

```bash
pnpm dlx a2a-mesh-cli task send http://localhost:3000 "Summarize the latest meeting"
```

Use streaming when you want live state changes:

```bash
pnpm dlx a2a-mesh-cli task stream http://localhost:3000 "Show work in progress"
```

## Register agents locally

```bash
pnpm dlx a2a-mesh-cli registry start --port 3099
pnpm dlx a2a-mesh-cli registry list --url http://localhost:3099
```

## Recommended verification

```bash
pnpm run lint
pnpm run typecheck
pnpm run test -- --coverage
```
