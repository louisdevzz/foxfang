import { describe, expect, it } from "vitest";
import { isFoxFangManagedMatrixDevice, summarizeMatrixDeviceHealth } from "./device-health.js";

describe("matrix device health", () => {
  it("detects FoxFang-managed device names", () => {
    expect(isFoxFangManagedMatrixDevice("FoxFang Gateway")).toBe(true);
    expect(isFoxFangManagedMatrixDevice("FoxFang Debug")).toBe(true);
    expect(isFoxFangManagedMatrixDevice("Element iPhone")).toBe(false);
    expect(isFoxFangManagedMatrixDevice(null)).toBe(false);
  });

  it("summarizes stale FoxFang-managed devices separately from the current device", () => {
    const summary = summarizeMatrixDeviceHealth([
      {
        deviceId: "du314Zpw3A",
        displayName: "FoxFang Gateway",
        current: true,
      },
      {
        deviceId: "BritdXC6iL",
        displayName: "FoxFang Gateway",
        current: false,
      },
      {
        deviceId: "G6NJU9cTgs",
        displayName: "FoxFang Debug",
        current: false,
      },
      {
        deviceId: "phone123",
        displayName: "Element iPhone",
        current: false,
      },
    ]);

    expect(summary.currentDeviceId).toBe("du314Zpw3A");
    expect(summary.currentFoxFangDevices).toEqual([
      expect.objectContaining({ deviceId: "du314Zpw3A" }),
    ]);
    expect(summary.staleFoxFangDevices).toEqual([
      expect.objectContaining({ deviceId: "BritdXC6iL" }),
      expect.objectContaining({ deviceId: "G6NJU9cTgs" }),
    ]);
  });
});
