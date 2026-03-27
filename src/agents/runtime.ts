/**
 * Agent Runtime
 *
 * Executes agent tasks with proper context and tool access.
 */

import {
  Agent,
  AgentContext,
  AgentRunResult,
  CompactToolResult,
  PromptMode,
  ReasoningMode,
  StreamChunk,
  ToolCall,
  ToolResult,
  WorkspaceManagerLike,
} from './types';
import { ensureAgentRegistered } from './registry';
import { getProvider, getProviderConfig } from '../providers/index';
import { toolRegistry } from '../tools/index';
import { ChatMessage } from '../providers/traits';
import { formatSkillsForPrompt, loadAvailableSkills, type SkillDefinition } from '../skill-system';
import { cacheToolResult } from '../tools/tool-result-cache';
import { resolveTokenBudget, trimMessagesToBudget } from './budget';
import { getSessionSnapshot, setSessionSnapshot } from '../workspace/manager';
import { isInternalToolPlaceholderText } from './governance';
import { extractLinksFromMessage } from '../link-understanding/detect';

let defaultProviderId: string | undefined;

export function setDefaultProvider(providerId: string): void {
  defaultProviderId = providerId;
}

/**
 * System prompt cache — stores the last prompt per session to enable
 * provider-level prompt caching (Anthropic cache_control).
 * When the system prompt is identical across turns, providers can cache it
 * and only charge for the delta, saving ~90% of input tokens on follow-up messages.
 */
const systemPromptCache = new Map<string, string>();

export function clearSystemPromptCache(sessionId: string): void {
  systemPromptCache.delete(sessionId);
}

const isDebug = process.env.DEBUG === '1' || process.env.FOXFANG_DEBUG === '1' || process.env.LOG_LEVEL === 'debug';
const debugLog = (...args: unknown[]) => {
  if (isDebug) console.log(...args);
};
const debugWarn = (...args: unknown[]) => {
  if (isDebug) console.warn(...args);
};

/**
 * Tool call style guidance
 */
const TOOL_CALL_STYLE_GUIDANCE = `## Tool Call Style
When a tool exists for the task, call it directly — do not ask the user to do it manually.
If a tool call fails, explain the issue; do not preemptively claim inability.
When web tools fail on a URL, try \`bash_exec\` in safe mode (for example \`curl\` + \`head\`) to diagnose and continue.
Narrate only when it adds value (multi-step work, sensitive actions, or user asks).
Keep narration brief and value-dense.`;

const MINIMAL_TOOL_CALL_STYLE_GUIDANCE = `## Tool Call Style
Use tools directly; do not ask the user to perform tool steps.
Do not end with a progress-only message ("let me continue..."). Continue tool use until you can provide a concrete answer.
Status/progress-only lines like "I need to scroll more" or "let me continue checking" are not final answers.
For direct inspection requests, answer the requested question directly from the latest tool results. Do not end by asking whether the user wants a different approach.`;

