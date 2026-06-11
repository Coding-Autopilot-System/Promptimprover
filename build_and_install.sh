#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PACKAGE_DIR="$SCRIPT_DIR/universal-refiner"

printf '%s\n' 'Validating and installing Universal Refiner...'
cd "$PACKAGE_DIR"
npm ci --no-fund
npm test
npm run build
npm install --global . --no-fund

command -v gemini-prompt-refiner >/dev/null 2>&1
VERSION=$(node -p "require('./package.json').version")
printf 'Prompt Refiner v%s installed: %s\n' "$VERSION" "$(command -v gemini-prompt-refiner)"