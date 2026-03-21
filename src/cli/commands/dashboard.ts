import { Command } from 'commander';
import chalk from 'chalk';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { resolveFoxFangHome } from '../../config/defaults';

type TraceRecord = {
  requestId: string;
  agentsInvoked: string[];
  totalInputTokens: number;
  totalOutputTokens: number;
  perAgentUsage: Array<{
    agent: string;
    inputTokens: number;
    outputTokens: number;
  }>;
  toolCalls: Array<{
    tool: string;
    rawSize: number;
    compactSize: number;
  }>;
  numberOfDelegations: number;
  numberOfReviewPasses: number;
  totalLatencyMs: number;
};

function resolveLogsDir(): string {
  const candidates = [
    join(resolveFoxFangHome(), 'logs'),
    join(process.cwd(), '.foxfang', 'logs'),
    join(homedir(), '.foxfang', 'logs'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[0];
}

function parseJsonLines(filepath: string): TraceRecord[] {
  try {
    const content = readFileSync(filepath, 'utf-8');
    const lines = content.split(/\r?\n/).filter(Boolean);
    const parsed: TraceRecord[] = [];
    for (const line of lines) {
      try {
        const item = JSON.parse(line) as TraceRecord;
        if (item && typeof item.requestId === 'string') parsed.push(item);
      } catch {
        // skip malformed lines
      }
    }
    return parsed;
  } catch {
    return [];
  }
}

function listTraceFiles(days: number): string[] {
  const logsDir = resolveLogsDir();
  if (!existsSync(logsDir)) return [];
  const entries = readdirSync(logsDir);

  const today = new Date();
  const threshold = new Date(today.getTime() - Math.max(1, days) * 24 * 60 * 60 * 1000);

  const files = entries
    .filter((name) => /^request-trace-\d{4}-\d{2}-\d{2}\.jsonl$/.test(name))
    .map((name) => {
      const datePart = name.replace('request-trace-', '').replace('.jsonl', '');
      const date = new Date(`${datePart}T00:00:00.000Z`);
      return { name, date };
    })
    .filter((entry) => Number.isFinite(entry.date.getTime()) && entry.date >= threshold)
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .map((entry) => join(logsDir, entry.name));

  return files;
}

function formatNumber(n: number): string {
  return Intl.NumberFormat('en-US').format(Math.round(n));
}

function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export async function registerDashboardCommand(program: Command): Promise<void> {
  program
    .command('dashboard')
    .description('Show token/cost hotspots from request traces')
    .option('--days <days>', 'How many recent days to include', '7')
    .option('--top <top>', 'Top N rows per table', '10')
    .action(async (options) => {
      const days = Math.max(1, Number(options.days || 7));
      const top = Math.max(1, Number(options.top || 10));

      const files = listTraceFiles(days);
      if (files.length === 0) {
        console.log(chalk.yellow('No request trace files found.'));
        console.log(chalk.dim(`Expected location: ${resolveLogsDir()}`));
        return;
      }

      const traces = files.flatMap((file) => parseJsonLines(file));
      if (traces.length === 0) {
        console.log(chalk.yellow('Trace files found but no valid records.'));
        return;
      }

      const agentAgg = new Map<string, { input: number; output: number; calls: number }>();
      const toolAgg = new Map<string, { raw: number; compact: number; calls: number }>();

      let totalInput = 0;
      let totalOutput = 0;
      let totalLatency = 0;
      let totalDelegations = 0;
      let totalReviews = 0;

      for (const trace of traces) {
        totalInput += trace.totalInputTokens || 0;
        totalOutput += trace.totalOutputTokens || 0;
        totalLatency += trace.totalLatencyMs || 0;
        totalDelegations += trace.numberOfDelegations || 0;
        totalReviews += trace.numberOfReviewPasses || 0;

        for (const row of trace.perAgentUsage || []) {
          const prev = agentAgg.get(row.agent) || { input: 0, output: 0, calls: 0 };
          prev.input += row.inputTokens || 0;
          prev.output += row.outputTokens || 0;
          prev.calls += 1;
          agentAgg.set(row.agent, prev);
        }

        for (const tool of trace.toolCalls || []) {
          const prev = toolAgg.get(tool.tool) || { raw: 0, compact: 0, calls: 0 };
          prev.raw += tool.rawSize || 0;
          prev.compact += tool.compactSize || 0;
          prev.calls += 1;
          toolAgg.set(tool.tool, prev);
        }
      }

      const agentRows = Array.from(agentAgg.entries())
        .map(([agent, stat]) => ({
          agent,
          total: stat.input + stat.output,
          input: stat.input,
          output: stat.output,
          calls: stat.calls,
        }))
        .sort((a, b) => b.total - a.total)
        .slice(0, top);

      const toolRows = Array.from(toolAgg.entries())
        .map(([tool, stat]) => ({
          tool,
          raw: stat.raw,
          compact: stat.compact,
          estimatedTokens: Math.max(0, Math.ceil(stat.compact / 4)),
          saved: Math.max(0, stat.raw - stat.compact),
          calls: stat.calls,
        }))
        .sort((a, b) => b.raw - a.raw)
        .slice(0, top);

      const toolBurnRows = Array.from(toolAgg.entries())
        .map(([tool, stat]) => ({
          tool,
          compact: stat.compact,
          estimatedTokens: Math.max(0, Math.ceil(stat.compact / 4)),
          calls: stat.calls,
        }))
        .sort((a, b) => b.compact - a.compact)
        .slice(0, top);

      const savingsRows = Array.from(toolAgg.entries())
        .map(([tool, stat]) => ({
          tool,
          saved: Math.max(0, stat.raw - stat.compact),
          ratio: stat.raw > 0 ? (stat.compact / stat.raw) : 1,
        }))
        .sort((a, b) => b.saved - a.saved)
        .slice(0, top);

      console.log(chalk.cyan('╔════════════════════════════════════════╗'));
      console.log(chalk.cyan('║       FoxFang Usage Dashboard          ║'));
      console.log(chalk.cyan('╚════════════════════════════════════════╝'));
      console.log();
      console.log(chalk.dim(`Window: last ${days} day(s)`));
      console.log(chalk.dim(`Files: ${files.length} | Records: ${traces.length}`));
      console.log();

      console.log(chalk.cyan('Totals'));
      console.log(`  Input tokens:  ${formatNumber(totalInput)}`);
      console.log(`  Output tokens: ${formatNumber(totalOutput)}`);
      console.log(`  Avg latency:   ${formatMs(totalLatency / traces.length)}`);
      console.log(`  Delegations:   ${formatNumber(totalDelegations)}`);
      console.log(`  Review passes: ${formatNumber(totalReviews)}`);
      console.log();

      console.log(chalk.cyan(`Top Agents by Tokens (top ${top})`));
      for (const row of agentRows) {
        console.log(
          `  ${row.agent.padEnd(20)} total=${formatNumber(row.total).padStart(9)} `
          + `in=${formatNumber(row.input).padStart(8)} `
          + `out=${formatNumber(row.output).padStart(8)} `
          + `calls=${formatNumber(row.calls).padStart(5)}`,
        );
      }
      console.log();

      console.log(chalk.cyan(`Top Tools by Raw Size (top ${top})`));
      for (const row of toolRows) {
        console.log(
          `  ${row.tool.padEnd(22)} raw=${formatNumber(row.raw).padStart(10)} `
          + `compact=${formatNumber(row.compact).padStart(10)} `
          + `estTok=${formatNumber(row.estimatedTokens).padStart(8)} `
          + `saved=${formatNumber(row.saved).padStart(10)} `
          + `calls=${formatNumber(row.calls).padStart(5)}`,
        );
      }
      console.log();

      console.log(chalk.cyan(`Top Tools by Estimated Token Burn (top ${top})`));
      for (const row of toolBurnRows) {
        console.log(
          `  ${row.tool.padEnd(22)} estTok=${formatNumber(row.estimatedTokens).padStart(10)} `
          + `compact=${formatNumber(row.compact).padStart(10)} `
          + `calls=${formatNumber(row.calls).padStart(5)}`,
        );
      }
      console.log();

      console.log(chalk.cyan(`Top Compaction Savings (top ${top})`));
      for (const row of savingsRows) {
        console.log(
          `  ${row.tool.padEnd(22)} saved=${formatNumber(row.saved).padStart(10)} `
          + `ratio=${(row.ratio * 100).toFixed(1).padStart(6)}%`,
        );
      }
      console.log();
    });
}
