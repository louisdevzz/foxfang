/**
 * GitHub Repository Read Tools
 *
 * Read repository metadata, files, and code via the GitHub API.
 */

import { Tool, ToolCategory, ToolResult } from '../traits';
import { loadConfig } from '../../config';
import {
  extractOwnerRepo,
  getGitHubToken,
  githubApiRequest,
} from '../../integrations/github';

type OwnerRepo = {
  owner: string;
  repo: string;
};

async function buildGitHubReconnectMessage(): Promise<string> {
  const generic = [
    'GitHub is not connected.',
    '',
    'To connect:',
    '1. Use OAuth: github_connect with action: "oauth"',
    '2. Or set token manually: github_connect with action: "set", token: "your_token_here"',
    '',
    'GitHub App connections are configured in the wizard.',
  ].join('\n');

  try {
    const config = await loadConfig();
    const github = config.github;
    if (!github?.connected) {
      return generic;
    }

    if (github.mode === 'app') {
      return [
        'GitHub App is marked connected in config, but the stored app credentials are missing or unreadable.',
        'Reconnect the GitHub App via `pnpm foxfang wizard github` so FoxFang can mint installation tokens again.',
      ].join('\n');
    }

    return [
      'GitHub is marked connected in config, but the stored credential is missing or unreadable.',
      'Reconnect via OAuth, PAT, or the GitHub wizard so the credential store is repopulated.',
    ].join('\n');
  } catch {
    return generic;
  }
}

type GitHubAuthContext = {
  token: string;
  apiBaseUrl?: string;
  mode?: string;
  scopes: string[];
};

type GitHubAuthFailure = {
  success: false;
  error: string;
  output?: string;
  data?: any;
};

async function requireGitHubToken(): Promise<GitHubAuthContext | GitHubAuthFailure> {
  const token = await getGitHubToken();
  if (!token) {
    return {
      success: false,
      error: await buildGitHubReconnectMessage(),
    };
  }

  return {
    token: token.token,
    apiBaseUrl: token.apiBaseUrl,
    mode: token.mode,
    scopes: Array.isArray(token.scopes) ? token.scopes : [],
  };
}

function parseRepo(repoInput: string): OwnerRepo | null {
  return extractOwnerRepo(String(repoInput || '').trim());
}

function normalizePath(path?: string): string {
  return String(path || '')
    .trim()
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
}

function truncateText(text: string, maxLength: number): { text: string; truncated: boolean } {
  if (text.length <= maxLength) {
    return { text, truncated: false };
  }
  return {
    text: `${text.slice(0, Math.max(0, maxLength - 25))}\n\n...[truncated]`,
    truncated: true,
  };
}

function decodeGitHubContent(content?: string, encoding?: string): string {
  if (!content) return '';
  if (encoding === 'base64') {
    return Buffer.from(content.replace(/\n/g, ''), 'base64').toString('utf8');
  }
  return content;
}

function extractReadmeSummarySource(text: string, maxLength: number): string {
  const normalized = String(text || '')
    .replace(/\r/g, '')
    .replace(/^\s*#.*$/gm, '')
    .replace(/^\s*!\[[^\]]*\]\([^)]+\)\s*$/gm, '')
    .replace(/^\s*\[[^\]]+\]\([^)]+\)\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!normalized) return '';

  const paragraphs = normalized
    .split(/\n\s*\n/)
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const selected: string[] = [];
  let total = 0;
  for (const paragraph of paragraphs) {
    const nextTotal = total + paragraph.length + (selected.length > 0 ? 2 : 0);
    if (selected.length > 0 && nextTotal > maxLength) break;
    if (paragraph.length > maxLength && selected.length === 0) {
      return truncateText(paragraph, maxLength).text;
    }
    selected.push(paragraph);
    total = nextTotal;
    if (total >= maxLength) break;
    if (selected.length >= 2) break;
  }

  return truncateText(selected.join('\n\n'), maxLength).text;
}

async function getRepoInfo(ownerRepo: OwnerRepo, token: string, apiBaseUrl?: string): Promise<any> {
  return githubApiRequest(
    `/repos/${ownerRepo.owner}/${ownerRepo.repo}`,
    { token, apiBaseUrl },
  );
}

function hasGitHubPermission(auth: GitHubAuthContext, permission: string, level: 'read' | 'write' = 'read'): boolean {
  const target = `${permission}:${level}`;
  if (auth.scopes.includes(target)) return true;
  if (level === 'read' && auth.scopes.includes(`${permission}:write`)) return true;
  return false;
}

