/**
 * Notion Tools
 *
 * Full CRUD integration with Notion workspace.
 * Requires NOTION_API_KEY in config.
 *
 * Features:
 * - notion_search: Search pages/databases in workspace
 * - notion_get_page: Read page content (blocks → markdown)
 * - notion_query_database: Query database with filters/sorts
 * - notion_create_page: Create new page in a database
 * - notion_update_page: Update page properties/content
 *
 * Setup: Add to ~/.foxfang/foxfang.json:
 * {
 *   "notion": {
 *     "apiKey": "secret_...",
 *     "defaultDatabaseId": "optional-database-id"
 *   }
 * }
 */

import { Tool, ToolCategory } from '../traits';
import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const NOTION_VERSION = '2022-06-28';
const NOTION_BASE_URL = 'https://api.notion.com/v1';

// ─── Config ──────────────────────────────────────────────────────────────

interface NotionToolConfig {
  apiKey?: string;
  defaultDatabaseId?: string;
}

function getNotionConfig(): NotionToolConfig {
  const configPath = join(homedir(), '.foxfang', 'foxfang.json');
  let config: any = {};

  try {
    config = JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch {
    // Config doesn't exist or is invalid
  }

  return {
    apiKey: config.notion?.apiKey || process.env.NOTION_API_KEY,
    defaultDatabaseId: config.notion?.defaultDatabaseId,
  };
}

function notionHeaders(apiKey: string): Record<string, string> {
  return {
    'Authorization': `Bearer ${apiKey}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
}

function requireApiKey(): { apiKey: string } | { error: string } {
  const config = getNotionConfig();
  if (!config.apiKey) {
    return {
      error: 'Notion API key not configured. Add to ~/.foxfang/foxfang.json: {"notion": {"apiKey": "secret_..."}} or set NOTION_API_KEY env var.',
    };
  }
  return { apiKey: config.apiKey };
}

// ─── Block → Markdown Conversion ─────────────────────────────────────────

function richTextToMarkdown(richText: any[]): string {
  if (!Array.isArray(richText)) return '';
  return richText.map(rt => {
    let text = rt.plain_text || '';
    if (rt.annotations?.bold) text = `**${text}**`;
    if (rt.annotations?.italic) text = `*${text}*`;
    if (rt.annotations?.strikethrough) text = `~~${text}~~`;
    if (rt.annotations?.code) text = `\`${text}\``;
    if (rt.href) text = `[${text}](${rt.href})`;
    return text;
  }).join('');
}

function blockToMarkdown(block: any): string {
  const type = block.type;
  if (!type) return '';

  const content = block[type];
  if (!content) return '';

  switch (type) {
    case 'paragraph':
      return richTextToMarkdown(content.rich_text);
    case 'heading_1':
      return `# ${richTextToMarkdown(content.rich_text)}`;
    case 'heading_2':
      return `## ${richTextToMarkdown(content.rich_text)}`;
    case 'heading_3':
      return `### ${richTextToMarkdown(content.rich_text)}`;
    case 'bulleted_list_item':
      return `- ${richTextToMarkdown(content.rich_text)}`;
    case 'numbered_list_item':
      return `1. ${richTextToMarkdown(content.rich_text)}`;
    case 'to_do':
      return `- [${content.checked ? 'x' : ' '}] ${richTextToMarkdown(content.rich_text)}`;
    case 'toggle':
      return `> ${richTextToMarkdown(content.rich_text)}`;
    case 'quote':
      return `> ${richTextToMarkdown(content.rich_text)}`;
    case 'callout':
      return `> ${content.icon?.emoji || ''} ${richTextToMarkdown(content.rich_text)}`;
    case 'code':
      return `\`\`\`${content.language || ''}\n${richTextToMarkdown(content.rich_text)}\n\`\`\``;
    case 'divider':
      return '---';
    case 'image': {
      const url = content.file?.url || content.external?.url || '';
      const caption = content.caption ? richTextToMarkdown(content.caption) : '';
      return `![${caption}](${url})`;
    }
    case 'bookmark':
      return `[Bookmark: ${content.url}](${content.url})`;
    case 'link_preview':
      return `[Link: ${content.url}](${content.url})`;
    case 'table_row':
      return (content.cells || []).map((cell: any[]) => richTextToMarkdown(cell)).join(' | ');
    default:
      return `[${type} block]`;
  }
}

