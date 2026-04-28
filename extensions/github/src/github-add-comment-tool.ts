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

const AddCommentSchema = Type.Object(
  {
    issue_number: Type.Number({
      description: "The issue number to comment on.",
    }),
    body: Type.String({
      description: "Comment text (markdown supported).",
    }),
    owner: Type.Optional(
      Type.String({ description: "GitHub org or username. Defaults to plugin defaultOwner." }),
    ),
    repo: Type.Optional(
      Type.String({ description: "Repository name. Defaults to plugin defaultRepo." }),
    ),
  },
  { additionalProperties: false },
);

export function createGitHubAddCommentTool(api: FoxFangPluginApi) {
  return {
    name: "github_add_comment",
    label: "GitHub: Add Comment",
    description:
      "Add a comment to an existing GitHub issue. " +
      "Use to post updates, follow-ups, or context from Signal conversations onto an issue.",
    parameters: AddCommentSchema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const cfg = api.config;
      const appId = resolveGitHubAppId(cfg);
      const privateKey = resolveGitHubPrivateKey(cfg);
      const installationId = resolveGitHubInstallationId(cfg);

      if (!appId || !privateKey || !installationId) {
        return jsonResult({
          error: "GitHub App not configured. Set appId, privateKey, and installationId.",
        });
      }

      const ownerParam = readStringParam(rawParams, "owner");
      const repoParam = readStringParam(rawParams, "repo");
      const owner = ownerParam || resolveGitHubDefaultOwner(cfg);
      const repo = repoParam || resolveGitHubDefaultRepo(cfg);
      const body = readStringParam(rawParams, "body", { required: true });
      const issueNumber = rawParams.issue_number;

      if (!owner || !repo) {
        return jsonResult({ error: "No repository specified." });
      }
      if (typeof issueNumber !== "number") {
        return jsonResult({ error: "issue_number must be a number." });
      }

      const resp = await githubFetch(
        appId,
        privateKey,
        installationId,
        `/repos/${owner}/${repo}/issues/${issueNumber}/comments`,
        {
          method: "POST",
          body: JSON.stringify({ body }),
        },
      );

      if (!resp.ok) {
        const errBody = await resp.text().catch(() => "(no body)");
        return jsonResult({ error: `GitHub API error (${resp.status}): ${errBody}` });
      }

      const comment = (await resp.json()) as { id: number; html_url: string };
      return jsonResult({
        comment_id: comment.id,
        url: comment.html_url,
        issue: `${owner}/${repo}#${issueNumber}`,
      });
    },
  };
}
