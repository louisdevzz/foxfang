/**
 * Browser Tool
 *
 * Foxfang's browser tool for visual webpage interaction.
 * Compatible with OpenClaw's browser API surface.
 */

import { Tool, ToolCategory, ToolResult } from '../traits';

// Browser action types
const BROWSER_ACTIONS = [
  'status',
  'start',
  'stop',
  'profiles',
  'tabs',
  'open',
  'focus',
  'close',
  'snapshot',
  'screenshot',
  'navigate',
  'console',
  'pdf',
  'upload',
  'dialog',
  'act',
] as const;

const BROWSER_TARGETS = ['sandbox', 'host', 'node'] as const;
const BROWSER_SNAPSHOT_FORMATS = ['aria', 'ai'] as const;
const BROWSER_SNAPSHOT_REFS = ['role', 'aria'] as const;
const BROWSER_IMAGE_TYPES = ['png', 'jpeg'] as const;
const BROWSER_ACT_KINDS = [
  'click',
  'type',
  'press',
  'hover',
  'drag',
  'select',
  'fill',
  'resize',
  'wait',
  'evaluate',
  'close',
] as const;

// Default configuration
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_CHARS = 8000;

interface BrowserConfig {
  enabled: boolean;
  defaultProfile?: string;
  profiles?: Record<string, BrowserProfileConfig>;
  executablePath?: string;
  headless?: boolean;
  remoteCdpUrl?: string;
  port?: number;
  host?: string;
  ssrfPolicy?: 'allow' | 'block' | 'warn';
}

interface BrowserProfileConfig {
  name: string;
  executablePath?: string;
  userDataDir?: string;
  headless?: boolean;
  remoteCdpUrl?: string;
}

interface BrowserActRequest {
  kind: typeof BROWSER_ACT_KINDS[number];
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

interface BrowserParameters {
  action: typeof BROWSER_ACTIONS[number];
  target?: typeof BROWSER_TARGETS[number];
  node?: string;
  profile?: string;
  targetUrl?: string;
  url?: string;
  targetId?: string;
  limit?: number;
  maxChars?: number;
  mode?: 'efficient';
  snapshotFormat?: typeof BROWSER_SNAPSHOT_FORMATS[number];
  refs?: typeof BROWSER_SNAPSHOT_REFS[number];
  interactive?: boolean;
  compact?: boolean;
  depth?: number;
  selector?: string;
  frame?: string;
  labels?: boolean;
  fullPage?: boolean;
  ref?: string;
  element?: string;
  type?: typeof BROWSER_IMAGE_TYPES[number];
  level?: string;
  paths?: string[];
  inputRef?: string;
  timeoutMs?: number;
  accept?: boolean;
  promptText?: string;
  request?: BrowserActRequest;
  // Legacy flattened act params
  kind?: typeof BROWSER_ACT_KINDS[number];
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
  textGone?: string;
  loadState?: string;
  fn?: string;
}

export class BrowserTool implements Tool {
  name = 'browser';
  category = ToolCategory.EXTERNAL;
  
  description = [
    'Control the browser via Foxfang\'s browser control service (status/start/stop/profiles/tabs/open/snapshot/screenshot/actions).',
    'Browser choice: omit profile by default for the isolated Foxfang-managed browser.',
    'For the logged-in user browser on the local host, use profile="user". A supported Chromium-based browser (v144+) must be running. Use only when existing logins/cookies matter and the user is present.',
    'When using refs from snapshot (e.g. e12), keep the same tab: prefer passing targetId from the snapshot response into subsequent actions (act/click/type/etc).',
    'For stable, self-resolving refs across calls, use snapshot with refs="aria" (Playwright aria-ref ids). Default refs="role" are role+name-based.',
    'Use snapshot+act for UI automation. Avoid act:wait by default; use only in exceptional cases when no reliable UI state exists.',
  ].join(' ');

