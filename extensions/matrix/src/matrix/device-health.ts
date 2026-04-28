export type MatrixManagedDeviceInfo = {
  deviceId: string;
  displayName: string | null;
  current: boolean;
};

export type MatrixDeviceHealthSummary = {
  currentDeviceId: string | null;
  staleFoxFangDevices: MatrixManagedDeviceInfo[];
  currentFoxFangDevices: MatrixManagedDeviceInfo[];
};

const FOXFANG_DEVICE_NAME_PREFIX = "FoxFang ";

export function isFoxFangManagedMatrixDevice(displayName: string | null | undefined): boolean {
  return displayName?.startsWith(FOXFANG_DEVICE_NAME_PREFIX) === true;
}

export function summarizeMatrixDeviceHealth(
  devices: MatrixManagedDeviceInfo[],
): MatrixDeviceHealthSummary {
  const currentDeviceId = devices.find((device) => device.current)?.deviceId ?? null;
  const openClawDevices = devices.filter((device) =>
    isFoxFangManagedMatrixDevice(device.displayName),
  );
  return {
    currentDeviceId,
    staleFoxFangDevices: openClawDevices.filter((device) => !device.current),
    currentFoxFangDevices: openClawDevices.filter((device) => device.current),
  };
}
