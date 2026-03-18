/**
 * GitHub Tools
 * 
 * Create issues, PRs, and manage GitHub repos via agent tools.
 * Inspired by ZeroBuild's github_ops.rs
 */

import { Tool, ToolCategory, ToolResult } from '../traits';
import {
  isGitHubConnected,
  getGitHubToken,
  saveGitHubToken,
  disconnectGitHub,
  githubApiRequest,
  extractOwnerRepo,
  validateIssueTitle,
  validatePRTitle,
  validateLabels,
  sanitizeLabels,
  generateIssueTemplate,
  generatePRTemplate,
  getGitHubUser,
  startGitHubOAuthFlow,
} from '../../integrations/github';
import { spawn } from 'child_process';

/**
 * GitHub Connect Tool - Check/set GitHub connection
 */
export class GitHubConnectTool implements Tool {
  name = 'github_connect';
  description = `Check or set GitHub connection status. 

TRIGGER PHRASES: 'github connect', 'connect github', 'check github', 'am i connected to github', 'login to github'

ACTIONS:
- check: Check if GitHub is connected (default)
- set: Set GitHub token manually (requires token parameter)
- oauth: Start OAuth flow via browser (opens browser for authorization)
- disconnect: Remove GitHub connection

If not connected, you can either:
1. Use OAuth (action: "oauth") - opens browser, no token needed
2. Set token manually (action: "set", token: "ghp_xxxx")

Get a personal access token at: https://github.com/settings/tokens
Required scopes: repo, read:user

Examples:
- Check connection: github_connect (or github_connect with action: "check")
- OAuth login: github_connect with action: "oauth"
- Set token: github_connect with action: "set", token: "ghp_xxxx"
- Disconnect: github_connect with action: "disconnect"`;

  category = ToolCategory.EXTERNAL;
  parameters = {
    type: 'object' as const,
    properties: {
      action: {
        type: 'string',
        enum: ['check', 'set', 'oauth', 'disconnect'],
        description: 'Action to perform',
        default: 'check',
      },
      token: {
        type: 'string',
        description: 'GitHub personal access token (for set action)',
      },
    },
    required: [],
  };

