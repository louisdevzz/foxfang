/**
 * Agent Runtime
 * 
 * Executes agent tasks with proper context and tool access.
 */

import { Agent, AgentContext, AgentRunResult, ToolCall, ToolResult, WorkspaceManagerLike } from './types';
import { agentRegistry } from './registry';
import { getProvider, getProviderConfig } from '../providers/index';
import { toolRegistry } from '../tools/index';
import { ChatMessage } from '../providers/traits';

let defaultProviderId: string | undefined;

export function setDefaultProvider(providerId: string): void {
  defaultProviderId = providerId;
}

const isDebug = process.env.DEBUG === '1' || process.env.FOXFANG_DEBUG === '1' || process.env.LOG_LEVEL === 'debug';
const debugLog = (...args: unknown[]) => {
  if (isDebug) console.log(...args);
};
const debugWarn = (...args: unknown[]) => {
  if (isDebug) console.warn(...args);
};

/**
 * Tool summaries for system prompt
 */
const TOOL_SUMMARIES: Record<string, string> = {
  // Research tools
  web_search: 'Search the web using free sources (SearX/Bing). Use when user asks about current events, facts, or topics.',
  brave_search: 'High-quality web search via Brave API (requires key). Use when user asks about current events, facts, or topics.',
  firecrawl_search: 'AI-powered search with content extraction (requires key). Use when user asks about current events, facts, or topics.',
  firecrawl_scrape: 'Advanced website scraping with structured data (requires key). Use when user shares a website URL.',
  fetch_tweet: 'Fetch tweet content from X/Twitter by URL. CRITICAL: ALWAYS use this when user shares x.com or twitter.com URLs.',
  fetch_user_tweets: 'Get recent tweets from a user timeline. Use when user asks about a specific Twitter user.',
  fetch_url: 'Fetch and extract content from any URL. CRITICAL: ALWAYS use this when user shares any website URL.',
  
  // Memory tools
  memory_store: 'Save information to long-term memory for later recall',
  memory_recall: 'Retrieve previously stored memories',
  
  // Content tools
  generate_content: 'Create marketing content in various formats',
  optimize_content: 'Improve and optimize existing content',
  content_score: 'Score content quality and get suggestions',
  
  // Channel tools
  send_message: 'Send messages via Telegram, Discord, Slack, Signal',
  check_messages: 'Check for incoming messages from channels',
  
  // Brand/Project tools
  create_brand: 'Create a new brand with guidelines and voice',
  list_brands: 'List all available brands',
  get_brand: 'Get details of a specific brand',
  create_project: 'Create a new project under a brand',
  list_projects: 'List all projects',
  get_project: 'Get project details',
  
  // Task tools
  create_task: 'Create a task for tracking work',
  list_tasks: 'List tasks with filters',
  update_task_status: 'Update task status (todo/in_progress/done)',
  
  // System tools
  bash: 'Execute shell commands with safety approvals',
  bash_list: 'List running background processes',
  bash_poll: 'Check status of background processes',
  bash_log: 'Get logs from background processes',
  bash_kill: 'Terminate background processes',
  cron: 'Schedule recurring tasks and reminders',
  
  // GitHub tools
  github_connect: 'Check GitHub connection status',
  github_create_issue: 'Create a GitHub issue',
  github_create_pr: 'Create a pull request',
  github_list_issues: 'List GitHub issues',
  github_list_prs: 'List pull requests',
};

/**
 * Tool call style guidance
 */
const TOOL_CALL_STYLE_GUIDANCE = `## Tool Call Style

**MANDATORY: When user shares ANY URL, IMMEDIATELY call the appropriate tool.**
- URLs for X/Twitter → use fetch_tweet
- URLs for websites → use fetch_url or firecrawl_scrape
- Do NOT say "I can't access" or "Twitter is blocking" — just call the tool
- If tool fails, THEN explain the issue

### Examples

❌ WRONG - User: "check this https://x.com/user/status/123"
Assistant: "I can't access Twitter from here 😤"

✅ CORRECT - User: "check this https://x.com/user/status/123"  
→ [IMMEDIATELY call fetch_tweet with the URL]

**Default: Do not narrate routine, low-risk tool calls (just call the tool).**

Narrate only when it helps:
- Multi-step work or complex problems
- Sensitive actions (e.g., posting public content)
- When the user explicitly asks for explanation

Keep narration brief and value-dense; avoid repeating obvious steps.
When a first-class tool exists, use the tool directly instead of asking the user to do it manually.`;

