#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

"$script_dir/doppler-required.sh" NPM_TOKEN

"$script_dir/doppler-run.sh" bash -euo pipefail <<'BASH'
umask 077
npmrc="$(mktemp)"
trap 'rm -f "$npmrc"' EXIT

printf "//registry.npmjs.org/:_authToken=%s\n" "$NPM_TOKEN" > "$npmrc"
export NPM_CONFIG_USERCONFIG="$npmrc"
export NPM_CONFIG_PROVENANCE=true

if [ -n "${GITHUB_REPOSITORY:-}" ]; then
  node --input-type=module <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';

const repository = process.env.GITHUB_REPOSITORY;
const workspaces = [
  'packages/core',
  'packages/adapters',
  'packages/registry',
  'cli',
  'packages/create-a2a-agent',
  'packages/mcp-bridge',
  'packages/ws',
];

for (const workspace of workspaces) {
  const manifestPath = `${workspace}/package.json`;
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.repository = {
    ...(manifest.repository ?? {}),
    type: 'git',
    url: `git+https://github.com/${repository}.git`,
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}
NODE
fi

for workspace in packages/core packages/adapters packages/registry cli packages/create-a2a-agent packages/mcp-bridge packages/ws; do
  pnpm --dir "$workspace" publish --access public --no-git-checks
done
BASH