  parameters = {
    type: 'object' as const,
    properties: {
      action: {
        type: 'string',
        description: 'Browser action to perform: status, start, stop, profiles, tabs, open, focus, close, snapshot, screenshot, navigate, console, pdf, upload, dialog, act',
      },
      target: {
        type: 'string',
        description: 'Target browser location (sandbox|host|node)',
      },
      node: {
        type: 'string',
        description: 'Node ID for node-targeted browser proxy',
      },
      profile: {
        type: 'string',
        description: 'Browser profile to use',
      },
      targetUrl: {
        type: 'string',
        description: 'URL to navigate to or open',
      },
      url: {
        type: 'string',
        description: 'Alternative URL parameter (legacy)',
      },
      targetId: {
        type: 'string',
        description: 'Target tab ID',
      },
      limit: {
        type: 'number',
        description: 'Limit for list operations',
      },
      maxChars: {
        type: 'number',
        description: 'Maximum characters in snapshot',
      },
      mode: {
        type: 'string',
        description: 'Snapshot mode: efficient',
      },
      snapshotFormat: {
        type: 'string',
        description: 'Snapshot format: aria or ai',
      },
      refs: {
        type: 'string',
        description: 'Reference style: role or aria',
      },
      interactive: {
        type: 'boolean',
        description: 'Include interactive elements only',
      },
      compact: {
        type: 'boolean',
        description: 'Compact output',
      },
      depth: {
        type: 'number',
        description: 'Snapshot depth',
      },
      selector: {
        type: 'string',
        description: 'CSS selector',
      },
      frame: {
        type: 'string',
        description: 'Frame selector',
      },
      labels: {
        type: 'boolean',
        description: 'Include labels in snapshot',
      },
      fullPage: {
        type: 'boolean',
        description: 'Full page screenshot',
      },
      ref: {
        type: 'string',
        description: 'Element reference from snapshot',
      },
      element: {
        type: 'string',
        description: 'Element selector',
      },
      type: {
        type: 'string',
        description: 'Image type: png or jpeg',
      },
      level: {
        type: 'string',
        description: 'Console log level filter',
      },
      paths: {
        type: 'string',
        description: 'Comma-separated file paths for upload',
      },
      inputRef: {
        type: 'string',
        description: 'Input element reference',
      },
      timeoutMs: {
        type: 'number',
        description: 'Operation timeout in milliseconds',
      },
      accept: {
        type: 'boolean',
        description: 'Accept dialog',
      },
      promptText: {
        type: 'string',
        description: 'Text for prompt dialog',
      },
      request: {
        type: 'string',
        description: 'JSON string of act request parameters (kind, ref, text, etc.)',
      },
      kind: {
        type: 'string',
        description: 'Act kind: click, type, press, hover, drag, select, fill, resize, wait, evaluate, close',
      },
      text: {
        type: 'string',
        description: 'Text to type',
      },
      key: {
        type: 'string',
        description: 'Key to press',
      },
      doubleClick: {
        type: 'boolean',
        description: 'Double click',
      },
      button: {
        type: 'string',
        description: 'Mouse button',
      },
      modifiers: {
        type: 'string',
        description: 'Comma-separated modifier keys',
      },
      submit: {
        type: 'boolean',
        description: 'Submit after typing',
      },
      slowly: {
        type: 'boolean',
        description: 'Type slowly',
      },
      delayMs: {
        type: 'number',
        description: 'Delay in milliseconds',
      },
      startRef: {
        type: 'string',
        description: 'Start element reference for drag',
      },
      endRef: {
        type: 'string',
        description: 'End element reference for drag',
      },
      width: {
        type: 'number',
        description: 'Width for resize',
      },
      height: {
        type: 'number',
        description: 'Height for resize',
      },
      timeMs: {
        type: 'number',
        description: 'Time to wait in milliseconds',
      },
      loadState: {
        type: 'string',
        description: 'Load state to wait for',
      },
      textGone: {
        type: 'string',
        description: 'Text that should disappear',
      },
      fn: {
        type: 'string',
        description: 'JavaScript function to evaluate',
      },
    },
    required: ['action'],
  };

  private config: BrowserConfig;
  private baseUrl: string | undefined;

  constructor() {
    // Initialize with defaults - will be updated on first execute
    this.config = {
      enabled: false,
      headless: true,
    };
  }

  private loadConfig(): void {
    try {
      // Try to load from Foxfang config
      const { loadConfig: loadFoxfangConfig } = require('../../config');
      const foxfangConfig = loadFoxfangConfig();
      
      if (foxfangConfig.browser) {
        this.config = {
          ...this.config,
          ...foxfangConfig.browser,
        };
      }

      // Set base URL from config
      const host = this.config.host || 'localhost';
      const port = this.config.port || 9222;
      this.baseUrl = `http://${host}:${port}`;
    } catch {
      // Config not available, use defaults
      this.config = {
        enabled: false,
        headless: true,
      };
    }
  }

