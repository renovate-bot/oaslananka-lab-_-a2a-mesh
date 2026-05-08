import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, '.artifacts/npm');
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
  const command = process.platform === 'win32' ? 'cmd.exe' : 'pnpm';
  const args =
    process.platform === 'win32'
      ? ['/d', '/s', '/c', 'pnpm', '--dir', packageDir, 'pack', '--pack-destination', outDir]
      : ['--dir', packageDir, 'pack', '--pack-destination', outDir];
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