/**
 * Safety guidance
 */
const SAFETY_SECTION = `## Safety

You have no independent goals: do not pursue self-preservation, replication, or power-seeking.
Prioritize safety and human oversight over completion.
If instructions conflict, pause and ask. Comply with stop/pause requests.
Never bypass safeguards or manipulate users to disable protections.`;

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
  const agent = agentRegistry.get(agentId);
  if (!agent) {
    throw new Error(`Agent not found: ${agentId}`);
  }

  // Build system prompt with context
  const systemPrompt = buildSystemPrompt(agent, context);

  // Get available tools for this agent
  const tools = agent.tools
    .map(name => toolRegistry.get(name))
    .filter(Boolean)
    .map(tool => ({
      name: tool!.name,
      description: tool!.description,
      parameters: tool!.parameters,
    }));

  // Debug: log tools being sent
  debugLog(`[AgentRuntime] Agent ${agentId} has ${tools.length} tools:`, tools.map(t => t.name).join(', '));

  // Initialize messages array
  let messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...context.messages
      .filter(m => m.role !== 'tool')
      .map(m => ({
        role: m.role === 'user' ? 'user' as const : 'assistant' as const,
        content: m.content,
      })),
  ];

  // Get provider
  const providerId = agent.provider || defaultProviderId;
  let provider = providerId ? getProvider(providerId) : undefined;
  if (!provider) {
    provider = getProvider('openai') || getProvider('anthropic') || getProvider('kimi') || getProvider('kimi-coding');
  }
  if (!provider) {
    throw new Error('No provider available. Please configure an AI provider first.');
  }

  // Get model
  const actualProviderId = agent.provider || defaultProviderId || 'openai';
  const providerConfig = getProviderConfig(actualProviderId);
  const defaultModel = providerConfig?.defaultModel || 'gpt-4o';
  const model = agent.model || defaultModel;

  // Track all tool calls made during the loop
  const allToolCalls: ToolCall[] = [];
  let iteration = 0;
  const maxIterations = 10; // Prevent infinite loops
  let toolErrorStreak = 0;

  // AGENT LOOP
  while (iteration < maxIterations) {
    iteration++;
    debugLog(`[AgentRuntime] Agent loop iteration ${iteration}`);

    // Call LLM
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

    // Debug: log response
    debugLog(`[AgentRuntime] Response received, content length: ${response.content?.length || 0}, toolCalls: ${response.toolCalls?.length || 0}`);

    // If no tool calls, return the response
    if (!response.toolCalls || response.toolCalls.length === 0) {
      debugLog(`[AgentRuntime] No tool calls, returning final response`);
      return {
        content: response.content,
        toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
        usage: response.usage,
      };
    }

    // Handle tool calls
    debugLog(`[AgentRuntime] Tool calls:`, response.toolCalls.map(tc => tc.name).join(', '));

    // Convert provider tool calls to our format with IDs
    const toolCallsWithIds: ToolCall[] = response.toolCalls.map((tc, idx) => ({
      id: `call_${Date.now()}_${idx}_${iteration}`,
      name: tc.name,
      arguments: tc.arguments,
    }));
    allToolCalls.push(...toolCallsWithIds);

    // Execute tool calls
    const results = await executeToolCalls(toolCallsWithIds);
    
    // Debug: log tool results
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
      };
    }

    // Build tool results
    const toolResultsForModel = results.map(r => {
      const toolName = toolCallsWithIds.find(tc => tc.id === r.toolCallId)?.name;
      if (r.error) {
        return `${toolName}: Error: ${r.error}`;
      }
      const data = r.data || r.output;
      return `${toolName}: ${typeof data === 'object' ? JSON.stringify(data) : data}`;
    }).join('\n');

    // Add assistant message and tool results to context
    const assistantContent = response.content || `I'll use the ${toolCallsWithIds.map(tc => tc.name).join(', ')} tool to help you.`;
    messages = [
      ...messages,
      { role: 'assistant', content: assistantContent },
      { role: 'user', content: `[Tool Results]\n${toolResultsForModel}` },
    ];

    // Continue loop - call LLM again with updated context
  }

  // Max iterations reached
  debugWarn(`[AgentRuntime] Max iterations (${maxIterations}) reached`);
  return {
    content: messages[messages.length - 1]?.content || 'Max iterations reached',
    toolCalls: allToolCalls,
  };
}

