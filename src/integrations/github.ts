/**
 * GitHub Integration
 * 
 * OAuth flow using ZeroBuild's public proxy service.
 * Inspired by ZeroBuild's gateway/oauth.rs
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { createSign } from 'crypto';
import { saveCredential, getCredential, deleteCredential } from '../credentials';

const GITHUB_API_BASE = 'https://api.github.com';
export const GITHUB_OAUTH_PROXY = 'https://foxfang-oauth-proxy.githubz.workers.dev';
export type GitHubAuthMode = 'oauth' | 'pat' | 'app';

export interface GitHubToken {
  token: string;
  username?: string;
  scopes: string[];
  createdAt: string;
  mode?: GitHubAuthMode;
  appId?: string;
  installationId?: string;
  expiresAt?: string;
  apiBaseUrl?: string;
}

export interface GitHubAppConnectionInput {
  appId: string;
  installationId: string;
  privateKey: string;
  apiBaseUrl?: string;
}

type GitHubAppAccessTokenResponse = {
  token: string;
  expires_at?: string;
  permissions?: Record<string, string>;
};

type GitHubAppInstallationResponse = {
  account?: {
    login?: string;
  };
}

/**
 * Check if GitHub is connected
 */
export async function isGitHubConnected(): Promise<boolean> {
  try {
    const token = await getGitHubToken();
    return token !== null;
  } catch {
    return false;
  }
}

/**
 * Get stored GitHub token
 */
export async function getGitHubToken(): Promise<GitHubToken | null> {
  const cred = await getCredential('github');
  if (!cred) return null;

  const mode = resolveGitHubAuthMode(cred.headers?.mode);
  const storedApiBaseUrl = sanitizeGitHubApiBaseUrl(cred.headers?.apiBaseUrl);

  if (mode === 'app') {
    const appCred = await getCredential('github-app');
    if (!appCred) return null;

    const appId = String(appCred.headers?.appId || cred.headers?.appId || '').trim();
    const installationId = String(appCred.headers?.installationId || cred.headers?.installationId || '').trim();
    const apiBaseUrl = sanitizeGitHubApiBaseUrl(appCred.headers?.apiBaseUrl || storedApiBaseUrl);

    if (!appId || !installationId) {
      return null;
    }

    try {
      const privateKey = normalizeGitHubPrivateKey(appCred.apiKey);
      const appJwt = createGitHubAppJwt(appId, privateKey);
      const installationToken = await createGitHubAppInstallationToken({
        appJwt,
        installationId,
        apiBaseUrl,
      });
      const scopes = Object.entries(installationToken.permissions || {}).map(
        ([scope, permission]) => `${scope}:${permission}`
      );

      return {
        token: installationToken.token,
        username: cred.headers?.owner || cred.apiType || `app:${appId}`,
        scopes,
        createdAt: appCred.createdAt || cred.createdAt,
        mode: 'app',
        appId,
        installationId,
        expiresAt: installationToken.expires_at,
        apiBaseUrl,
      };
    } catch {
      return null;
    }
  }

  return {
    token: cred.apiKey,
    username: cred.apiType, // We store username in apiType field
    scopes: parseScopes(cred.headers?.scopes),
    createdAt: cred.createdAt,
    mode,
    apiBaseUrl: storedApiBaseUrl,
  };
}

/**
 * Save GitHub token
 */
export async function saveGitHubToken(
  token: string,
  username?: string,
  scopes: string[] = [],
  mode: GitHubAuthMode = 'oauth'
): Promise<void> {
  if (mode !== 'app') {
    await deleteCredential('github-app').catch(() => undefined);
  }

  await saveCredential('github', {
    provider: 'github',
    apiKey: token,
    apiType: username, // Store username in apiType field
    headers: {
      scopes: scopes.join(','),
      mode,
      apiBaseUrl: GITHUB_API_BASE,
    },
    createdAt: new Date().toISOString(),
  });
}

/**
 * Save GitHub App credentials and validate by requesting installation token.
 */
