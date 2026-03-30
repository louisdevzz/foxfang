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

const CreateIssueSchema = Type.Object(
  {
    title: Type.String({
      description: "Issue title.",
    }),
    body: Type.Optional(
      Type.String({
        description: "Issue body / description (markdown supported).",
      }),
    ),
    owner: Type.Optional(
      Type.String({
        description:
          "GitHub org or username that owns the repo. Defaults to plugin defaultOwner config.",
      }),
    ),
    repo: Type.Optional(
      Type.String({
        description:
          "Repository name (without owner). Defaults to plugin defaultRepo config.",
      }),
    ),
    assignees: Type.Optional(
      Type.String({
        description:
          "Comma-separated GitHub usernames to assign (e.g. 'alice,bob'). Each must be a collaborator.",
      }),
    ),
    labels: Type.Optional(
      Type.String({
        description: "Comma-separated label names to apply (e.g. 'bug,marketing').",
      }),
    ),
    milestone: Type.Optional(
      Type.Number({
        description: "Milestone number to associate the issue with.",
      }),
    ),
  },
  { additionalProperties: false },
);

export function createGitHubCreateIssueTool(api: FoxFangPluginApi) {
  return {
    name: "github_create_issue",
    label: "GitHub: Create Issue",
    description:
      "Create a GitHub issue in a repository using the configured GitHub App. " +
      "Use this when a user asks to log a task, bug, or request as a GitHub issue — " +
      "especially when converting messages from Signal or other channels into tracked issues.",
    parameters: CreateIssueSchema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const cfg = api.config;
      const appId = resolveGitHubAppId(cfg);
      const privateKey = resolveGitHubPrivateKey(cfg);
      const installationId = resolveGitHubInstallationId(cfg);

      if (!appId || !privateKey || !installationId) {
        return jsonResult({
          error:
            "GitHub App not configured. Set appId, privateKey, and installationId " +
            "in plugin config or via GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY / GITHUB_APP_INSTALLATION_ID env vars.",
        });
      }

      const title = readStringParam(rawParams, "title", { required: true });
      const body = readStringParam(rawParams, "body");
      const ownerParam = readStringParam(rawParams, "owner");
      const repoParam = readStringParam(rawParams, "repo");
      const assigneesParam = readStringParam(rawParams, "assignees");
      const labelsParam = readStringParam(rawParams, "labels");

      const owner = ownerParam || resolveGitHubDefaultOwner(cfg);
      const repo = repoParam || resolveGitHubDefaultRepo(cfg);

      if (!owner || !repo) {
        return jsonResult({
          error:
            "No repository specified. Provide owner/repo params or set defaultOwner/defaultRepo in plugin config.",
        });
      }

      const payload: Record<string, unknown> = { title };
      if (body) payload.body = body;
      if (assigneesParam) {
        payload.assignees = assigneesParam
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      }
      if (labelsParam) {
        payload.labels = labelsParam
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      }
      if (typeof rawParams.milestone === "number") {
        payload.milestone = rawParams.milestone;
      }

      const resp = await githubFetch(appId, privateKey, installationId, `/repos/${owner}/${repo}/issues`, {
        method: "POST",
        body: JSON.stringify(payload),
      });

      if (!resp.ok) {
        const errBody = await resp.text().catch(() => "(no body)");
        return jsonResult({ error: `GitHub API error (${resp.status}): ${errBody}` });
      }

      const issue = (await resp.json()) as {
        number: number;
        html_url: string;
        title: string;
        state: string;
      };

      return jsonResult({
        number: issue.number,
        url: issue.html_url,
        title: issue.title,
        state: issue.state,
        repo: `${owner}/${repo}`,
      });
    },
  };
}
