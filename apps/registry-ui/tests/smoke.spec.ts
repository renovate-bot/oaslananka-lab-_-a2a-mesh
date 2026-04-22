import { expect, test } from '@playwright/test';

function installMockEventSource(page: Parameters<typeof test>[0]['page']) {
  return page.addInitScript(() => {
    class MockEventSource {
      url: string;
      onmessage: ((event: MessageEvent<string>) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;

      constructor(url: string) {
        this.url = url;
        window.setTimeout(() => {
          if (this.url.includes('/tasks/stream')) {
            this.onmessage?.(
              new MessageEvent('message', {
                data: JSON.stringify({
                  taskId: 'task-2',
                  agentId: 'agent-2',
                  agentName: 'Writer Agent',
                  agentUrl: 'http://localhost:3002',
                  status: 'working',
                  updatedAt: '2026-04-06T10:00:03.000Z',
                  summary: 'Drafting final report from research output.',
                  historyCount: 4,
                  artifactCount: 0,
                  task: {
                    id: 'task-2',
                    status: { state: 'working', timestamp: '2026-04-06T10:00:03.000Z' },
                  },
                }),
              }),
            );
          } else {
            this.onmessage?.(
              new MessageEvent('message', {
                data: JSON.stringify({
                  id: 'agent-1',
                  url: 'http://localhost:3001',
                  status: 'healthy',
                  tenantId: 'tenant-a',
                  card: {
                    name: 'Researcher Agent',
                    description: 'Finds and synthesizes information.',
                    version: '1.0.0',
                    transport: 'http',
                    capabilities: { streaming: true, mcpCompatible: true },
                    skills: [
                      {
                        id: 'research',
                        name: 'Research',
                        description: 'Researches topics',
                        tags: ['web'],
                      },
                    ],
                  },
                }),
              }),
            );
          }
        }, 50);
      }

      close() {}
    }

    window.EventSource = MockEventSource as unknown as typeof EventSource;
  });
}

test('renders readonly public discovery mode', async ({ page }) => {
  await page.route('**/api/agents', async (route) => {
    await route.fulfill({ status: 401, body: 'Unauthorized' });
  });
  await page.route('**/api/agents?public=true', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'agent-public',
          url: 'https://public.example/agent',
          status: 'healthy',
          isPublic: true,
          card: {
            name: 'Public Research Agent',
            description: 'Publicly discoverable research endpoint.',
            version: '1.0.0',
            transport: 'http',
            capabilities: { streaming: true },
            skills: [{ id: 'public-research', name: 'Research', description: 'Finds facts' }],
          },
        },
      ]),
    });
  });
  await page.route('**/api/metrics/summary', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        registrations: 1,
        searches: 0,
        heartbeats: 0,
        agentCount: 1,
        healthyAgents: 1,
        unhealthyAgents: 0,
        unknownAgents: 0,
        activeTenants: 0,
        publicAgents: 1,
      }),
    });
  });
  await page.route('**/api/tasks/recent?limit=30', async (route) => {
    await route.fulfill({ status: 401, body: 'Unauthorized' });
  });
  await installMockEventSource(page);

  await page.goto('/');

  await expect(page.getByText('a2a-mesh operator console')).toBeVisible();
  await expect(page.getByText('Public discovery mode')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Public Research Agent' })).toBeVisible();
  await expect(page.getByText('Live task feeds and admin actions are hidden')).toBeVisible();
});

