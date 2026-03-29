import {
  buildChannelConfigSchema,
  WhatsAppConfigSchema,
} from "foxfang/plugin-sdk/channel-config-schema";
import { whatsAppChannelConfigUiHints } from "./config-ui-hints.js";

export const WhatsAppChannelConfigSchema = buildChannelConfigSchema(WhatsAppConfigSchema, {
  uiHints: whatsAppChannelConfigUiHints,
});
