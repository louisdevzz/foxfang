import {
  buildChannelConfigSchema,
  MSTeamsConfigSchema,
} from "foxfang/plugin-sdk/channel-config-schema";
import { msTeamsChannelConfigUiHints } from "./config-ui-hints.js";

export const MSTeamsChannelConfigSchema = buildChannelConfigSchema(MSTeamsConfigSchema, {
  uiHints: msTeamsChannelConfigUiHints,
});
