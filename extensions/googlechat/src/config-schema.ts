import {
  buildChannelConfigSchema,
  GoogleChatConfigSchema,
} from "foxfang/plugin-sdk/channel-config-schema";

export const GoogleChatChannelConfigSchema = buildChannelConfigSchema(GoogleChatConfigSchema);
