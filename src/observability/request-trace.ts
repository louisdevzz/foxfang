import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { RequestTrace } from '../agents/types';
import { resolveFoxFangHome } from '../config/defaults';

function resolveTraceFilePath(): string {
  const candidates = [
    join(resolveFoxFangHome(), 'logs'),
    join(process.cwd(), '.foxfang', 'logs'),
    join(homedir(), '.foxfang', 'logs'),
  ];

  let dir: string | null = null;
  for (const candidate of candidates) {
    try {
      if (!existsSync(candidate)) {
        mkdirSync(candidate, { recursive: true });
      }
      dir = candidate;
      break;
    } catch {
      // Try next location when this path is not writable.
    }
  }

  if (!dir) {
    throw new Error('Unable to create writable logs directory for request trace.');
  }

  const day = new Date().toISOString().slice(0, 10);
  return join(dir, `request-trace-${day}.jsonl`);
}

export function createRequestTrace(requestId: string): RequestTrace {
  return {
    requestId,
    agentsInvoked: [],
    totalInputTokens: 0,
    totalOutputTokens: 0,
    perAgentUsage: [],
    toolCalls: [],
    numberOfDelegations: 0,
    numberOfReviewPasses: 0,
    totalLatencyMs: 0,
  };
}

export function addAgentUsage(
  trace: RequestTrace,
  agent: string,
  usage?: { promptTokens: number; completionTokens: number },
): void {
  if (!usage) return;
  trace.agentsInvoked.push(agent);
  trace.totalInputTokens += usage.promptTokens;
  trace.totalOutputTokens += usage.completionTokens;
  trace.perAgentUsage.push({
    agent,
    inputTokens: usage.promptTokens,
    outputTokens: usage.completionTokens,
  });
}

export function addToolTelemetry(
  trace: RequestTrace,
  items?: Array<{ tool: string; rawSize: number; compactSize: number }>,
): void {
  if (!items || items.length === 0) return;
  trace.toolCalls.push(...items);
}

export function flushRequestTrace(trace: RequestTrace): void {
  try {
    const filepath = resolveTraceFilePath();
    appendFileSync(filepath, `${JSON.stringify(trace)}\n`, 'utf-8');
  } catch (error) {
    if (process.env.DEBUG === '1' || process.env.FOXFANG_DEBUG === '1') {
      console.warn('[trace] Failed to persist request trace:', error);
    }
  }
}