function blocksToMarkdown(blocks: any[]): string {
  return blocks.map(blockToMarkdown).filter(Boolean).join('\n\n');
}

function extractPageTitle(page: any): string {
  const properties = page.properties || {};
  for (const [, prop] of Object.entries(properties) as [string, any][]) {
    if (prop.type === 'title' && Array.isArray(prop.title)) {
      return richTextToMarkdown(prop.title);
    }
  }
  return 'Untitled';
}

function formatPageProperties(properties: any): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, prop] of Object.entries(properties) as [string, any][]) {
    switch (prop.type) {
      case 'title':
        result[key] = richTextToMarkdown(prop.title);
        break;
      case 'rich_text':
        result[key] = richTextToMarkdown(prop.rich_text);
        break;
      case 'number':
        result[key] = String(prop.number ?? '');
        break;
      case 'select':
        result[key] = prop.select?.name || '';
        break;
      case 'multi_select':
        result[key] = (prop.multi_select || []).map((s: any) => s.name).join(', ');
        break;
      case 'date':
        result[key] = prop.date?.start || '';
        if (prop.date?.end) result[key] += ` → ${prop.date.end}`;
        break;
      case 'checkbox':
        result[key] = prop.checkbox ? 'Yes' : 'No';
        break;
      case 'url':
        result[key] = prop.url || '';
        break;
      case 'email':
        result[key] = prop.email || '';
        break;
      case 'phone_number':
        result[key] = prop.phone_number || '';
        break;
      case 'status':
        result[key] = prop.status?.name || '';
        break;
      case 'people':
        result[key] = (prop.people || []).map((p: any) => p.name || p.id).join(', ');
        break;
      case 'relation':
        result[key] = `${(prop.relation || []).length} relation(s)`;
        break;
      case 'formula':
        result[key] = String(prop.formula?.string ?? prop.formula?.number ?? prop.formula?.boolean ?? '');
        break;
      case 'rollup':
        result[key] = String(prop.rollup?.number ?? prop.rollup?.array?.length ?? '');
        break;
      case 'created_time':
        result[key] = prop.created_time || '';
        break;
      case 'last_edited_time':
        result[key] = prop.last_edited_time || '';
        break;
      default:
        result[key] = `[${prop.type}]`;
    }
  }
  return result;
}

// ─── API Helpers ─────────────────────────────────────────────────────────

