import { createPrivateKey, createSign } from "node:crypto";

const GITHUB_API_BASE = "https://api.github.com";

// Cache installation token to avoid re-requesting within its 1-hour lifetime
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

/**
 * Build a GitHub App JWT (RS256, valid for up to 10 minutes).
 * https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app
 */
function buildAppJwt(appId: string, privateKeyPem: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iat: now - 60, // issued 60s in the past to account for clock skew
      exp: now + 9 * 60, // expires in 9 minutes (max 10)
      iss: appId,
    }),
  ).toString("base64url");

  const data = `${header}.${payload}`;
  const sign = createSign("RSA-SHA256");
  sign.update(data);
  const privateKey = createPrivateKey(privateKeyPem);
  const signature = sign.sign(privateKey, "base64url");
  return `${data}.${signature}`;
}

/**
 * Exchange the App JWT for an installation access token.
 * Installation tokens expire after 1 hour — cached until 5 minutes before expiry.
 */
export async function getInstallationToken(
  appId: string,
  privateKeyPem: string,
  installationId: string,
): Promise<string> {
  const cacheKey = `${appId}:${installationId}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.token;
  }

  const jwt = buildAppJwt(appId, privateKeyPem);
  const resp = await fetch(
    `${GITHUB_API_BASE}/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );

  if (!resp.ok) {
    const body = await resp.text().catch(() => "(no body)");
    throw new Error(
      `GitHub App auth failed (${resp.status}): ${body}`,
    );
  }

  const data = (await resp.json()) as { token: string; expires_at: string };

  // Cache until 5 minutes before actual expiry
  const expiresAt = new Date(data.expires_at).getTime() - 5 * 60 * 1000;
  tokenCache.set(cacheKey, { token: data.token, expiresAt });

  return data.token;
}

/** Authenticated GitHub API fetch using installation token */
export async function githubFetch(
  appId: string,
  privateKeyPem: string,
  installationId: string,
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const token = await getInstallationToken(appId, privateKeyPem, installationId);
  return fetch(`${GITHUB_API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers ?? {}),
    },
  });
}
