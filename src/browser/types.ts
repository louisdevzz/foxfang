/**
 * Browser Service Types
 * 
 * Type definitions for Foxfang browser service
 * Compatible with OpenClaw's browser types
 */

export interface BrowserProfile {
  name: string;
  userDataDir?: string;
  executablePath?: string;
  headless?: boolean;
  remoteCdpUrl?: string;
}

export interface BrowserConfig {
  enabled: boolean;
  port: number;
  host: string;
  headless: boolean;
  executablePath?: string;
  defaultProfile: string;
  profiles: Record<string, BrowserProfile>;
  autoStart: boolean;
  userDataDir?: string;
}

export interface BrowserStatus {
  enabled: boolean;
  running: boolean;
  pid: number | null;
  cdpPort: number | null;
  cdpUrl?: string | null;
  chosenBrowser: string | null;
  detectedBrowser?: string | null;
  userDataDir: string | null;
  color: string;
  headless: boolean;
  attachOnly: boolean;
  profile?: string;
}

export interface ProfileStatus {
  name: string;
  cdpPort: number | null;
  cdpUrl: string | null;
  color: string;
  driver: "foxfang" | "existing-session";
  running: boolean;
  tabCount: number;
  isDefault: boolean;
  isRemote: boolean;
  missingFromConfig?: boolean;
  reconcileReason?: string | null;
}

export interface BrowserTab {
  targetId: string;
  title: string;
  url: string;
  wsUrl?: string;
  type?: string;
}

export interface SnapshotAriaNode {
  ref: string;
  role: string;
  name: string;
  value?: string;
  description?: string;
  backendDOMNodeId?: number;
  depth: number;
}

export interface SnapshotResult {
  ok: true;
  format: "aria" | "ai";
  targetId: string;
  url: string;
  snapshot?: string;
  nodes?: SnapshotAriaNode[];
  truncated?: boolean;
  refs?: Record<string, { role: string; name?: string; nth?: number }>;
  stats?: {
    lines: number;
    chars: number;
    refs: number;
    interactive: number;
  };
  labels?: boolean;
  labelsCount?: number;
  labelsSkipped?: number;
  imagePath?: string;
  imageType?: "png" | "jpeg";
}

export interface BrowserActRequest {
  kind: "click" | "type" | "press" | "hover" | "drag" | "select" | "fill" | "resize" | "wait" | "evaluate" | "close";
  targetId?: string;
  ref?: string;
  doubleClick?: boolean;
  button?: string;
  modifiers?: string[];
  text?: string;
  submit?: boolean;
  slowly?: boolean;
  key?: string;
  delayMs?: number;
  startRef?: string;
  endRef?: string;
  values?: string[];
  fields?: Record<string, unknown>[];
  width?: number;
  height?: number;
  timeMs?: number;
  selector?: string;
  url?: string;
  loadState?: string;
  textGone?: string;
  timeoutMs?: number;
  fn?: string;
}

export interface BrowserRuntime {
  process?: any;
  cdpPort: number;
  cdpUrl: string;
  browser?: any; // Playwright Browser instance
  context?: any; // Playwright BrowserContext
  pages: Map<string, BrowserPageSession>;
}

export interface BrowserPageSession {
  targetId: string;
  page: any; // Playwright Page
  title: string;
  url: string;
  createdAt: number;
}

export interface BrowserServerState {
  config: BrowserConfig;
  profiles: Map<string, BrowserRuntime>;
  defaultProfile: string;
}