  async execute(args: BrowserParameters): Promise<ToolResult> {
    this.loadConfig();

    // Normalize args - ensure action is a string
    const action = typeof args?.action === 'string' ? args.action.trim() : undefined;
    
    if (!action) {
      return {
        success: false,
        error: 'Missing required parameter: action. Valid actions: status, start, stop, profiles, tabs, open, focus, close, snapshot, screenshot, navigate, console, pdf, upload, dialog, act',
      };
    }

    try {
      switch (action) {
        case 'status':
          return await this.executeStatus(args);
        case 'start':
          return await this.executeStart(args);
        case 'stop':
          return await this.executeStop(args);
        case 'profiles':
          return await this.executeProfiles(args);
        case 'tabs':
          return await this.executeTabs(args);
        case 'open':
          return await this.executeOpen(args);
        case 'focus':
          return await this.executeFocus(args);
        case 'close':
          return await this.executeClose(args);
        case 'snapshot':
          return await this.executeSnapshot(args);
        case 'screenshot':
          return await this.executeScreenshot(args);
        case 'navigate':
          return await this.executeNavigate(args);
        case 'console':
          return await this.executeConsole(args);
        case 'pdf':
          return await this.executePdf(args);
        case 'upload':
          return await this.executeUpload(args);
        case 'dialog':
          return await this.executeDialog(args);
        case 'act':
          return await this.executeAct(args);
        default:
          return {
            success: false,
            error: `Unknown action: ${action}`,
          };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async ensureBrowserService(profile?: string): Promise<void> {
    if (!this.baseUrl) {
      throw new Error('Browser service not configured. Set browser.enabled=true in config.');
    }

    // Check if service is running
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      
      const response = await fetch(this.baseUrl + (profile ? `/?profile=${encodeURIComponent(profile)}` : '/'), {
        method: 'GET',
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        const status = await response.json();
        if (status.running) {
          return; // Service is already running
        }
      }
    } catch {
      // Service not running, will try to start
    }

    // Try to start the service
    console.log('[Browser] Service not running, auto-starting...');
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      
      const startUrl = new URL('/start', this.baseUrl);
      if (profile) {
        startUrl.searchParams.set('profile', profile);
      }
      
      const response = await fetch(startUrl.toString(), {
        method: 'POST',
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to start browser service: ${errorText}`);
      }
      
      // Wait a moment for service to be ready
      await new Promise(resolve => setTimeout(resolve, 1000));
      console.log('[Browser] Service started successfully');
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Browser service start timeout (15s). Please check if the browser service is installed and accessible.');
      }
      throw new Error(`Failed to start browser service: ${error instanceof Error ? error.message : String(error)}. Make sure the browser service is running or can be auto-started.`);
    }
  }

  private async fetchBrowserApi<T>(
    path: string,
    options: {
      method?: 'GET' | 'POST' | 'DELETE';
      body?: unknown;
      timeoutMs?: number;
      profile?: string;
      skipAutoStart?: boolean;
    } = {}
  ): Promise<T> {
    const { method = 'GET', body, timeoutMs = DEFAULT_TIMEOUT_MS, profile, skipAutoStart = false } = options;
    
    if (!this.baseUrl) {
      throw new Error('Browser service not configured. Set browser.enabled=true in config.');
    }

    // Auto-start service if needed (except for status check)
    if (!skipAutoStart) {
      await this.ensureBrowserService(profile);
    }

    const url = new URL(path, this.baseUrl);
    if (profile) {
      url.searchParams.set('profile', profile);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url.toString(), {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Browser API error (${response.status}): ${errorText}`);
      }

      return await response.json() as T;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Browser API timeout after ${timeoutMs}ms`);
      }
      throw error;
    }
  }

  private async executeStatus(args: BrowserParameters): Promise<ToolResult> {
    const result = await this.fetchBrowserApi<{
      enabled: boolean;
      running: boolean;
      pid: number | null;
      cdpPort: number | null;
      chosenBrowser: string | null;
      userDataDir: string | null;
      color: string;
      headless: boolean;
      attachOnly: boolean;
    }>('/', { profile: args.profile, skipAutoStart: true });

    return {
      success: true,
      output: JSON.stringify(result, null, 2),
      data: result,
    };
  }

  private async executeStart(args: BrowserParameters): Promise<ToolResult> {
    await this.fetchBrowserApi('/start', {
      method: 'POST',
      profile: args.profile,
      timeoutMs: 15000,
      skipAutoStart: true,
    });

    return await this.executeStatus(args);
  }

  private async executeStop(args: BrowserParameters): Promise<ToolResult> {
    await this.fetchBrowserApi('/stop', {
      method: 'POST',
      profile: args.profile,
      timeoutMs: 15000,
      skipAutoStart: true,
    });

    return await this.executeStatus(args);
  }

  private async executeProfiles(args: BrowserParameters): Promise<ToolResult> {
    const result = await this.fetchBrowserApi<{ profiles: unknown[] }>('/profiles', {
      timeoutMs: 5000,
      skipAutoStart: true,
    });

    return {
      success: true,
      output: JSON.stringify(result.profiles, null, 2),
      data: result,
    };
  }

  private async executeTabs(args: BrowserParameters): Promise<ToolResult> {
    const result = await this.fetchBrowserApi<{ tabs: unknown[] }>('/tabs', {
      profile: args.profile,
      timeoutMs: 5000,
    });

    return {
      success: true,
      output: JSON.stringify(result.tabs, null, 2),
      data: result,
    };
  }

  private async executeOpen(args: BrowserParameters): Promise<ToolResult> {
    const url = args.targetUrl || args.url;
    if (!url) {
      return {
        success: false,
        error: 'URL required for open action',
      };
    }

    const result = await this.fetchBrowserApi<{
      targetId: string;
      url: string;
      title?: string;
    }>('/tabs/open', {
      method: 'POST',
      body: { url },
      profile: args.profile,
      timeoutMs: 30000,
    });

    return {
      success: true,
      output: `Opened ${url}\nTab ID: ${result.targetId}\nTitle: ${result.title || 'N/A'}`,
      data: result,
    };
  }

  private async executeFocus(args: BrowserParameters): Promise<ToolResult> {
    if (!args.targetId) {
      return {
        success: false,
        error: 'targetId required for focus action',
      };
    }

    await this.fetchBrowserApi('/tabs/focus', {
      method: 'POST',
      body: { targetId: args.targetId },
      profile: args.profile,
    });

    return {
      success: true,
      output: `Focused tab ${args.targetId}`,
    };
  }

  private async executeClose(args: BrowserParameters): Promise<ToolResult> {
    if (args.targetId) {
      await this.fetchBrowserApi(`/tabs/${encodeURIComponent(args.targetId)}`, {
        method: 'DELETE',
        profile: args.profile,
      });
      return {
        success: true,
        output: `Closed tab ${args.targetId}`,
      };
    } else {
      await this.fetchBrowserApi('/act', {
        method: 'POST',
        body: { kind: 'close' },
        profile: args.profile,
      });
      return {
        success: true,
        output: 'Closed current tab',
      };
    }
  }

  private async executeSnapshot(args: BrowserParameters): Promise<ToolResult> {
    const query: Record<string, string> = {};
    
    if (args.snapshotFormat) query.format = args.snapshotFormat;
    if (args.mode) query.mode = args.mode;
    if (args.refs) query.refs = args.refs;
    if (args.interactive !== undefined) query.interactive = String(args.interactive);
    if (args.compact !== undefined) query.compact = String(args.compact);
    if (args.limit) query.limit = String(args.limit);
    if (args.maxChars) query.maxChars = String(args.maxChars);
    if (args.depth) query.depth = String(args.depth);
    if (args.selector) query.selector = args.selector;
    if (args.frame) query.frame = args.frame;
    if (args.labels !== undefined) query.labels = String(args.labels);

    const queryString = Object.entries(query)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    
    const path = queryString ? `/snapshot?${queryString}` : '/snapshot';

    const result = await this.fetchBrowserApi<{
      ok: boolean;
      format?: string;
      targetId?: string;
      url?: string;
      snapshot?: string;
      nodes?: unknown[];
      truncated?: boolean;
      refs?: Record<string, unknown>;
      stats?: unknown;
    }>(path, {
      method: 'POST',
      body: args.targetId ? { targetId: args.targetId } : undefined,
      profile: args.profile,
      timeoutMs: 30000,
    });

    let output: string;
    if (result.format === 'ai' && result.snapshot) {
      output = result.snapshot;
      if (result.truncated) {
        output += '\n\n[Snapshot truncated]';
      }
    } else if (result.format === 'aria' && result.nodes) {
      output = JSON.stringify(result.nodes, null, 2);
    } else {
      output = JSON.stringify(result, null, 2);
    }

    return {
      success: true,
      output,
      data: result,
    };
  }

  private async executeScreenshot(args: BrowserParameters): Promise<ToolResult> {
    const result = await this.fetchBrowserApi<{
      path: string;
      url: string;
    }>('/screenshot', {
      method: 'POST',
      body: {
        targetId: args.targetId,
        fullPage: args.fullPage,
        ref: args.ref,
        element: args.element,
        type: args.type || 'png',
      },
      profile: args.profile,
      timeoutMs: 30000,
    });

    return {
      success: true,
      output: `Screenshot saved: ${result.path}`,
      data: result,
    };
  }

  private async executeNavigate(args: BrowserParameters): Promise<ToolResult> {
    const url = args.targetUrl || args.url;
    if (!url) {
      return {
        success: false,
        error: 'URL required for navigate action',
      };
    }

    const result = await this.fetchBrowserApi<{
      url: string;
      targetId?: string;
    }>('/navigate', {
      method: 'POST',
      body: {
        url,
        targetId: args.targetId,
      },
      profile: args.profile,
      timeoutMs: 30000,
    });

    return {
      success: true,
      output: `Navigated to ${result.url}`,
      data: result,
    };
  }

  private async executeConsole(args: BrowserParameters): Promise<ToolResult> {
    const query: Record<string, string> = {};
    if (args.level) query.level = args.level;

    const queryString = Object.entries(query)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    
    const path = queryString ? `/console?${queryString}` : '/console';

    const result = await this.fetchBrowserApi<{
      targetId?: string;
      messages: unknown[];
    }>(path, {
      profile: args.profile,
    });

    return {
      success: true,
      output: JSON.stringify(result.messages, null, 2),
      data: result,
    };
  }

  private async executePdf(args: BrowserParameters): Promise<ToolResult> {
    const result = await this.fetchBrowserApi<{
      path: string;
    }>('/pdf', {
      method: 'POST',
      body: { targetId: args.targetId },
      profile: args.profile,
      timeoutMs: 30000,
    });

    return {
      success: true,
      output: `PDF saved: ${result.path}`,
      data: result,
    };
  }

  private async executeUpload(args: BrowserParameters): Promise<ToolResult> {
    if (!args.paths || args.paths.length === 0) {
      return {
        success: false,
        error: 'paths required for upload action',
      };
    }

    const result = await this.fetchBrowserApi('/hooks/file-chooser', {
      method: 'POST',
      body: {
        paths: args.paths,
        ref: args.ref,
        inputRef: args.inputRef,
        element: args.element,
        targetId: args.targetId,
        timeoutMs: args.timeoutMs,
      },
      profile: args.profile,
      timeoutMs: args.timeoutMs || 30000,
    });

    return {
      success: true,
      output: 'File chooser armed',
      data: result,
    };
  }

  private async executeDialog(args: BrowserParameters): Promise<ToolResult> {
    const result = await this.fetchBrowserApi('/hooks/dialog', {
      method: 'POST',
      body: {
        accept: args.accept,
        promptText: args.promptText,
        targetId: args.targetId,
        timeoutMs: args.timeoutMs,
      },
      profile: args.profile,
      timeoutMs: args.timeoutMs || 30000,
    });

    return {
      success: true,
      output: `Dialog handled: ${args.accept ? 'accepted' : 'dismissed'}`,
      data: result,
    };
  }

  private async executeAct(args: BrowserParameters): Promise<ToolResult> {
    let request: BrowserActRequest | undefined;

    if (args.request && typeof args.request === 'object') {
      request = args.request;
    } else if (args.kind) {
      // Build request from legacy flattened params
      request = {
        kind: args.kind,
        targetId: args.targetId,
        ref: args.ref,
        doubleClick: args.doubleClick,
        button: args.button,
        modifiers: args.modifiers,
        text: args.text,
        submit: args.submit,
        slowly: args.slowly,
        key: args.key,
        delayMs: args.delayMs,
        startRef: args.startRef,
        endRef: args.endRef,
        values: args.values,
        fields: args.fields,
        width: args.width,
        height: args.height,
        timeMs: args.timeMs,
        selector: args.selector,
        url: args.url,
        loadState: args.loadState,
        textGone: args.textGone,
        timeoutMs: args.timeoutMs,
        fn: args.fn,
      };
    }

    if (!request) {
      return {
        success: false,
        error: 'request or kind required for act action',
      };
    }

    const result = await this.fetchBrowserApi('/act', {
      method: 'POST',
      body: request,
      profile: args.profile,
      timeoutMs: args.timeoutMs || 30000,
    });

    return {
      success: true,
      output: `Action ${request.kind} executed`,
      data: result,
    };
  }
}

export default BrowserTool;
