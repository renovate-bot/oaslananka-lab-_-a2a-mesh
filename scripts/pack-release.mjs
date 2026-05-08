import { mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const outDir = '.artifacts/npm';
const packageDirs = [
  'packages/core',
  'packages/adapters',
  'packages/registry',
  'cli',
  'packages/create-a2a-agent',
  'packages/mcp-bridge',
  'packages/ws',
];

await mkdir(outDir, { recursive: true });

for (const packageDir of packageDirs) {
  const packDestination = packageDir === 'cli' ? '../.artifacts/npm' : '../../.artifacts/npm';
  const command = process.platform === 'win32' ? 'cmd.exe' : 'pnpm';
  const args =
    process.platform === 'win32'
      ? [
          '/d',
          '/s',
          '/c',
          'pnpm',
          '--dir',
          packageDir,
          'pack',
          '--pack-destination',
          packDestination,
        ]
      : ['--dir', packageDir, 'pack', '--pack-destination', packDestination];
  const result = spawnSync(command, args, {
    stdio: 'inherit',
  });

  if (result.error) {
    console.error(result.error.message);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
