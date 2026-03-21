import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { isAbsolute, join } from 'path';
import { resolveFoxFangHome } from '../config/defaults';

type CachedItem = {
  ref: string;
  source: string;
  raw: string;
  createdAt: number;
  artifactPath?: string;
};

type ToolCacheConfigShape = {
  agentRuntime?: {
    toolCacheTtlMs?: number;
  };
};

const CACHE = new Map<string, CachedItem>();
const MAX_CACHE_ITEMS = 300;
const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function resolveHomeBasedFoxFangDir(): string {
  const configured = (resolveFoxFangHome() || '').trim();
  if (!configured) {
    return join(homedir(), '.foxfang');
  }
  if (isAbsolute(configured)) {
    return configured;
  }
  // Prevent writing cache artifacts into project-relative paths like ./ .foxfang
  return join(homedir(), configured);
}

function getCacheDir(): string {
  const candidates = [
    join(resolveHomeBasedFoxFangDir(), 'artifacts', 'tool-results'),
    join(homedir(), '.foxfang', 'artifacts', 'tool-results'),
  ];

  for (const base of candidates) {
    try {
      if (!existsSync(base)) {
        mkdirSync(base, { recursive: true });
      }
      return base;
    } catch {
      // Try next candidate when filesystem permissions deny this location.
    }
  }

  throw new Error('Unable to create a writable tool-result cache directory.');
}

function getCacheTTLms(): number {
  const configCandidates = [
    join(resolveHomeBasedFoxFangDir(), 'foxfang.json'),
    join(homedir(), '.foxfang', 'foxfang.json'),
  ];

  for (const configFile of configCandidates) {
    if (!existsSync(configFile)) continue;
    try {
      const parsed = JSON.parse(readFileSync(configFile, 'utf-8')) as ToolCacheConfigShape;
      const fromConfig = Number(parsed?.agentRuntime?.toolCacheTtlMs);
      if (Number.isFinite(fromConfig) && fromConfig > 0) {
        return Math.floor(fromConfig);
      }
    } catch {
      // Try next config file candidate
    }
  }
  return DEFAULT_CACHE_TTL_MS;
}

function cacheFilePath(rawRef: string): string | null {
  try {
    return join(getCacheDir(), `${rawRef}.json`);
  } catch {
    return null;
  }
}

function isExpired(createdAt: number, ttlMs: number): boolean {
  return Date.now() - createdAt > ttlMs;
}

function removeCacheFile(rawRef: string): void {
  const file = cacheFilePath(rawRef);
  if (!file) return;
  try {
    unlinkSync(file);
  } catch {
    // Ignore cleanup errors
  }
}

function saveCacheFile(item: CachedItem): void {
  if (!item.artifactPath) return;
  writeFileSync(item.artifactPath, JSON.stringify(item), 'utf-8');
}

function loadCacheFile(rawRef: string): CachedItem | null {
  const file = cacheFilePath(rawRef);
  if (!file) return null;
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as CachedItem;
    if (!parsed || typeof parsed.raw !== 'string' || typeof parsed.createdAt !== 'number') {
      return null;
    }
    return {
      ...parsed,
      artifactPath: file,
    };
  } catch {
    return null;
  }
}

function pruneExpiredDiskItems(ttlMs: number): void {
  let dir = '';
  try {
    dir = getCacheDir();
  } catch {
    return;
  }
  const entries = readdirSync(dir);
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const file = join(dir, entry);
    try {
      const stats = statSync(file);
      if (isExpired(stats.mtimeMs, ttlMs)) {
        unlinkSync(file);
      }
    } catch {
      // Ignore invalid files
    }
  }
}

function pruneCache() {
  if (CACHE.size <= MAX_CACHE_ITEMS) return;
  const sorted = Array.from(CACHE.values()).sort((a, b) => a.createdAt - b.createdAt);
  const toDelete = sorted.slice(0, CACHE.size - MAX_CACHE_ITEMS);
  for (const item of toDelete) {
    CACHE.delete(item.ref);
    removeCacheFile(item.ref);
  }
}

function safeStringify(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function cacheToolResult(source: string, raw: unknown): { rawRef: string; rawSize: number } {
  const ttlMs = getCacheTTLms();
  pruneExpiredDiskItems(ttlMs);

  const payload = safeStringify(raw);
  const rawRef = `raw_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const item: CachedItem = {
    ref: rawRef,
    source,
    raw: payload,
    createdAt: Date.now(),
    artifactPath: cacheFilePath(rawRef) || undefined,
  };
  CACHE.set(rawRef, item);
  saveCacheFile(item);
  pruneCache();
  return {
    rawRef,
    rawSize: payload.length,
  };
}

export function expandCachedResult(rawRef: string, maxChars = 8000): { found: boolean; source?: string; content?: string } {
  const ttlMs = getCacheTTLms();
  let entry = CACHE.get(rawRef);
  if (!entry) {
    const diskEntry = loadCacheFile(rawRef);
    if (diskEntry) {
      entry = diskEntry;
      CACHE.set(rawRef, diskEntry);
    }
  }
  if (!entry) return { found: false };
  if (isExpired(entry.createdAt, ttlMs)) {
    CACHE.delete(rawRef);
    removeCacheFile(rawRef);
    return { found: false };
  }
  return {
    found: true,
    source: entry.source,
    content: entry.raw.slice(0, Math.max(1, maxChars)),
  };
}

export function getCachedSnippet(rawRef: string, start = 0, length = 800): { found: boolean; source?: string; snippet?: string } {
  const ttlMs = getCacheTTLms();
  let entry = CACHE.get(rawRef);
  if (!entry) {
    const diskEntry = loadCacheFile(rawRef);
    if (diskEntry) {
      entry = diskEntry;
      CACHE.set(rawRef, diskEntry);
    }
  }
  if (!entry) return { found: false };
  if (isExpired(entry.createdAt, ttlMs)) {
    CACHE.delete(rawRef);
    removeCacheFile(rawRef);
    return { found: false };
  }

  const safeStart = Math.max(0, Math.floor(start));
  const safeLength = Math.max(1, Math.floor(length));
  return {
    found: true,
    source: entry.source,
    snippet: entry.raw.slice(safeStart, safeStart + safeLength),
  };
}
