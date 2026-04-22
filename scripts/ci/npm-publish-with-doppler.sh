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

for workspace in packages/core packages/adapters packages/registry cli packages/create-a2a-agent; do
  npm publish --provenance --access public --workspace "$workspace"
done
BASH