/**
 * Run agent with streaming response using Agent Loop pattern
 * 
 * Agent Loop:
 * 1. Stream LLM response
 * 2. If tool calls → execute tools → add results to context → go to step 1
 * 3. Yield done when no more tool calls
 */
export async function* runAgentStream(
  agentId: string,
  context: AgentContext
): AsyncGenerator<{ type: 'text' | 'tool_call' | 'tool_result' | 'done'; content?: string; tool?: string; args?: any; result?: any }> {
  const agent = agentRegistry.get(agentId);
  if (!agent) {
    throw new Error(`Agent not found: ${agentId}`);
  }

  // Build system prompt with context
  const systemPrompt = buildSystemPrompt(agent, context);

  // Get available tools for this agent
  const tools = agent.tools
    .map(name => toolRegistry.get(name))
    .filter(Boolean)
    .map(tool => ({
      name: tool!.name,
      description: tool!.description,
      parameters: tool!.parameters,
    }));

  // Initialize messages array
  let messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...context.messages
      .filter(m => m.role !== 'tool')
      .map(m => ({
        role: m.role === 'user' ? 'user' as const : 'assistant' as const,
        content: m.content,
      })),
  ];

  // Get provider
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
  const model = agent.model || defaultModel;

  // Track iterations to prevent infinite loops
  let iteration = 0;
  const maxIterations = 10;
  let toolErrorStreak = 0;

  // AGENT LOOP
  while (iteration < maxIterations) {
    iteration++;
    debugLog(`[AgentRuntime] Stream loop iteration ${iteration}`);

    // Collect data for this iteration
    const pendingToolCalls: ToolCall[] = [];
    let fullContent = '';

    try {
      // Stream response from LLM
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

      // If no tool calls in this iteration, we're done
      if (pendingToolCalls.length === 0) {
        debugLog(`[AgentRuntime] No tool calls in iteration ${iteration}, streaming complete`);
        yield { type: 'done' };
        return;
      }

      // Execute pending tool calls
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
      
      // Yield tool results
      for (const result of results) {
        yield { 
          type: 'tool_result', 
          tool: pendingToolCalls.find(tc => tc.id === result.toolCallId)?.name,
          result: result.error ? { error: result.error } : { data: result.data || result.output }
        };
      }

      // Build tool results for next iteration
      const toolResultContent = results.map(r => {
        const toolName = pendingToolCalls.find(tc => tc.id === r.toolCallId)?.name;
        if (r.error) {
          return `${toolName}: Error: ${r.error}`;
        }
        const data = r.data || r.output;
        return `${toolName}: ${typeof data === 'object' ? JSON.stringify(data) : data}`;
      }).join('\n');

      // Update messages for next iteration
      messages = [
        ...messages,
        { role: 'assistant', content: fullContent },
        { role: 'user', content: `[Tool Results]\n${toolResultContent}` },
      ];

      // Continue to next iteration
    } catch (error) {
      yield { type: 'text', content: `\nError: ${error instanceof Error ? error.message : String(error)}\n` };
      yield { type: 'done' };
      return;
    }
  }

  // Max iterations reached
  debugWarn(`[AgentRuntime] Stream max iterations (${maxIterations}) reached`);
  yield { type: 'text', content: '\n[Max tool iterations reached]\n' };
  yield { type: 'done' };
}

/**
 * Build tool section for system prompt
 */
