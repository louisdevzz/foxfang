/**
 * Personas Tool
 *
 * Fetch marketing personas from a URL and save to a scoped personas file.
 * Reply Cash personas should not be mixed with unrelated contexts.
 *
 * Default source: https://marketing.reply.cash
 * Override via argument or config.
 */

import { Tool, ToolCategory } from '../traits';
import { existsSync, writeFileSync, mkdirSync } from 'fs';
import { basename, join } from 'path';
import { homedir } from 'os';
import { fetchLinkContent } from '../../link-understanding/fetch';
import { storeMemory } from '../../memory/database';

const DEFAULT_PERSONAS_URL = 'https://marketing.reply.cash';

function getWorkspacePath(): string {
  return join(homedir(), '.foxfang', 'workspace', 'presets');
}

function resolveOutputFileName(args: { filename?: string; scope?: string }): string {
  const customFilename = String(args.filename || '').trim();
  if (customFilename) return basename(customFilename);

  const scope = String(args.scope || 'reply-cash').trim().toLowerCase();
  if (scope === 'reply-cash' || scope === 'replycash') {
    return 'PERSONAS_REPLY_CASH.md';
  }

  return 'AUDIENCE_PERSONAS.md';
}

function looksLikeHtml(content: string): boolean {
  return /<html[\s>]|<body[\s>]|<div[\s>]|<main[\s>]|<article[\s>]/i.test(content);
}

/**
 * Strip HTML tags and decode common entities for plain-text extraction.
 */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<h([1-6])[^>]*>/gi, (_m, level) => '#'.repeat(Number(level)) + ' ')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeExtractedContent(content: string): string {
  const input = content.replace(/\r\n/g, '\n');
  const lines = input.split('\n');
  const cleaned: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.replace(/\t/g, ' ').replace(/[ \u00A0]+/g, ' ').trim();
    if (!line) {
      cleaned.push('');
      continue;
    }
    if (/^[-*•]\s*$/.test(line)) continue;
    if (line.includes('<!--') || line.includes('-->')) continue;
    if (!/[\p{L}\p{N}]/u.test(line)) continue;
    cleaned.push(line);
  }

  const compacted: string[] = [];
  let prevBlank = false;
  let prevLine = '';

  for (const line of cleaned) {
    if (!line) {
      if (!prevBlank) compacted.push('');
      prevBlank = true;
      continue;
    }

    if (line === prevLine && line.length < 40) continue;
    compacted.push(line);
    prevBlank = false;
    prevLine = line;
  }

  return compacted.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function isLowSignalPersonaContent(content: string): boolean {
  const lines = content.split('\n').map((line) => line.trim()).filter(Boolean);
  if (content.length < 250 && lines.length <= 8) return true;

  const suspiciousMarkers = [
    'unsupported for link rel=preload',
    'gptengineer.js',
    'modulepreload',
    'reply.cash - send stablecoins locally',
  ];
  const markerHits = suspiciousMarkers.filter((marker) => content.toLowerCase().includes(marker)).length;
  if (content.length < 600 && markerHits >= 1) return true;

  return false;
}

/**
 * Personas Sync Tool
 * Fetches personas from a URL, extracts content, saves as a scoped personas markdown file.
 */
export class PersonasSyncTool implements Tool {
  name = 'personas_sync';
  description = 'Fetch personas from a URL (Firecrawl-first, native fallback), save to scoped workspace personas file, and store a memory snapshot.';
  category = ToolCategory.EXTERNAL;
  parameters = {
    type: 'object' as const,
    properties: {
      url: {
        type: 'string',
        description: `URL to fetch personas from (default: ${DEFAULT_PERSONAS_URL})`,
      },
      format: {
        type: 'string',
        description: 'Expected content format: "html" (auto-convert) or "markdown" (save as-is). Default: auto-detect.',
      },
      scope: {
        type: 'string',
        description: 'Personas scope: "reply-cash" (default) or "generic".',
      },
      filename: {
        type: 'string',
        description: 'Optional output filename (overrides scope default).',
      },
      writeMemory: {
        type: 'boolean',
        description: 'Store synced personas snapshot into memory DB (default: true).',
      },
    },
    required: [],
  };

