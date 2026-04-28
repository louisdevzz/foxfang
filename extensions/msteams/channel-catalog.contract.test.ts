import { describeChannelCatalogEntryContract } from "../../test/helpers/channels/channel-catalog-contract.js";

describeChannelCatalogEntryContract({
  channelId: "msteams",
  npmSpec: "@foxfang/msteams",
  alias: "teams",
});