export async function saveGitHubAppConnection(input: GitHubAppConnectionInput): Promise<GitHubToken> {
  const appId = String(input.appId || '').trim();
  const installationId = String(input.installationId || '').trim();
  const privateKey = normalizeGitHubPrivateKey(input.privateKey);
  const apiBaseUrl = sanitizeGitHubApiBaseUrl(input.apiBaseUrl);

  if (!appId) {
    throw new Error('GitHub App ID is required');
  }
  if (!installationId) {
    throw new Error('GitHub Installation ID is required');
  }

  const appJwt = createGitHubAppJwt(appId, privateKey);
  const [installationInfo, installationToken] = await Promise.all([
    fetchGitHubAppInstallation({
      appJwt,
      installationId,
      apiBaseUrl,
    }),
    createGitHubAppInstallationToken({
      appJwt,
      installationId,
      apiBaseUrl,
    }),
  ]);

  const owner = installationInfo.account?.login || `app:${appId}`;
  const scopes = Object.entries(installationToken.permissions || {}).map(
    ([scope, permission]) => `${scope}:${permission}`
  );
  const createdAt = new Date().toISOString();

  await saveCredential('github-app', {
    provider: 'github-app',
    apiKey: privateKey,
    apiType: 'app-private-key',
    headers: {
      appId,
      installationId,
      apiBaseUrl: apiBaseUrl || GITHUB_API_BASE,
    },
    createdAt,
  });

  await saveCredential('github', {
    provider: 'github',
    apiKey: 'github-app-auth',
    apiType: owner,
    headers: {
      mode: 'app',
      appId,
      installationId,
      owner,
      scopes: scopes.join(','),
      apiBaseUrl: apiBaseUrl || GITHUB_API_BASE,
    },
    createdAt,
  });

  return {
    token: installationToken.token,
    username: owner,
    scopes,
    createdAt,
    mode: 'app',
    appId,
    installationId,
    expiresAt: installationToken.expires_at,
    apiBaseUrl: apiBaseUrl || GITHUB_API_BASE,
  };
}

/**
 * Disconnect GitHub (remove token)
 */
export async function disconnectGitHub(): Promise<void> {
  await deleteCredential('github');
  await deleteCredential('github-app').catch(() => undefined);
}

/**
 * Start OAuth flow using ZeroBuild's public proxy
 * 
 * This opens the OAuth proxy URL in the browser and starts a local
 * server to receive the callback with the token.
 */
