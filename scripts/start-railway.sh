#!/usr/bin/env bash
set -euo pipefail

export NODE_ENV="${NODE_ENV:-production}"
export HOME="${HOME:-/data}"
export FOXFANG_HOME="${FOXFANG_HOME:-${HOME}/.foxfang}"
export FOXFANG_GATEWAY_PORT="${FOXFANG_GATEWAY_PORT:-${PORT:-8080}}"
export SIGNAL_HTTP_URL="${SIGNAL_HTTP_URL:-http://signal-api:8080}"

mkdir -p "${HOME}" "${FOXFANG_HOME}"

if [[ -z "${SETUP_USERNAME:-}" || -z "${SETUP_PASSWORD:-}" ]]; then
  echo "[Railway] WARNING: SETUP_USERNAME/SETUP_PASSWORD not set. /setup will return 503."
fi

CONFIG_PATH="${FOXFANG_HOME}/foxfang.json"

if [[ ! -f "${CONFIG_PATH}" ]]; then
  export FOXFANG_BOOTSTRAP_CONFIG_PATH="${CONFIG_PATH}"
  node - <<'NODE'
const fs = require('node:fs');
const path = require('node:path');

const configPath = process.env.FOXFANG_BOOTSTRAP_CONFIG_PATH;
const providerChoice = (process.env.FOXFANG_DEFAULT_PROVIDER || '').toLowerCase();
const gatewayPort = Number.parseInt(process.env.FOXFANG_GATEWAY_PORT || '8080', 10);
const modelOverride = process.env.FOXFANG_DEFAULT_MODEL;

const providerCandidates = [
  {
    id: 'openai',
    name: 'OpenAI',
    apiKey: process.env.OPENAI_API_KEY || '',
    defaultModel: 'gpt-4o-mini',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    defaultModel: 'claude-3-7-sonnet-latest',
  },
  {
    id: 'kimi',
    name: 'Kimi',
    apiKey: process.env.KIMI_API_KEY || '',
    defaultModel: 'moonshot-v1-8k',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    apiKey: process.env.OPENROUTER_API_KEY || '',
    defaultModel: 'openai/gpt-4o-mini',
    baseUrl: 'https://openrouter.ai/api/v1',
  },
];

const preferredProvider = providerCandidates.find(
  (provider) => provider.id === providerChoice && provider.apiKey,
);
const availableProvider =
  preferredProvider ||
  providerCandidates.find((provider) => provider.apiKey);

if (!availableProvider) {
  console.log(
    '[Railway] No model provider key found. Set OPENAI_API_KEY, ANTHROPIC_API_KEY, KIMI_API_KEY, or OPENROUTER_API_KEY.',
  );
  process.exit(0);
}

const defaultModel = modelOverride || availableProvider.defaultModel;
const providerConfig = {
  id: availableProvider.id,
  name: availableProvider.name,
  enabled: true,
  apiKey: availableProvider.apiKey,
};

if (availableProvider.baseUrl) {
  providerConfig.baseUrl = availableProvider.baseUrl;
}

const config = {
  defaultProvider: availableProvider.id,
  defaultModel,
  providers: [providerConfig],
  gateway: {
    port: gatewayPort,
    host: '0.0.0.0',
    enableCors: true,
    maxRequestSize: '10mb',
  },
};

fs.mkdirSync(path.dirname(configPath), { recursive: true });
fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
console.log(`[Railway] Bootstrapped ${configPath} with provider "${availableProvider.id}"`);
NODE
fi

echo "[Railway] Starting FoxFang gateway on port ${FOXFANG_GATEWAY_PORT}"
exec node dist/daemon/gateway-server.js
