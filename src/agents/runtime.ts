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
  ToolCall,
  ToolResult,
  WorkspaceManagerLike,
} from './types';
import { ensureAgentRegistered } from './registry';
import { getProvider, getProviderConfig } from '../providers/index';
import { toolRegistry } from '../tools/index';
import { ChatMessage } from '../providers/traits';
import { formatSkillsForPrompt, loadAvailableSkills } from '../skill-system';
import { cacheToolResult } from '../tools/tool-result-cache';
import { resolveTokenBudget, trimMessagesToBudget } from './budget';
import { getSessionSnapshot, setSessionSnapshot } from '../workspace/manager';

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

function getCachedSystemPrompt(sessionId: string): string | undefined {
  return systemPromptCache.get(sessionId);
}

function setCachedSystemPrompt(sessionId: string, prompt: string): void {
  systemPromptCache.set(sessionId, prompt);
}

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
Narrate only when it adds value (multi-step work, sensitive actions, or user asks).
Keep narration brief and value-dense.`;

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

function compactToolPayload(toolName: string, rawData: unknown): {
  compact: CompactToolResult;
  rawSize: number;
  compactSize: number;
} {
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

function buildSkillsSection(context: AgentContext): string {
  const workspaceInfo = context.workspace?.getWorkspaceInfo?.();
  const skills = loadAvailableSkills({
    homeDir: workspaceInfo?.homeDir,
    workspacePath: workspaceInfo?.workspacePath,
  });

  if (skills.length === 0) return '';

  const lines: string[] = [];
  lines.push('## Skills');
  lines.push('');
  lines.push('Before replying: scan `<available_skills>` descriptions.');
  lines.push('- If exactly one skill clearly matches, follow it.');
  lines.push('- If multiple skills might match, pick the most specific one.');
  lines.push('- If needed, load full instructions via `bash` with `cat "<location>"`.');
  lines.push('- Read at most one skill file before your first answer.');
  lines.push('- If user asks to add/install a skill, use `skills_add`.');
  lines.push('');
  lines.push(formatSkillsForPrompt(skills));
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

  const isMinimal = promptMode === 'minimal';
  const perFileMax = isMinimal ? BOOTSTRAP_MINIMAL_MAX_CHARS_PER_FILE : BOOTSTRAP_MAX_CHARS_PER_FILE;
  const totalMax = isMinimal ? BOOTSTRAP_MINIMAL_TOTAL_MAX_CHARS : BOOTSTRAP_TOTAL_MAX_CHARS;

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
 * "minimal" mode (channel messages, subagents):
 *   Identity + Tooling + Safety (short) + Workspace Context (SOUL + IDENTITY + BRAND files) + Runtime
 *   Skips: skills, tool call style guidance, memory, agents.md
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

  const isMinimal = promptMode === 'minimal';
  const lines: string[] = [];

  // 1. Identity — minimal, personality comes from SOUL.md
  lines.push('You are a personal assistant running inside FoxFang 🦊.');
  lines.push('');

  // 2. Tooling (always included when agent has tools)
  const toolSection = buildToolSection(agent.tools);
  if (toolSection) {
    lines.push(toolSection);
  }

  // 3. Tool Call Style (skip in minimal — saves ~200 chars)
  if (!isMinimal) {
    lines.push(TOOL_CALL_STYLE_GUIDANCE);
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

  // 5. Skills (skip in minimal — saves significant tokens)
  if (!isMinimal) {
    const skillsSection = buildSkillsSection(context);
    if (skillsSection) {
      lines.push(skillsSection);
    }
  }

  // Agent-specific role guidance (from config systemPrompt)
  if (agent.systemPrompt) {
    lines.push('## Agent Role');
    lines.push(agent.systemPrompt);
    lines.push('');
  }

  // 6. Workspace Context — budget-constrained, mode-aware
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

  // 7. Runtime
  lines.push('## Runtime');
  lines.push(`Runtime: agent=${agent.id} | model=${agent.model || 'default'}`);
  lines.push('');

  const finalPrompt = lines.join('\n');
  console.log(`[SystemPrompt] Final prompt length: ${finalPrompt.length} chars (mode=${promptMode})`);
  return finalPrompt;
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

  debugLog(`[AgentRuntime] Agent ${agentId} has ${tools.length} tools:`, tools.map(t => t.name).join(', '));

  const reasoningMode = normalizeReasoningMode(context.reasoningMode);
  const budget = context.budget || resolveTokenBudget({ agentId, mode: reasoningMode });

  const initialMessages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...context.messages
      .filter(m => m.role !== 'tool')
      .map(m => ({
        role: m.role === 'user' ? 'user' as const : 'assistant' as const,
        content: m.content,
      })),
  ];
  const trimmedInput = trimMessagesToBudget(initialMessages, budget.requestMaxInputTokens);
  let messages: ChatMessage[] = trimmedInput.messages;

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

  const allToolCalls: ToolCall[] = [];
  let iteration = 0;
  const maxIterations = budget.maxToolIterations;
  let toolErrorStreak = 0;
  const toolTelemetry: Array<{ tool: string; rawSize: number; compactSize: number }> = [];
  const isToolIntentOnlyText = (content: string): boolean => {
    const text = String(content || '').trim();
    if (!text) return false;
    return (
      /^i(?:'| wi)ll use the [a-z0-9_\- ]+ tool(?: to help you)?\.?$/i.test(text) ||
      /^let me use the [a-z0-9_\- ]+ tool(?: to help)?\.?$/i.test(text)
    );
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
      response = await provider.chat({
        model,
        messages,
        tools: tools.length > 0 ? tools : undefined,
      });
    } catch (error) {
      console.error('Provider chat error:', error);
      throw new Error(`Failed to get response from ${provider.name}: ${error instanceof Error ? error.message : String(error)}`);
    }

    debugLog(`[AgentRuntime] Response received, content length: ${response.content?.length || 0}, toolCalls: ${response.toolCalls?.length || 0}`);

    if (!response.toolCalls || response.toolCalls.length === 0) {
      const normalizedContent = String(response.content || '').trim();
      if (isToolIntentOnlyText(normalizedContent)) {
        debugWarn(`[AgentRuntime] Detected tool-intent placeholder text from provider; forcing no-tools finalization`);
        try {
          const finalized = await finalizeWithoutTools('The previous assistant response was a tool-intent placeholder.');
          if (finalized.content && !isToolIntentOnlyText(finalized.content)) {
            return {
              content: finalized.content,
              toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
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
          usage: response.usage,
          toolTelemetry: toolTelemetry.length > 0 ? toolTelemetry : undefined,
        };
      }

      debugLog(`[AgentRuntime] No tool calls, returning final response`);
      return {
        content: response.content,
        toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
        usage: response.usage,
        toolTelemetry: toolTelemetry.length > 0 ? toolTelemetry : undefined,
      };
    }

    debugLog(`[AgentRuntime] Tool calls:`, response.toolCalls.map(tc => tc.name).join(', '));

    const toolCallsWithIds: ToolCall[] = response.toolCalls.map((tc, idx) => ({
      id: `call_${Date.now()}_${idx}_${iteration}`,
      name: tc.name,
      arguments: tc.arguments,
    }));
    allToolCalls.push(...toolCallsWithIds);

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
      return {
        content: `Tool execution failed repeatedly:\n${errorSummary}`,
        toolCalls: allToolCalls,
        usage: response.usage,
        toolTelemetry: toolTelemetry.length > 0 ? toolTelemetry : undefined,
      };
    }

    const toolResultsForModel = results.map(r => {
      const toolName = toolCallsWithIds.find(tc => tc.id === r.toolCallId)?.name;
      if (r.error) {
        return `${toolName}: Error: ${r.error}`;
      }
      if (toolName && typeof r.rawSize === 'number' && typeof r.compactSize === 'number') {
        toolTelemetry.push({
          tool: toolName,
          rawSize: r.rawSize,
          compactSize: r.compactSize,
        });
      }
      const data = r.compact || r.data || r.output;
      return `${toolName}: ${typeof data === 'object' ? JSON.stringify(data) : data}`;
    }).join('\n');

    const assistantContent = (response.content || '').trim() || '[Tool invocation]';
    messages = [
      ...messages,
      { role: 'assistant', content: assistantContent },
      { role: 'user', content: `[Tool Results]\n${toolResultsForModel}` },
    ];
    messages = trimMessagesToBudget(messages, budget.requestMaxInputTokens).messages;
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
    toolTelemetry: toolTelemetry.length > 0 ? toolTelemetry : undefined,
  };
}

/**
 * Run agent with streaming response using Agent Loop pattern
 */
export async function* runAgentStream(
  agentId: string,
  context: AgentContext
): AsyncGenerator<{ type: 'text' | 'tool_call' | 'tool_result' | 'done'; content?: string; tool?: string; args?: any; result?: any }> {
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

  const reasoningMode = normalizeReasoningMode(context.reasoningMode);
  const budget = context.budget || resolveTokenBudget({ agentId, mode: reasoningMode });

  const initialMessages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...context.messages
      .filter(m => m.role !== 'tool')
      .map(m => ({
        role: m.role === 'user' ? 'user' as const : 'assistant' as const,
        content: m.content,
      })),
  ];
  const trimmedInput = trimMessagesToBudget(initialMessages, budget.requestMaxInputTokens);
  let messages: ChatMessage[] = trimmedInput.messages;

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

  let iteration = 0;
  const maxIterations = budget.maxToolIterations;
  let toolErrorStreak = 0;

  // AGENT LOOP
  while (iteration < maxIterations) {
    iteration++;
    debugLog(`[AgentRuntime] Stream loop iteration ${iteration}`);

    const pendingToolCalls: ToolCall[] = [];
    let fullContent = '';

    try {
      const stream = provider.chatStream({
        model,
        messages,
        tools: tools.length > 0 ? tools : undefined,
      });

      for await (const chunk of stream) {
        if (chunk.type === 'content') {
          fullContent += chunk.content || '';
          yield { type: 'text', content: chunk.content || '' };
        } else if (chunk.type === 'tool_call') {
          const toolCall: ToolCall = {
            id: `call_${Date.now()}_${pendingToolCalls.length}_${iteration}`,
            name: chunk.tool || '',
            arguments: chunk.args,
          };
          pendingToolCalls.push(toolCall);
          yield { type: 'tool_call', tool: chunk.tool, args: chunk.args };
        }
      }

      if (pendingToolCalls.length === 0) {
        debugLog(`[AgentRuntime] No tool calls in iteration ${iteration}, streaming complete`);
        yield { type: 'done' };
        return;
      }

      debugLog(`[AgentRuntime] Executing ${pendingToolCalls.length} tool calls`);
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
        yield { type: 'text', content: `\nTool execution failed repeatedly:\n${errorSummary}\n` };
        yield { type: 'done' };
        return;
      }

      for (const result of results) {
        yield {
          type: 'tool_result',
          tool: pendingToolCalls.find(tc => tc.id === result.toolCallId)?.name,
          result: result.error ? { error: result.error } : { data: result.compact || result.data || result.output }
        };
      }

      const toolResultContent = results.map(r => {
        const toolName = pendingToolCalls.find(tc => tc.id === r.toolCallId)?.name;
        if (r.error) {
          return `${toolName}: Error: ${r.error}`;
        }
        const data = r.compact || r.data || r.output;
        return `${toolName}: ${typeof data === 'object' ? JSON.stringify(data) : data}`;
      }).join('\n');

      messages = [
        ...messages,
        { role: 'assistant', content: fullContent },
        { role: 'user', content: `[Tool Results]\n${toolResultContent}` },
      ];
      messages = trimMessagesToBudget(messages, budget.requestMaxInputTokens).messages;

    } catch (error) {
      yield { type: 'text', content: `\nError: ${error instanceof Error ? error.message : String(error)}\n` };
      yield { type: 'done' };
      return;
    }
  }

  debugWarn(`[AgentRuntime] Stream max iterations (${maxIterations}) reached`);
  yield { type: 'text', content: '\n[Max tool iterations reached]\n' };
  yield { type: 'done' };
}

/**
 * Execute tool calls and return results
 */
async function executeToolCalls(toolCalls: ToolCall[]): Promise<ToolResult[]> {
  const results: ToolResult[] = [];

  for (const toolCall of toolCalls) {
    try {
      const tool = toolRegistry.get(toolCall.name);
      if (!tool) {
        results.push({
          toolCallId: toolCall.id,
          output: '',
          error: `Tool not found: ${toolCall.name}`,
        });
        continue;
      }

      const result = await tool.execute(toolCall.arguments);
      const toolData = result.success ? (result.data ?? result.output ?? '') : '';
      const compacted = result.success
        ? compactToolPayload(toolCall.name, toolData)
        : undefined;
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
      results.push({
        toolCallId: toolCall.id,
        output: '',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}

// parseDirectives removed — delegation now handled by sessions_spawn tool
