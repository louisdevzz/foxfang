import { loadGeneratedBundledPluginEntries } from "../generated/bundled-plugin-entries.generated.js";
import type { FoxFangPluginDefinition } from "./types.js";

type BundledRegistrablePlugin = FoxFangPluginDefinition & {
  id: string;
  register: NonNullable<FoxFangPluginDefinition["register"]>;
};

export const BUNDLED_PLUGIN_ENTRIES =
  (await loadGeneratedBundledPluginEntries()) as unknown as readonly BundledRegistrablePlugin[];