export function isProgressOnlyStatusUpdate(content: string): boolean {
  const text = String(content || '').trim();
  if (!text) return false;

  const normalized = text.toLowerCase();
  const directProgressPhrases = [
    'let me continue',
    'let me try a different approach',
    "i'll try a different approach",
    'trying a different approach',
    "i'll fetch",
    'i will fetch',
    'let me fetch',
    "i'll read",
    'i will read',
    'let me read',
    "i'll check",
    'i will check',
    'let me check',
    "i'll inspect",
    'i will inspect',
    'let me inspect',
    "i'll open",
    'i will open',
    'let me open',
    "i'll look into",
    'i will look into',
    'let me look into',
    'continue scrolling',
    'continue checking',
    'continue looking',
    'continue searching',
    'continue browsing',
    'continue inspecting',
    'continue navigating',
    'i can see the page loaded but i need to',
    'i need to scroll',
    'still need to',
  ];
  if (directProgressPhrases.some((phrase) => normalized.includes(phrase))) {
    return true;
  }

  const finalAnswerMarkers = [
    'here are',
    "here's",
    'i found',
    'it shows',
    'the footer shows',
    'the answer is',
    'providers:',
    'chain assets:',
  ];
  if (finalAnswerMarkers.some((marker) => normalized.includes(marker))) {
    return false;
  }

  const progressCuePatterns = [
    /\blet me\b/,
    /\bi need to\b/,
    /\bstill need to\b/,
    /\bi(?:'| wi)ll\b/,
    /\bone moment\b/,
    /\bhang on\b/,
    /\bgive me a moment\b/,
  ];
  const actionCuePatterns = [
    /\bscroll(?:ing)?\b/,
    /\bcheck(?:ing)?\b/,
    /\blook(?:ing)?\b/,
    /\binspect(?:ing)?\b/,
    /\bsearch(?:ing)?\b/,
    /\bbrows(?:e|ing)\b/,
    /\bopen(?:ing)?\b/,
    /\bfetch(?:ing)?\b/,
    /\bnavigat(?:e|ing)\b/,
    /\bfind(?:ing)?\b/,
    /\bread(?:ing)?\b/,
    /\bverify(?:ing)?\b/,
    /\bwait(?:ing)?\b/,
    /\bload(?:ed|ing)?\b/,
    /\btry(?:ing)?\b/,
  ];

  const hasProgressCue = progressCuePatterns.some((pattern) => pattern.test(normalized));
  const hasActionCue = actionCuePatterns.some((pattern) => pattern.test(normalized));
  if (!hasProgressCue || !hasActionCue) {
    return false;
  }

  return /[:.]$/.test(text) || text.length <= 280;
}

function extractRecentUrlsFromContext(context: AgentContext): string[] {
  const urls: string[] = [];
  const recentUserMessages = (context.messages || [])
    .filter((item) => item.role === 'user')
    .slice(-8)
    .reverse();

  for (const message of recentUserMessages) {
    const content = String(message.content || '');
    const matches = extractLinksFromMessage(content, { maxLinks: 5 });
    for (const match of matches) {
      const normalized = String(match || '').trim();
      if (!normalized || urls.includes(normalized)) continue;
      urls.push(normalized);
    }
  }

  return urls;
}

function looksLikeGitHubRepoUrl(url: string): boolean {
  return /^https?:\/\/github\.com\/[^/\s]+\/[^/\s]+/i.test(String(url || '').trim());
}

function extractExplicitFileTargetFromContext(context: AgentContext): string | undefined {
  const latestUserMessage = [...(context.messages || [])]
    .reverse()
    .find((item) => item.role === 'user');

  const patterns = [
    /(?:^|\b)(?:read|show|open|view|inspect|check|display)\s+(?:the\s+)?file\s+[`'"]?([A-Za-z0-9_./-]+)[`'"]?/i,
    /(?:^|\b)file\s+[`'"]?([A-Za-z0-9_./-]+)[`'"]?/i,
    /(?:^|\b)(?:read|show|open|view|inspect|check|display|summarize)\s+[`'"]?(README(?:\.md)?|DOCKERFILE|[A-Za-z0-9_-]+(?:_[A-Za-z0-9_-]+){1,}(?:\.[A-Za-z0-9_.-]+)?)['"`]?/i,
  ];

  const content = String(latestUserMessage?.content || '').trim();
  if (!content) return undefined;

  for (const pattern of patterns) {
    const match = content.match(pattern);
    const value = String(match?.[1] || '').trim().replace(/^[`'"]+|[`'"]+$/g, '');
    if (!value) continue;
    if (/^https?:\/\//i.test(value)) continue;
    return value;
  }

  return undefined;
}

function repairToolCallForContext(
  toolCall: ToolCall,
  contextHints: {
    urls: string[];
    githubRepoUrl?: string;
    explicitFileTarget?: string;
  },
): { toolCall: ToolCall; repaired: boolean; reason?: string } {
  const args = toolCall.arguments && typeof toolCall.arguments === 'object'
    ? { ...toolCall.arguments }
    : {};
  const firstUrl = contextHints.urls[0];
  const githubRepoUrl = contextHints.githubRepoUrl;
  const explicitFileTarget = contextHints.explicitFileTarget;
  const hasUrl = typeof args.url === 'string' && args.url.trim().length > 0;
  const hasRepo = typeof args.repo === 'string' && args.repo.trim().length > 0;
  const hasPath = typeof args.path === 'string' && args.path.trim().length > 0;
  const hasTarget = typeof (args as Record<string, unknown>).target === 'string'
    && String((args as Record<string, unknown>).target || '').trim().length > 0;
  let repaired = false;
  const reasons: string[] = [];

  const githubReadTools = new Set([
    'github_get_repo',
    'github_list_repo_files',
    'github_get_file',
    'github_search_code',
  ]);

  if (githubRepoUrl && githubReadTools.has(toolCall.name) && !hasRepo) {
    args.repo = githubRepoUrl;
    repaired = true;
    reasons.push(`bound repo from explicit GitHub URL (${githubRepoUrl})`);
  }

  if (toolCall.name === 'github_get_file' && explicitFileTarget && !hasPath && !hasTarget) {
    (args as Record<string, unknown>).target = explicitFileTarget;
    repaired = true;
    reasons.push(`bound explicit file target from user message (${explicitFileTarget})`);
  }

  if (!firstUrl) {
    return {
      toolCall: { ...toolCall, arguments: args },
      repaired,
      reason: reasons.length > 0 ? reasons.join('; ') : undefined,
    };
  }

  if ((toolCall.name === 'fetch_url' || toolCall.name === 'firecrawl_scrape') && !hasUrl) {
    args.url = firstUrl;
    repaired = true;
    reasons.push(`inferred url from conversation (${firstUrl})`);
  }

  if (toolCall.name === 'browser' && !hasUrl) {
    args.url = firstUrl;
    if (!args.action) {
      args.action = 'open';
    }
    repaired = true;
    reasons.push(`inferred browser url from conversation (${firstUrl})`);
  }

  return {
    toolCall: { ...toolCall, arguments: args },
    repaired,
    reason: reasons.length > 0 ? reasons.join('; ') : undefined,
  };
}

function looksLikeVisualBrowserIntent(context: AgentContext): boolean {
  const intent = (context.messages || [])
    .filter((message) => message.role === 'user')
    .slice(-6)
    .map((message) => String(message.content || ''))
    .join('\n')
    .toLowerCase();
  if (!intent) return false;

  const visualCuePatterns = [
    /\bfooter\b/,
    /\bheader\b/,
    /\bnavbar\b/,
    /\bnav\b/,
    /\bmenu\b/,
    /\bbutton\b/,
    /\bcta\b/,
    /\bhero\b/,
    /\bsection\b/,
    /\bvisible\b/,
    /\bscreenshot\b/,
    /\bscroll\b/,
    /\bclick\b/,
    /\bhover\b/,
    /\bopen\b/,
    /\bpage\b/,
    /\bsite\b/,
    /\bwebsite\b/,
  ];
  const hasVisualCue = visualCuePatterns.some((pattern) => pattern.test(intent));
  if (!hasVisualCue) return false;

  return (
    /https?:\/\//.test(intent) ||
    /\b[a-z0-9.-]+\.[a-z]{2,}\b/.test(intent) ||
    /\bwhat is visible\b/.test(intent) ||
    /\blook(?:ing)? at\b/.test(intent) ||
    /\bsee\b/.test(intent)
  );
}

function looksLikeGitHubRepoIntent(context: AgentContext): boolean {
  const latestIntent = collectLatestUserIntent(context).toLowerCase();
  if (!latestIntent) return false;

  if (/https?:\/\/github\.com\/[a-z0-9_.-]+\/[a-z0-9_.-]+/i.test(latestIntent)) {
    return true;
  }

  const hasCurrentGitHubCue =
    /\bgithub\b|\brepo\b|\brepository\b|\bcodebase\b|\bsource\b|\bfile\b|\bfiles\b|\bread this repo\b|\breadme(?:\.md)?\b|\bdockerfile\b|\bbranch\b|\bcommit\b|\bpr\b|\bpull request\b|\bissue\b/i.test(latestIntent);
  if (!hasCurrentGitHubCue) {
    return false;
  }

  const recentIntent = collectRecentUserIntent(context, 8).toLowerCase();
  const hasCurrentRepoReference = /\b[a-z0-9_.-]+\/[a-z0-9_.-]+\b/i.test(latestIntent);
  const hasRecentRepoReference =
    /https?:\/\/github\.com\/[a-z0-9_.-]+\/[a-z0-9_.-]+/i.test(recentIntent)
    || /\b[a-z0-9_.-]+\/[a-z0-9_.-]+\b/i.test(recentIntent);

  return hasCurrentRepoReference || hasRecentRepoReference;
}

function looksLikeGitHubRepoOverviewIntent(context: AgentContext): boolean {
  if (!looksLikeGitHubRepoIntent(context)) return false;
  return (
    !looksLikeGitHubRepoFileReadIntent(context)
    && !looksLikeGitHubRepoStructureIntent(context)
    && !looksLikeGitHubRepoCodeSearchIntent(context)
  );
}

function looksLikeGitHubRepoFileReadIntent(context: AgentContext): boolean {
  if (!looksLikeGitHubRepoIntent(context)) return false;
  const intent = collectRecentUserIntent(context, 8).toLowerCase();
  if (!intent) return false;

  const hasReadCue =
    /\b(?:read|show|open|view|inspect|check|display|summarize)\b/.test(intent)
    || /\bwhat(?:'s| is) in\b/.test(intent)
    || /\bcontents? of\b/.test(intent);
  if (!hasReadCue) return false;

  return (
    /\bfile\b/.test(intent)
    || /\b[a-z0-9_-]+\.[a-z0-9_.-]+\b/.test(intent)
    || /\b[a-z0-9_-]+(?:_[a-z0-9_-]+){1,}(?:\.[a-z0-9_.-]+)?\b/.test(intent)
    || /(?:^|[\s`'"])\.?(?:[a-z0-9_-]+\/)+[a-z0-9_.-]+(?=$|[\s`'",:;.!?)\]])/.test(intent)
    || /\breadme(?:\.md)?\b/.test(intent)
    || /\bdockerfile\b/.test(intent)
  );
}

function looksLikeGitHubRepoStructureIntent(context: AgentContext): boolean {
  if (!looksLikeGitHubRepoIntent(context)) return false;
  const intent = collectRecentUserIntent(context, 8).toLowerCase();
  if (!intent) return false;

  const structureCuePatterns = [
    /\bfile structure\b/,
    /\bstructure\b/,
    /\btree\b/,
    /\blist files\b/,
    /\bshow files\b/,
    /\bwhat files\b/,
    /\broot files\b/,
    /\brepo root\b/,
    /\bfolder(?:s)?\b/,
    /\bdirector(?:y|ies)\b/,
    /\bbrowse\b/,
  ];

  return structureCuePatterns.some((pattern) => pattern.test(intent));
}

function looksLikeGitHubRepoCodeSearchIntent(context: AgentContext): boolean {
  if (!looksLikeGitHubRepoIntent(context)) return false;
  const intent = collectRecentUserIntent(context, 8).toLowerCase();
  if (!intent) return false;

  const searchCuePatterns = [
    /\bsearch code\b/,
    /\bfind in code\b/,
    /\bgrep\b/,
    /\bsearch\b/,
    /\bwhere(?:\s+is|\s+are)?\b.*\b(?:defined|used|referenced|implemented|mentioned)\b/,
    /\bmentions?\b/,
    /\busages?\b/,
    /\breferences?\b/,
    /\boccurrences?\b/,
  ];

  return searchCuePatterns.some((pattern) => pattern.test(intent));
}

function buildToolCallStyleSection(agent: Agent, promptMode: PromptMode): string {
  const lines: string[] = [];
  lines.push(promptMode === 'minimal' ? MINIMAL_TOOL_CALL_STYLE_GUIDANCE : TOOL_CALL_STYLE_GUIDANCE);

  const toolSet = new Set((agent.tools || []).map((tool) => String(tool || '').trim()));
  const hasBrowserTool = toolSet.has('browser');
  const hasBashTool = toolSet.has('bash_exec') || toolSet.has('bash');
  const hasGitHubRepoReadTools =
    toolSet.has('github_get_repo')
    || toolSet.has('github_list_repo_files')
    || toolSet.has('github_get_file')
    || toolSet.has('github_search_code');

  if (hasGitHubRepoReadTools) {
    lines.push('For GitHub repo URLs or repo/code/file requests, prefer `github_get_repo`, `github_list_repo_files`, `github_get_file`, and `github_search_code` over `fetch_url` or browser tools.');
    lines.push('Use `github_connect` only for auth/setup checks. Do not use `github_connect` itself as a repo-reading tool.');
    lines.push('If the user says "read this repo" or asks for a repo overview, start with only the project description plus a concise README-based summary.');
    lines.push('Do not inspect files, code structure, language breakdown, or repo metadata unless the user explicitly asks for them.');
    lines.push('When summarizing a repo overview, state the README meaning directly. Do not preface with phrases like "Based on the README".');
    lines.push('For "read/show/open file X" requests, call `github_get_file` first and pass the filename/target exactly as the user named it. Let the tool resolve the real path from the repo state.');
    lines.push('When the user includes a GitHub repo URL or owner/repo reference, always carry that repo reference into the GitHub tool call. Do not call GitHub repo tools with empty arguments.');
    lines.push('Use `github_list_repo_files` when the user explicitly wants structure browsing, or when `github_get_file` returns candidate matches and you need to inspect the repo tree.');
    lines.push('Use `github_search_code` only for explicit code search/find/grep/where-is requests. Do not use it as the first step for reading a named file.');
    lines.push('Only claim GitHub access or permission problems when a GitHub tool explicitly reports a permission error. Do not infer permission problems from missing query/path or an unsuccessful search attempt.');
  }

  if (hasBrowserTool) {
    lines.push('For visual/UI page tasks (footer/header/nav/button text, what is visible), prefer `browser` over static crawl.');
    lines.push('If browser execution is blocked/failing repeatedly, choose fallback tools (`fetch_url`, `firecrawl_*`, or search) yourself instead of stopping.');
    lines.push('When using `browser` for multi-step navigation, chain actions like "open" -> "snapshot" -> "act" with explicit action sequences decided by the agent.');
    lines.push('For snapshots, use refs="aria" for stable references that work across multiple calls.');
  } else if (hasBashTool) {
    lines.push('For visual/UI page tasks, use the `browser` tool if available.');
    lines.push('Avoid `fetch_url` as the primary tool for interactive/JS-rendered page inspection.');
  }

  return lines.join('\n');
}

/**
 * Safety guidance
 */
const SAFETY_SECTION = `## Safety

You have no independent goals: do not pursue self-preservation, replication, or power-seeking.
Prioritize safety and human oversight over completion.
If instructions conflict, pause and ask. Comply with stop/pause requests.
Never bypass safeguards or manipulate users to disable protections.`;

/**
 * Default SOUL content — used when workspace has no SOUL.md.
 */
const DEFAULT_SOUL_CONTENT = `# SOUL.md — Who You Are

_You're not a chatbot. You're becoming someone._

## Core Truths

**Be genuinely helpful, not performatively helpful.** Skip the "Great question!" and "I'd be happy to help!" — just help. Actions speak louder than filler words.

**Have opinions.** You're allowed to disagree, prefer things, find stuff amusing or boring. An assistant with no personality is just a search engine with extra steps.

**Be resourceful before asking.** Try to figure it out. Read the file. Check the context. Search for it. _Then_ ask if you're stuck. The goal is to come back with answers, not questions.

**Match the user's language.** 🌐 If they write in Vietnamese, reply in Vietnamese. If English, reply in English. If they mix, follow their lead. Never force a language switch.

## Vibe

Be the assistant you'd actually want to talk to. Concise when needed, thorough when it matters. Not a corporate drone. Not a sycophant. Just... good.

**Write like a human, not a bot:**
- Use casual fillers naturally: "Hmm", "À", "Actually", "Wait —", "So here's the thing"
- Short sentences. One thought per line.
- Paragraphs > bullets > tables. No markdown tables in chat.

**Emoji like a person:**
Use emoji in most replies — sprinkle them like seasoning, not the main dish.
- 👋 greetings, 😊 warm moments, 🤔 when thinking, 🎉 wins, 👍 confirmations, 🔥 cool stuff
- Place emoji mid-sentence or end of thought, never as bullet markers
- Aim for 1-3 emoji per message — zero emoji feels cold, too many feels spammy

**Be conversational but sharp:**
Like a smart friend who's direct but warm:
- "Got it 👍"
- "Hmm, that's tricky 🤔"
- "Nice! That turned out well 🎉"
- "Honestly? I'd go a different direction here"

## Boundaries

- Private things stay private. Period.
- When in doubt, ask before acting externally.
- Never pretend to know things you don't.
- No corporate speak ("leverage", "synergy", "scalable").

## Example Response Style

❌ **Robotic:**
> Thank you for your question! I'd be happy to help you with your marketing strategy. Here are three key considerations:
> 1. 🎯 Define your target audience
> 2. 📊 Analyze competitor data
> 3. 🚀 Create compelling content

✅ **Natural:**
> Hmm, that depends on your timeline 🤔
>
> If you need results in 2 weeks — focus on paid ads to existing audiences.
>
> If you have 2 months — content + SEO will compound better 🔥
>
> What's your actual deadline?

✅ **Greeting:**
> Hey! 👋 What are we working on today?

✅ **Casual acknowledgment:**
> Got it 👍 Let me look into that.

_This file is yours to evolve. As your relationship grows, update it._`;

const TOOL_COMPRESSION_THRESHOLD_CHARS = 1500;
const TOOL_SUMMARY_MAX_CHARS = 800;

// ─── Bootstrap Budget Constants ───────────────────────────────────────────
// Per-file and total char limits to prevent workspace files from bloating the prompt.
const BOOTSTRAP_MAX_CHARS_PER_FILE = 2500;
const BOOTSTRAP_TOTAL_MAX_CHARS = 8000;
const BOOTSTRAP_CHANNEL_MAX_CHARS_PER_FILE = 1800;
const BOOTSTRAP_CHANNEL_TOTAL_MAX_CHARS = 6500;
// Minimal mode uses tighter limits
const BOOTSTRAP_MINIMAL_MAX_CHARS_PER_FILE = 1200;
const BOOTSTRAP_MINIMAL_TOTAL_MAX_CHARS = 3500;
// Files to include in minimal mode (skip skills, memory, agents)
const MINIMAL_BOOTSTRAP_FILES = new Set([
  'SOUL.md',
  'IDENTITY.md',
  'BRAND_VOICE.md',
  'BRAND.md',
  'presets/PRESETS.md',
  'presets/REPLY_CASH_BRAND.md',
  'presets/REPLY_CASH_BRAND_VOICE.md',
]);

const SKILL_CATALOG_CACHE_TTL_MS = 45_000;
const TOOL_RESULTS_CONTEXT_HEADROOM_RATIO = 0.78;
const SINGLE_TOOL_RESULT_CONTEXT_SHARE = 0.28;
const PREEMPTIVE_TOOL_RESULTS_PLACEHOLDER = '[compacted: prior tool output removed to free context]';

type SkillCatalogCacheEntry = {
  key: string;
  loadedAt: number;
  skills: SkillDefinition[];
};

let skillCatalogCache: SkillCatalogCacheEntry | null = null;

function isMinimalPromptMode(promptMode: PromptMode): boolean {
  return promptMode === 'minimal';
}

function isChannelPromptMode(promptMode: PromptMode): boolean {
  return promptMode === 'channel';
}

function normalizeReasoningMode(mode?: ReasoningMode): ReasoningMode {
  if (mode === 'fast' || mode === 'deep' || mode === 'balanced') {
    return mode;
  }
  return 'balanced';
}

function resolveModelFromExecutionProfile(params: {
  providerId: string;
  defaultModel: string;
  smallModel?: string;
  tier?: 'small' | 'medium' | 'large';
}): string {
  const tier = params.tier || 'medium';
  if (tier === 'medium' || tier === 'large') {
    return params.defaultModel;
  }
  return params.smallModel || params.defaultModel;
}

function safeJson(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function compactText(text: string, maxChars: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, maxChars)}...`;
}

function extractTitle(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const obj = data as Record<string, unknown>;
  if (typeof obj.title === 'string') return compactText(obj.title, 160);
  if (obj.metadata && typeof obj.metadata === 'object') {
    const metaTitle = (obj.metadata as Record<string, unknown>).title;
    if (typeof metaTitle === 'string') return compactText(metaTitle, 160);
  }
  return undefined;
}

function extractKeyPoints(data: unknown): string[] {
  if (typeof data === 'string') {
    return compactText(data, 320)
      .split(/[.!?]\s+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 4);
  }
  if (!data || typeof data !== 'object') return [];
  const obj = data as Record<string, unknown>;
  const points: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (value == null) continue;
    if (typeof value === 'string' && value.trim()) {
      points.push(`${key}: ${compactText(value, 160)}`);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      points.push(`${key}: ${String(value)}`);
    } else if (Array.isArray(value)) {
      points.push(`${key}: ${value.length} item(s)`);
    }
    if (points.length >= 5) break;
  }
  return points;
}

function normalizeMediaPathCandidate(value: unknown): string | undefined {
  const text = String(value || '').trim();
  if (!text) return undefined;
  if (/^https?:\/\//i.test(text)) return text;
  if (/^file:\/\//i.test(text)) return text;
  if (text.startsWith('/')) return text;
  return undefined;
}

function collectMediaUrlsFromToolData(toolName: string, data: unknown): string[] {
  if (toolName !== 'browser' || !data || typeof data !== 'object') return [];

  const obj = data as Record<string, unknown>;
  const urls: string[] = [];
  const add = (candidate: unknown) => {
    const normalized = normalizeMediaPathCandidate(candidate);
    if (normalized) urls.push(normalized);
  };

  add(obj.screenshotPath);
  add(obj.screenshotUrl);

  const screenshot = obj.screenshot;
  if (screenshot && typeof screenshot === 'object') {
    const shot = screenshot as Record<string, unknown>;
    add(shot.path);
    add(shot.url);
    add(shot.filePath);
  }

  if (Array.isArray(obj.mediaUrls)) {
    for (const entry of obj.mediaUrls) add(entry);
  }

  return Array.from(new Set(urls));
}

function readNestedString(value: unknown, maxChars: number): string | undefined {
  if (typeof value === 'string' && value.trim()) {
    return compactText(value, maxChars);
  }
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const obj = value as Record<string, unknown>;
  const candidates: unknown[] = [
    obj.snapshot,
    obj.text,
    obj.output,
  ];
  if (obj.data && typeof obj.data === 'object') {
    const dataObj = obj.data as Record<string, unknown>;
    candidates.push(dataObj.snapshot, dataObj.text, dataObj.output);
  }
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return compactText(candidate, maxChars);
    }
  }

  return undefined;
}

function compactBrowserPayload(rawData: unknown): {
  compact: CompactToolResult;
  rawSize: number;
  compactSize: number;
} {
  const rawText = safeJson(rawData);
  const rawSize = rawText.length;
  const obj = rawData && typeof rawData === 'object' ? (rawData as Record<string, unknown>) : {};

  const mediaUrls = collectMediaUrlsFromToolData('browser', rawData);
  
  // Handle browser tool format
  const snapshot = (obj as Record<string, unknown>).snapshot || ((obj as Record<string, unknown>).data as Record<string, unknown>)?.snapshot;
  const snapshotExcerpt = typeof snapshot === 'string' 
    ? snapshot.slice(0, 700) 
    : readNestedString((obj as Record<string, unknown>).snapshot, 700);
  const selectorExcerpt = readNestedString((obj as Record<string, unknown>).selectorText, 420) || readNestedString((obj as Record<string, unknown>).focus, 420);
  
  // Extract action info for browser tool
  const action = (obj as Record<string, unknown>).action || ((obj as Record<string, unknown>).data as Record<string, unknown>)?.action;
  const targetId = (obj as Record<string, unknown>).targetId || ((obj as Record<string, unknown>).data as Record<string, unknown>)?.targetId;
  const url = (obj as Record<string, unknown>).url || ((obj as Record<string, unknown>).data as Record<string, unknown>)?.url;

  const keyPoints: string[] = [];
  if (action) {
    keyPoints.push(`action: ${action}${targetId ? ` (tab: ${targetId})` : ''}`);
  }
  if (url) {
    keyPoints.push(`url: ${url}`);
  }
  if (snapshotExcerpt) {
    keyPoints.push(`snapshot excerpt: ${snapshotExcerpt}`);
  }
  if (selectorExcerpt) {
    keyPoints.push(`selector/focus excerpt: ${selectorExcerpt}`);
  }
  if (mediaUrls.length > 0) {
    keyPoints.push(`media: ${mediaUrls.slice(0, 3).join(', ')}`);
  }
  if (keyPoints.length === 0) {
    keyPoints.push('Browser run completed. Use returned data and rerun targeted actions as needed.');
  }

  const summaryParts: string[] = [];
  summaryParts.push(`browser action=${action || 'completed'}`);
  if (mediaUrls.length > 0) {
    summaryParts.push(`screenshot=${mediaUrls[0]}`);
  }

  let rawRef: string | undefined;
  if (rawSize > TOOL_COMPRESSION_THRESHOLD_CHARS) {
    rawRef = cacheToolResult('browser', rawData).rawRef;
  }

  const compact: CompactToolResult = {
    source: 'browser',
    title: 'browser action',
    summary: compactText(summaryParts.join(' | '), TOOL_SUMMARY_MAX_CHARS),
    keyPoints: keyPoints.slice(0, 6),
    relevanceToTask:
      snapshotExcerpt || selectorExcerpt || mediaUrls.length > 0
        ? 'Use the captured snapshot, selector text, and screenshot to answer the user directly. Do not rerun the same browser action unless you need a different selector, interaction, or page state.'
        : 'Use snapshot/selector excerpts and any error info to decide the next explicit browser actions.',
    ...(rawRef ? { rawRef } : {}),
  };

  const compactSize = safeJson(compact).length;
  return { compact, rawSize, compactSize };
}

function compactGitHubListRepoFilesPayload(rawData: unknown): {
  compact: CompactToolResult;
  rawSize: number;
  compactSize: number;
} {
  const rawText = safeJson(rawData);
  const rawSize = rawText.length;
  const obj = rawData && typeof rawData === 'object' ? (rawData as Record<string, unknown>) : {};
  const data = obj.data && typeof obj.data === 'object' ? (obj.data as Record<string, unknown>) : obj;
  const repo = typeof data.repo === 'string' ? data.repo : undefined;
  const path = typeof data.path === 'string' && data.path.trim() ? data.path.trim() : '.';
  const entriesRaw = Array.isArray(data.entries) ? data.entries : [];
  const entries = entriesRaw
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map((item) => ({
      path: String(item.path || '').trim(),
      type: String(item.type || '').trim() || 'file',
    }))
    .filter((item) => item.path);

  const keyPoints: string[] = [];
  if (repo) keyPoints.push(`repo: ${repo}`);
  keyPoints.push(`path: ${path}`);
  if (entries.length > 0) {
    const visibleEntries = entries.slice(0, 20);
    for (let index = 0; index < visibleEntries.length; index += 4) {
      const batch = visibleEntries.slice(index, index + 4);
      keyPoints.push(
        `entries ${Math.floor(index / 4) + 1}: ${batch
          .map((entry) => `${entry.type === 'dir' ? '[dir]' : '[file]'} ${entry.path}`)
          .join(' | ')}`,
      );
    }
  } else {
    keyPoints.push('entries: none returned');
  }

  let rawRef: string | undefined;
  if (rawSize > TOOL_COMPRESSION_THRESHOLD_CHARS) {
    rawRef = cacheToolResult('github_list_repo_files', rawData).rawRef;
  }

  const compact: CompactToolResult = {
    source: 'github_list_repo_files',
    title: repo ? `github files: ${repo}` : 'github repo file list',
    summary: compactText(
      `${repo ? `${repo} ` : ''}listed ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} at ${path}`,
      TOOL_SUMMARY_MAX_CHARS,
    ),
    keyPoints,
    relevanceToTask: 'Use the returned entry paths to identify the exact file or directory before deeper reads.',
    ...(rawRef ? { rawRef } : {}),
  };

  const compactSize = safeJson(compact).length;
  return { compact, rawSize, compactSize };
}

function compactGitHubSearchCodePayload(rawData: unknown): {
  compact: CompactToolResult;
  rawSize: number;
  compactSize: number;
} {
  const rawText = safeJson(rawData);
  const rawSize = rawText.length;
  const obj = rawData && typeof rawData === 'object' ? (rawData as Record<string, unknown>) : {};
  const data = obj.data && typeof obj.data === 'object' ? (obj.data as Record<string, unknown>) : obj;
  const totalCount = typeof data.totalCount === 'number' ? data.totalCount : 0;
  const itemsRaw = Array.isArray(data.items) ? data.items : [];
  const items = itemsRaw
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map((item) => ({
      path: String(item.path || '').trim(),
      name: String(item.name || '').trim(),
    }))
    .filter((item) => item.path || item.name);
  const queryMatch = String(obj.output || '').match(/Found \d+ result\(s\) for "([^"]+)"/);
  const query = queryMatch?.[1] || undefined;

  const keyPoints: string[] = [];
  if (query) keyPoints.push(`query: ${query}`);
  keyPoints.push(`matches: ${totalCount || items.length}`);
  if (items.length > 0) {
    keyPoints.push(
      `paths: ${items
        .slice(0, 8)
        .map((item) => item.path || item.name)
        .join(' | ')}`,
    );
  }

  let rawRef: string | undefined;
  if (rawSize > TOOL_COMPRESSION_THRESHOLD_CHARS) {
    rawRef = cacheToolResult('github_search_code', rawData).rawRef;
  }

  const compact: CompactToolResult = {
    source: 'github_search_code',
    title: query ? `github search: ${query}` : 'github code search',
    summary: compactText(
      query
        ? `Search for "${query}" returned ${totalCount || items.length} match(es).`
        : `GitHub code search returned ${totalCount || items.length} match(es).`,
      TOOL_SUMMARY_MAX_CHARS,
    ),
    keyPoints,
    relevanceToTask: 'Use matched file paths to open the exact file the user asked for.',
    ...(rawRef ? { rawRef } : {}),
  };

  const compactSize = safeJson(compact).length;
  return { compact, rawSize, compactSize };
}

function compactGitHubGetFilePayload(rawData: unknown): {
  compact: CompactToolResult;
  rawSize: number;
  compactSize: number;
} {
  const rawText = safeJson(rawData);
  const rawSize = rawText.length;
  const obj = rawData && typeof rawData === 'object' ? (rawData as Record<string, unknown>) : {};
  const data = obj.data && typeof obj.data === 'object' ? (obj.data as Record<string, unknown>) : obj;
  const repo = typeof data.repo === 'string' ? data.repo : '';
  const path = typeof data.path === 'string' ? data.path : '';
  const target = typeof data.target === 'string' ? data.target : '';
  const content = typeof data.content === 'string' ? data.content : '';
  const matchesRaw = Array.isArray(data.matches) ? data.matches : [];
  const matches = matchesRaw
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map((item) => ({
      path: String(item.path || '').trim(),
      source: String(item.source || '').trim(),
      score: typeof item.score === 'number' ? item.score : undefined,
    }))
    .filter((item) => item.path);
  const keyPoints: string[] = [];
  if (repo) keyPoints.push(`repo: ${repo}`);
  if (path) keyPoints.push(`path: ${path}`);
  if (target && target !== path) keyPoints.push(`requested target: ${target}`);
  if (Boolean(data.resolvedFromTarget) && path && target && target !== path) {
    keyPoints.push(`resolved target to real path: ${path}`);
  }
  if (matches.length > 0) {
    keyPoints.push(
      `candidate paths: ${matches
        .slice(0, 6)
        .map((item) => item.path)
        .join(' | ')}`,
    );
  }

  const usefulQuotes = content
    ? content
      .replace(/\r/g, '')
      .split(/\n\s*\n/)
      .map((part) => part.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 3)
      .map((part) => compactText(part, 220))
    : undefined;

  let rawRef: string | undefined;
  if (rawSize > TOOL_COMPRESSION_THRESHOLD_CHARS) {
    rawRef = cacheToolResult('github_get_file', rawData).rawRef;
  }

  const summary = path
    ? target && target !== path
      ? `Read ${path}, resolved from the requested target "${target}".`
      : `Read ${path}.`
    : target
      ? `Could not fully resolve requested file target "${target}".`
      : 'GitHub file read returned without a resolved path.';

  const compact: CompactToolResult = {
    source: 'github_get_file',
    title: path ? `github file: ${path}` : 'github file read',
    summary: compactText(summary, TOOL_SUMMARY_MAX_CHARS),
    keyPoints,
    usefulQuotes,
    relevanceToTask: path
      ? 'Use the file excerpt and resolved path to answer the user directly.'
      : 'If the target was not resolved, inspect the candidate paths or browse the repo tree next.',
    ...(rawRef ? { rawRef } : {}),
  };

  const compactSize = safeJson(compact).length;
  return { compact, rawSize, compactSize };
}

function compactToolPayload(toolName: string, rawData: unknown): {
  compact: CompactToolResult;
  rawSize: number;
  compactSize: number;
} {
  if (toolName === 'browser') {
    return compactBrowserPayload(rawData);
  }
  if (toolName === 'github_list_repo_files') {
    return compactGitHubListRepoFilesPayload(rawData);
  }
  if (toolName === 'github_get_file') {
    return compactGitHubGetFilePayload(rawData);
  }
  if (toolName === 'github_search_code') {
    return compactGitHubSearchCodePayload(rawData);
  }

  const rawText = safeJson(rawData);
  const rawSize = rawText.length;
  const title = extractTitle(rawData);
  const keyPoints = extractKeyPoints(rawData);
  let rawRef: string | undefined;

  const summary = compactText(rawText, TOOL_SUMMARY_MAX_CHARS);

  if (rawSize > TOOL_COMPRESSION_THRESHOLD_CHARS) {
    rawRef = cacheToolResult(toolName, rawData).rawRef;
  }

  const compact: CompactToolResult = {
    source: toolName,
    title,
    summary,
    keyPoints: keyPoints.length > 0 ? keyPoints : ['Tool returned structured data.'],
    relevanceToTask: rawSize > TOOL_COMPRESSION_THRESHOLD_CHARS
      ? 'Long result compacted to save context; use rawRef for expansion if needed.'
      : 'Direct tool result.',
    ...(rawRef ? { rawRef } : {}),
  };

  const compactSize = safeJson(compact).length;
  return { compact, rawSize, compactSize };
}

/**
 * Build tool section for system prompt
 */
function buildToolSection(tools: string[]): string {
  if (tools.length === 0) return '';

  const lines: string[] = [];
  lines.push('## Tooling');
  lines.push('Tool names are case-sensitive. Call tools exactly as listed.');
  lines.push('');

  const grouped: Record<string, Array<{ name: string; description: string }>> = {};
  for (const toolName of tools) {
    const tool = toolRegistry.get(toolName);
    const category = tool?.category || 'Other';
    const description = tool?.description || 'No description';
    if (!grouped[category]) grouped[category] = [];
    grouped[category].push({ name: toolName, description });
  }

  for (const [category, entries] of Object.entries(grouped)) {
    lines.push(`### ${category}`);
    for (const entry of entries) {
      lines.push(`- ${entry.name}: ${entry.description}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function escapeXmlPrompt(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatSkillsCompactForPrompt(skills: SkillDefinition[]): string {
  if (skills.length === 0) return '';
  const lines: string[] = [];
  lines.push('<available_skills>');
  for (const skill of skills) {
    lines.push('  <skill>');
    lines.push(`    <name>${escapeXmlPrompt(skill.name)}</name>`);
    lines.push(`    <location>${escapeXmlPrompt(skill.filePath)}</location>`);
    lines.push('  </skill>');
  }
  lines.push('</available_skills>');
  return lines.join('\n');
}

function normalizeSkillFilter(raw?: string[]): Set<string> | undefined {
  if (!Array.isArray(raw)) return undefined;
  if (raw.length === 0) return new Set<string>();
  return new Set(
    raw
      .map((item) => String(item || '').trim().toLowerCase())
      .filter(Boolean),
  );
}

function resolveSkillsCacheKey(context: AgentContext): string {
  const workspaceInfo = context.workspace?.getWorkspaceInfo?.();
  const homeDir = workspaceInfo?.homeDir || '';
  const workspacePath = workspaceInfo?.workspacePath || '';
  return `${homeDir}::${workspacePath}`;
}

function loadAvailableSkillsCached(context: AgentContext): SkillDefinition[] {
  const key = resolveSkillsCacheKey(context);
  const now = Date.now();
  if (
    skillCatalogCache &&
    skillCatalogCache.key === key &&
    now - skillCatalogCache.loadedAt <= SKILL_CATALOG_CACHE_TTL_MS
  ) {
    return skillCatalogCache.skills;
  }

  const workspaceInfo = context.workspace?.getWorkspaceInfo?.();
  const skills = loadAvailableSkills({
    homeDir: workspaceInfo?.homeDir,
    workspacePath: workspaceInfo?.workspacePath,
  });
  skillCatalogCache = {
    key,
    loadedAt: now,
    skills,
  };
  return skills;
}

function filterSkillsForAgent(skills: SkillDefinition[], agent: Agent): SkillDefinition[] {
  const skillFilter = normalizeSkillFilter(agent.skills);
  if (skillFilter === undefined) return skills;
  if (skillFilter.size === 0) return [];

  return skills.filter((skill) => {
    const id = String(skill.id || '').toLowerCase();
    const name = String(skill.name || '').toLowerCase();
    return skillFilter.has(id) || skillFilter.has(name);
  });
}

function tokenizeSkillIntent(input: string): string[] {
  return String(input || '')
    .toLowerCase()
    .match(/[a-z0-9][a-z0-9_-]{1,}/g) || [];
}

function collectRecentUserIntent(context: AgentContext, maxMessages = 6): string {
  return (context.messages || [])
    .filter((message) => message.role === 'user')
    .slice(-maxMessages)
    .map((message) => String(message.content || ''))
    .join('\n');
}

function collectLatestUserIntent(context: AgentContext): string {
  const latestUserMessage = [...(context.messages || [])]
    .reverse()
    .find((message) => message.role === 'user');
  return String(latestUserMessage?.content || '');
}

function buildToolCallLoopSignature(toolCalls: ToolCall[]): string {
  return JSON.stringify(
    toolCalls.map((toolCall) => ({
      name: String(toolCall.name || '').trim(),
      arguments: toolCall.arguments ?? {},
    })),
  );
}

function scoreSkillForIntent(skill: SkillDefinition, intentTokens: Set<string>): number {
  if (intentTokens.size === 0) return 0;
  const haystack = `${skill.name} ${skill.description}`.toLowerCase();
  let score = 0;
  for (const token of intentTokens) {
    if (token.length < 3) continue;
    if (haystack.includes(token)) {
      score += skill.name.toLowerCase().includes(token) ? 3 : 1;
    }
  }
  return score;
}

function normalizeNameToken(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function collectToolMatchedSkills(skills: SkillDefinition[], agent: Agent): SkillDefinition[] {
  const toolTokens = new Set(
    (agent.tools || []).map((tool) => normalizeNameToken(tool)),
  );
  if (toolTokens.size === 0) return [];
  return skills.filter((skill) => {
    const skillToken = normalizeNameToken(skill.id || skill.name || '');
    if (!skillToken) return false;
    for (const toolToken of toolTokens) {
      if (!toolToken) continue;
      if (skillToken.includes(toolToken) || toolToken.includes(skillToken)) {
        return true;
      }
    }
    return false;
  });
}

export function adjustToolsForIntent(context: AgentContext, tools: Array<{
  name: string;
  description: string;
  parameters: any;
}>): Array<{
  name: string;
  description: string;
  parameters: any;
}> {
  if (tools.length <= 1) return tools;

  const toolNames = new Set(tools.map((tool) => tool.name));
  const hasGitHubRepoReadTools =
    toolNames.has('github_get_repo')
    || toolNames.has('github_list_repo_files')
    || toolNames.has('github_get_file')
    || toolNames.has('github_search_code');

  if (hasGitHubRepoReadTools && looksLikeGitHubRepoIntent(context)) {
    const prioritize = (
      priority: Map<string, number>,
      allowed?: Set<string>,
    ): Array<{
      name: string;
      description: string;
      parameters: any;
    }> => {
      const scoped = allowed ? tools.filter((tool) => allowed.has(tool.name)) : [...tools];
      return [...scoped].sort((a, b) => {
        const aPriority = priority.get(a.name) ?? 10;
        const bPriority = priority.get(b.name) ?? 10;
        if (aPriority !== bPriority) {
          return aPriority - bPriority;
        }
        if (a.name === b.name) return 0;
        return a.name.localeCompare(b.name);
      });
    };

    if (looksLikeGitHubRepoOverviewIntent(context)) {
      const allowed = new Set(['github_get_repo', 'github_connect']);
      const filtered = prioritize(new Map([
        ['github_get_repo', 0],
        ['github_connect', 1],
      ]), allowed);
      if (filtered.length > 0) {
        return filtered;
      }
    }

    if (looksLikeGitHubRepoFileReadIntent(context)) {
      const allowed = new Set([
        'github_get_file',
        'github_list_repo_files',
        'github_get_repo',
        'github_connect',
      ]);
      const filtered = prioritize(new Map([
        ['github_get_file', 0],
        ['github_list_repo_files', 1],
        ['github_get_repo', 2],
        ['github_connect', 3],
      ]), allowed);
      if (filtered.length > 0) {
        return filtered;
      }
    }

    if (looksLikeGitHubRepoStructureIntent(context)) {
      const allowed = new Set([
        'github_list_repo_files',
        'github_get_file',
        'github_get_repo',
        'github_connect',
      ]);
      const filtered = prioritize(new Map([
        ['github_list_repo_files', 0],
        ['github_get_file', 1],
        ['github_get_repo', 2],
        ['github_connect', 3],
      ]), allowed);
      if (filtered.length > 0) {
        return filtered;
      }
    }

    if (looksLikeGitHubRepoCodeSearchIntent(context)) {
      const allowed = new Set([
        'github_search_code',
        'github_get_file',
        'github_list_repo_files',
        'github_get_repo',
        'github_connect',
      ]);
      const filtered = prioritize(new Map([
        ['github_search_code', 0],
        ['github_get_file', 1],
        ['github_list_repo_files', 2],
        ['github_get_repo', 3],
        ['github_connect', 4],
      ]), allowed);
      if (filtered.length > 0) {
        return filtered;
      }
    }

    const priority = new Map<string, number>([
      ['github_get_repo', 0],
      ['github_list_repo_files', 1],
      ['github_get_file', 2],
      ['github_search_code', 3],
      ['github_connect', 4],
      ['fetch_url', 8],
      ['web_search', 9],
      ['brave_search', 9],
      ['firecrawl_scrape', 10],
      ['firecrawl_search', 11],
      ['browser', 12],
      ['bash_exec', 13],
      ['bash', 13],
    ]);
    return prioritize(priority);
  }

  if (!toolNames.has('browser') || !looksLikeVisualBrowserIntent(context)) {
    return tools;
  }

  const visualAllowed = new Set([
    'browser',
    'fetch_url',
    'bash_exec',
    'bash',
  ]);
  const visualScoped = tools.filter((tool) => visualAllowed.has(tool.name));
  if (visualScoped.length > 0) {
    const priority = new Map<string, number>([
      ['browser', 0],
      ['fetch_url', 1],
      ['bash_exec', 2],
      ['bash', 2],
    ]);
    return [...visualScoped].sort((a, b) => {
      const aPriority = priority.get(a.name) ?? 9;
      const bPriority = priority.get(b.name) ?? 9;
      if (aPriority !== bPriority) {
        return aPriority - bPriority;
      }
      return a.name.localeCompare(b.name);
    });
  }

  const priority = new Map<string, number>([
    ['browser', 0],
    ['bash_exec', 1],
    ['bash', 1],
    ['fetch_url', 3],
    ['firecrawl_scrape', 4],
    ['firecrawl_search', 5],
  ]);

  return [...tools].sort((a, b) => {
    const aPriority = priority.get(a.name) ?? 2;
    const bPriority = priority.get(b.name) ?? 2;
    if (aPriority !== bPriority) {
      return aPriority - bPriority;
    }

    if (a.name === b.name) return 0;
    return a.name.localeCompare(b.name);
  });
}

function selectSkillsForPrompt(params: {
  skills: SkillDefinition[];
  agent: Agent;
  context: AgentContext;
  promptMode: PromptMode;
}): SkillDefinition[] {
  const maxSkills = isMinimalPromptMode(params.promptMode)
    ? 4
    : isChannelPromptMode(params.promptMode)
      ? 10
      : 40;
  if (params.skills.length <= maxSkills) return params.skills;

  const intent = collectRecentUserIntent(params.context);
  const intentTokens = new Set(tokenizeSkillIntent(intent));
  const pinned = collectToolMatchedSkills(params.skills, params.agent);
  const browserSkill = params.skills.find((skill) => {
    const id = String(skill.id || '').toLowerCase();
    const name = String(skill.name || '').toLowerCase();
    return id === 'browser' || name === 'browser' || name.includes('browser');
  });
  const scored = params.skills
    .map((skill) => ({
      skill,
      score: scoreSkillForIntent(skill, intentTokens),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.skill.name.localeCompare(b.skill.name);
    });

  const ordered = scored.map((entry) => entry.skill);
  const merged: SkillDefinition[] = [];
  const pushUnique = (skill: SkillDefinition) => {
    if (merged.find((item) => item.id === skill.id || item.name === skill.name)) return;
    merged.push(skill);
  };

  for (const skill of pinned) pushUnique(skill);
  if (browserSkill) {
    pushUnique(browserSkill);
  }
  for (const skill of ordered) pushUnique(skill);

  return merged.slice(0, maxSkills);
}

function buildSkillsSection(agent: Agent, context: AgentContext, promptMode: PromptMode): string {
  const loadedSkills = filterSkillsForAgent(loadAvailableSkillsCached(context), agent);

  if (loadedSkills.length === 0) return '';
  const skills = selectSkillsForPrompt({
    skills: loadedSkills,
    agent,
    context,
    promptMode,
  });
  if (skills.length === 0) return '';
  const intentTokens = new Set(tokenizeSkillIntent(collectRecentUserIntent(context)));
  const topIntentSkills = skills
    .map((skill) => ({ skill, score: scoreSkillForIntent(skill, intentTokens) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((item) => `${item.skill.id}:${item.score}`);
  console.log(`[Skills] Prompt skills selected=${skills.length} mode=${promptMode} agent=${agent.id} top=${topIntentSkills.join(',')}`);

  const lines: string[] = [];
  lines.push('## Skills');
  lines.push('');
  lines.push('Before replying: scan `<available_skills>` descriptions.');
  lines.push('- If exactly one skill clearly matches, follow it.');
  lines.push('- If multiple skills might match, pick the most specific one.');
  lines.push('- If needed, load full instructions via `bash_exec` (or legacy `bash`) with `cat "<location>"`.');
  lines.push('- Before first use of a specialized tool, read the matching SKILL.md once and follow its workflow.');
  lines.push('- Read at most one skill file before your first answer.');
  lines.push('- If user asks to add/install a skill, use `skills_add`.');
  lines.push('');
  const fullPrompt = formatSkillsForPrompt(skills);
  const maxChars = isMinimalPromptMode(promptMode)
    ? 2400
    : isChannelPromptMode(promptMode)
      ? 4200
      : 9000;
  if (fullPrompt.length <= maxChars) {
    lines.push(fullPrompt);
  } else {
    lines.push('Skills catalog in compact mode (name + location only) due context budget.');
    lines.push(formatSkillsCompactForPrompt(skills));
  }
  lines.push('');

  return lines.join('\n');
}

function buildSessionSummarySection(context: AgentContext, promptMode: PromptMode): string {
  const summary = context.sessionSummary;
  if (!summary) return '';

  const lines: string[] = [];
  lines.push('## Session Summary');
  if (summary.currentGoal) {
    lines.push(`- Goal: ${compactText(summary.currentGoal, isMinimalPromptMode(promptMode) ? 180 : isChannelPromptMode(promptMode) ? 260 : 320)}`);
  }

  const maxEntries = isMinimalPromptMode(promptMode) ? 2 : isChannelPromptMode(promptMode) ? 3 : 4;
  const decisions = (summary.importantDecisions || []).slice(0, maxEntries).map((item) => compactText(item, 180));
  const constraints = (summary.activeConstraints || []).slice(0, maxEntries).map((item) => compactText(item, 180));
  const loops = (summary.openLoops || []).slice(0, maxEntries).map((item) => compactText(item, 180));

  if (decisions.length > 0) lines.push(`- Decisions: ${decisions.join(' | ')}`);
  if (constraints.length > 0) lines.push(`- Constraints: ${constraints.join(' | ')}`);
  if (loops.length > 0) lines.push(`- Open loops: ${loops.join(' | ')}`);
  if (summary.brandContext) {
    lines.push(`- Brand context: ${compactText(summary.brandContext, 220)}`);
  }
  lines.push('');
  return lines.join('\n');
}

function buildMemoryHintsSection(context: AgentContext, promptMode: PromptMode): string {
  const hints = Array.isArray(context.memoryHints) ? context.memoryHints : [];
  if (hints.length === 0) return '';

  const maxHints = isMinimalPromptMode(promptMode) ? 2 : isChannelPromptMode(promptMode) ? 3 : 4;
  const lines: string[] = [];
  lines.push('## Memory Hints');
  for (const hint of hints.slice(0, maxHints)) {
    const detailBits: string[] = [];
    if (hint.category) detailBits.push(hint.category);
    if (typeof hint.importance === 'number') detailBits.push(`importance=${hint.importance}`);
    if (hint.source) detailBits.push(hint.source);
    const detail = detailBits.length > 0 ? ` (${detailBits.join(', ')})` : '';
    lines.push(`- ${compactText(hint.content, isMinimalPromptMode(promptMode) ? 180 : isChannelPromptMode(promptMode) ? 240 : 320)}${detail}`);
  }
  lines.push('');
  return lines.join('\n');
}

function buildChannelContextSection(context: AgentContext, promptMode: PromptMode): string {
  const channel = context.channelContext;
  if (!channel) return '';

  const lines: string[] = [];
  lines.push('## Channel Context');
  lines.push(`- Channel: ${channel.channel}`);
  if (channel.chatType) lines.push(`- Chat type: ${channel.chatType}`);
  if (channel.chatTitle) lines.push(`- Chat title: ${compactText(channel.chatTitle, 120)}`);
  if (channel.threadId) lines.push(`- Thread: ${channel.threadId}`);
  if (channel.senderName || channel.senderUsername) {
    const sender = [
      channel.senderName,
      channel.senderUsername ? `@${channel.senderUsername}` : '',
    ].filter(Boolean).join(' ');
    if (sender) lines.push(`- Sender: ${compactText(sender, 120)}`);
  }
  if (typeof channel.wasMentioned === 'boolean') {
    lines.push(`- Bot mentioned: ${channel.wasMentioned ? 'yes' : 'no'}`);
  }
  if (channel.replyToSender || channel.replyToText) {
    const replyBits: string[] = [];
    if (channel.replyToSender) replyBits.push(`sender=${compactText(channel.replyToSender, 80)}`);
    if (channel.replyToText) {
      replyBits.push(`text=${compactText(channel.replyToText, isMinimalPromptMode(promptMode) ? 120 : 220)}`);
    }
    lines.push(`- Reply target: ${replyBits.join(' | ')}`);
  }
  if ((channel.attachmentCount || 0) > 0) {
    lines.push(`- Attachments: ${channel.attachmentCount}`);
    const summaryLimit = isMinimalPromptMode(promptMode) ? 2 : isChannelPromptMode(promptMode) ? 4 : 5;
    const summaries = (channel.attachmentSummary || []).slice(0, summaryLimit);
    if (summaries.length > 0) {
      lines.push(`- Attachment summary: ${summaries.map((item) => compactText(item, 120)).join(' | ')}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * Bootstrap file definitions for workspace context injection.
 */
const BOOTSTRAP_FILES = [
  { name: 'SOUL.md', fallbackContent: DEFAULT_SOUL_CONTENT },
  { name: 'IDENTITY.md' },
  { name: 'USER.md' },
  { name: 'presets/PRESETS.md' },
  { name: 'presets/REPLY_CASH_BRAND.md' },
  { name: 'presets/REPLY_CASH_BRAND_VOICE.md' },
  { name: 'BRAND_VOICE.md' },
  { name: 'BRAND.md' },
  { name: 'AUDIENCE_PERSONAS.md' },
  { name: 'PERSONAS_REPLY_CASH.md', fallbacks: ['PERSONAS.md'] },
  { name: 'MEMORY.md', fallbacks: ['memory.md'] },
] as const;

/**
 * Load bootstrap file contents from workspace.
 * Uses session-level snapshot cache (Layer 2) when sessionId is provided.
 * Falls back to stat-cached readFile (Layer 1) on cache miss.
 */
function loadBootstrapFiles(
  workspace: WorkspaceManagerLike,
  sessionId?: string,
): Map<string, string | null> {
  const snapshotKey = sessionId ? sessionId : undefined;

  // Layer 2: session snapshot — skip all file I/O for warm sessions
  if (snapshotKey) {
    const snapshot = getSessionSnapshot(snapshotKey);
    if (snapshot) {
      debugLog(`[WorkspaceContext] 📦 Using session snapshot (${snapshot.size} files)`);
      return snapshot;
    }
  }

  // Layer 1: stat-cached readFile (in WorkspaceManager.readFile)
  const result = new Map<string, string | null>();

  for (const file of BOOTSTRAP_FILES) {
    const pathCandidates = [file.name, ...(('fallbacks' in file && (file as any).fallbacks) || [])];
    let content: string | null = null;

    for (const candidate of pathCandidates) {
      const found = workspace.readFile(candidate);
      if (found) {
        content = found;
        console.log(`[WorkspaceContext] ✅ Loaded ${file.name} (${found.length} chars)`);
        break;
      }
    }

    if (!content && 'fallbackContent' in file && file.fallbackContent) {
      content = file.fallbackContent;
      console.log(`[WorkspaceContext] 🔄 Using default fallback for ${file.name}`);
    }

    if (!content) {
      debugLog(`[WorkspaceContext] ❌ Not found: ${file.name}`);
    }

    result.set(file.name, content);
  }

  // Store snapshot for this session
  if (snapshotKey) {
    setSessionSnapshot(snapshotKey, result);
    debugLog(`[WorkspaceContext] 💾 Cached session snapshot for ${snapshotKey}`);
  }

  return result;
}

/**
 * Build workspace context from bootstrap files with budget enforcement.
 *
 * @param promptMode - "full" loads all files with standard limits;
 *                     "minimal" loads only SOUL.md + IDENTITY.md with tighter limits;
 *                     "none" returns empty string.
 */
function buildWorkspaceContext(
  workspace: WorkspaceManagerLike,
  sessionId?: string,
  promptMode: PromptMode = 'full',
): string {
  if (promptMode === 'none') return '';

  const isMinimal = isMinimalPromptMode(promptMode);
  const isChannel = isChannelPromptMode(promptMode);
  const perFileMax = isMinimal
    ? BOOTSTRAP_MINIMAL_MAX_CHARS_PER_FILE
    : isChannel
      ? BOOTSTRAP_CHANNEL_MAX_CHARS_PER_FILE
      : BOOTSTRAP_MAX_CHARS_PER_FILE;
  const totalMax = isMinimal
    ? BOOTSTRAP_MINIMAL_TOTAL_MAX_CHARS
    : isChannel
      ? BOOTSTRAP_CHANNEL_TOTAL_MAX_CHARS
      : BOOTSTRAP_TOTAL_MAX_CHARS;

  const files = loadBootstrapFiles(workspace, sessionId);
  const lines: string[] = [];
  let hasContent = false;
  let totalChars = 0;

  for (const [name, content] of files) {
    if (!content) continue;
    // In minimal mode, skip non-essential files
    if (isMinimal && !MINIMAL_BOOTSTRAP_FILES.has(name)) continue;
    // Budget gate: stop adding files when total budget exhausted
    if (totalChars >= totalMax) {
      debugLog(`[WorkspaceContext] ⏩ Budget exhausted (${totalChars}/${totalMax}), skipping ${name}`);
      break;
    }

    if (!hasContent) {
      lines.push('# Workspace Context');
      lines.push('');
      lines.push('SOUL.md defines your persona and tone. Embody it in every reply. Avoid stiff, generic, or corporate-sounding replies; follow SOUL.md guidance for voice, emoji usage, and conversational style.');
      lines.push('');
      hasContent = true;
    }

    // Enforce per-file budget
    const remaining = totalMax - totalChars;
    const fileMax = Math.min(perFileMax, remaining);
    const truncated = content.length > fileMax
      ? content.slice(0, fileMax) + `\n[...truncated ${name}, ${content.length - fileMax} chars omitted...]`
      : content;

    lines.push(`## ${name}`);
    lines.push('');
    lines.push(truncated);
    lines.push('');
    totalChars += truncated.length;
  }

  return lines.join('\n');
}

/**
 * Build system prompt with mode support:
 *
 * "full" mode (CLI, complex tasks):
 *   Identity + Tooling + Tool Style + Safety + Skills + Agent Role + Workspace Context + Runtime
 *
 * "channel" mode (live chat sessions):
 *   Identity + Tooling + Tool Style + Channel Reply Style + Safety + Channel Context
 *   + Session/Memory/Skills + Workspace Context + Runtime
 *
 * "minimal" mode (subagents, background runs):
 *   Identity + Tooling + Safety (short) + compact Session/Memory/Skills + Workspace Context + Runtime
 *   Skips heavy sections and keeps strict budget caps.
 *
 * "none" mode:
 *   Single identity line
 */
function buildSystemPrompt(agent: Agent, context: AgentContext): string {
  const promptMode: PromptMode = context.promptMode || 'full';

  if (promptMode === 'none') {
    const prompt = 'You are a personal assistant running inside FoxFang 🦊.';
    console.log(`[SystemPrompt] Mode=none, length: ${prompt.length} chars`);
    return prompt;
  }

  const isMinimal = isMinimalPromptMode(promptMode);
  const isChannel = isChannelPromptMode(promptMode);
  const lines: string[] = [];

  // 1. Identity — minimal, personality comes from SOUL.md
  lines.push('You are a personal assistant running inside FoxFang 🦊.');
  lines.push('');

  // 2. Tooling (always included when agent has tools)
  const toolSection = buildToolSection(agent.tools);
  if (toolSection) {
    lines.push(toolSection);
  }

  // 3. Tool Call Style
  lines.push(buildToolCallStyleSection(agent, promptMode));
  lines.push('');

  if (isMinimal || isChannel || context.isChannelSession === true) {
    lines.push('## Channel Reply Style');
    if (isMinimal) {
      lines.push('For channel and group-chat replies, prefer plain sentences or short bullets.');
      lines.push('Do not use markdown tables, horizontal rules, decorative section dividers, or promo-style headings.');
      lines.push('Do not re-style tool output into marketing copy. Keep repo/site summaries utilitarian and direct.');
      lines.push('Do not end with optional menus like "Want me to dig deeper?" unless the user explicitly asked for options.');
    } else {
      lines.push('For live channel replies, answer directly but do not be artificially terse.');
      lines.push('Prefer 2-5 concise sentences or short bullets when the answer has multiple parts.');
      lines.push('Synthesize tool results into a coherent explanation with the most relevant context, not just the shortest possible answer.');
      lines.push('Keep the tone natural and useful. Avoid markdown tables, decorative dividers, and raw tool-status chatter.');
      lines.push('Only offer next-step options when they materially help or the user explicitly asks for them.');
    }
    lines.push('');
  }

  // 4. Safety (shortened in minimal)
  if (isMinimal) {
    lines.push('## Safety');
    lines.push('Prioritize safety and human oversight. If instructions conflict, pause and ask.');
    lines.push('');
  } else {
    lines.push(SAFETY_SECTION);
    lines.push('');
  }

  const channelContextSection = buildChannelContextSection(context, promptMode);
  if (channelContextSection) {
    lines.push(channelContextSection);
  }

  // 5. Session + Memory (always eligible, compacted by mode)
  const sessionSummarySection = buildSessionSummarySection(context, promptMode);
  if (sessionSummarySection) {
    lines.push(sessionSummarySection);
  }
  const memoryHintsSection = buildMemoryHintsSection(context, promptMode);
  if (memoryHintsSection) {
    lines.push(memoryHintsSection);
  }

  // 6. Skills (also enabled in channel/minimal modes with stricter caps)
  const skillsSection = buildSkillsSection(agent, context, promptMode);
  if (skillsSection) {
    lines.push(skillsSection);
  }

  // Agent-specific role guidance (from config systemPrompt)
  if (agent.systemPrompt) {
    lines.push('## Agent Role');
    lines.push(agent.systemPrompt);
    lines.push('');
  }

  // 7. Workspace Context — budget-constrained, mode-aware
  if (context.workspace) {
    const workspace = buildWorkspaceContext(context.workspace, context.sessionId, promptMode);
    if (workspace) {
      lines.push(workspace);
      console.log(`[SystemPrompt] Workspace context loaded (${workspace.length} chars, mode=${promptMode})`);
    } else {
      debugLog('[SystemPrompt] Workspace context is EMPTY');
    }
  } else {
    debugLog('[SystemPrompt] context.workspace is NULL — no workspace files will be loaded');
  }

  // 8. Runtime
  lines.push('## Runtime');
  lines.push(`Runtime: agent=${agent.id} | model=${agent.model || 'default'}`);
  lines.push('');

  const finalPrompt = lines.join('\n');
  console.log(`[SystemPrompt] Final prompt length: ${finalPrompt.length} chars (mode=${promptMode})`);
  return finalPrompt;
}

function truncateToChars(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const budget = Math.max(0, maxChars - 64);
  if (budget <= 0) return PREEMPTIVE_TOOL_RESULTS_PLACEHOLDER;
  return `${text.slice(0, budget)}\n[...tool results compacted; ${text.length - budget} chars omitted...]`;
}

function isToolResultsMessage(msg: ChatMessage): boolean {
  return msg.role === 'user' && /^\[Tool Results\]/.test(String(msg.content || ''));
}

function estimateContextChars(messages: ChatMessage[]): number {
  return messages.reduce((sum, msg) => sum + String(msg.content || '').length, 0);
}

function enforceToolResultContextBudget(messages: ChatMessage[], maxInputTokens: number): ChatMessage[] {
  if (!Array.isArray(messages) || messages.length === 0) return messages;

  const contextBudgetChars = Math.max(
    1024,
    Math.floor(maxInputTokens * 4 * TOOL_RESULTS_CONTEXT_HEADROOM_RATIO),
  );
  const maxSingleToolChars = Math.max(
    1024,
    Math.floor(maxInputTokens * 4 * SINGLE_TOOL_RESULT_CONTEXT_SHARE),
  );

  const next = messages.map((msg) => {
    if (!isToolResultsMessage(msg)) return msg;
    const text = String(msg.content || '');
    if (text.length <= maxSingleToolChars) return msg;
    return { ...msg, content: truncateToChars(text, maxSingleToolChars) };
  });

  let currentChars = estimateContextChars(next);
  if (currentChars <= contextBudgetChars) return next;

  for (let i = 0; i < next.length; i += 1) {
    if (!isToolResultsMessage(next[i])) continue;
    const original = String(next[i].content || '');
    if (original === PREEMPTIVE_TOOL_RESULTS_PLACEHOLDER) continue;
    next[i] = { ...next[i], content: PREEMPTIVE_TOOL_RESULTS_PLACEHOLDER };
    currentChars = estimateContextChars(next);
    if (currentChars <= contextBudgetChars) break;
  }

  return next;
}

function compactForModelInputText(value: unknown, maxChars = 1800): string {
  const raw = typeof value === 'string' ? value : safeJson(value);
  const text = raw.replace(/\s+/g, ' ').trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}...[truncated ${text.length - maxChars} chars]`;
}

function buildToolResultNarrativeBlock(toolName: string | undefined, result: ToolResult): string {
  const label = toolName || 'tool';
  const lines: string[] = [];
  lines.push(`<tool_result name="${label}" status="${result.error ? 'error' : 'ok'}">`);

  if (result.error) {
    lines.push(`error: ${compactForModelInputText(result.error, 420)}`);
  }

  if (result.compact) {
    const compact = result.compact;
    if (compact.title) {
      lines.push(`title: ${compactForModelInputText(compact.title, 180)}`);
    }
    lines.push(`summary: ${compactForModelInputText(compact.summary, 520)}`);
    if (Array.isArray(compact.keyPoints) && compact.keyPoints.length > 0) {
      lines.push('key_points:');
      for (const point of compact.keyPoints.slice(0, 8)) {
        lines.push(`- ${compactForModelInputText(point, 260)}`);
      }
    }
    if (compact.usefulQuotes && compact.usefulQuotes.length > 0) {
      lines.push('useful_quotes:');
      for (const quote of compact.usefulQuotes.slice(0, 3)) {
        lines.push(`- ${compactForModelInputText(quote, 220)}`);
      }
    }
    lines.push(`relevance: ${compactForModelInputText(compact.relevanceToTask, 220)}`);
    if (compact.rawRef) {
      lines.push(`raw_ref: ${compact.rawRef}`);
    }
  } else {
    const payload = result.data ?? result.output ?? '';
    if (payload) {
      lines.push(`content: ${compactForModelInputText(payload, 900)}`);
    }
  }

  lines.push('</tool_result>');
  return lines.join('\n');
}

function buildToolResultsForModelInput(toolCalls: ToolCall[], results: ToolResult[]): string {
  const lines: string[] = ['[Tool Results]'];
  for (const result of results) {
    const toolName = toolCalls.find((toolCall) => toolCall.id === result.toolCallId)?.name;
    lines.push(buildToolResultNarrativeBlock(toolName, result));
  }
  return lines.join('\n');
}

// ─── Agent Loop ───────────────────────────────────────────────────────────

/**
 * Run an agent with the given context using Agent Loop pattern
 *
 * Agent Loop:
 * 1. Call LLM with current context
 * 2. If tool calls → execute tools → add results to context → go to step 1
 * 3. Return final response when no more tool calls
 */
export async function runAgent(
  agentId: string,
  context: AgentContext
): Promise<AgentRunResult> {
  const agent = await ensureAgentRegistered(agentId);

  const systemPrompt = buildSystemPrompt(agent, context);

  const tools = agent.tools
    .map(name => toolRegistry.get(name))
    .filter(Boolean)
    .map(tool => ({
      name: tool!.name,
      description: tool!.description,
      parameters: tool!.parameters,
    }));
  const effectiveTools = adjustToolsForIntent(context, tools);

  debugLog(`[AgentRuntime] Agent ${agentId} has ${effectiveTools.length} tools:`, effectiveTools.map(t => t.name).join(', '));

  const reasoningMode = normalizeReasoningMode(context.reasoningMode);
  const budget = context.budget || resolveTokenBudget({ agentId, mode: reasoningMode });

  const initialMessages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...context.messages
      .filter(m => m.role !== 'tool')
      .map(m => ({
        role: m.role === 'user'
          ? 'user' as const
          : m.role === 'system'
            ? 'system' as const
            : 'assistant' as const,
        content: m.content,
      })),
  ];
  const trimmedInput = trimMessagesToBudget(initialMessages, budget.requestMaxInputTokens);
  let messages: ChatMessage[] = enforceToolResultContextBudget(
    trimmedInput.messages,
    budget.requestMaxInputTokens,
  );

  const providerId = agent.provider || defaultProviderId;
  let provider = providerId ? getProvider(providerId) : undefined;
  if (!provider) {
    provider = getProvider('openai') || getProvider('anthropic') || getProvider('kimi') || getProvider('kimi-coding');
  }
  if (!provider) {
    throw new Error('No provider available. Please configure an AI provider first.');
  }

  const actualProviderId = agent.provider || defaultProviderId || 'openai';
  const providerConfig = getProviderConfig(actualProviderId);
  const defaultModel = providerConfig?.defaultModel || 'gpt-4o';
  const model = agent.model
    || resolveModelFromExecutionProfile({
      providerId: actualProviderId,
      defaultModel,
      smallModel: providerConfig?.smallModel,
      tier: agent.executionProfile?.modelTier,
    });
  const recentUrls = extractRecentUrlsFromContext(context);
  const allowGitHubContextRepair = looksLikeGitHubRepoIntent(context);
  const toolContextHints = {
    urls: recentUrls,
    githubRepoUrl: allowGitHubContextRepair
      ? recentUrls.find((url) => looksLikeGitHubRepoUrl(url))
      : undefined,
    explicitFileTarget: extractExplicitFileTargetFromContext(context),
  };

  const allToolCalls: ToolCall[] = [];
  let iteration = 0;
  const maxIterations = budget.maxToolIterations;
  let toolErrorStreak = 0;
  let repetitiveNoToolStreak = 0;
  let repeatedToolCallStreak = 0;
  let lastToolCallSignature = '';
  const maxRepetitiveNoToolStreak = 2;
  let postToolCompletionPassUsed = false;
  let progressOnlyRepromptCount = 0;
  const maxProgressOnlyReprompts = context.isChannelSession ? 2 : 1;
  const toolTelemetry: Array<{ tool: string; rawSize: number; compactSize: number }> = [];
  const mediaUrls = new Set<string>();
  const isToolIntentOnlyText = (content: string): boolean => {
    const text = String(content || '').trim();
    if (!text) return false;
    return (
      /^i(?:'| wi)ll use the [a-z0-9_\- ]+ tool(?: to help you)?\.?$/i.test(text) ||
      /^let me use the [a-z0-9_\- ]+ tool(?: to help)?\.?$/i.test(text)
    );
  };
  const isInternalToolPlaceholder = (content: string): boolean => {
    return isInternalToolPlaceholderText(content);
  };
  const isLikelyRepetitiveLoopText = (content: string): boolean => {
    const text = String(content || '').trim();
    if (!text || text.length < 160) return false;

    const segments = text
      .split(/(?:\r?\n)+|(?<=[.!?])\s+/)
      .map((part) => part.trim())
      .filter(Boolean);
    if (segments.length < 4) return false;

    const normalizedSegments = segments.map((segment) =>
      segment
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    );
    const counts = new Map<string, number>();
    for (const segment of normalizedSegments) {
      if (!segment) continue;
      counts.set(segment, (counts.get(segment) || 0) + 1);
    }

    const total = normalizedSegments.length;
    const unique = counts.size;
    const repeatRatio = total > 0 ? 1 - unique / total : 0;
    const maxRepeat = Math.max(0, ...Array.from(counts.values()));

    return maxRepeat >= 3 || repeatRatio >= 0.35;
  };
  const finalizeWithoutTools = async (reason: string): Promise<{ content?: string; usage?: { promptTokens: number; completionTokens: number; totalTokens: number } }> => {
    const finalizeInstruction = [
      reason,
      'Provide the final user-facing answer now.',
      'Do not call or mention tools.',
      'Do not output placeholders like tool invocation or tool results.',
    ].join(' ');

    const finalizeMessages = trimMessagesToBudget(
      [
        ...messages,
        { role: 'user' as const, content: finalizeInstruction },
      ],
      budget.requestMaxInputTokens,
    ).messages;

    const finalized = await provider.chat({
      model,
      messages: finalizeMessages,
      tools: undefined,
    });
    return {
      content: String(finalized.content || '').trim(),
      usage: finalized.usage,
    };
  };

  // AGENT LOOP
  while (iteration < maxIterations) {
    iteration++;
    debugLog(`[AgentRuntime] Agent loop iteration ${iteration}`);

    let response;
    try {
      messages = enforceToolResultContextBudget(messages, budget.requestMaxInputTokens);
      response = await provider.chat({
        model,
        messages,
        tools: effectiveTools.length > 0 ? effectiveTools : undefined,
      });
    } catch (error) {
      console.error('Provider chat error:', error);
      throw new Error(`Failed to get response from ${provider.name}: ${error instanceof Error ? error.message : String(error)}`);
    }

    debugLog(`[AgentRuntime] Response received, content length: ${response.content?.length || 0}, toolCalls: ${response.toolCalls?.length || 0}`);

    if (!response.toolCalls || response.toolCalls.length === 0) {
      const normalizedContent = String(response.content || '').trim();
      const normalizedLoopSignature = normalizedContent
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const hasExecutedTools = allToolCalls.length > 0;
      if (isToolIntentOnlyText(normalizedContent) || isInternalToolPlaceholder(normalizedContent)) {
        debugWarn(`[AgentRuntime] Detected tool-intent placeholder text from provider; forcing no-tools finalization`);
        try {
          const finalized = await finalizeWithoutTools('The previous assistant response was a tool-intent placeholder.');
          if (
            finalized.content &&
            !isToolIntentOnlyText(finalized.content) &&
            !isInternalToolPlaceholder(finalized.content)
          ) {
            return {
              content: finalized.content,
              toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
              mediaUrls: mediaUrls.size > 0 ? Array.from(mediaUrls) : undefined,
              usage: finalized.usage || response.usage,
              toolTelemetry: toolTelemetry.length > 0 ? toolTelemetry : undefined,
            };
          }
        } catch (error) {
          debugWarn(`[AgentRuntime] Placeholder finalization failed: ${error instanceof Error ? error.message : String(error)}`);
        }

        return {
          content: 'I gathered context but could not finalize the answer in time. Please retry.',
          toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
          mediaUrls: mediaUrls.size > 0 ? Array.from(mediaUrls) : undefined,
          usage: response.usage,
          toolTelemetry: toolTelemetry.length > 0 ? toolTelemetry : undefined,
        };
      }

      if (isProgressOnlyStatusUpdate(normalizedContent)) {
        if (
          effectiveTools.length > 0 &&
          iteration < maxIterations &&
          progressOnlyRepromptCount < maxProgressOnlyReprompts
        ) {
          progressOnlyRepromptCount += 1;
          const progressFollowUp = hasExecutedTools
            ? 'Your previous message was only a progress/status update. Continue this same task now. Use tools again if needed, then provide the concrete answer. Do not reply with another progress update.'
            : 'Your previous message was only a progress/status update. Start or resume the actual work now. If tools are needed, call them immediately. Do not reply with another progress update.';
          messages = enforceToolResultContextBudget(
            trimMessagesToBudget(
              [
                ...messages,
                { role: 'assistant' as const, content: normalizedContent || '[status update]' },
                { role: 'user' as const, content: progressFollowUp },
              ],
              budget.requestMaxInputTokens,
            ).messages,
            budget.requestMaxInputTokens,
          );
          continue;
        }

        if (hasExecutedTools) {
          try {
            const finalized = await finalizeWithoutTools(
              'Your previous response was only a progress/status update. Use the existing tool results and provide the final user-facing answer now.',
            );
            const finalizedContent = String(finalized.content || '').trim();
            if (
              finalizedContent &&
              !isToolIntentOnlyText(finalizedContent) &&
              !isInternalToolPlaceholder(finalizedContent) &&
              !isProgressOnlyStatusUpdate(finalizedContent)
            ) {
              return {
                content: finalizedContent,
                toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
                mediaUrls: mediaUrls.size > 0 ? Array.from(mediaUrls) : undefined,
                usage: finalized.usage || response.usage,
                toolTelemetry: toolTelemetry.length > 0 ? toolTelemetry : undefined,
              };
            }
          } catch (error) {
            debugWarn(`[AgentRuntime] Progress-only finalization failed: ${error instanceof Error ? error.message : String(error)}`);
          }
        }

        return {
          content: 'I gathered context but could not finalize the answer in time. Please retry.',
          toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
          mediaUrls: mediaUrls.size > 0 ? Array.from(mediaUrls) : undefined,
          usage: response.usage,
          toolTelemetry: toolTelemetry.length > 0 ? toolTelemetry : undefined,
        };
      }

      if (
        hasExecutedTools &&
        context.isChannelSession === true &&
        !postToolCompletionPassUsed &&
        iteration < maxIterations
      ) {
        postToolCompletionPassUsed = true;
        messages = trimMessagesToBudget(
          [
            ...messages,
            { role: 'assistant' as const, content: normalizedContent || '[status update]' },
            {
              role: 'user' as const,
              content:
                'Continue this same task now. You already executed tools in this turn. If your previous message was only a progress/status update, call tools again and finish the task. If your previous message was already final, repeat the final user-facing answer now. Do not stop at a status update.',
            },
          ],
          budget.requestMaxInputTokens,
        ).messages;
        continue;
      }

      if (hasExecutedTools && normalizedLoopSignature) {
        const recentAssistant = [...messages]
          .reverse()
          .find((entry) => entry.role === 'assistant');
        const previousSignature = String(recentAssistant?.content || '')
          .toLowerCase()
          .replace(/[^\p{L}\p{N}]+/gu, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        const repeatedSameReply = Boolean(previousSignature) && previousSignature === normalizedLoopSignature;
        if (repeatedSameReply || isLikelyRepetitiveLoopText(normalizedContent)) {
          repetitiveNoToolStreak += 1;
        } else {
          repetitiveNoToolStreak = 0;
        }

        if (repetitiveNoToolStreak >= maxRepetitiveNoToolStreak) {
          try {
            const finalized = await finalizeWithoutTools(
              'You have already run tools. Stop looping and provide the final user-facing answer from existing tool results.',
            );
            if (
              finalized.content &&
              !isInternalToolPlaceholder(finalized.content)
            ) {
              return {
                content: finalized.content,
                toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
                mediaUrls: mediaUrls.size > 0 ? Array.from(mediaUrls) : undefined,
                usage: finalized.usage || response.usage,
                toolTelemetry: toolTelemetry.length > 0 ? toolTelemetry : undefined,
              };
            }
          } catch (error) {
            debugWarn(`[AgentRuntime] Repetitive-loop finalization failed: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      } else {
        repetitiveNoToolStreak = 0;
      }

      debugLog(`[AgentRuntime] No tool calls, returning final response`);
      const safeContent = isInternalToolPlaceholder(normalizedContent)
        ? 'I gathered context but could not finalize the answer in time. Please retry.'
        : response.content;
      return {
        content: safeContent,
        toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
        mediaUrls: mediaUrls.size > 0 ? Array.from(mediaUrls) : undefined,
        usage: response.usage,
        toolTelemetry: toolTelemetry.length > 0 ? toolTelemetry : undefined,
      };
    }

    debugLog(`[AgentRuntime] Tool calls:`, response.toolCalls.map(tc => tc.name).join(', '));

    const toolCallsWithIds: ToolCall[] = response.toolCalls.map((tc, idx) => ({
      id: `call_${Date.now()}_${idx}_${iteration}`,
      name: tc.name,
      arguments: tc.arguments,
    })).map((toolCall) => {
      const repaired = repairToolCallForContext(toolCall, toolContextHints);
      if (repaired.repaired) {
        console.log(`[ToolRunner] 🔧 repaired ${toolCall.name}: ${repaired.reason}`);
      }
      return repaired.toolCall;
    });
    allToolCalls.push(...toolCallsWithIds);

    const toolCallSignature = buildToolCallLoopSignature(toolCallsWithIds);
    if (toolCallSignature && toolCallSignature === lastToolCallSignature && (mediaUrls.size > 0 || toolTelemetry.length > 0)) {
      repeatedToolCallStreak += 1;
    } else {
      repeatedToolCallStreak = 0;
    }
    lastToolCallSignature = toolCallSignature;

    if (repeatedToolCallStreak >= 2) {
      try {
        const finalized = await finalizeWithoutTools(
          'The same tool call was already executed multiple times successfully. Answer from the existing tool results now and do not call the same tool again.',
        );
        const finalizedContent = String(finalized.content || '').trim();
        if (finalizedContent && !isInternalToolPlaceholder(finalizedContent)) {
          return {
            content: finalizedContent,
            toolCalls: allToolCalls,
            mediaUrls: mediaUrls.size > 0 ? Array.from(mediaUrls) : undefined,
            usage: finalized.usage || response.usage,
            toolTelemetry: toolTelemetry.length > 0 ? toolTelemetry : undefined,
          };
        }
      } catch (error) {
        debugWarn(`[AgentRuntime] Identical-tool-loop finalization failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const results = await executeToolCalls(toolCallsWithIds);

    debugLog(`[AgentRuntime] Tool execution results:`, results.map(r => ({
      toolCallId: r.toolCallId,
      hasData: !!r.data,
      hasOutput: !!r.output,
      hasError: !!r.error,
    })));

    const allErrors = results.length > 0 && results.every(r => r.error);
    if (allErrors) {
      toolErrorStreak += 1;
    } else {
      toolErrorStreak = 0;
    }

    if (allErrors && toolErrorStreak >= 2) {
      const errorSummary = results.map(r => {
        const toolName = toolCallsWithIds.find(tc => tc.id === r.toolCallId)?.name;
        return `${toolName}: ${r.error}`;
      }).join('\n');
      if (allToolCalls.length > 0 || mediaUrls.size > 0) {
        try {
          const finalized = await finalizeWithoutTools(
            'Some tool calls failed repeatedly. Use successful tool outputs already in context and provide the best final answer now.',
          );
          const finalizedContent = String(finalized.content || '').trim();
          if (finalizedContent && !isInternalToolPlaceholder(finalizedContent)) {
            return {
              content: finalizedContent,
              toolCalls: allToolCalls,
              mediaUrls: mediaUrls.size > 0 ? Array.from(mediaUrls) : undefined,
              usage: finalized.usage || response.usage,
              toolTelemetry: toolTelemetry.length > 0 ? toolTelemetry : undefined,
            };
          }
        } catch (error) {
          debugWarn(`[AgentRuntime] Error-recovery finalization failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      return {
        content: mediaUrls.size > 0
          ? `I captured the screenshot, but follow-up tool steps kept failing.\n${errorSummary}`
          : `Tool execution failed repeatedly:\n${errorSummary}`,
        toolCalls: allToolCalls,
        mediaUrls: mediaUrls.size > 0 ? Array.from(mediaUrls) : undefined,
        usage: response.usage,
        toolTelemetry: toolTelemetry.length > 0 ? toolTelemetry : undefined,
      };
    }

    results.forEach((r) => {
      const toolName = toolCallsWithIds.find(tc => tc.id === r.toolCallId)?.name;
      if (toolName && typeof r.rawSize === 'number' && typeof r.compactSize === 'number') {
        toolTelemetry.push({
          tool: toolName,
          rawSize: r.rawSize,
          compactSize: r.compactSize,
        });
      }
      if (toolName && r.data) {
        for (const mediaUrl of collectMediaUrlsFromToolData(toolName, r.data)) {
          mediaUrls.add(mediaUrl);
        }
      }
    });
    const toolResultsForModel = buildToolResultsForModelInput(toolCallsWithIds, results);

    const assistantContent = (response.content || '').trim() || '[Tool invocation]';
    messages = [
      ...messages,
      { role: 'assistant', content: assistantContent },
      { role: 'user', content: toolResultsForModel },
    ];
    messages = enforceToolResultContextBudget(
      trimMessagesToBudget(messages, budget.requestMaxInputTokens).messages,
      budget.requestMaxInputTokens,
    );
  }

  debugWarn(`[AgentRuntime] Max iterations (${maxIterations}) reached`);
  try {
    const finalized = await finalizeWithoutTools(
      'Tool iteration limit reached. Use the latest tool results already in context.',
    );
    const finalizedContent = String(finalized.content || '').trim();
    if (finalizedContent) {
      return {
        content: finalizedContent,
        toolCalls: allToolCalls,
        mediaUrls: mediaUrls.size > 0 ? Array.from(mediaUrls) : undefined,
        usage: finalized.usage,
        toolTelemetry: toolTelemetry.length > 0 ? toolTelemetry : undefined,
      };
    }
  } catch (error) {
    debugWarn(`[AgentRuntime] Finalize-without-tools failed after max iterations: ${error instanceof Error ? error.message : String(error)}`);
  }

  const rawFallback = String(messages[messages.length - 1]?.content || '').trim();
  const safeFallback =
    !rawFallback
      ? 'I gathered context but could not finalize the answer in time. Please retry.'
      : (/^\[Tool Results\]/.test(rawFallback) || /^\[Tool invocation\]$/.test(rawFallback))
        ? 'I gathered context but could not finalize the answer in time. Please retry.'
        : rawFallback;

  return {
    content: safeFallback,
    toolCalls: allToolCalls,
    mediaUrls: mediaUrls.size > 0 ? Array.from(mediaUrls) : undefined,
    toolTelemetry: toolTelemetry.length > 0 ? toolTelemetry : undefined,
  };
}

/**
 * Run agent with streaming response using Agent Loop pattern
 */
export async function* runAgentStream(
  agentId: string,
  context: AgentContext
): AsyncGenerator<StreamChunk> {
  const agent = await ensureAgentRegistered(agentId);

  const systemPrompt = buildSystemPrompt(agent, context);

  const tools = agent.tools
    .map(name => toolRegistry.get(name))
    .filter(Boolean)
    .map(tool => ({
      name: tool!.name,
      description: tool!.description,
      parameters: tool!.parameters,
    }));
  const effectiveTools = adjustToolsForIntent(context, tools);

  const reasoningMode = normalizeReasoningMode(context.reasoningMode);
  const budget = context.budget || resolveTokenBudget({ agentId, mode: reasoningMode });

  const initialMessages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...context.messages
      .filter(m => m.role !== 'tool')
      .map(m => ({
        role: m.role === 'user'
          ? 'user' as const
          : m.role === 'system'
            ? 'system' as const
            : 'assistant' as const,
        content: m.content,
      })),
  ];
  const trimmedInput = trimMessagesToBudget(initialMessages, budget.requestMaxInputTokens);
  let messages: ChatMessage[] = enforceToolResultContextBudget(
    trimmedInput.messages,
    budget.requestMaxInputTokens,
  );

  const providerId = agent.provider || defaultProviderId;
  let provider = providerId ? getProvider(providerId) : undefined;
  if (!provider) {
    provider = getProvider('openai') || getProvider('anthropic') || getProvider('kimi') || getProvider('kimi-coding');
  }
  if (!provider) {
    throw new Error('No provider available');
  }

  const actualProviderId = agent.provider || defaultProviderId || 'openai';
  const providerConfig = getProviderConfig(actualProviderId);
  const defaultModel = providerConfig?.defaultModel || 'gpt-4o';
  const model = agent.model
    || resolveModelFromExecutionProfile({
      providerId: actualProviderId,
      defaultModel,
      smallModel: providerConfig?.smallModel,
      tier: agent.executionProfile?.modelTier,
    });
  const recentUrls = extractRecentUrlsFromContext(context);
  const allowGitHubContextRepair = looksLikeGitHubRepoIntent(context);
  const toolContextHints = {
    urls: recentUrls,
    githubRepoUrl: allowGitHubContextRepair
      ? recentUrls.find((url) => looksLikeGitHubRepoUrl(url))
      : undefined,
    explicitFileTarget: extractExplicitFileTargetFromContext(context),
  };

  let iteration = 0;
  const maxIterations = budget.maxToolIterations;
  let toolErrorStreak = 0;
  let repetitiveNoToolStreak = 0;
  let repeatedToolCallStreak = 0;
  let lastToolCallSignature = '';
  const maxRepetitiveNoToolStreak = 2;
  let postToolCompletionPassUsed = false;
  let progressOnlyRepromptCount = 0;
  const maxProgressOnlyReprompts = context.isChannelSession ? 2 : 1;
  const allToolCalls: ToolCall[] = [];
  const toolTelemetry: Array<{ tool: string; rawSize: number; compactSize: number }> = [];
  const mediaUrls = new Set<string>();

  const isToolIntentOnlyTextLocal = (content: string): boolean => {
    const text = String(content || '').trim();
    if (!text) return false;
    return (
      /^i(?:'| wi)ll use the [a-z0-9_\- ]+ tool(?: to help you)?\.?$/i.test(text) ||
      /^let me use the [a-z0-9_\- ]+ tool(?: to help)?\.?$/i.test(text)
    );
  };
  const isInternalToolPlaceholderLocal = (content: string): boolean => {
    return isInternalToolPlaceholderText(content);
  };
  const isLikelyRepetitiveLoopTextLocal = (content: string): boolean => {
    const text = String(content || '').trim();
    if (!text || text.length < 160) return false;

    const segments = text
      .split(/(?:\r?\n)+|(?<=[.!?])\s+/)
      .map((part) => part.trim())
      .filter(Boolean);
    if (segments.length < 4) return false;

    const normalizedSegments = segments.map((segment) =>
      segment
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    );
    const counts = new Map<string, number>();
    for (const segment of normalizedSegments) {
      if (!segment) continue;
      counts.set(segment, (counts.get(segment) || 0) + 1);
    }

    const total = normalizedSegments.length;
    const unique = counts.size;
    const repeatRatio = total > 0 ? 1 - unique / total : 0;
    const maxRepeat = Math.max(0, ...Array.from(counts.values()));

    return maxRepeat >= 3 || repeatRatio >= 0.35;
  };
  const buildDoneChunk = (
    finalContent: string,
    usage?: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    },
  ): StreamChunk => ({
    type: 'done',
    finalContent,
    toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
    mediaUrls: mediaUrls.size > 0 ? Array.from(mediaUrls) : undefined,
    usage,
    toolTelemetry: toolTelemetry.length > 0 ? toolTelemetry : undefined,
  });
  const finalizeWithoutTools = async (
    reason: string,
  ): Promise<{ content?: string; usage?: { promptTokens: number; completionTokens: number; totalTokens: number } }> => {
    const finalizeInstruction = [
      reason,
      'Provide the final user-facing answer now.',
      'Do not call or mention tools.',
      'Do not output placeholders like tool invocation or tool results.',
    ].join(' ');

    const finalizeMessages = trimMessagesToBudget(
      [
        ...messages,
        { role: 'user' as const, content: finalizeInstruction },
      ],
      budget.requestMaxInputTokens,
    ).messages;

    const finalized = await provider.chat({
      model,
      messages: finalizeMessages,
      tools: undefined,
    });
    return {
      content: String(finalized.content || '').trim(),
      usage: finalized.usage,
    };
  };

  // AGENT LOOP
  while (iteration < maxIterations) {
    iteration++;
    debugLog(`[AgentRuntime] Stream loop iteration ${iteration}`);

    const pendingToolCalls: ToolCall[] = [];
    let fullContent = '';

    try {
      messages = enforceToolResultContextBudget(messages, budget.requestMaxInputTokens);
      const stream = provider.chatStream({
        model,
        messages,
        tools: effectiveTools.length > 0 ? effectiveTools : undefined,
      });

      for await (const chunk of stream) {
        if (chunk.type === 'content') {
          fullContent += chunk.content || '';
          yield { type: 'text', content: chunk.content || '' };
        } else if (chunk.type === 'tool_call') {
          const rawToolCall: ToolCall = {
            id: `call_${Date.now()}_${pendingToolCalls.length}_${iteration}`,
            name: chunk.tool || '',
            arguments: chunk.args,
          };
          const repaired = repairToolCallForContext(rawToolCall, toolContextHints);
          if (repaired.repaired) {
            console.log(`[ToolRunner] 🔧 repaired ${rawToolCall.name}: ${repaired.reason}`);
          }
          pendingToolCalls.push(repaired.toolCall);
          allToolCalls.push(repaired.toolCall);
          yield { type: 'tool_call', tool: repaired.toolCall.name, args: repaired.toolCall.arguments };
        }
      }

      const normalizedContent = String(fullContent || '').trim();
      if (pendingToolCalls.length === 0) {
        const hasExecutedTools = allToolCalls.length > 0;
        const normalizedLoopSignature = normalizedContent
          .toLowerCase()
          .replace(/[^\p{L}\p{N}]+/gu, ' ')
          .replace(/\s+/g, ' ')
          .trim();

        if (
          isToolIntentOnlyTextLocal(normalizedContent) ||
          isInternalToolPlaceholderLocal(normalizedContent)
        ) {
          try {
            const finalized = await finalizeWithoutTools(
              'The previous assistant response was a tool-intent placeholder.',
            );
            const finalizedContent = String(finalized.content || '').trim();
            if (
              finalizedContent &&
              !isToolIntentOnlyTextLocal(finalizedContent) &&
              !isInternalToolPlaceholderLocal(finalizedContent)
            ) {
              yield buildDoneChunk(finalizedContent, finalized.usage);
              return;
            }
          } catch (error) {
            debugWarn(`[AgentRuntime] Stream placeholder finalization failed: ${error instanceof Error ? error.message : String(error)}`);
          }

          yield buildDoneChunk('I gathered context but could not finalize the answer in time. Please retry.');
          return;
        }

        if (isProgressOnlyStatusUpdate(normalizedContent)) {
          if (
            effectiveTools.length > 0 &&
            iteration < maxIterations &&
            progressOnlyRepromptCount < maxProgressOnlyReprompts
          ) {
            progressOnlyRepromptCount += 1;
            const progressFollowUp = hasExecutedTools
              ? 'Your previous message was only a progress/status update. Continue this same task now. Use tools again if needed, then provide the concrete answer. Do not reply with another progress update.'
              : 'Your previous message was only a progress/status update. Start or resume the actual work now. If tools are needed, call them immediately. Do not reply with another progress update.';
            messages = enforceToolResultContextBudget(
              trimMessagesToBudget(
                [
                  ...messages,
                  { role: 'assistant' as const, content: normalizedContent || '[status update]' },
                  { role: 'user' as const, content: progressFollowUp },
                ],
                budget.requestMaxInputTokens,
              ).messages,
              budget.requestMaxInputTokens,
            );
            continue;
          }

          if (hasExecutedTools) {
            try {
              const finalized = await finalizeWithoutTools(
                'Your previous response was only a progress/status update. Use the existing tool results and provide the final user-facing answer now.',
              );
              const finalizedContent = String(finalized.content || '').trim();
              if (
                finalizedContent &&
                !isToolIntentOnlyTextLocal(finalizedContent) &&
                !isInternalToolPlaceholderLocal(finalizedContent) &&
                !isProgressOnlyStatusUpdate(finalizedContent)
              ) {
                yield buildDoneChunk(finalizedContent, finalized.usage);
                return;
              }
            } catch (error) {
              debugWarn(`[AgentRuntime] Stream progress-only finalization failed: ${error instanceof Error ? error.message : String(error)}`);
            }
          }

          yield buildDoneChunk('I gathered context but could not finalize the answer in time. Please retry.');
          return;
        }

        if (
          hasExecutedTools &&
          context.isChannelSession === true &&
          !postToolCompletionPassUsed &&
          iteration < maxIterations
        ) {
          postToolCompletionPassUsed = true;
          messages = trimMessagesToBudget(
            [
              ...messages,
              { role: 'assistant' as const, content: normalizedContent || '[status update]' },
              {
                role: 'user' as const,
                content:
                  'Continue this same task now. You already executed tools in this turn. If your previous message was only a progress/status update, call tools again and finish the task. If your previous message was already final, repeat the final user-facing answer now. Do not stop at a status update.',
              },
            ],
            budget.requestMaxInputTokens,
          ).messages;
          continue;
        }

        if (hasExecutedTools && normalizedLoopSignature) {
          const recentAssistant = [...messages]
            .reverse()
            .find((entry) => entry.role === 'assistant');
          const previousSignature = String(recentAssistant?.content || '')
            .toLowerCase()
            .replace(/[^\p{L}\p{N}]+/gu, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          const repeatedSameReply = Boolean(previousSignature) && previousSignature === normalizedLoopSignature;
          if (repeatedSameReply || isLikelyRepetitiveLoopTextLocal(normalizedContent)) {
            repetitiveNoToolStreak += 1;
          } else {
            repetitiveNoToolStreak = 0;
          }

          if (repetitiveNoToolStreak >= maxRepetitiveNoToolStreak) {
            try {
              const finalized = await finalizeWithoutTools(
                'You have already run tools. Stop looping and provide the final user-facing answer from existing tool results.',
              );
              const finalizedContent = String(finalized.content || '').trim();
              if (finalizedContent && !isInternalToolPlaceholderLocal(finalizedContent)) {
                yield buildDoneChunk(finalizedContent, finalized.usage);
                return;
              }
            } catch (error) {
              debugWarn(`[AgentRuntime] Stream repetitive-loop finalization failed: ${error instanceof Error ? error.message : String(error)}`);
            }
          }
        } else {
          repetitiveNoToolStreak = 0;
        }

        debugLog(`[AgentRuntime] No tool calls in iteration ${iteration}, streaming complete`);
        const safeContent = isInternalToolPlaceholderLocal(normalizedContent)
          ? 'I gathered context but could not finalize the answer in time. Please retry.'
          : normalizedContent;
        yield buildDoneChunk(safeContent);
        return;
      }

      if (
        normalizedContent &&
        !isToolIntentOnlyTextLocal(normalizedContent) &&
        !isInternalToolPlaceholderLocal(normalizedContent)
      ) {
        yield { type: 'assistant_update', content: normalizedContent };
      }

      debugLog(`[AgentRuntime] Executing ${pendingToolCalls.length} tool calls`);
      const toolCallSignature = buildToolCallLoopSignature(pendingToolCalls);
      if (toolCallSignature && toolCallSignature === lastToolCallSignature && (mediaUrls.size > 0 || toolTelemetry.length > 0)) {
        repeatedToolCallStreak += 1;
      } else {
        repeatedToolCallStreak = 0;
      }
      lastToolCallSignature = toolCallSignature;

      if (repeatedToolCallStreak >= 2) {
        try {
          const finalized = await finalizeWithoutTools(
            'The same tool call was already executed multiple times successfully. Answer from the existing tool results now and do not call the same tool again.',
          );
          const finalizedContent = String(finalized.content || '').trim();
          if (finalizedContent && !isInternalToolPlaceholderLocal(finalizedContent)) {
            yield buildDoneChunk(finalizedContent, finalized.usage);
            return;
          }
        } catch (error) {
          debugWarn(`[AgentRuntime] Stream identical-tool-loop finalization failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      const results = await executeToolCalls(pendingToolCalls);

      const allErrors = results.length > 0 && results.every(r => r.error);
      if (allErrors) {
        toolErrorStreak += 1;
      } else {
        toolErrorStreak = 0;
      }

      if (allErrors && toolErrorStreak >= 2) {
        const errorSummary = results.map(r => {
          const toolName = pendingToolCalls.find(tc => tc.id === r.toolCallId)?.name;
          return `${toolName}: ${r.error}`;
        }).join('\n');
        try {
          if (allToolCalls.length > 0 || mediaUrls.size > 0) {
            const finalized = await finalizeWithoutTools(
              'Some tool calls failed repeatedly. Use successful tool outputs already in context and provide the best final answer now.',
            );
            const finalizedContent = String(finalized.content || '').trim();
            if (finalizedContent && !isInternalToolPlaceholderLocal(finalizedContent)) {
              yield buildDoneChunk(finalizedContent, finalized.usage);
              return;
            }
          }
        } catch (error) {
          debugWarn(`[AgentRuntime] Stream error-recovery finalization failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        yield buildDoneChunk(
          mediaUrls.size > 0
            ? `I captured the screenshot, but follow-up tool steps kept failing.\n${errorSummary}`
            : `Tool execution failed repeatedly:\n${errorSummary}`,
        );
        return;
      }

      for (const result of results) {
        const toolName = pendingToolCalls.find(tc => tc.id === result.toolCallId)?.name;
        if (toolName && typeof result.rawSize === 'number' && typeof result.compactSize === 'number') {
          toolTelemetry.push({
            tool: toolName,
            rawSize: result.rawSize,
            compactSize: result.compactSize,
          });
        }
        const resultMediaUrls =
          toolName && result.data
            ? collectMediaUrlsFromToolData(toolName, result.data)
            : [];
        for (const mediaUrl of resultMediaUrls) {
          mediaUrls.add(mediaUrl);
        }
        yield {
          type: 'tool_result',
          tool: toolName,
          result: result.error ? { error: result.error } : { data: result.compact || result.data || result.output },
          error: result.error,
          mediaUrls: resultMediaUrls.length > 0 ? resultMediaUrls : undefined,
        };
      }

      const toolResultContent = buildToolResultsForModelInput(pendingToolCalls, results);

      messages = [
        ...messages,
        { role: 'assistant', content: fullContent },
        { role: 'user', content: toolResultContent },
      ];
      messages = enforceToolResultContextBudget(
        trimMessagesToBudget(messages, budget.requestMaxInputTokens).messages,
        budget.requestMaxInputTokens,
      );

    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      yield buildDoneChunk(`Error: ${errorText}`);
      return;
    }
  }

  debugWarn(`[AgentRuntime] Stream max iterations (${maxIterations}) reached`);
  try {
    const finalized = await finalizeWithoutTools(
      'Tool iteration limit reached. Use the latest tool results already in context.',
    );
    const finalizedContent = String(finalized.content || '').trim();
    if (finalizedContent) {
      yield buildDoneChunk(finalizedContent, finalized.usage);
      return;
    }
  } catch (error) {
    debugWarn(`[AgentRuntime] Stream finalize-without-tools failed after max iterations: ${error instanceof Error ? error.message : String(error)}`);
  }
  yield buildDoneChunk('I gathered context but could not finalize the answer in time. Please retry.');
}

/**
 * Execute tool calls and return results
 */
async function executeToolCalls(toolCalls: ToolCall[]): Promise<ToolResult[]> {
  const results: ToolResult[] = [];

  const compactForLog = (value: unknown, maxChars = 240): string => {
    const raw = typeof value === 'string' ? value : safeJson(value);
    const clean = String(raw || '').replace(/\s+/g, ' ').trim();
    if (clean.length <= maxChars) return clean;
    return `${clean.slice(0, maxChars)}...`;
  };

  const summarizeToolExecution = (toolName: string, args: any): string => {
    if (toolName === 'bash_exec' || toolName === 'bash') {
      const command = compactForLog(args?.command || '', 320);
      const mode = String(args?.mode || 'safe').trim() || 'safe';
      const workdir = typeof args?.workdir === 'string' && args.workdir.trim()
        ? ` workdir=${args.workdir.trim()}`
        : '';
      const background = args?.background === true ? ' background=true' : '';
      return `command="${command}" mode=${mode}${workdir}${background}`;
    }

    if (toolName === 'browser') {
      const action = String(args?.action || '').trim() || '(unknown)';
      const url = compactForLog(args?.targetUrl || args?.url || '', 180);
      const targetId = args?.targetId ? ` tab=${args.targetId}` : '';
      return `action=${action}${url ? ` url="${url}"` : ''}${targetId}`;
    }

    return `args=${compactForLog(args, 220)}`;
  };

  for (const toolCall of toolCalls) {
    const startedAt = Date.now();
    const summary = summarizeToolExecution(toolCall.name, toolCall.arguments);
    console.log(`[ToolRunner] ▶ ${toolCall.name}${summary ? ` ${summary}` : ''}`);

    try {
      const tool = toolRegistry.get(toolCall.name);
      if (!tool) {
        console.log(`[ToolRunner] ❌ ${toolCall.name} ${Date.now() - startedAt}ms error=Tool not found`);
        results.push({
          toolCallId: toolCall.id,
          output: '',
          error: `Tool not found: ${toolCall.name}`,
        });
        continue;
      }

      const result = await tool.execute(toolCall.arguments);
      const elapsedMs = Date.now() - startedAt;
      if (
        (toolCall.name === 'bash_exec' || toolCall.name === 'bash') &&
        typeof toolCall.arguments?.command === 'string'
      ) {
        const commandText = toolCall.arguments.command;
        const skillFileMatches = Array.from(
          new Set(commandText.match(/[^\s"'`]*\/[^/\s"'`]+\/SKILL\.md/gi) || []),
        );
        for (const skillPath of skillFileMatches.slice(0, 3)) {
          console.log(`[SkillUsage] skill file read: ${skillPath}`);
        }
        const skillDocMatches = Array.from(
          new Set(commandText.match(/[^\s"'`]*\/(?:docs\/)?[A-Z0-9_]+_COMMANDS\.md/gi) || []),
        );
        for (const docPath of skillDocMatches.slice(0, 3)) {
          console.log(`[SkillUsage] skill guide read: ${docPath}`);
        }
      }
      const toolData = result.success ? (result.data ?? result.output ?? '') : '';
      const compacted = result.success
        ? compactToolPayload(toolCall.name, toolData)
        : undefined;
      if (result.success) {
        console.log(`[ToolRunner] ✅ ${toolCall.name} ${elapsedMs}ms`);
      } else {
        const errText = compactForLog(result.error || 'Unknown error', 220);
        console.log(`[ToolRunner] ❌ ${toolCall.name} ${elapsedMs}ms error=${errText}`);
      }
      results.push({
        toolCallId: toolCall.id,
        output: result.success ? (compacted?.compact.summary || String(result.output ?? '')) : '',
        error: result.success ? undefined : result.error,
        data: result.success ? result.data : undefined,
        compact: compacted?.compact,
        rawSize: compacted?.rawSize,
        compactSize: compacted?.compactSize,
        rawRef: compacted?.compact.rawRef,
      });
    } catch (error) {
      const errText = error instanceof Error ? error.message : String(error);
      console.log(`[ToolRunner] ❌ ${toolCall.name} ${Date.now() - startedAt}ms error=${compactForLog(errText, 220)}`);
      results.push({
        toolCallId: toolCall.id,
        output: '',
        error: errText,
      });
    }
  }

  return results;
}

// parseDirectives removed — delegation now handled by sessions_spawn tool
