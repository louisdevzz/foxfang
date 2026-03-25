/**
 * Personas Tool
 *
 * Fetch marketing personas from a URL and save to workspace PERSONAS.md.
 * The agent runtime automatically loads PERSONAS.md into system prompt context.
 *
 * Default source: https://marketing.reply.cash
 * Override via argument or config.
 */

import { Tool, ToolCategory } from '../traits';
import { existsSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const DEFAULT_PERSONAS_URL = 'https://marketing.reply.cash';

function getWorkspacePath(): string {
  return join(homedir(), '.foxfang');
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

/**
 * Personas Sync Tool
 * Fetches personas from a URL, extracts content, saves as PERSONAS.md
 */
export class PersonasSyncTool implements Tool {
  name = 'personas_sync';
  description = 'Fetch marketing personas from a URL and save to workspace PERSONAS.md. Personas guide content creation voice and style.';
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
    },
    required: [],
  };

  async execute(args: {
    url?: string;
    format?: 'html' | 'markdown';
  }): Promise<{ success: boolean; data?: any; error?: string }> {
    const url = args.url || DEFAULT_PERSONAS_URL;

    try {
      const response = await fetch(url, {
        headers: {
          'Accept': 'text/html, text/markdown, text/plain, application/json',
          'User-Agent': 'FoxFang/1.0',
        },
      });

      if (!response.ok) {
        return {
          success: false,
          error: `Failed to fetch personas: ${response.status} ${response.statusText}`,
        };
      }

      const contentType = response.headers.get('content-type') || '';
      const rawBody = await response.text();

      let content: string;
      const isHtml = args.format === 'html' || (!args.format && contentType.includes('text/html'));

      if (isHtml) {
        content = htmlToText(rawBody);
      } else {
        // Markdown or plain text — use as-is
        content = rawBody;
      }

      if (!content.trim()) {
        return { success: false, error: 'Fetched content is empty after processing.' };
      }

      // Build PERSONAS.md
      const personasContent = `# Marketing Personas

> Auto-synced from ${url}
> Last updated: ${new Date().toISOString()}

${content}
`;

      // Write to workspace
      const workspacePath = getWorkspacePath();
      if (!existsSync(workspacePath)) {
        mkdirSync(workspacePath, { recursive: true });
      }

      const filePath = join(workspacePath, 'PERSONAS.md');
      writeFileSync(filePath, personasContent, 'utf-8');

      return {
        success: true,
        data: {
          source: url,
          savedTo: filePath,
          contentLength: content.length,
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
