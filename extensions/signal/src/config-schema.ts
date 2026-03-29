import {
  buildChannelConfigSchema,
  SignalConfigSchema,
} from "foxfang/plugin-sdk/channel-config-schema";
import { signalChannelConfigUiHints } from "./config-ui-hints.js";

export const SignalChannelConfigSchema = buildChannelConfigSchema(SignalConfigSchema, {
  uiHints: signalChannelConfigUiHints,
});