  async execute(args: {
    url?: string;
    format?: 'html' | 'markdown';
    scope?: 'reply-cash' | 'generic' | string;
    filename?: string;
    writeMemory?: boolean;
  }): Promise<{ success: boolean; data?: any; error?: string }> {
    const url = args.url || DEFAULT_PERSONAS_URL;

    try {
      let content = '';
      let sourceTitle = '';
      let extractionMode = 'fetch_link_content';

      const fetched = await fetchLinkContent(url);
      if (!fetched.error && fetched.content?.trim()) {
        sourceTitle = fetched.title || '';
        content = fetched.content;
        extractionMode = fetched.source || extractionMode;
      } else {
        extractionMode = 'direct_fetch_fallback';
        const response = await fetch(url, {
          headers: {
            'Accept': 'text/html, text/markdown, text/plain, application/json',
            'User-Agent': 'FoxFang/1.0',
          },
        });

        if (!response.ok) {
          return {
            success: false,
            error: `Failed to fetch personas: ${response.status} ${response.statusText}${fetched.error ? ` | fetchLinkContent: ${fetched.error}` : ''}`,
          };
        }

        const contentType = response.headers.get('content-type') || '';
        const rawBody = await response.text();
        const shouldParseHtml =
          args.format === 'html' ||
          (!args.format && (contentType.includes('text/html') || looksLikeHtml(rawBody)));

        content = shouldParseHtml ? htmlToText(rawBody) : rawBody;
      }

      if (args.format === 'html' && looksLikeHtml(content)) {
        content = htmlToText(content);
      }

      content = normalizeExtractedContent(content);

      if (!content.trim()) {
        return { success: false, error: 'Fetched content is empty after processing.' };
      }
      if (isLowSignalPersonaContent(content)) {
        return {
          success: false,
          error: extractionMode === 'native' || extractionMode === 'direct_fetch_fallback'
            ? 'Extracted content looks like a client-rendered shell (very low signal). Firecrawl scrape is required for this URL.'
            : 'Extracted personas content is too low-signal. Please verify source URL or scrape settings.',
        };
      }

      const outputFile = resolveOutputFileName(args);

      // Build personas markdown
      const personasContent = `# Marketing Personas

> Auto-synced from ${url}
> Last updated: ${new Date().toISOString()}
> Scope: ${String(args.scope || 'reply-cash')}
> File: ${outputFile}

${content}
`;

      // Write to workspace
      const workspacePath = getWorkspacePath();
      if (!existsSync(workspacePath)) {
        mkdirSync(workspacePath, { recursive: true });
      }

      const filePath = join(workspacePath, outputFile);
      writeFileSync(filePath, personasContent, 'utf-8');

      const shouldWriteMemory = args.writeMemory !== false;
      let memoryId: number | null = null;
      let memoryError: string | null = null;

      if (shouldWriteMemory) {
        try {
          const memoryScope = String(args.scope || 'reply-cash').trim().toLowerCase() || 'reply-cash';
          const memoryPayload = [
            `personas_scope: ${memoryScope}`,
            `source: ${url}`,
            `saved_file: ${outputFile}`,
            `saved_at: ${new Date().toISOString()}`,
            '',
            content.slice(0, 12000),
          ].join('\n');

          memoryId = storeMemory(memoryPayload, 'fact', {
            importance: 7,
            metadata: {
              source: url,
              scope: memoryScope,
              file: outputFile,
              extractionMode,
            },
          });
        } catch (error) {
          memoryError = error instanceof Error ? error.message : String(error);
        }
      }

      return {
        success: true,
        data: {
          source: url,
          title: sourceTitle || undefined,
          savedTo: filePath,
          contentLength: content.length,
          extractionMode,
          memoryStored: shouldWriteMemory ? memoryId !== null : false,
          memoryId: memoryId || undefined,
          memoryError: memoryError || undefined,
          preview: content.slice(0, 500) + (content.length > 500 ? '...' : ''),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to sync personas',
      };
    }
  }
}
