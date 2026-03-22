/**
 * Memory Tools
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, resolve, sep } from 'path';
import { Tool, ToolCategory } from '../traits';
import { listRecentMemories, searchMemories, storeMemory } from '../../memory/database';
import { resolveFoxFangHome } from '../../config/defaults';

export class MemoryStoreTool implements Tool {
  name = 'memory_store';
  description = 'Store information in memory';
  category = ToolCategory.DATA;
  parameters = {
    type: 'object' as const,
    properties: {
      key: { type: 'string', description: 'Memory key' },
      value: { type: 'string', description: 'Memory value' },
    },
    required: ['key', 'value'],
  };

  async execute(args: { key: string; value: string }): Promise<{ success: boolean; data?: any }> {
    const content = `${args.key}: ${args.value}`;
    const id = storeMemory(content, 'fact', { importance: 6 });
    return { success: true, data: { id, key: args.key } };
  }
}

export class MemoryRecallTool implements Tool {
  name = 'memory_recall';
  description = 'Recall information from memory';
  category = ToolCategory.DATA;
  parameters = {
    type: 'object' as const,
    properties: {
      key: { type: 'string', description: 'Memory key' },
    },
    required: ['key'],
  };

  async execute(args: { key: string }): Promise<{ found: boolean; value?: string; data?: any }> {
    const hits = searchMemories(args.key, 4);
    if (hits.length === 0) {
      return { found: false };
    }
    return {
      found: true,
      value: hits[0].content,
      data: {
        key: args.key,
        matches: hits.map((hit) => ({
          id: hit.id,
          category: hit.category,
          content: hit.content,
          importance: hit.importance,
        })),
      },
    };
  }
}

type MemorySearchHit = {
  sourceType: 'workspace' | 'database';
  path: string;
  lineStart: number;
  lineEnd: number;
  score: number;
  lexicalScore: number;
  semanticScore: number;
  recencyScore: number;
  importanceScore: number;
  snippet: string;
  source: string;
};

type MemoryFileEntry = {
  path: string;
  mtimeMs: number;
};

type QueryProfile = {
  normalizedQuery: string;
  expandedTerms: string[];
  queryTokenSet: Set<string>;
  queryTrigrams: Set<string>;
};

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'from', 'into', 'about', 'have', 'your',
  'you', 'are', 'was', 'were', 'will', 'can', 'should', 'need', 'not', 'but', 'all', 'any',
  'cua', 'va', 'cho', 'voi', 'nay', 'kia', 'ban', 'toi', 'la', 'mot', 'nhung', 'neu', 'roi',
  'khi', 'duoc', 'trong', 'ngoai', 'them', 'len', 'xuong',
]);

const SEMANTIC_ALIASES: Record<string, string[]> = {
  launch: ['release', 'go live', 'ra mat'],
  audience: ['customer', 'customers', 'client', 'persona', 'khach hang'],
  brand: ['voice', 'tone', 'positioning', 'thuong hieu'],
  campaign: ['plan', 'strategy', 'chien dich'],
  optimize: ['improve', 'enhance', 'toi uu'],
  review: ['audit', 'analyze', 'assessment', 'danh gia', 'phan tich'],
  content: ['copy', 'post', 'caption', 'bai viet', 'noi dung'],
  seo: ['ranking', 'keyword', 'organic', 'xep hang', 'tu khoa'],
};

function workspaceRoot(): string {
  return join(resolveFoxFangHome(), 'workspace');
}

function isWithin(base: string, target: string): boolean {
  const rel = relative(base, target);
  return !rel.startsWith('..') && !rel.includes(`${sep}..${sep}`);
}

function isAllowedMemoryFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  const base = normalized.split('/').pop() || '';
  if (base === 'MEMORY.md' || base === 'memory.md') return true;
  return normalized.includes('/memory/') && normalized.toLowerCase().endsWith('.md');
}

function stripDiacritics(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalizeSemanticText(value: string): string {
  return stripDiacritics(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeSemantic(value: string): string[] {
  return normalizeSemanticText(value)
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2 && !STOP_WORDS.has(term));
}

function expandTerms(baseTerms: string[]): string[] {
  const expanded = new Set<string>();
  for (const term of baseTerms) {
    expanded.add(term);
    if (term.endsWith('s') && term.length > 3) expanded.add(term.slice(0, -1));
    if (term.endsWith('ing') && term.length > 5) expanded.add(term.slice(0, -3));
    if (term.endsWith('ed') && term.length > 4) expanded.add(term.slice(0, -2));
    const aliases = SEMANTIC_ALIASES[term];
    if (aliases) {
      for (const alias of aliases) {
        const normalizedAlias = normalizeSemanticText(alias);
        if (normalizedAlias) expanded.add(normalizedAlias);
      }
    }
  }
  return Array.from(expanded).slice(0, 36);
}

function makeTrigrams(value: string): Set<string> {
  const normalized = normalizeSemanticText(value).replace(/\s+/g, ' ');
  const compact = normalized.length > 260 ? normalized.slice(0, 260) : normalized;
  if (compact.length < 3) return new Set(compact ? [compact] : []);
  const out = new Set<string>();
  for (let i = 0; i <= compact.length - 3; i += 1) {
    out.add(compact.slice(i, i + 3));
  }
  return out;
}

function diceCoefficient(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const item of a) {
    if (b.has(item)) overlap += 1;
  }
  return (2 * overlap) / (a.size + b.size);
}

function queryProfile(query: string): QueryProfile {
  const normalizedQuery = normalizeSemanticText(query);
  const queryTokens = tokenizeSemantic(query);
  return {
    normalizedQuery,
    expandedTerms: expandTerms(queryTokens),
    queryTokenSet: new Set(queryTokens),
    queryTrigrams: makeTrigrams(query),
  };
}

function lexicalMatchScore(text: string, expandedTerms: string[]): number {
  const normalized = normalizeSemanticText(text);
  if (!normalized) return 0;
  let raw = 0;
  for (const term of expandedTerms) {
    if (!term) continue;
    if (normalized.includes(term)) raw += term.includes(' ') ? 1.6 : 1;
  }
  const denominator = Math.max(2, expandedTerms.length * 0.45);
  return Math.min(1, raw / denominator);
}

function tokenOverlapScore(text: string, queryTokens: Set<string>): number {
  const tokens = new Set(tokenizeSemantic(text));
  if (tokens.size === 0 || queryTokens.size === 0) return 0;
  let overlap = 0;
  for (const token of queryTokens) {
    if (tokens.has(token)) overlap += 1;
  }
  return overlap / Math.sqrt(tokens.size * queryTokens.size);
}

function semanticSimilarityScore(text: string, profile: QueryProfile): number {
  const phraseBoost = normalizeSemanticText(text).includes(profile.normalizedQuery) ? 0.15 : 0;
  const overlap = tokenOverlapScore(text, profile.queryTokenSet);
  const trigram = diceCoefficient(makeTrigrams(text), profile.queryTrigrams);
  return Math.min(1, overlap * 0.65 + trigram * 0.35 + phraseBoost);
}

function recencyScore(timestampMs?: number): number {
  if (!timestampMs || Number.isNaN(timestampMs)) return 0.35;
  const ageMs = Math.max(0, Date.now() - timestampMs);
  const ageDays = ageMs / (24 * 60 * 60 * 1000);
  return 1 / (1 + ageDays / 30);
}

function parseTimestamp(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return undefined;
}

function scoreCandidate(params: {
  text: string;
  profile: QueryProfile;
  timestampMs?: number;
  importance?: number;
}): {
  finalScore: number;
  lexicalScore: number;
  semanticScore: number;
  recencyScore: number;
  importanceScore: number;
} {
  const lexicalScore = lexicalMatchScore(params.text, params.profile.expandedTerms);
  const semanticScore = semanticSimilarityScore(params.text, params.profile);
  const recency = recencyScore(params.timestampMs);
  const importanceScore = Math.min(1, Math.max(0, (params.importance || 5) / 10));
  const finalScore = (
    lexicalScore * 0.35
    + semanticScore * 0.45
    + recency * 0.1
    + importanceScore * 0.1
  );
  return {
    finalScore,
    lexicalScore,
    semanticScore,
    recencyScore: recency,
    importanceScore,
  };
}

function listMemoryFiles(rootDir: string, maxFiles = 200): MemoryFileEntry[] {
  if (!existsSync(rootDir)) return [];

  const files: MemoryFileEntry[] = [];
  const stack = [rootDir];

  while (stack.length > 0 && files.length < maxFiles) {
    const dir = stack.pop() as string;
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }

    for (const name of entries) {
      const fullPath = join(dir, name);
      let stats;
      try {
        stats = statSync(fullPath);
      } catch {
        continue;
      }
      if (stats.isDirectory()) {
        if (name === 'node_modules' || name === '.git') continue;
        stack.push(fullPath);
        continue;
      }
      if (!stats.isFile()) continue;
      if (isAllowedMemoryFile(fullPath)) {
        files.push({
          path: fullPath,
          mtimeMs: stats.mtimeMs || Date.now(),
        });
        if (files.length >= maxFiles) break;
      }
    }
  }

  return files;
}

function snippetFromLines(lines: string[], hitIndex: number): { lineStart: number; lineEnd: number; snippet: string } {
  const start = Math.max(0, hitIndex - 2);
  const end = Math.min(lines.length - 1, hitIndex + 2);
  const snippet = lines.slice(start, end + 1).join('\n').trim();
  return {
    lineStart: start + 1,
    lineEnd: end + 1,
    snippet,
  };
}

function searchWorkspaceMemory(query: string, limit: number): MemorySearchHit[] {
  const root = workspaceRoot();
  const profile = queryProfile(query);
  if (!profile.normalizedQuery) return [];

  const files = listMemoryFiles(root);
  const hits: MemorySearchHit[] = [];

  for (const fileEntry of files) {
    let content = '';
    try {
      content = readFileSync(fileEntry.path, 'utf-8');
    } catch {
      continue;
    }
    const lines = content.split(/\r?\n/);
    for (let idx = 0; idx < lines.length; idx += 1) {
      const line = lines[idx];
      if (!line || line.trim().length < 2) continue;
      const snippet = snippetFromLines(lines, idx);
      const score = scoreCandidate({
        text: snippet.snippet,
        profile,
        timestampMs: fileEntry.mtimeMs,
        importance: 5,
      });
      if (score.lexicalScore <= 0 && score.semanticScore < 0.2) continue;
      if (score.finalScore < 0.18) continue;

      const sourcePath = relative(root, fileEntry.path).replace(/\\/g, '/');
      const displayPath = sourcePath || fileEntry.path;
      hits.push({
        sourceType: 'workspace',
        path: displayPath,
        lineStart: snippet.lineStart,
        lineEnd: snippet.lineEnd,
        score: score.finalScore,
        lexicalScore: score.lexicalScore,
        semanticScore: score.semanticScore,
        recencyScore: score.recencyScore,
        importanceScore: score.importanceScore,
        snippet: snippet.snippet,
        source: `${displayPath}#L${snippet.lineStart}-L${snippet.lineEnd}`,
      });
    }
  }

  const deduped = new Map<string, MemorySearchHit>();
  for (const hit of hits.sort((a, b) => b.score - a.score)) {
    if (!deduped.has(hit.source)) {
      deduped.set(hit.source, hit);
    }
    if (deduped.size >= Math.max(1, limit)) break;
  }
  return Array.from(deduped.values());
}

function searchDatabaseMemory(query: string, limit: number): MemorySearchHit[] {
  const profile = queryProfile(query);
  if (!profile.normalizedQuery) return [];

  const candidateRows = [
    ...searchMemories(query, Math.max(12, limit * 3)),
    ...listRecentMemories(Math.max(20, limit * 4)),
  ];

  const dedup = new Map<number, any>();
  for (const row of candidateRows) {
    const id = Number((row as any).id);
    if (!Number.isFinite(id)) continue;
    if (!dedup.has(id)) dedup.set(id, row);
  }

  const hits: MemorySearchHit[] = [];
  for (const row of dedup.values()) {
    const content = String((row as any).content || '').trim();
    if (!content) continue;

    const score = scoreCandidate({
      text: content,
      profile,
      timestampMs: parseTimestamp((row as any).createdAt ?? (row as any).created_at),
      importance: Number((row as any).importance || 5),
    });
    if (score.lexicalScore <= 0 && score.semanticScore < 0.2) continue;
    if (score.finalScore < 0.16) continue;

    const id = Number((row as any).id);
    const snippet = content.length > 420 ? `${content.slice(0, 420)}...` : content;
    hits.push({
      sourceType: 'database',
      path: `memories/${id}`,
      lineStart: 1,
      lineEnd: 1,
      score: score.finalScore,
      lexicalScore: score.lexicalScore,
      semanticScore: score.semanticScore,
      recencyScore: score.recencyScore,
      importanceScore: score.importanceScore,
      snippet,
      source: `memories#id=${id}`,
    });
  }

  return hits
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, limit));
}

function searchHybridMemory(query: string, limit: number): MemorySearchHit[] {
  const expandedLimit = Math.max(10, limit * 4);
  const merged = [
    ...searchWorkspaceMemory(query, expandedLimit),
    ...searchDatabaseMemory(query, expandedLimit),
  ];

  const dedup = new Map<string, MemorySearchHit>();
  for (const hit of merged.sort((a, b) => b.score - a.score)) {
    if (!dedup.has(hit.source)) {
      dedup.set(hit.source, hit);
    }
    if (dedup.size >= Math.max(1, limit)) break;
  }
  return Array.from(dedup.values());
}

function resolveMemoryPath(inputPath: string): string | null {
  const root = workspaceRoot();
  const resolved = resolve(root, inputPath);
  if (!isWithin(root, resolved)) return null;
  if (!isAllowedMemoryFile(resolved)) return null;
  return resolved;
}

export class MemorySearchTool implements Tool {
  name = 'memory_search';
  description = 'Hybrid search over MEMORY.md, memory/*.md, and DB memories with source citations';
  category = ToolCategory.DATA;
  parameters = {
    type: 'object' as const,
    properties: {
      query: { type: 'string', description: 'Search query for memory recall' },
      limit: { type: 'number', description: 'Maximum number of snippets to return (default 5)' },
    },
    required: ['query'],
  };

  async execute(args: { query: string; limit?: number }): Promise<{ success: boolean; output?: string; data?: any; error?: string }> {
    const query = (args.query || '').trim();
    if (!query) {
      return { success: false, error: 'query is required' };
    }
    const limit = Math.max(1, Math.min(20, Number(args.limit || 5)));
    const hits = searchHybridMemory(query, limit);

    return {
      success: true,
      output: hits.length === 0 ? 'No memory snippets found.' : `Found ${hits.length} memory snippet(s).`,
      data: {
        query,
        count: hits.length,
        snippets: hits.map((hit) => ({
          sourceType: hit.sourceType,
          source: hit.source,
          path: hit.path,
          lineStart: hit.lineStart,
          lineEnd: hit.lineEnd,
          score: Number(hit.score.toFixed(4)),
          lexicalScore: Number(hit.lexicalScore.toFixed(4)),
          semanticScore: Number(hit.semanticScore.toFixed(4)),
          recencyScore: Number(hit.recencyScore.toFixed(4)),
          importanceScore: Number(hit.importanceScore.toFixed(4)),
          snippet: hit.snippet,
        })),
      },
    };
  }
}

export class MemoryGetTool implements Tool {
  name = 'memory_get';
  description = 'Read a memory file with optional line range (MEMORY.md or memory/*.md)';
  category = ToolCategory.DATA;
  parameters = {
    type: 'object' as const,
    properties: {
      path: { type: 'string', description: 'Workspace-relative path to memory file' },
      startLine: { type: 'number', description: '1-based starting line number' },
      lineCount: { type: 'number', description: 'How many lines to read (default 120)' },
    },
    required: ['path'],
  };

  async execute(args: { path: string; startLine?: number; lineCount?: number }): Promise<{ success: boolean; output?: string; data?: any; error?: string }> {
    const requestedPath = (args.path || '').trim();
    if (!requestedPath) return { success: false, error: 'path is required' };

    const resolved = resolveMemoryPath(requestedPath);
    if (!resolved) {
      return { success: false, error: 'Invalid memory path. Only MEMORY.md or memory/*.md are allowed.' };
    }
    if (!existsSync(resolved)) {
      return { success: true, output: 'Memory file not found.', data: { found: false, path: requestedPath } };
    }

    let content = '';
    try {
      content = readFileSync(resolved, 'utf-8');
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }

    const lines = content.split(/\r?\n/);
    const startLine = Math.max(1, Math.floor(Number(args.startLine || 1)));
    const lineCount = Math.max(1, Math.min(800, Math.floor(Number(args.lineCount || 120))));
    const startIdx = Math.min(lines.length, startLine - 1);
    const endIdxExclusive = Math.min(lines.length, startIdx + lineCount);
    const body = lines.slice(startIdx, endIdxExclusive).join('\n').trim();
    const root = workspaceRoot();
    const sourcePath = relative(root, resolved).replace(/\\/g, '/');

    return {
      success: true,
      output: body,
      data: {
        found: true,
        path: sourcePath || requestedPath,
        lineStart: startIdx + 1,
        lineEnd: endIdxExclusive,
        source: `${sourcePath || requestedPath}#L${startIdx + 1}-L${endIdxExclusive}`,
        content: body,
      },
    };
  }
}
