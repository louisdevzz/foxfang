import type { FoxFangConfig } from "../../config/types.js";

export type DirectoryConfigParams = {
  cfg: FoxFangConfig;
  accountId?: string | null;
  query?: string | null;
  limit?: number | null;
};