test('renders authenticated fleet, topology, and task stream', async ({ page }) => {
  await page.route('**/api/agents', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'agent-1',
          url: 'http://localhost:3001',
          status: 'healthy',
          tenantId: 'tenant-a',
          lastHeartbeatAt: '2026-04-06T10:04:00.000Z',
          lastSuccessAt: '2026-04-06T10:02:00.000Z',
          card: {
            name: 'Researcher Agent',
            description: 'Finds and synthesizes information.',
            version: '1.0.0',
            transport: 'http',
            capabilities: { streaming: true, mcpCompatible: true },
            skills: [
              {
                id: 'research',
                name: 'Research',
                description: 'Researches topics',
                tags: ['web'],
              },
            ],
          },
        },
        {
          id: 'agent-2',
          url: 'http://localhost:3002',
          status: 'unhealthy',
          tenantId: 'tenant-a',
          consecutiveFailures: 2,
          card: {
            name: 'Writer Agent',
            description: 'Polishes output into a report.',
            version: '1.0.0',
            transport: 'http',
            capabilities: { streaming: true },
            skills: [
              {
                id: 'write',
                name: 'Write',
                description: 'Creates polished output',
                tags: ['text'],
              },
            ],
          },
        },
      ]),
    });
  });

  await page.route('**/api/metrics/summary', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        registrations: 12,
        searches: 8,
        heartbeats: 42,
        agentCount: 2,
        healthyAgents: 1,
        unhealthyAgents: 1,
        unknownAgents: 0,
        activeTenants: 1,
        publicAgents: 0,
      }),
    });
  });

  await page.route('**/api/tasks/recent?limit=30', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([
        {
          taskId: 'task-1',
          agentId: 'agent-1',
          agentName: 'Researcher Agent',
          agentUrl: 'http://localhost:3001',
          status: 'completed',
          updatedAt: '2026-04-06T10:00:00.000Z',
          summary: 'Collected and summarized research findings.',
          historyCount: 3,
          artifactCount: 1,
          task: {
            id: 'task-1',
            status: { state: 'completed', timestamp: '2026-04-06T10:00:00.000Z' },
          },
        },
      ]),
    });
  });

  await installMockEventSource(page);

  await page.goto('/');

  await expect(page.getByText('Operator mode')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Researcher Agent' })).toBeVisible();
  await expect(page.getByRole('cell', { name: /Writer Agent/ })).toBeVisible();

  await page.getByRole('button', { name: 'Live Topology' }).click();
  await expect(page.getByText('Live agent mesh')).toBeVisible();

  await page.getByRole('button', { name: 'Task Stream' }).click();
  await expect(page.getByText('Recent task events')).toBeVisible();
  await expect(page.getByText('Collected and summarized research findings.').first()).toBeVisible();
});

test('filters agents by search query', async ({ page }) => {
  await page.route('**/api/agents', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'agent-1',
          url: 'http://localhost:3001',
          status: 'healthy',
          tenantId: 'tenant-a',
          card: {
            name: 'Researcher Agent',
            description: 'Finds facts',
            version: '1.0.0',
            transport: 'http',
            capabilities: { streaming: true },
            skills: [{ id: 'research', name: 'Research', description: 'Researches topics' }],
          },
        },
        {
          id: 'agent-2',
          url: 'http://localhost:3002',
          status: 'healthy',
          tenantId: 'tenant-a',
          card: {
            name: 'Writer Agent',
            description: 'Writes reports',
            version: '1.0.0',
            transport: 'http',
            capabilities: { streaming: true },
            skills: [{ id: 'write', name: 'Write', description: 'Writes output' }],
          },
        },
      ]),
    });
  });
  await page.route('**/api/metrics/summary', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        registrations: 2,
        searches: 0,
        heartbeats: 0,
        agentCount: 2,
        healthyAgents: 2,
        unhealthyAgents: 0,
        unknownAgents: 0,
        activeTenants: 1,
        publicAgents: 0,
      }),
    });
  });
  await page.route('**/api/tasks/recent?limit=30', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: '[]' });
  });
  await installMockEventSource(page);

  await page.goto('/');
  await page.getByPlaceholder('Search by name, skill, tag, or tenant').fill('writer');

  await expect(page.getByRole('heading', { name: 'Writer Agent' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Researcher Agent' })).toHaveCount(0);
});
