# Deploy FoxFang on Railway

This repository includes a ready Railway template:

- `railway.toml`
- `Dockerfile`
- `scripts/start-railway.sh`

## 1) Create project

1. In Railway, create a new project from this GitHub repo.
2. Railway will detect `railway.toml` and build with the included `Dockerfile`.

## 2) Add persistent volume

Add one volume and mount it to:

- `/data`

FoxFang uses this mount for persistent state (`/data/.foxfang`).

## 3) Set environment variables

Setup auth (required):

- `SETUP_USERNAME`
- `SETUP_PASSWORD`

Optional provider bootstrap (if you want first-run config from env):

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `KIMI_API_KEY`
- `OPENROUTER_API_KEY`

Optional:

- `FOXFANG_DEFAULT_PROVIDER` (`openai`, `anthropic`, `kimi`, `openrouter`)
- `FOXFANG_DEFAULT_MODEL`
- `FOXFANG_CHANNELS` (comma-separated channels, e.g. `telegram,discord`)
- `SIGNAL_HTTP_URL` (default `http://signal-api:8080`, for Signal sidecar)

## 4) Optional: add Signal sidecar service

If you want to use Signal channel on Railway, run a second service from image:

- `bbernhard/signal-cli-rest-api`

Important:

- Do not try to merge that Docker Hub image into FoxFang `Dockerfile` directly for Railway deploy.
- Railway should run it as a separate service (sidecar) in the same project, then FoxFang calls it via `SIGNAL_HTTP_URL`.

Recommended in Railway dashboard:

1. Add new service in the same project.
2. Deploy from Docker image: `bbernhard/signal-cli-rest-api:latest`.
3. Name the service `signal-api`.
4. Set service env/volume for Signal account data per image docs.
5. Keep FoxFang `SIGNAL_HTTP_URL=http://signal-api:8080` (or set to your service URL, e.g. `http://signal-api.railway.internal:8080`).

Then in FoxFang `/setup`:

- Set Signal channel mode to `Enabled`
- Fill only `Signal phone number` (no `httpUrl` field needed)

## 5) Deploy and verify

After deploy, open:

- `https://<your-railway-domain>/setup` (login with `SETUP_USERNAME`/`SETUP_PASSWORD`)
- `https://<your-railway-domain>/healthz`

Inside `/setup`, you can optionally connect GitHub with OAuth (click `Connect GitHub`).

Expected response:

```json
{"status":"ok", ...}
```

## 6) Runtime behavior

On first startup, `scripts/start-railway.sh` will:

1. Map Railway `PORT` to `FOXFANG_GATEWAY_PORT`
2. Set `HOME=/data` and `FOXFANG_HOME=/data/.foxfang`
3. Set `SIGNAL_HTTP_URL` default to `http://signal-api:8080` (override if needed)
4. Optionally bootstrap `foxfang.json` from provider env vars if config does not exist
5. Start `dist/daemon/gateway-server.js`

The `/setup` web app:

- is protected by Basic Auth (`SETUP_USERNAME` + `SETUP_PASSWORD`)
- saves runtime config (providers/channels/tools) into `~/.foxfang/foxfang.json`
- supports GitHub connect by OAuth in setup web; token is stored via FoxFang credentials store (keychain if available, otherwise encrypted file at `~/.foxfang/credentials`)
- triggers FoxFang restart after each successful save so config is applied immediately

This keeps FoxFang state/config persistent across redeploys.

## 7) Setup with Railway CLI

If you prefer terminal-only setup, use Railway CLI:

```bash
# Install CLI
npm install -g @railway/cli

# Login (or: railway login --browserless)
railway login
```

From your FoxFang repo:

```bash
# Option A: create and link a new Railway project
railway init --name foxfang

# Option B: link to an existing Railway project/environment/service
railway link -p <PROJECT_ID_OR_NAME> -e <ENV_ID_OR_NAME> -s <SERVICE_ID_OR_NAME>

# Confirm current link target
railway status
```

Create and link an app service (required if `railway status` shows `Service: None`):

```bash
# Create service
railway add --service foxfang

# Link service to current directory
railway service link foxfang

# Verify now has service
railway status
```

Set required setup auth variables:

```bash
railway variables set SETUP_USERNAME=admin SETUP_PASSWORD='change-this-now'
```

Optional provider bootstrap variables:

```bash
railway variables set OPENAI_API_KEY=<your_key>
# or
railway variables set ANTHROPIC_API_KEY=<your_key>
# or
railway variables set KIMI_API_KEY=<your_key>
# or
railway variables set OPENROUTER_API_KEY=<your_key>
```

Optional Signal endpoint:

```bash
railway variables set SIGNAL_HTTP_URL=http://signal-api:8080
```

Attach a persistent volume mounted at `/data`:

```bash
# Recommended (interactive, easiest)
railway volume add -m /data

# Non-interactive (explicit service/environment)
railway volume add -s <SERVICE_ID_OR_NAME> -e <ENV_ID_OR_NAME> -m /data
```

Deploy:

```bash
# Deploy current repository
railway up --detach

# Stream logs if needed
railway logs
```

Then verify:

- `https://<your-railway-domain>/setup`
- `https://<your-railway-domain>/healthz`

Notes:

- With GitHub/repo deploy, Railway does not auto-create the volume from `railway.toml` alone.
- `requiredMountPath = "/data"` in `railway.toml` ensures deployment requires that mount path.
- For truly one-click infra provisioning (including volume), publish a Railway Template and let users deploy via that template flow.