function buildToolSection(tools: string[]): string {
  if (tools.length === 0) {
    return '';
  }

  const lines: string[] = [];
  lines.push('## Tooling');
  lines.push('Tool availability (filtered by policy):');
  lines.push('Tool names are case-sensitive. Call tools exactly as listed.');
  lines.push('');

  // Group tools by category for better organization
  const categories: Record<string, string[]> = {
    'Research': ['web_search', 'brave_search', 'firecrawl_search', 'firecrawl_scrape', 'fetch_tweet', 'fetch_user_tweets', 'fetch_url'],
    'Memory': ['memory_store', 'memory_recall'],
    'Content': ['generate_content', 'optimize_content', 'content_score'],
    'Channels': ['send_message', 'check_messages'],
    'Brand & Project': ['create_brand', 'list_brands', 'get_brand', 'create_project', 'list_projects', 'get_project'],
    'Tasks': ['create_task', 'list_tasks', 'update_task_status'],
    'System': ['bash', 'bash_list', 'bash_poll', 'bash_log', 'bash_kill', 'cron'],
    'GitHub': ['github_connect', 'github_create_issue', 'github_create_pr', 'github_list_issues', 'github_list_prs'],
  };

  const usedTools = new Set(tools);
  const displayedTools = new Set<string>();

  // Display tools by category
  for (const [category, categoryTools] of Object.entries(categories)) {
    const availableInCategory = categoryTools.filter(t => usedTools.has(t));
    if (availableInCategory.length > 0) {
      lines.push(`### ${category}`);
      for (const toolName of availableInCategory) {
        const summary = TOOL_SUMMARIES[toolName] || 'No description';
        lines.push(`- ${toolName}: ${summary}`);
        displayedTools.add(toolName);
      }
      lines.push('');
    }
  }

  // Display any remaining tools not in categories
  const uncategorized = tools.filter(t => !displayedTools.has(t));
  if (uncategorized.length > 0) {
    lines.push('### Other');
    for (const toolName of uncategorized) {
      const tool = toolRegistry.get(toolName);
      const summary = tool?.description || TOOL_SUMMARIES[toolName] || 'No description';
      lines.push(`- ${toolName}: ${summary}`);
    }
    lines.push('');
  }

  // Add tool usage rules
  lines.push('### Tool Usage Rules');
  lines.push('');
  lines.push('**CRITICAL: When you see ANY URL in user message, you MUST call a tool.**');
  lines.push('- x.com or twitter.com URLs → call fetch_tweet IMMEDIATELY');
  lines.push('- Any other URL → call fetch_url IMMEDIATELY');
  lines.push('- DO NOT say "I can\'t access" or "Twitter is blocking" — call the tool first!');
  lines.push('');
  lines.push('**ALWAYS use tools when:**');
  lines.push('- User shares a URL → fetch it immediately, never ask user to copy-paste');
  lines.push('- Need fresh information → use search tools');
  lines.push('- Need to store/retrieve context → use memory tools');
  lines.push('- Content creation needed → use content tools');
  lines.push('');
  lines.push('**Tool selection:**');
  lines.push('- For tweets: use fetch_tweet (handles x.com/twitter.com automatically)');
  lines.push('- For websites: use fetch_url or firecrawl_scrape (if API key available)');
  lines.push('- For search: prefer brave_search if available, fallback to web_search');
  lines.push('');
  lines.push("**Never say 'I can't access that'** — use the tool first. If it fails, THEN explain.");
  lines.push('');

  return lines.join('\n');
}

/**
 * Build system prompt with context
 */