async function notionFetch(apiKey: string, path: string, options: {
  method?: string;
  body?: any;
} = {}): Promise<any> {
  const response = await fetch(`${NOTION_BASE_URL}${path}`, {
    method: options.method || 'GET',
    headers: notionHeaders(apiKey),
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Notion API error ${response.status}: ${errorText}`);
  }

  return response.json();
}

async function fetchAllBlocks(apiKey: string, blockId: string): Promise<any[]> {
  const blocks: any[] = [];
  let cursor: string | undefined;

  do {
    const params = cursor ? `?start_cursor=${cursor}` : '';
    const result = await notionFetch(apiKey, `/blocks/${blockId}/children${params}`);
    blocks.push(...(result.results || []));
    cursor = result.has_more ? result.next_cursor : undefined;
  } while (cursor);

  return blocks;
}

// ─── Tools ───────────────────────────────────────────────────────────────

/**
 * Search pages and databases in Notion workspace
 */
export class NotionSearchTool implements Tool {
  name = 'notion_search';
  description = 'Search pages and databases in your Notion workspace. Returns matching pages with titles and properties.';
  category = ToolCategory.EXTERNAL;
  parameters = {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description: 'Search query text',
      },
      filter: {
        type: 'string',
        description: 'Filter by object type: "page" or "database" (optional)',
      },
      limit: {
        type: 'number',
        description: 'Max results (default 10, max 100)',
      },
    },
    required: ['query'],
  };

  async execute(args: {
    query: string;
    filter?: 'page' | 'database';
    limit?: number;
  }): Promise<{ success: boolean; data?: any; error?: string }> {
    const auth = requireApiKey();
    if ('error' in auth) return { success: false, error: auth.error };

    try {
      const body: any = {
        query: args.query,
        page_size: Math.min(args.limit || 10, 100),
      };
      if (args.filter) {
        body.filter = { value: args.filter, property: 'object' };
      }

      const result = await notionFetch(auth.apiKey, '/search', {
        method: 'POST',
        body,
      });

      const items = (result.results || []).map((item: any) => ({
        id: item.id,
        type: item.object,
        title: extractPageTitle(item),
        url: item.url,
        lastEdited: item.last_edited_time,
        properties: item.properties ? formatPageProperties(item.properties) : undefined,
      }));

      return { success: true, data: { results: items, total: items.length } };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Notion search failed' };
    }
  }
}

/**
 * List all accessible databases in the Notion workspace
 */
export class NotionListDatabasesTool implements Tool {
  name = 'notion_list_databases';
  description = 'List all databases accessible to the integration. Returns database IDs, titles, and property schemas so you can query them later.';
  category = ToolCategory.EXTERNAL;
  parameters = {
    type: 'object' as const,
    properties: {
      limit: {
        type: 'number',
        description: 'Max results (default 20, max 100)',
      },
    },
    required: [],
  };

  async execute(args: {
    limit?: number;
  }): Promise<{ success: boolean; data?: any; error?: string }> {
    const auth = requireApiKey();
    if ('error' in auth) return { success: false, error: auth.error };

    try {
      // Search for all databases
      const result = await notionFetch(auth.apiKey, '/search', {
        method: 'POST',
        body: {
          filter: { value: 'database', property: 'object' },
          page_size: Math.min(args.limit || 20, 100),
        },
      });

      const databases = await Promise.all(
        (result.results || []).map(async (db: any) => {
          // Get database schema
          const schema = await notionFetch(auth.apiKey, `/databases/${db.id}`).catch(() => null);
          
          return {
            id: db.id,
            title: extractPageTitle(db),
            url: db.url,
            description: db.description?.[0]?.plain_text || '',
            properties: schema?.properties ? Object.keys(schema.properties) : [],
            propertyTypes: schema?.properties 
              ? Object.entries(schema.properties).map(([name, prop]: [string, any]) => ({
                  name,
                  type: prop.type,
                }))
              : [],
          };
        })
      );

      return { 
        success: true, 
        data: { 
          databases, 
          total: databases.length,
          hint: 'Use notion_query_database with one of these databaseIds to query content' 
        } 
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to list databases' };
    }
  }
}

/**
 * Get page content (properties + blocks as markdown)
 */
export class NotionGetPageTool implements Tool {
  name = 'notion_get_page';
  description = 'Read a Notion page content. Returns page properties and content blocks converted to markdown.';
  category = ToolCategory.EXTERNAL;
  parameters = {
    type: 'object' as const,
    properties: {
      pageId: {
        type: 'string',
        description: 'Notion page ID (UUID format, with or without dashes)',
      },
    },
    required: ['pageId'],
  };

  async execute(args: {
    pageId: string;
  }): Promise<{ success: boolean; data?: any; error?: string }> {
    const auth = requireApiKey();
    if ('error' in auth) return { success: false, error: auth.error };

    try {
      const [page, blocks] = await Promise.all([
        notionFetch(auth.apiKey, `/pages/${args.pageId}`),
        fetchAllBlocks(auth.apiKey, args.pageId),
      ]);

      const title = extractPageTitle(page);
      const properties = formatPageProperties(page.properties || {});
      const markdown = blocksToMarkdown(blocks);

      return {
        success: true,
        data: {
          id: page.id,
          title,
          url: page.url,
          properties,
          content: markdown,
          lastEdited: page.last_edited_time,
        },
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to get page' };
    }
  }
}

/**
 * Query a Notion database with filters and sorts
 */
export class NotionQueryDatabaseTool implements Tool {
  name = 'notion_query_database';
  description = 'Query a Notion database with optional filters and sorts. Returns pages matching the query criteria.';
  category = ToolCategory.EXTERNAL;
  parameters = {
    type: 'object' as const,
    properties: {
      databaseId: {
        type: 'string',
        description: 'Notion database ID. If omitted, uses defaultDatabaseId from config.',
      },
      filter: {
        type: 'object',
        description: 'Notion filter object (e.g. {"property":"Status","select":{"equals":"Published"}})',
      },
      sorts: {
        type: 'array',
        description: 'Sort array (e.g. [{"property":"Date","direction":"descending"}])',
      },
      limit: {
        type: 'number',
        description: 'Max results (default 20, max 100)',
      },
    },
    required: [],
  };

  async execute(args: {
    databaseId?: string;
    filter?: any;
    sorts?: any[];
    limit?: number;
  }): Promise<{ success: boolean; data?: any; error?: string }> {
    const auth = requireApiKey();
    if ('error' in auth) return { success: false, error: auth.error };

    const config = getNotionConfig();
    const databaseId = args.databaseId || config.defaultDatabaseId;
    if (!databaseId) {
      return {
        success: false,
        error: 'No database ID provided. Pass databaseId or set notion.defaultDatabaseId in config.',
      };
    }

    try {
      const body: any = {
        page_size: Math.min(args.limit || 20, 100),
      };
      if (args.filter) body.filter = args.filter;
      if (args.sorts) body.sorts = args.sorts;

      const result = await notionFetch(auth.apiKey, `/databases/${databaseId}/query`, {
        method: 'POST',
        body,
      });

      const pages = (result.results || []).map((page: any) => ({
        id: page.id,
        title: extractPageTitle(page),
        url: page.url,
        properties: formatPageProperties(page.properties || {}),
        lastEdited: page.last_edited_time,
      }));

      return { success: true, data: { pages, total: pages.length, hasMore: result.has_more } };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Database query failed' };
    }
  }
}

/**
 * Create a new page in a Notion database
 */
export class NotionCreatePageTool implements Tool {
  name = 'notion_create_page';
  description = 'Create a new page in a Notion database. Set properties and optional content blocks.';
  category = ToolCategory.EXTERNAL;
  parameters = {
    type: 'object' as const,
    properties: {
      databaseId: {
        type: 'string',
        description: 'Target database ID. If omitted, uses defaultDatabaseId from config.',
      },
      properties: {
        type: 'object',
        description: 'Page properties object (Notion API format). Must include title property.',
      },
      content: {
        type: 'string',
        description: 'Optional markdown content to add as page body. Will be converted to Notion blocks.',
      },
    },
    required: ['properties'],
  };

  async execute(args: {
    databaseId?: string;
    properties: any;
    content?: string;
  }): Promise<{ success: boolean; data?: any; error?: string }> {
    const auth = requireApiKey();
    if ('error' in auth) return { success: false, error: auth.error };

    const config = getNotionConfig();
    const databaseId = args.databaseId || config.defaultDatabaseId;
    if (!databaseId) {
      return {
        success: false,
        error: 'No database ID provided. Pass databaseId or set notion.defaultDatabaseId in config.',
      };
    }

    try {
      const body: any = {
        parent: { database_id: databaseId },
        properties: args.properties,
      };

      if (args.content) {
        body.children = markdownToBlocks(args.content);
      }

      const result = await notionFetch(auth.apiKey, '/pages', {
        method: 'POST',
        body,
      });

      return {
        success: true,
        data: {
          id: result.id,
          url: result.url,
          title: extractPageTitle(result),
          created: result.created_time,
        },
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to create page' };
    }
  }
}

/**
 * Update an existing Notion page
 */
export class NotionUpdatePageTool implements Tool {
  name = 'notion_update_page';
  description = 'Update properties of an existing Notion page. Optionally append content blocks.';
  category = ToolCategory.EXTERNAL;
  parameters = {
    type: 'object' as const,
    properties: {
      pageId: {
        type: 'string',
        description: 'Notion page ID to update',
      },
      properties: {
        type: 'object',
        description: 'Properties to update (Notion API format)',
      },
      appendContent: {
        type: 'string',
        description: 'Optional markdown content to append to the page',
      },
    },
    required: ['pageId'],
  };

  async execute(args: {
    pageId: string;
    properties?: any;
    appendContent?: string;
  }): Promise<{ success: boolean; data?: any; error?: string }> {
    const auth = requireApiKey();
    if ('error' in auth) return { success: false, error: auth.error };

    try {
      const results: any = {};

      // Update properties if provided
      if (args.properties) {
        const updated = await notionFetch(auth.apiKey, `/pages/${args.pageId}`, {
          method: 'PATCH',
          body: { properties: args.properties },
        });
        results.page = {
          id: updated.id,
          url: updated.url,
          title: extractPageTitle(updated),
          lastEdited: updated.last_edited_time,
        };
      }

      // Append content blocks if provided
      if (args.appendContent) {
        const blocks = markdownToBlocks(args.appendContent);
        await notionFetch(auth.apiKey, `/blocks/${args.pageId}/children`, {
          method: 'PATCH',
          body: { children: blocks },
        });
        results.appendedBlocks = blocks.length;
      }

      return { success: true, data: results };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to update page' };
    }
  }
}

// ─── Markdown → Notion Blocks ────────────────────────────────────────────

function markdownToBlocks(markdown: string): any[] {
  const lines = markdown.split('\n');
  const blocks: any[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Headings
    const h1 = trimmed.match(/^#\s+(.+)/);
    if (h1) {
      blocks.push({
        object: 'block',
        type: 'heading_1',
        heading_1: { rich_text: [{ type: 'text', text: { content: h1[1] } }] },
      });
      continue;
    }

    const h2 = trimmed.match(/^##\s+(.+)/);
    if (h2) {
      blocks.push({
        object: 'block',
        type: 'heading_2',
        heading_2: { rich_text: [{ type: 'text', text: { content: h2[1] } }] },
      });
      continue;
    }

    const h3 = trimmed.match(/^###\s+(.+)/);
    if (h3) {
      blocks.push({
        object: 'block',
        type: 'heading_3',
        heading_3: { rich_text: [{ type: 'text', text: { content: h3[1] } }] },
      });
      continue;
    }

    // Bullet list
    const bullet = trimmed.match(/^[-*]\s+(.+)/);
    if (bullet) {
      blocks.push({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: { rich_text: [{ type: 'text', text: { content: bullet[1] } }] },
      });
      continue;
    }

    // Numbered list
    const numbered = trimmed.match(/^\d+\.\s+(.+)/);
    if (numbered) {
      blocks.push({
        object: 'block',
        type: 'numbered_list_item',
        numbered_list_item: { rich_text: [{ type: 'text', text: { content: numbered[1] } }] },
      });
      continue;
    }

    // Todo
    const todo = trimmed.match(/^-\s+\[([ x])\]\s+(.+)/);
    if (todo) {
      blocks.push({
        object: 'block',
        type: 'to_do',
        to_do: {
          rich_text: [{ type: 'text', text: { content: todo[2] } }],
          checked: todo[1] === 'x',
        },
      });
      continue;
    }

    // Quote
    const quote = trimmed.match(/^>\s+(.+)/);
    if (quote) {
      blocks.push({
        object: 'block',
        type: 'quote',
        quote: { rich_text: [{ type: 'text', text: { content: quote[1] } }] },
      });
      continue;
    }

    // Divider
    if (trimmed === '---' || trimmed === '***') {
      blocks.push({ object: 'block', type: 'divider', divider: {} });
      continue;
    }

    // Default: paragraph
    blocks.push({
      object: 'block',
      type: 'paragraph',
      paragraph: { rich_text: [{ type: 'text', text: { content: trimmed } }] },
    });
  }

  return blocks;
}
