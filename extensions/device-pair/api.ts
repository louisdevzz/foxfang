export {
  approveDevicePairing,
  clearDeviceBootstrapTokens,
  issueDeviceBootstrapToken,
  PAIRING_SETUP_BOOTSTRAP_PROFILE,
  listDevicePairing,
  revokeDeviceBootstrapToken,
  type DeviceBootstrapProfile,
} from "foxfang/plugin-sdk/device-bootstrap";
export { definePluginEntry, type FoxFangPluginApi } from "foxfang/plugin-sdk/plugin-entry";
export {
  resolveGatewayBindUrl,
  resolveGatewayPort,
  resolveTailnetHostWithRunner,
} from "foxfang/plugin-sdk/core";
export {
  resolvePreferredFoxFangTmpDir,
  runPluginCommandWithTimeout,
} from "foxfang/plugin-sdk/sandbox";
export { renderQrPngBase64 } from "./qr-image.js";