  async execute(args: { action?: string; token?: string }): Promise<ToolResult> {
    const action = args.action || 'check';

    try {
      switch (action) {
        case 'check': {
          const token = await getGitHubToken();
          if (token) {
            return {
              success: true,
              output: `✅ GitHub is connected (user: ${token.username || 'unknown'}).\nYou can now create issues, PRs, and manage repositories.`,
              data: { connected: true, username: token.username },
            };
          } else {
            return {
              success: false,
              output: '',
              error: `GitHub is not connected.\n\nTo connect:\n1. Use OAuth: github_connect with action: "oauth" (opens browser)\n2. Or set token manually: github_connect with action: "set", token: "your_token_here"\n\nGet a token at: https://github.com/settings/tokens (scopes: repo, read:user)`,
            };
          }
        }

        case 'oauth': {
          // Start OAuth flow
          const { authUrl, waitForCallback } = await startGitHubOAuthFlow();
          
          // Open browser
          const openCommand = process.platform === 'darwin' ? 'open' : 
                             process.platform === 'win32' ? 'start' : 'xdg-open';
          spawn(openCommand, [authUrl], { detached: true, stdio: 'ignore' }).unref();
          
          try {
            const token = await waitForCallback();
            return {
              success: true,
              output: `✅ GitHub connected successfully via OAuth (user: ${token.username || 'unknown'})`,
              data: { connected: true, username: token.username },
            };
          } catch (error) {
            return {
              success: false,
              error: `OAuth failed: ${error instanceof Error ? error.message : String(error)}`,
            };
          }
        }

        case 'set': {
          if (!args.token) {
            return {
              success: false,
              error: 'Token is required for set action. Get one at https://github.com/settings/tokens',
            };
          }

          // Validate token by getting user info
          try {
            const userInfo = await getGitHubUser(args.token);
            await saveGitHubToken(args.token, userInfo.login, ['repo', 'read:user']);
            
            return {
              success: true,
              output: `✅ GitHub connected successfully (user: ${userInfo.login})`,
              data: { connected: true, username: userInfo.login },
            };
          } catch (error) {
            return {
              success: false,
              error: `Invalid token: ${error instanceof Error ? error.message : String(error)}`,
            };
          }
        }

        case 'disconnect': {
          await disconnectGitHub();
          return {
            success: true,
            output: '✅ GitHub disconnected successfully',
          };
        }

        default:
          return {
            success: false,
            error: `Unknown action: ${action}. Use 'check', 'oauth', 'set', or 'disconnect'`,
          };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

/**
 * GitHub Create Issue Tool
 */
export class GitHubCreateIssueTool implements Tool {
  name = 'github_create_issue';
  description = `CREATE A GITHUB ISSUE - Use this when user says '#issue', '#bug', 'create issue', or wants to report a bug/request a feature.

WORKFLOW (MUST FOLLOW):
1. First call with confirm:false → Shows preview to user, STOPS and waits for user response
2. After user says 'create it' or 'confirm', call again with confirm:true → Actually creates the issue

TRIGGER PHRASES: '#issue', '#bug', '#feature', 'create issue', 'file issue', 'report bug'.

REQUIRED FORMAT (ENFORCED):
- Title MUST start with bracketed prefix: [Feature]:, [Bug]:, [Chore]:, [Docs]:, [Security]:, [Refactor]:, [Test]:, or [Perf]:
- At least one type label is REQUIRED (feature, bug, chore, docs, security, refactor, test, perf)
- Body should follow the standard template with sections

DO NOT use this for file searches or reading code. All content MUST be in English.
The user must have connected their GitHub account first (use github_connect).`;

  category = ToolCategory.EXTERNAL;
  parameters = {
    type: 'object' as const,
    properties: {
      repo: {
        type: 'string',
        description: 'Repository name (e.g. "owner/repo" or "https://github.com/owner/repo")',
      },
      title: {
        type: 'string',
        description: 'Issue title. MUST use format: [Feature]: ..., [Bug]: ..., etc.',
      },
      body: {
        type: 'string',
        description: 'Issue body (Markdown). Template will be auto-generated if not provided.',
      },
      labels: {
        type: 'array',
        items: { type: 'string' },
        description: 'REQUIRED: At least one type label. Valid: feature, bug, chore, docs, security, refactor, test, perf',
      },
      confirm: {
        type: 'boolean',
        description: 'REQUIRED: Set to false first to preview. After user approves, call again with confirm: true.',
      },
    },
    required: ['repo', 'title', 'labels', 'confirm'],
  };

  async execute(args: {
    repo: string;
    title: string;
    body?: string;
    labels: string[];
    confirm: boolean;
  }): Promise<ToolResult> {
    try {
      // Check GitHub connection
      const token = await getGitHubToken();
      if (!token) {
        return {
          success: false,
          error: 'GitHub is not connected. Run "github_connect" first to authenticate.',
        };
      }

      // Validate title
      const titleValidation = validateIssueTitle(args.title);
      if (!titleValidation.valid) {
        return {
          success: false,
          error: titleValidation.error,
          data: { hint: 'Valid prefixes: [Feature]:, [Bug]:, [Chore]:, [Docs]:, [Security]:, [Refactor]:, [Test]:, [Perf]:' },
        };
      }

      // Parse owner/repo
      const ownerRepo = extractOwnerRepo(args.repo);
      if (!ownerRepo) {
        return {
          success: false,
          error: `Could not parse owner/repo from: '${args.repo}'`,
          data: { hint: 'Use format: "owner/repo" or "https://github.com/owner/repo"' },
        };
      }

      // Validate labels
      const labelValidation = validateLabels(args.labels);
      if (!labelValidation.valid) {
        return {
          success: false,
          error: labelValidation.error,
        };
      }

      // Sanitize labels
      const labels = sanitizeLabels(args.labels);

      // Generate body if not provided
      const body = args.body?.trim() || generateIssueTemplate(args.title);

      // Check confirmation
      if (!args.confirm) {
        return {
          success: false,
          output: `📋 ISSUE PREVIEW — Please review before creating\n═══════════════════════════════════════════\n\nRepository: ${ownerRepo.owner}/${ownerRepo.repo}\nTitle: ${args.title}\nLabels: ${labels.join(', ')}\n\nBody:\n\`\`\`markdown\n${body}\n\`\`\`\n\n─────────────────────────────────────────────\n\n⏳ WAITING FOR YOUR CONFIRMATION\n\nReply "create it" or "confirm" to CREATE this issue\nReply with corrections to EDIT the information\nReply "cancel" to ABORT`,
          data: { preview: true, hint: '⏳ PREVIEW MODE — Issue not created yet. Waiting for user confirmation.' },
        };
      }

      // Create the issue
      const result = await githubApiRequest(
        `/repos/${ownerRepo.owner}/${ownerRepo.repo}/issues`,
        {
          method: 'POST',
          token: token.token,
          body: {
            title: args.title,
            body,
            labels,
          },
        }
      );

      return {
        success: true,
        output: `✅ Issue #${result.number} created: ${result.html_url}`,
        data: {
          number: result.number,
          url: result.html_url,
          title: result.title,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

/**
 * GitHub Create PR Tool
 */
export class GitHubCreatePRTool implements Tool {
  name = 'github_create_pr';
  description = `CREATE A GITHUB PULL REQUEST - Use this when user says '#pr', '#pullrequest', 'create PR', or wants to submit code for review.

WORKFLOW (MUST FOLLOW):
1. First call with confirm:false → Shows preview to user, STOPS and waits for user response
2. After user says 'create it' or 'confirm', call again with confirm:true → Actually creates the PR

TRIGGER PHRASES: '#pr', '#pullrequest', 'create PR', 'open PR', 'submit PR', 'make pull request'.

REQUIRED FORMAT (ENFORCED):
- Title MUST follow conventional commit format: 'type(scope): description'
  Valid types: feat, fix, chore, docs, style, refactor, perf, test, build, ci, revert
  Example: 'feat(auth): add OAuth2 token refresh'
- At least one type label is REQUIRED (feature, bug, chore, docs, security, refactor, test, perf)

DO NOT use this for creating issues or general queries. All content MUST be in English.
The user must have connected their GitHub account first (use github_connect).`;

  category = ToolCategory.EXTERNAL;
  parameters = {
    type: 'object' as const,
    properties: {
      repo: {
        type: 'string',
        description: 'Repository name (e.g. "owner/repo" or URL)',
      },
      title: {
        type: 'string',
        description: 'PR title. MUST use format: "type(scope): description" (conventional commits)',
      },
      body: {
        type: 'string',
        description: 'PR description (Markdown). Template will be auto-generated if not provided.',
      },
      head: {
        type: 'string',
        description: 'Branch to merge from (e.g. "feature-branch")',
      },
      base: {
        type: 'string',
        description: 'Branch to merge into (default: main)',
        default: 'main',
      },
      labels: {
        type: 'array',
        items: { type: 'string' },
        description: 'REQUIRED: At least one type label',
      },
      confirm: {
        type: 'boolean',
        description: 'REQUIRED: Set to false first to preview. After user approves, call again with confirm: true.',
      },
    },
    required: ['repo', 'title', 'head', 'labels', 'confirm'],
  };

  async execute(args: {
    repo: string;
    title: string;
    body?: string;
    head: string;
    base?: string;
    labels: string[];
    confirm: boolean;
  }): Promise<ToolResult> {
    try {
      // Check GitHub connection
      const token = await getGitHubToken();
      if (!token) {
        return {
          success: false,
          error: 'GitHub is not connected. Run "github_connect" first to authenticate.',
        };
      }

      // Validate title
      const titleValidation = validatePRTitle(args.title);
      if (!titleValidation.valid) {
        return {
          success: false,
          error: titleValidation.error,
        };
      }

      // Parse owner/repo
      const ownerRepo = extractOwnerRepo(args.repo);
      if (!ownerRepo) {
        return {
          success: false,
          error: `Could not parse owner/repo from: '${args.repo}'`,
        };
      }

      // Validate labels
      const labelValidation = validateLabels(args.labels);
      if (!labelValidation.valid) {
        return {
          success: false,
          error: labelValidation.error,
        };
      }

      // Sanitize labels
      const labels = sanitizeLabels(args.labels);

      // Generate body if not provided
      const body = args.body?.trim() || generatePRTemplate(args.title);
      const base = args.base || 'main';

      // Check confirmation
      if (!args.confirm) {
        return {
          success: false,
          output: `📋 PULL REQUEST PREVIEW — Please review before creating\n═══════════════════════════════════════════════\n\nRepository: ${ownerRepo.owner}/${ownerRepo.repo}\nTitle: ${args.title}\nBranch: ${args.head} → ${base}\nLabels: ${labels.join(', ')}\n\nBody:\n\`\`\`markdown\n${body}\n\`\`\`\n\n─────────────────────────────────────────────\n\n⏳ WAITING FOR YOUR CONFIRMATION\n\nReply "create it" or "confirm" to CREATE this PR\nReply with corrections to EDIT the information\nReply "cancel" to ABORT`,
          data: { preview: true, hint: '⏳ PREVIEW MODE — Pull Request not created yet. Waiting for user confirmation.' },
        };
      }

      // Create the PR
      const result = await githubApiRequest(
        `/repos/${ownerRepo.owner}/${ownerRepo.repo}/pulls`,
        {
          method: 'POST',
          token: token.token,
          body: {
            title: args.title,
            body,
            head: args.head,
            base,
          },
        }
      );

      // Add labels to PR
      if (labels.length > 0) {
        try {
          await githubApiRequest(
            `/repos/${ownerRepo.owner}/${ownerRepo.repo}/issues/${result.number}/labels`,
            {
              method: 'POST',
              token: token.token,
              body: { labels },
            }
          );
        } catch {
          // Label errors are non-fatal
        }
      }

      return {
        success: true,
        output: `✅ Pull request #${result.number} created: ${result.html_url}`,
        data: {
          number: result.number,
          url: result.html_url,
          title: result.title,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

/**
 * GitHub List Issues Tool
 */
export class GitHubListIssuesTool implements Tool {
  name = 'github_list_issues';
  description = 'List issues in a GitHub repository.';
  category = ToolCategory.EXTERNAL;
  parameters = {
    type: 'object' as const,
    properties: {
      repo: {
        type: 'string',
        description: 'Repository name (e.g. "owner/repo")',
      },
      state: {
        type: 'string',
        enum: ['open', 'closed', 'all'],
        description: 'Filter by state',
        default: 'open',
      },
      limit: {
        type: 'number',
        description: 'Maximum issues to return',
        default: 30,
      },
    },
    required: ['repo'],
  };

  async execute(args: { repo: string; state?: string; limit?: number }): Promise<ToolResult> {
    try {
      const token = await getGitHubToken();
      if (!token) {
        return {
          success: false,
          error: 'GitHub is not connected. Run "github_connect" first.',
        };
      }

      const ownerRepo = extractOwnerRepo(args.repo);
      if (!ownerRepo) {
        return {
          success: false,
          error: `Invalid repo format: ${args.repo}`,
        };
      }

      const state = args.state || 'open';
      const limit = Math.min(args.limit || 30, 100);

      const issues = await githubApiRequest(
        `/repos/${ownerRepo.owner}/${ownerRepo.repo}/issues?state=${state}&per_page=${limit}`,
        { token: token.token }
      );

      if (!Array.isArray(issues) || issues.length === 0) {
        return {
          success: true,
          output: 'No issues found.',
          data: { issues: [] },
        };
      }

      const summary = issues.map((i: any) => ({
        number: i.number,
        title: i.title,
        state: i.state,
        url: i.html_url,
        labels: i.labels?.map((l: any) => l.name) || [],
      }));

      return {
        success: true,
        output: `${issues.length} issue(s):\n\n` + summary.map((s: any) => 
          `#${s.number}: ${s.title} (${s.state})\n   ${s.url}`
        ).join('\n\n'),
        data: { issues: summary },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

/**
 * GitHub List PRs Tool
 */
export class GitHubListPRsTool implements Tool {
  name = 'github_list_prs';
  description = 'List pull requests in a GitHub repository.';
  category = ToolCategory.EXTERNAL;
  parameters = {
    type: 'object' as const,
    properties: {
      repo: {
        type: 'string',
        description: 'Repository name (e.g. "owner/repo")',
      },
      state: {
        type: 'string',
        enum: ['open', 'closed', 'all'],
        description: 'Filter by state',
        default: 'open',
      },
      limit: {
        type: 'number',
        description: 'Maximum PRs to return',
        default: 30,
      },
    },
    required: ['repo'],
  };

  async execute(args: { repo: string; state?: string; limit?: number }): Promise<ToolResult> {
    try {
      const token = await getGitHubToken();
      if (!token) {
        return {
          success: false,
          error: 'GitHub is not connected. Run "github_connect" first.',
        };
      }

      const ownerRepo = extractOwnerRepo(args.repo);
      if (!ownerRepo) {
        return {
          success: false,
          error: `Invalid repo format: ${args.repo}`,
        };
      }

      const state = args.state || 'open';
      const limit = Math.min(args.limit || 30, 100);

      const prs = await githubApiRequest(
        `/repos/${ownerRepo.owner}/${ownerRepo.repo}/pulls?state=${state}&per_page=${limit}`,
        { token: token.token }
      );

      if (!Array.isArray(prs) || prs.length === 0) {
        return {
          success: true,
          output: 'No pull requests found.',
          data: { prs: [] },
        };
      }

      const summary = prs.map((p: any) => ({
        number: p.number,
        title: p.title,
        state: p.state,
        url: p.html_url,
        head: p.head.ref,
        base: p.base.ref,
      }));

      return {
        success: true,
        output: `${prs.length} PR(s):\n\n` + summary.map((s: any) => 
          `#${s.number}: ${s.title}\n   ${s.head} → ${s.base} (${s.state})\n   ${s.url}`
        ).join('\n\n'),
        data: { prs: summary },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