function buildMissingContentsPermissionMessage(repo: OwnerRepo): string {
  return [
    `GitHub is connected and the app can see repo metadata for ${repo.owner}/${repo.repo}, but it does not have repository contents access.`,
    'To read the repo tree, README, and files, grant the GitHub App `Contents: Read-only` permission and ensure the installation still includes this repository.',
  ].join(' ');
}

function isGitHubIntegrationAccessError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /resource not accessible by integration/i.test(message);
}

export class GitHubGetRepoTool implements Tool {
  name = 'github_get_repo';
  description = `Read a GitHub repository overview via the GitHub API.

Use this for requests like:
- "read this repo"
- "what is this GitHub repo?"
- "summarize https://github.com/owner/repo"
- "show repo metadata / README / default branch"

Default behavior should be lightweight:
- read repo description
- read README and summarize what the project is
- do NOT inspect the codebase, file tree, or language breakdown unless the user explicitly asks

Prefer this over fetch_url for GitHub repository URLs.`;

  category = ToolCategory.EXTERNAL;
  parameters = {
    type: 'object' as const,
    properties: {
      repo: {
        type: 'string',
        description: 'Repository in "owner/repo" format or full GitHub URL.',
      },
      includeReadme: {
        type: 'boolean',
        description: 'Include README summary source when available.',
        default: true,
      },
      includeLanguages: {
        type: 'boolean',
        description: 'Include language breakdown when available.',
        default: false,
      },
      includeMetadata: {
        type: 'boolean',
        description: 'Include repo metadata like visibility, default branch, stars, and last push time.',
        default: false,
      },
      maxReadmeLength: {
        type: 'number',
        description: 'Maximum README summary-source length in characters.',
        default: 1800,
      },
    },
    required: ['repo'],
  };