export async function startGitHubOAuthFlow(): Promise<{ authUrl: string; waitForCallback: () => Promise<GitHubToken> }> {
  // Find an available port
  const port = await findAvailablePort(3333);
  const callbackUrl = `http://127.0.0.1:${port}/auth/github/callback`;
  
  // Build proxy auth URL
  const authUrl = `${GITHUB_OAUTH_PROXY}/start?redirect_uri=${encodeURIComponent(callbackUrl)}`;
  
  // Create promise that will resolve when callback is received
  const waitForCallback = (): Promise<GitHubToken> => {
    return new Promise((resolve, reject) => {
      let timeoutId: NodeJS.Timeout;
      
      const server = createServer((req: IncomingMessage, res: ServerResponse) => {
        const url = new URL(req.url || '/', `http://localhost:${port}`);
        
        if (url.pathname === '/auth/github/callback') {
          clearTimeout(timeoutId);
          
          const token = url.searchParams.get('token');
          const username = url.searchParams.get('username');
          const error = url.searchParams.get('error');
          
          if (error) {
            res.writeHead(400, { 'Content-Type': 'text/html' });
            res.end(`
              <!DOCTYPE html>
              <html>
                <body style="font-family:sans-serif;text-align:center;padding:40px">
                  <h2>❌ GitHub Connection Failed</h2>
                  <p>Error: ${escapeHtml(error)}</p>
                  <p>You can close this window.</p>
                </body>
              </html>
            `);
            if ((res as any).socket) {
              (res as any).socket.destroy();
            }
            closeServer(server);
            reject(new Error(`OAuth failed: ${error}`));
            return;
          }
          
          if (!token) {
            res.writeHead(400, { 'Content-Type': 'text/html' });
            res.end(`
              <!DOCTYPE html>
              <html>
                <body style="font-family:sans-serif;text-align:center;padding:40px">
                  <h2>❌ GitHub Connection Failed</h2>
                  <p>No token received from OAuth proxy.</p>
                  <p>You can close this window.</p>
                </body>
              </html>
            `);
            if ((res as any).socket) {
              (res as any).socket.destroy();
            }
            closeServer(server);
            reject(new Error('No token received from OAuth proxy'));
            return;
          }
          
          // Success! Save token and respond
          const githubToken: GitHubToken = {
            token,
            username: username || undefined,
            scopes: ['repo', 'read:user'],
            createdAt: new Date().toISOString(),
          };
          
          saveGitHubToken(token, githubToken.username, githubToken.scopes).then(() => {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
              <!DOCTYPE html>
              <html>
                <body style="font-family:sans-serif;text-align:center;padding:40px">
                  <h2>✅ GitHub Connected!</h2>
                  <p>Connected as <strong>${escapeHtml(username || 'unknown user')}</strong></p>
                  <p>You can close this window and return to your terminal.</p>
                </body>
              </html>
            `);
            // Destroy socket to immediately close connection
            if ((res as any).socket) {
              (res as any).socket.destroy();
            }
            closeServer(server);
            resolve(githubToken);
          }).catch(err => {
            res.writeHead(500, { 'Content-Type': 'text/html' });
            res.end(`
              <!DOCTYPE html>
              <html>
                <body style="font-family:sans-serif;text-align:center;padding:40px">
                  <h2>❌ Failed to Save Token</h2>
                  <p>Error: ${escapeHtml(err.message)}</p>
                </body>
              </html>
            `);
            if ((res as any).socket) {
              (res as any).socket.destroy();
            }
            closeServer(server);
            reject(err);
          });
        } else {
          res.writeHead(404);
          res.end('Not found');
        }
      });
      
      server.listen(port, '127.0.0.1', () => {
        console.log(`Waiting for GitHub OAuth callback on port ${port}...`);
      });
      
      // Allow server to not keep process running - call immediately after listen
      server.unref();
      
      // Also unref the socket handles to ensure process can exit
      server.on('connection', (socket) => {
        socket.unref();
      });
      
      // Timeout after 5 minutes
      timeoutId = setTimeout(() => {
        closeServer(server);
        reject(new Error('OAuth timeout - authorization took too long'));
      }, 5 * 60 * 1000);
    });
  };
  
  return { authUrl, waitForCallback };
}


/**
 * Close server and all connections
 */
function closeServer(server: any): void {
  try {
    // Close all active connections (Node.js 18.2+)
    if (typeof server.closeAllConnections === 'function') {
      server.closeAllConnections();
    }
  } catch {}
  
  try {
    server.close();
  } catch {}
}

/**
 * Find an available port
 */
async function findAvailablePort(startPort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(startPort, '127.0.0.1', () => {
      const port = (server.address() as any).port;
      server.close(() => resolve(port));
    });
    server.on('error', () => {
      // Port in use, try next
      resolve(findAvailablePort(startPort + 1));
    });
  });
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Make authenticated GitHub API request
 */
export async function githubApiRequest(
  endpoint: string,
  options: {
    method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
    body?: any;
    token: string;
    apiBaseUrl?: string;
  }
): Promise<any> {
  const apiBaseUrl = await resolveGitHubApiBaseUrl(options.apiBaseUrl);
  const url = endpoint.startsWith('http') ? endpoint : `${apiBaseUrl}${endpoint}`;
  
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      'Authorization': `Bearer ${options.token}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'FoxFang/1.0',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  
  const responseBody = await response.text();
  
  if (!response.ok) {
    let errorMessage = `GitHub API error: ${response.status}`;
    try {
      const errorData = JSON.parse(responseBody);
      errorMessage = errorData.message || errorMessage;
    } catch {}
    throw new Error(errorMessage);
  }
  
  if (responseBody) {
    try {
      return JSON.parse(responseBody);
    } catch {
      return responseBody;
    }
  }
  
  return null;
}

/**
 * Get GitHub user info
 */
export async function getGitHubUser(token: string): Promise<{ login: string; id: number }> {
  return githubApiRequest('/user', { token });
}

function parseScopes(scopesValue?: string): string[] {
  return String(scopesValue || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolveGitHubAuthMode(mode?: string): GitHubAuthMode {
  if (mode === 'app' || mode === 'pat' || mode === 'oauth') {
    return mode;
  }
  return 'oauth';
}

function sanitizeGitHubApiBaseUrl(apiBaseUrl?: string): string {
  const value = String(apiBaseUrl || '').trim().replace(/\/+$/, '');
  if (!value) return '';
  return value;
}

async function resolveGitHubApiBaseUrl(override?: string): Promise<string> {
  const fromOverride = sanitizeGitHubApiBaseUrl(override);
  if (fromOverride) return fromOverride;

  const cred = await getCredential('github').catch(() => null);
  const fromCredential = sanitizeGitHubApiBaseUrl(cred?.headers?.apiBaseUrl);
  return fromCredential || GITHUB_API_BASE;
}

function base64UrlEncode(value: Buffer | string): string {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function createGitHubAppJwt(appId: string, privateKey: string): string {
  const nowInSeconds = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64UrlEncode(JSON.stringify({
    iat: nowInSeconds - 60,
    exp: nowInSeconds + (9 * 60),
    iss: appId,
  }));
  const body = `${header}.${payload}`;

  const signer = createSign('RSA-SHA256');
  signer.update(body);
  signer.end();
  const signature = signer.sign(privateKey);
  return `${body}.${base64UrlEncode(signature)}`;
}

export function normalizeGitHubPrivateKey(privateKey: string): string {
  const normalized = String(privateKey || '').trim().replace(/\\n/g, '\n');
  if (!normalized) {
    throw new Error('GitHub App private key is required');
  }
  if (!normalized.includes('BEGIN') || !normalized.includes('PRIVATE KEY')) {
    throw new Error('GitHub App private key must be a PEM private key');
  }
  return normalized.endsWith('\n') ? normalized : `${normalized}\n`;
}

async function fetchGitHubAppInstallation(input: {
  appJwt: string;
  installationId: string;
  apiBaseUrl?: string;
}): Promise<GitHubAppInstallationResponse> {
  const apiBaseUrl = sanitizeGitHubApiBaseUrl(input.apiBaseUrl) || GITHUB_API_BASE;
  const response = await fetch(`${apiBaseUrl}/app/installations/${encodeURIComponent(input.installationId)}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${input.appJwt}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'FoxFang/1.0',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`GitHub App installation lookup failed: ${extractGitHubApiError(body, response.status)}`);
  }
  if (!body) return {};
  try {
    return JSON.parse(body) as GitHubAppInstallationResponse;
  } catch {
    return {};
  }
}

async function createGitHubAppInstallationToken(input: {
  appJwt: string;
  installationId: string;
  apiBaseUrl?: string;
}): Promise<GitHubAppAccessTokenResponse> {
  const apiBaseUrl = sanitizeGitHubApiBaseUrl(input.apiBaseUrl) || GITHUB_API_BASE;
  const response = await fetch(`${apiBaseUrl}/app/installations/${encodeURIComponent(input.installationId)}/access_tokens`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.appJwt}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'FoxFang/1.0',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({}),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`GitHub App token exchange failed: ${extractGitHubApiError(body, response.status)}`);
  }
  let parsed: GitHubAppAccessTokenResponse;
  try {
    parsed = JSON.parse(body) as GitHubAppAccessTokenResponse;
  } catch {
    throw new Error('GitHub App token exchange failed: Invalid JSON response');
  }
  if (!parsed.token) {
    throw new Error('GitHub App token exchange failed: No access token returned');
  }
  return parsed;
}

function extractGitHubApiError(body: string, status: number): string {
  try {
    const parsed = JSON.parse(body);
    if (typeof parsed?.message === 'string' && parsed.message.trim()) {
      return parsed.message.trim();
    }
  } catch {
    // ignore parse errors
  }
  return `HTTP ${status}`;
}

/**
 * Extract owner and repo from various input formats
 */
export function extractOwnerRepo(input: string): { owner: string; repo: string } | null {
  if (!input) return null;
  
  // Handle full URL format: https://github.com/owner/repo
  if (input.includes('github.com/')) {
    const parts = input.split('github.com/');
    if (parts.length >= 2) {
      const path = parts[1].trim().replace(/\.git$/, '').replace(/\/$/, '');
      const segments = path.split('/').filter(s => s);
      if (segments.length >= 2) {
        return { owner: segments[0], repo: segments[1] };
      }
    }
  }
  
  // Handle "owner/repo" format
  if (input.includes('/')) {
    const segments = input.split('/').filter(s => s);
    if (segments.length >= 2) {
      return { owner: segments[0], repo: segments[1] };
    }
  }
  
  return null;
}

/**
 * Validate issue title format
 */
export function validateIssueTitle(title: string): { valid: boolean; error?: string } {
  if (!title?.trim()) {
    return { valid: false, error: 'Issue title is required' };
  }
  
  const validPrefixes = [
    '[Feature]:', '[Bug]:', '[Chore]:', '[Docs]:', 
    '[Security]:', '[Refactor]:', '[Test]:', '[Perf]:'
  ];
  
  const hasPrefix = validPrefixes.some(prefix => title.trim().startsWith(prefix));
  
  if (!hasPrefix) {
    return {
      valid: false,
      error: `Title must start with a bracketed prefix. Valid: ${validPrefixes.join(', ')}`
    };
  }
  
  return { valid: true };
}

/**
 * Validate PR title format (conventional commits)
 */
export function validatePRTitle(title: string): { valid: boolean; error?: string } {
  if (!title?.trim()) {
    return { valid: false, error: 'PR title is required' };
  }
  
  const pattern = /^(feat|fix|chore|docs|style|refactor|perf|test|build|ci|revert)(\([^)]+\))?: .+/;
  
  if (!pattern.test(title.trim())) {
    return {
      valid: false,
      error: 'Title must follow conventional commit format: "type(scope): description". Valid types: feat, fix, chore, docs, style, refactor, perf, test, build, ci, revert'
    };
  }
  
  return { valid: true };
}

/**
 * Validate labels
 */
export function validateLabels(labels: string[]): { valid: boolean; error?: string } {
  if (!labels || labels.length === 0) {
    return { valid: false, error: 'At least one label is required' };
  }
  
  const validTypeLabels = ['feature', 'bug', 'chore', 'docs', 'security', 'refactor', 'test', 'perf'];
  const hasTypeLabel = labels.some(l => validTypeLabels.includes(l.toLowerCase()));
  
  if (!hasTypeLabel) {
    return {
      valid: false,
      error: `Must include at least one type label: ${validTypeLabels.join(', ')}`
    };
  }
  
  return { valid: true };
}

/**
 * Sanitize labels (remove problematic ones)
 */
export function sanitizeLabels(labels: string[]): string[] {
  return labels.filter(label => {
    // Skip labels with spaces (cause 422 errors if not pre-created)
    if (label.includes(' ')) {
      console.warn(`Skipping label with space: ${label}`);
      return false;
    }
    return true;
  });
}

/**
 * Generate issue template
 */
export function generateIssueTemplate(title: string): string {
  // Extract summary from title
  const summary = title.replace(/^\[[^\]]+\]:\s*/, '').trim();
  
  return `## Summary
${summary}

## Problem Statement
[Describe the current behavior, gap, or pain point. For bugs: include exact reproduction steps and error messages.]

## Proposed Solution
[For features: what the new behavior should look like. For bugs: what correct behavior looks like.]

## Non-goals / Out of Scope
- [Explicitly list what this issue will NOT address.]

## Alternatives Considered
- [Alternatives evaluated and why they were not chosen.]

## Acceptance Criteria
- [ ] [Concrete, testable condition 1]
- [ ] [Concrete, testable condition 2]

## Architecture Impact
- Affected subsystems: [list modules, traits, tools, or channels impacted]
- New dependencies: [none or list]
- Config/schema changes: [yes/no — if yes, describe]

## Risk and Rollback
- Risk: [low / medium / high — and why]
- Rollback: [how to revert if the fix or feature causes a regression]

## Breaking Change?
- [ ] Yes — describe impact and migration path
- [ ] No

## Data Hygiene Checks
- [ ] I removed personal/sensitive data from examples, payloads, and logs.
- [ ] I used neutral, project-focused wording and placeholders.
`;
}

/**
 * Generate PR template
 */
export function generatePRTemplate(title: string): string {
  // Extract summary from title
  const summary = title.replace(/^(feat|fix|chore|docs|style|refactor|perf|test|build|ci|revert)(\([^)]+\))?:\s*/, '').trim();
  
  return `## Summary
${summary}

## Problem
[What broken/missing behavior or gap does this PR address?]

## Root Cause
[For bug fixes: what was the underlying cause? For features: what need or gap drove this?]

## Changes
- [Concrete change 1 — module / file / behavior]
- [Concrete change 2]

## Validation
- [ ] Tests pass
- [ ] Manual testing completed
- [ ] Documentation updated

## Scope
- Affected subsystems: [list]
- Files changed: [count or list key files]

## Risk
- Risk tier: [low / medium / high]
- Blast radius: [which subsystems or users could be affected by a regression]

## Rollback
- Revert strategy: [\`git revert <commit>\` or specific steps]
- Migration needed on rollback: [yes / no — if yes, describe]
`;
}
