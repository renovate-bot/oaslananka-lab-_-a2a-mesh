#!/usr/bin/env bash
set -euo pipefail

: "${DOPPLER_TOKEN:?DOPPLER_TOKEN is required for Doppler-backed operations.}"

export DOPPLER_PROJECT="${DOPPLER_PROJECT:-all}"
export DOPPLER_CONFIG="${DOPPLER_CONFIG:-main}"

if ! command -v doppler >/dev/null 2>&1; then
  echo "doppler CLI is not installed. Run scripts/ci/install-doppler-cli.sh first." >&2
  exit 1
fi

exec doppler run --project "$DOPPLER_PROJECT" --config "$DOPPLER_CONFIG" -- "$@"
