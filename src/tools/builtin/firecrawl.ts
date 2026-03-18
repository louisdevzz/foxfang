/**
 * Firecrawl Tools
 * 
 * Advanced web scraping and search using Firecrawl API.
 * Requires FIRECRAWL_API_KEY in config.
 * 
 * Features:
 * - firecrawl_search: Search web with AI-powered results
 * - firecrawl_scrape: Scrape and extract structured data from URLs
 * 
 * Setup: Add to ~/.foxfang/foxfang.json:
 * {
 *   "firecrawl": {
 *     "apiKey": "fc-your-api-key"
 *   }
 * }
 */

import { Tool, ToolCategory } from '../traits';
import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// Firecrawl API response types
interface FirecrawlSearchResult {
  title: string;
  url: string;
  markdown?: string;
  html?: string;
  content?: string;
  description?: string;
}

interface FirecrawlSearchResponse {
  success: boolean;
  data?: FirecrawlSearchResult[];
  error?: string;
}

interface FirecrawlScrapeResponse {
  success: boolean;
  data?: {
    markdown?: string;
    html?: string;
    links?: string[];
    metadata?: {
      title?: string;
      description?: string;
      sourceURL?: string;
      [key: string]: any;
    };
  };
  error?: string;
}

// Get Firecrawl API key from config
function getFirecrawlConfig(): { apiKey?: string; baseUrl: string } {
  const configPath = join(homedir(), '.foxfang', 'foxfang.json');
  let config: any = {};
  
  try {
    config = JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch {
    // Config doesn't exist or is invalid
  }

  return {
    apiKey: config.firecrawl?.apiKey || process.env.FIRECRAWL_API_KEY,
    baseUrl: config.firecrawl?.baseUrl || process.env.FIRECRAWL_BASE_URL || 'https://api.firecrawl.dev',
  };
}

/**
 * Firecrawl Search Tool
 * Search the web using Firecrawl's AI-powered search
 */
export class FirecrawlSearchTool implements Tool {
  name = 'firecrawl_search';
  description = 'Search the web using Firecrawl AI (requires API key). Returns AI-powered search results with extracted content.';
  category = ToolCategory.EXTERNAL;
  parameters = {
    type: 'object' as const,
    properties: {
      query: { 
        type: 'string', 
        description: 'Search query' 
      },
      limit: { 
        type: 'number', 
        description: 'Number of results (max 10, default 5)',
        default: 5 
      },
      includeContent: {
        type: 'boolean',
        description: 'Include full page content (default: true)',
        default: true
      }
    },
    required: ['query'],
  };

  async execute(args: { 
    query: string; 
    limit?: number;
    includeContent?: boolean;
  }): Promise<{ 
    success: boolean; 
    results?: FirecrawlSearchResult[]; 
    error?: string 
  }> {
    const config = getFirecrawlConfig();
    
    if (!config.apiKey) {
      return {
        success: false,
        error: 'Firecrawl API key not configured. Add to ~/.foxfang/foxfang.json: {"firecrawl": {"apiKey": "your-key"}} or set FIRECRAWL_API_KEY env var.'
      };
    }

    try {
      const results = await searchFirecrawl(
        config.apiKey, 
        config.baseUrl, 
        args.query, 
        Math.min(args.limit || 5, 10),
        args.includeContent !== false
      );
      return { success: true, results };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Firecrawl search failed' 
      };
    }
  }
}

/**
 * Firecrawl Scrape Tool
 * Scrape and extract structured data from a URL
 */
export class FirecrawlScrapeTool implements Tool {
  name = 'firecrawl_scrape';
  description = 'Scrape and extract content from a URL using Firecrawl (requires API key). Returns clean markdown, links, and metadata.';
  category = ToolCategory.EXTERNAL;
  parameters = {
    type: 'object' as const,
    properties: {
      url: { 
        type: 'string', 
        description: 'URL to scrape' 
      },
      formats: {
        type: 'array',
        items: { type: 'string', enum: ['markdown', 'html', 'links'] },
        description: 'Output formats (default: ["markdown"])',
        default: ['markdown']
      },
      onlyMainContent: {
        type: 'boolean',
        description: 'Extract only main content (default: true)',
        default: true
      }
    },
    required: ['url'],
  };

