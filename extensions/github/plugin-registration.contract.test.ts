import { describePluginRegistrationContract } from "../../test/helpers/extensions/plugin-registration-contract.js";

describePluginRegistrationContract({
  pluginId: "github",
  toolNames: ["github_create_issue", "github_list_issues", "github_add_comment"],
});
