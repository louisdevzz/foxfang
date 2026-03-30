import { Type } from "@sinclair/typebox";
import type { FoxFangPluginApi } from "foxfang/plugin-sdk/plugin-runtime";
import { jsonResult, readStringParam } from "foxfang/plugin-sdk/provider-web-search";
import { githubFetch } from "./github-app-auth.js";
import {
  resolveGitHubAppId,
  resolveGitHubDefaultOwner,
  resolveGitHubDefaultRepo,
  resolveGitHubInstallationId,
  resolveGitHubPrivateKey,
} from "./config.js";

function optionalStringEnum<const T extends readonly string[]>(
  values: T,
  options: { description?: string } = {},
) {
  return Type.Optional(
    Type.Unsafe<T[number]>({
      type: "string",
      enum: [...values],
      ...options,
    }),
  );
}

const ListIssuesSchema = Type.Object(
  {
    owner: Type.Optional(
      Type.String({ description: "GitHub org or username. Defaults to plugin defaultOwner." }),
    ),
    repo: Type.Optional(
      Type.String({ description: "Repository name. Defaults to plugin defaultRepo." }),
    ),
    state: optionalStringEnum(["open", "closed", "all"] as const, {
      description: 'Filter by state: "open" (default), "closed", or "all".',
    }),
    assignee: Type.Optional(
      Type.String({ description: "Filter by assignee GitHub username." }),
    ),
    labels: Type.Optional(
      Type.String({ description: "Comma-separated label names to filter by." }),
    ),
    limit: Type.Optional(
      Type.Number({
        description: "Maximum number of issues to return (1–100, default 20).",
        minimum: 1,
        maximum: 100,
      }),
    ),
  },
  { additionalProperties: false },
);

export function createGitHubListIssuesTool(api: FoxFangPluginApi) {
  return {
    name: "github_list_issues",
    label: "GitHub: List Issues",
    description:
      "List open (or filtered) GitHub issues in a repository using the configured GitHub App. " +
      "Useful to check existing issues before creating a duplicate, or to show what's tracked.",
    parameters: ListIssuesSchema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const cfg = api.config;
      const appId = resolveGitHubAppId(cfg);
      const privateKey = resolveGitHubPrivateKey(cfg);
      const installationId = resolveGitHubInstallationId(cfg);

      if (!appId || !privateKey || !installationId) {
        return jsonResult({
          error:
            "GitHub App not configured. Set appId, privateKey, and installationId " +
            "in plugin config or via env vars.",
        });
      }

      const ownerParam = readStringParam(rawParams, "owner");
      const repoParam = readStringParam(rawParams, "repo");
      const owner = ownerParam || resolveGitHubDefaultOwner(cfg);
      const repo = repoParam || resolveGitHubDefaultRepo(cfg);

      if (!owner || !repo) {
        return jsonResult({
          error: "No repository specified. Provide owner/repo or set defaults in plugin config.",
        });
      }

      const state =
        typeof rawParams.state === "string" ? rawParams.state : "open";
      const assignee =
        typeof rawParams.assignee === "string" ? rawParams.assignee.trim() : undefined;
      const labelsParam =
        typeof rawParams.labels === "string" ? rawParams.labels.trim() : undefined;
      const limit =
        typeof rawParams.limit === "number"
          ? Math.min(Math.max(1, rawParams.limit), 100)
          : 20;

      const params = new URLSearchParams({
        state,
        per_page: String(limit),
      });
      if (assignee) params.set("assignee", assignee);
      if (labelsParam) params.set("labels", labelsParam);

      const resp = await githubFetch(
        appId,
        privateKey,
        installationId,
        `/repos/${owner}/${repo}/issues?${params.toString()}`,
      );

      if (!resp.ok) {
        const errBody = await resp.text().catch(() => "(no body)");
        return jsonResult({ error: `GitHub API error (${resp.status}): ${errBody}` });
      }

      const issues = (await resp.json()) as Array<{
        number: number;
        title: string;
        state: string;
        html_url: string;
        assignees: Array<{ login: string }>;
        labels: Array<{ name: string }>;
        created_at: string;
      }>;

      return jsonResult({
        repo: `${owner}/${repo}`,
        total: issues.length,
        issues: issues.map((i) => ({
          number: i.number,
          title: i.title,
          state: i.state,
          url: i.html_url,
          assignees: i.assignees.map((a) => a.login),
          labels: i.labels.map((l) => l.name),
          created_at: i.created_at,
        })),
      });
    },
  };
}