  async execute(args: { 
    url: string; 
    formats?: string[];
    onlyMainContent?: boolean;
  }): Promise<{ 
    success: boolean; 
    data?: FirecrawlScrapeResponse['data']; 
    error?: string 
  }> {
    const config = getFirecrawlConfig();
    
    if (!config.apiKey) {
      return {
        success: false,
        error: 'Firecrawl API key not configured. Add to ~/.foxfang/foxfang.json: {"firecrawl": {"apiKey": "your-key"}} or set FIRECRAWL_API_KEY env var.'
      };
    }

    try {
      const data = await scrapeFirecrawl(
        config.apiKey, 
        config.baseUrl, 
        args.url,
        args.formats || ['markdown'],
        args.onlyMainContent !== false
      );
      return { success: true, data };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Firecrawl scrape failed' 
      };
    }
  }
}

/**
 * Search using Firecrawl API
 */
async function searchFirecrawl(
  apiKey: string, 
  baseUrl: string, 
  query: string, 
  limit: number,
  includeContent: boolean
): Promise<FirecrawlSearchResult[]> {
  const response = await fetch(`${baseUrl}/v1/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      limit,
      formats: includeContent ? ['markdown'] : [],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Firecrawl API error: ${response.status} - ${error}`);
  }

  const result = await response.json() as FirecrawlSearchResponse;
  
  if (!result.success) {
    throw new Error(result.error || 'Search failed');
  }

  return result.data || [];
}

/**
 * Scrape URL using Firecrawl API
 */
async function scrapeFirecrawl(
  apiKey: string, 
  baseUrl: string, 
  url: string,
  formats: string[],
  onlyMainContent: boolean
): Promise<FirecrawlScrapeResponse['data']> {
  const response = await fetch(`${baseUrl}/v1/scrape`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      url,
      formats,
      onlyMainContent,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Firecrawl API error: ${response.status} - ${error}`);
  }

  const result = await response.json() as FirecrawlScrapeResponse;
  
  if (!result.success) {
    throw new Error(result.error || 'Scrape failed');
  }

  return result.data;
}

/**
 * Format search results for display
 */
export function formatFirecrawlResults(results: FirecrawlSearchResult[]): string {
  if (results.length === 0) {
    return 'No results found.';
  }

  return results.map((r, i) => {
    let output = `${i + 1}. ${r.title}\n`;
    output += `   🔗 ${r.url}\n`;
    if (r.description) {
      output += `   ${r.description.slice(0, 150)}${r.description.length > 150 ? '...' : ''}\n`;
    }
    if (r.markdown) {
      const preview = r.markdown.replace(/\n/g, ' ').slice(0, 200);
      output += `   📄 ${preview}...\n`;
    }
    return output;
  }).join('\n');
}

/**
 * Format scrape result for display
 */
export function formatFirecrawlScrape(data: FirecrawlScrapeResponse['data']): string {
  if (!data) return 'No data';
  
  let output = '';
  
  if (data.metadata?.title) {
    output += `📄 ${data.metadata.title}\n`;
  }
  if (data.metadata?.sourceURL) {
    output += `🔗 ${data.metadata.sourceURL}\n`;
  }
  if (data.metadata?.description) {
    output += `📝 ${data.metadata.description}\n`;
  }
  
  output += `${'─'.repeat(50)}\n\n`;
  
  if (data.markdown) {
    output += data.markdown.slice(0, 5000);
    if (data.markdown.length > 5000) {
      output += '\n\n[Content truncated...]';
    }
  } else if (data.html) {
    output += `[HTML content: ${data.html.length} chars]`;
  }
  
  if (data.links && data.links.length > 0) {
    output += `\n\n📎 Found ${data.links.length} links`;
  }
  
  return output;
}
