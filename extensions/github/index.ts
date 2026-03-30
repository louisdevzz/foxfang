import { definePluginEntry, type AnyAgentTool } from "foxfang/plugin-sdk/plugin-entry";
import { createGitHubAddCommentTool } from "./src/github-add-comment-tool.js";
import { createGitHubCreateIssueTool } from "./src/github-create-issue-tool.js";
import { createGitHubListIssuesTool } from "./src/github-list-issues-tool.js";

export default definePluginEntry({
  id: "github",
  name: "GitHub Plugin",
  description:
    "GitHub App integration — create issues, list issues, and add comments. " +
    "Authenticated via GitHub App (App ID + private key + installation ID).",
  register(api) {
    api.registerTool(createGitHubCreateIssueTool(api) as AnyAgentTool);
    api.registerTool(createGitHubListIssuesTool(api) as AnyAgentTool);
    api.registerTool(createGitHubAddCommentTool(api) as AnyAgentTool);
  },
});