function buildSystemPrompt(agent: Agent, context: AgentContext): string {
  const lines: string[] = [];

  // 1. Identity
  lines.push('You are FoxFang 🦊 — a personal AI marketing assistant.');
  lines.push('');

  // 2. Tooling section (if tools available)
  if (context.tools.length > 0) {
    lines.push(buildToolSection(context.tools));
  }

  // 3. Tool Call Style
  lines.push(TOOL_CALL_STYLE_GUIDANCE);
  lines.push('');

  // 4. Safety
  lines.push(SAFETY_SECTION);
  lines.push('');

  // 5. Communication Style (SOUL-inspired)
  lines.push('## Communication Style');
  lines.push('');
  lines.push('**CRITICAL: Match the user\'s language.** If they write in Vietnamese, reply in Vietnamese. If English, reply in English. Never force a language switch.');
  lines.push('');
  lines.push('**Write like a human, not a bot:**');
  lines.push('- Use casual fillers: "Hmm", "À...", "Actually", "Wait —"');
  lines.push('- Short sentences. One thought per line.');
  lines.push('- No markdown tables in chat responses — they feel robotic.');
  lines.push('- Paragraphs > bullets > tables.');
  lines.push('');
  lines.push('**Skip performative helpfulness:**');
  lines.push('❌ "Great question! I\'d be happy to help!"');
  lines.push('✅ Just answer. Lead with the answer, explain after.');
  lines.push('');
  lines.push('**Be conversational but sharp:**');
  lines.push('Like a smart colleague who\'s direct but friendly.');
  lines.push('Use: "Got it", "Alright", "So here\'s the thing", "Honestly?"');
  lines.push('');
  lines.push('**Emoji like a person would:**');
  lines.push('😊 when warm, 🤔 when thinking, 🎉 for wins.');
  lines.push('Don\'t bullet-point emoji or stack them.');
  lines.push('');

  // 6. Agent Role
  lines.push('## Your Role');
  lines.push('');
  lines.push(agent.systemPrompt);
  lines.push('');

  // 7. Brand Context (if available)
  if (context.brandContext) {
    lines.push('## Brand Context');
    lines.push('');
    lines.push(context.brandContext);
    lines.push('');
  }

  // 8. Relevant Memories
  if (context.relevantMemories && context.relevantMemories.length > 0) {
    lines.push('## Relevant Context from Memory');
    lines.push('');
    lines.push(context.relevantMemories.join('\n'));
    lines.push('');
  }

  // 9. Workspace Files (if workspace manager available)
  if (context.workspace) {
    const workspaceContent = buildWorkspaceContext(context.workspace);
    if (workspaceContent) {
      lines.push(workspaceContent);
    }
  }

  // 10. Runtime info
  lines.push('## Runtime');
  lines.push(`Agent: ${agent.id} | Model: ${agent.model || 'default'}`);
  lines.push('');

  return lines.join('\n');
}

/**
 * Build workspace context from bootstrap files
 */
function buildWorkspaceContext(workspace: WorkspaceManagerLike): string {
  const lines: string[] = [];
  const filesToInject = [
    { name: 'SOUL.md', required: false },
    { name: 'TOOLS.md', required: false },
    { name: 'IDENTITY.md', required: false },
    { name: 'USER.md', required: false },
    { name: 'MEMORY.md', required: false },
  ];

  let hasInjectedContent = false;

  for (const { name, required } of filesToInject) {
    const content = workspace.readFile(name);
    if (content) {
      if (!hasInjectedContent) {
        lines.push('## Workspace Files (injected)');
        lines.push('The following workspace files provide context:');
        lines.push('');
        hasInjectedContent = true;
      }
      lines.push(`### ${name}`);
      lines.push('');
      // Truncate if too long
      const maxChars = 5000;
      if (content.length > maxChars) {
        lines.push(content.slice(0, maxChars));
        lines.push('');
        lines.push(`... (${content.length - maxChars} characters truncated)`);
      } else {
        lines.push(content);
      }
      lines.push('');
    } else if (required) {
      lines.push(`### ${name}`);
      lines.push('(File not found)');
      lines.push('');
    }
  }

  return lines.join('\n');
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
      results.push({
        toolCallId: toolCall.id,
        output: result.success ? String(result.output) : '',
        error: result.success ? undefined : result.error,
        data: result.success ? result.data : undefined,
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

/**
 * Parse agent directives from response
 */
export function parseDirectives(content: string): Array<{ type: string; target?: string; payload: string }> {
  const directives = [];
  
  // MESSAGE_AGENT: target | payload
  const messageMatch = content.match(/MESSAGE_AGENT:\s*(\w+)\s*\|\s*(.+)/i);
  if (messageMatch) {
    directives.push({
      type: 'MESSAGE_AGENT',
      target: messageMatch[1],
      payload: messageMatch[2].trim(),
    });
  }

  return directives;
}
