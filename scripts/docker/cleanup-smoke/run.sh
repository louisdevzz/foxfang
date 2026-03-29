#!/usr/bin/env bash
set -euo pipefail

cd /repo

export FOXFANG_STATE_DIR="/tmp/foxfang-test"
export FOXFANG_CONFIG_PATH="${FOXFANG_STATE_DIR}/foxfang.json"

echo "==> Build"
pnpm build

echo "==> Seed state"
mkdir -p "${FOXFANG_STATE_DIR}/credentials"
mkdir -p "${FOXFANG_STATE_DIR}/agents/main/sessions"
echo '{}' >"${FOXFANG_CONFIG_PATH}"
echo 'creds' >"${FOXFANG_STATE_DIR}/credentials/marker.txt"
echo 'session' >"${FOXFANG_STATE_DIR}/agents/main/sessions/sessions.json"

echo "==> Reset (config+creds+sessions)"
pnpm foxfang reset --scope config+creds+sessions --yes --non-interactive

test ! -f "${FOXFANG_CONFIG_PATH}"
test ! -d "${FOXFANG_STATE_DIR}/credentials"
test ! -d "${FOXFANG_STATE_DIR}/agents/main/sessions"

echo "==> Recreate minimal config"
mkdir -p "${FOXFANG_STATE_DIR}/credentials"
echo '{}' >"${FOXFANG_CONFIG_PATH}"

echo "==> Uninstall (state only)"
pnpm foxfang uninstall --state --yes --non-interactive

test ! -d "${FOXFANG_STATE_DIR}"

echo "OK"