  async execute(args: {
    repo: string;
    includeReadme?: boolean;
    includeLanguages?: boolean;
    includeMetadata?: boolean;
    maxReadmeLength?: number;
  }): Promise<ToolResult> {
    try {
      const auth = await requireGitHubToken();
      if ('success' in auth) {
        return auth;
      }

      const ownerRepo = parseRepo(args.repo);
      if (!ownerRepo) {
        return {
          success: false,
          error: `Could not parse owner/repo from: '${args.repo}'`,
        };
      }

      const includeReadme = args.includeReadme !== false;
      const includeLanguages = args.includeLanguages === true;
      const includeMetadata = args.includeMetadata === true;
      const maxReadmeLength = Math.max(500, Math.min(args.maxReadmeLength || 1800, 12000));
      const hasContentsAccess = !(auth.mode === 'app' && !hasGitHubPermission(auth, 'contents', 'read'));

      const [repoInfo, readmeResult, languagesResult] = await Promise.all([
        getRepoInfo(ownerRepo, auth.token, auth.apiBaseUrl),
        includeReadme && hasContentsAccess
          ? githubApiRequest(
              `/repos/${ownerRepo.owner}/${ownerRepo.repo}/readme`,
              { token: auth.token, apiBaseUrl: auth.apiBaseUrl },
            ).catch(() => null)
          : Promise.resolve(null),
        includeLanguages && hasContentsAccess
          ? githubApiRequest(
              `/repos/${ownerRepo.owner}/${ownerRepo.repo}/languages`,
              { token: auth.token, apiBaseUrl: auth.apiBaseUrl },
            ).catch(() => null)
          : Promise.resolve(null),
      ]);

      const readmeText = decodeGitHubContent(readmeResult?.content, readmeResult?.encoding).trim();
      const readmeSummarySource = readmeText
        ? extractReadmeSummarySource(readmeText, maxReadmeLength)
        : '';

      const languages = languagesResult && typeof languagesResult === 'object'
        ? Object.entries(languagesResult as Record<string, number>)
            .sort((a, b) => Number(b[1]) - Number(a[1]))
            .slice(0, 10)
        : [];

      const outputLines = [
        `Repository: ${repoInfo.full_name}`,
        `Description: ${repoInfo.description || 'No description'}`,
      ];

      if (includeMetadata) {
        if (Array.isArray(repoInfo.topics) && repoInfo.topics.length > 0) {
          outputLines.push(`Topics: ${repoInfo.topics.join(', ')}`);
        }
        outputLines.push(`Visibility: ${repoInfo.private ? 'private' : 'public'}`);
        outputLines.push(`Default branch: ${repoInfo.default_branch || 'unknown'}`);
        outputLines.push(`Stars: ${repoInfo.stargazers_count ?? 0}`);
        outputLines.push(`Forks: ${repoInfo.forks_count ?? 0}`);
        outputLines.push(`Open issues: ${repoInfo.open_issues_count ?? 0}`);
        outputLines.push(`Primary language: ${repoInfo.language || 'unknown'}`);
        outputLines.push(`Last push: ${repoInfo.pushed_at || 'unknown'}`);
      }
      if (!hasContentsAccess) {
        outputLines.push('GitHub App contents access: missing');
        outputLines.push(buildMissingContentsPermissionMessage(ownerRepo));
      }
      if (languages.length > 0) {
        outputLines.push(`Languages: ${languages.map(([name, bytes]) => `${name} (${bytes})`).join(', ')}`);
      }
      if (readmeSummarySource) {
        outputLines.push('');
        outputLines.push('README:');
        outputLines.push(readmeSummarySource);
      }

      const overviewData: Record<string, any> = {
        fullName: repoInfo.full_name,
        description: repoInfo.description,
        htmlUrl: repoInfo.html_url,
      };

      if (includeMetadata) {
        if (Array.isArray(repoInfo.topics) && repoInfo.topics.length > 0) {
          overviewData.topics = repoInfo.topics;
        }
        overviewData.private = Boolean(repoInfo.private);
        overviewData.defaultBranch = repoInfo.default_branch;
        overviewData.stars = repoInfo.stargazers_count;
        overviewData.forks = repoInfo.forks_count;
        overviewData.openIssues = repoInfo.open_issues_count;
        overviewData.primaryLanguage = repoInfo.language;
        overviewData.pushedAt = repoInfo.pushed_at;
      }

      return {
        success: true,
        output: outputLines.join('\n'),
        data: {
          repo: overviewData,
          languages: includeLanguages ? Object.fromEntries(languages) : undefined,
          contentsAccess: hasContentsAccess,
          readme: readmeSummarySource || undefined,
          readmeTruncated: Boolean(readmeText && readmeSummarySource && readmeSummarySource.length < readmeText.length),
        },
      };
    } catch (error) {
      if (isGitHubIntegrationAccessError(error)) {
        const ownerRepo = parseRepo(args.repo);
        if (ownerRepo) {
          return {
            success: false,
            error: buildMissingContentsPermissionMessage(ownerRepo),
            data: {
              repo: `${ownerRepo.owner}/${ownerRepo.repo}`,
              reason: 'missing_contents_permission',
            },
          };
        }
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

export class GitHubListRepoFilesTool implements Tool {
  name = 'github_list_repo_files';
  description = `List files or directories in a GitHub repository path.

Use this for:
- "show the repo structure"
- "list files in src/"
- "what is in the root of this repo?"

Prefer this over scraping the GitHub HTML page.`;

  category = ToolCategory.EXTERNAL;
  parameters = {
    type: 'object' as const,
    properties: {
      repo: {
        type: 'string',
        description: 'Repository in "owner/repo" format or full GitHub URL.',
      },
      path: {
        type: 'string',
        description: 'Optional directory path inside the repository. Defaults to root.',
      },
      ref: {
        type: 'string',
        description: 'Optional git ref, tag, or branch name.',
      },
      limit: {
        type: 'number',
        description: 'Maximum entries to return.',
        default: 100,
      },
    },
    required: ['repo'],
  };

  async execute(args: {
    repo: string;
    path?: string;
    ref?: string;
    limit?: number;
  }): Promise<ToolResult> {
    try {
      const auth = await requireGitHubToken();
      if ('success' in auth) {
        return auth;
      }

      const ownerRepo = parseRepo(args.repo);
      if (!ownerRepo) {
        return {
          success: false,
          error: `Could not parse owner/repo from: '${args.repo}'`,
        };
      }

      if (auth.mode === 'app' && !hasGitHubPermission(auth, 'contents', 'read')) {
        return {
          success: false,
          error: buildMissingContentsPermissionMessage(ownerRepo),
          data: {
            repo: `${ownerRepo.owner}/${ownerRepo.repo}`,
            reason: 'missing_contents_permission',
          },
        };
      }

      const path = normalizePath(args.path);
      const limit = Math.max(1, Math.min(args.limit || 100, 300));
      const query = args.ref ? `?ref=${encodeURIComponent(args.ref)}` : '';
      const endpointPath = path ? `/${path}` : '';
      const response = await githubApiRequest(
        `/repos/${ownerRepo.owner}/${ownerRepo.repo}/contents${endpointPath}${query}`,
        { token: auth.token, apiBaseUrl: auth.apiBaseUrl },
      );

      const entries = Array.isArray(response) ? response : [response];
      const normalizedEntries = entries
        .map((entry: any) => ({
          name: entry.name,
          path: entry.path,
          type: entry.type,
          size: entry.size,
          url: entry.html_url,
        }))
        .sort((a, b) => {
          if (a.type !== b.type) {
            return a.type === 'dir' ? -1 : 1;
          }
          return String(a.path || '').localeCompare(String(b.path || ''));
        })
        .slice(0, limit);

      return {
        success: true,
        output: [
          `Repository: ${ownerRepo.owner}/${ownerRepo.repo}`,
          `Path: ${path || '.'}`,
          '',
          ...normalizedEntries.map((entry) => {
            const sizePart = typeof entry.size === 'number' ? ` (${entry.size} bytes)` : '';
            return `${entry.type === 'dir' ? '[dir]' : '[file]'} ${entry.path}${sizePart}`;
          }),
        ].join('\n'),
        data: {
          repo: `${ownerRepo.owner}/${ownerRepo.repo}`,
          path: path || '',
          entries: normalizedEntries,
        },
      };
    } catch (error) {
      if (isGitHubIntegrationAccessError(error)) {
        const ownerRepo = parseRepo(args.repo);
        if (ownerRepo) {
          return {
            success: false,
            error: buildMissingContentsPermissionMessage(ownerRepo),
            data: {
              repo: `${ownerRepo.owner}/${ownerRepo.repo}`,
              reason: 'missing_contents_permission',
            },
          };
        }
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

export class GitHubGetFileTool implements Tool {
  name = 'github_get_file';
  description = `Read a file from a GitHub repository via the GitHub API.

Use this for:
- "open package.json"
- "read README.md"
- "show src/index.ts"
- "what is in this file?"`;

  category = ToolCategory.EXTERNAL;
  parameters = {
    type: 'object' as const,
    properties: {
      repo: {
        type: 'string',
        description: 'Repository in "owner/repo" format or full GitHub URL.',
      },
      path: {
        type: 'string',
        description: 'File path inside the repository.',
      },
      ref: {
        type: 'string',
        description: 'Optional git ref, tag, or branch name.',
      },
      maxLength: {
        type: 'number',
        description: 'Maximum file content length to return.',
        default: 12000,
      },
    },
    required: ['repo', 'path'],
  };

  async execute(args: {
    repo: string;
    path: string;
    ref?: string;
    maxLength?: number;
  }): Promise<ToolResult> {
    try {
      const auth = await requireGitHubToken();
      if ('success' in auth) {
        return auth;
      }

      const ownerRepo = parseRepo(args.repo);
      if (!ownerRepo) {
        return {
          success: false,
          error: `Could not parse owner/repo from: '${args.repo}'`,
        };
      }

      if (auth.mode === 'app' && !hasGitHubPermission(auth, 'contents', 'read')) {
        return {
          success: false,
          error: buildMissingContentsPermissionMessage(ownerRepo),
          data: {
            repo: `${ownerRepo.owner}/${ownerRepo.repo}`,
            reason: 'missing_contents_permission',
          },
        };
      }

      const path = normalizePath(args.path);
      if (!path) {
        return {
          success: false,
          error: 'File path is required',
        };
      }

      const maxLength = Math.max(500, Math.min(args.maxLength || 12000, 50000));
      const query = args.ref ? `?ref=${encodeURIComponent(args.ref)}` : '';
      const file = await githubApiRequest(
        `/repos/${ownerRepo.owner}/${ownerRepo.repo}/contents/${path}${query}`,
        { token: auth.token, apiBaseUrl: auth.apiBaseUrl },
      );

      if (Array.isArray(file) || file?.type === 'dir') {
        return {
          success: false,
          error: `Path is a directory, not a file: ${path}`,
        };
      }

      const decoded = decodeGitHubContent(file?.content, file?.encoding);
      const truncated = truncateText(decoded, maxLength);

      return {
        success: true,
        output: `File: ${file.path}\nSHA: ${file.sha}\nSize: ${file.size || 0} bytes\n\n${truncated.text}`,
        data: {
          repo: `${ownerRepo.owner}/${ownerRepo.repo}`,
          path: file.path,
          sha: file.sha,
          size: file.size,
          content: truncated.text,
          truncated: truncated.truncated,
          htmlUrl: file.html_url,
        },
      };
    } catch (error) {
      if (isGitHubIntegrationAccessError(error)) {
        const ownerRepo = parseRepo(args.repo);
        if (ownerRepo) {
          return {
            success: false,
            error: buildMissingContentsPermissionMessage(ownerRepo),
            data: {
              repo: `${ownerRepo.owner}/${ownerRepo.repo}`,
              reason: 'missing_contents_permission',
            },
          };
        }
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

export class GitHubSearchCodeTool implements Tool {
  name = 'github_search_code';
  description = `Search code inside a GitHub repository via the GitHub API.

Use this for:
- "find auth middleware"
- "search for env var usage"
- "where is this function defined?"
- "find files mentioning X"`;

  category = ToolCategory.EXTERNAL;
  parameters = {
    type: 'object' as const,
    properties: {
      repo: {
        type: 'string',
        description: 'Repository in "owner/repo" format or full GitHub URL.',
      },
      query: {
        type: 'string',
        description: 'Search query, symbol name, keyword, or phrase.',
      },
      path: {
        type: 'string',
        description: 'Optional subdirectory restriction.',
      },
      filename: {
        type: 'string',
        description: 'Optional filename filter.',
      },
      extension: {
        type: 'string',
        description: 'Optional extension filter without dot, e.g. ts or md.',
      },
      limit: {
        type: 'number',
        description: 'Maximum results to return.',
        default: 10,
      },
    },
    required: ['repo', 'query'],
  };

  async execute(args: {
    repo: string;
    query: string;
    path?: string;
    filename?: string;
    extension?: string;
    limit?: number;
  }): Promise<ToolResult> {
    try {
      const auth = await requireGitHubToken();
      if ('success' in auth) {
        return auth;
      }

      const ownerRepo = parseRepo(args.repo);
      if (!ownerRepo) {
        return {
          success: false,
          error: `Could not parse owner/repo from: '${args.repo}'`,
        };
      }

      if (auth.mode === 'app' && !hasGitHubPermission(auth, 'contents', 'read')) {
        return {
          success: false,
          error: buildMissingContentsPermissionMessage(ownerRepo),
          data: {
            repo: `${ownerRepo.owner}/${ownerRepo.repo}`,
            reason: 'missing_contents_permission',
          },
        };
      }

      const query = String(args.query || '').trim();
      if (!query) {
        return {
          success: false,
          error: 'Search query is required',
        };
      }

      const limit = Math.max(1, Math.min(args.limit || 10, 50));
      const queryParts = [query, `repo:${ownerRepo.owner}/${ownerRepo.repo}`];
      if (args.path?.trim()) queryParts.push(`path:${args.path.trim()}`);
      if (args.filename?.trim()) queryParts.push(`filename:${args.filename.trim()}`);
      if (args.extension?.trim()) queryParts.push(`extension:${args.extension.trim().replace(/^\./, '')}`);

      const result = await githubApiRequest(
        `/search/code?q=${encodeURIComponent(queryParts.join(' '))}&per_page=${limit}`,
        { token: auth.token, apiBaseUrl: auth.apiBaseUrl },
      );

      const items = Array.isArray(result?.items) ? result.items : [];
      const summary = items.slice(0, limit).map((item: any) => ({
        name: item.name,
        path: item.path,
        sha: item.sha,
        url: item.html_url,
        repository: item.repository?.full_name,
      }));

      if (summary.length === 0) {
        return {
          success: true,
          output: `No code matches found for "${query}" in ${ownerRepo.owner}/${ownerRepo.repo}.`,
          data: {
            totalCount: result?.total_count || 0,
            items: [],
          },
        };
      }

      return {
        success: true,
        output: [
          `Found ${summary.length} result(s) for "${query}" in ${ownerRepo.owner}/${ownerRepo.repo}:`,
          '',
          ...summary.map((item: { path: string; url: string }) => `${item.path}\n${item.url}`),
        ].join('\n'),
        data: {
          totalCount: result?.total_count || summary.length,
          items: summary,
        },
      };
    } catch (error) {
      if (isGitHubIntegrationAccessError(error)) {
        const ownerRepo = parseRepo(args.repo);
        if (ownerRepo) {
          return {
            success: false,
            error: buildMissingContentsPermissionMessage(ownerRepo),
            data: {
              repo: `${ownerRepo.owner}/${ownerRepo.repo}`,
              reason: 'missing_contents_permission',
            },
          };
        }
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
