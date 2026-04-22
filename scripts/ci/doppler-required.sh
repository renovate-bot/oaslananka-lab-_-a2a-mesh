#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "Usage: scripts/ci/doppler-required.sh SECRET_NAME [SECRET_NAME...]" >&2
  exit 2
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

"$script_dir/doppler-run.sh" sh -c '
missing=0
for name do
  if [ -z "$(printenv "$name")" ]; then
    echo "Missing Doppler secret: $name" >&2
    missing=1
  else
    echo "Doppler secret present: $name"
  fi
done
exit "$missing"
' sh "$@"
