#!/usr/bin/env bash
set -euo pipefail

if command -v doppler >/dev/null 2>&1; then
  doppler --version
  exit 0
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required to install the Doppler CLI." >&2
  exit 1
fi

installer="$(mktemp)"
trap 'rm -f "$installer"' EXIT

curl -fsSL https://cli.doppler.com/install.sh -o "$installer"

if [ "$(id -u)" -eq 0 ]; then
  sh "$installer"
elif command -v sudo >/dev/null 2>&1; then
  sudo sh "$installer"
else
  sh "$installer"
fi

doppler --version
