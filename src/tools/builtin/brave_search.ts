/**
 * Brave Search Tool
 * 
 * Search the web using Brave Search API.
 * Requires BRAVE_API_KEY in config.
 * 
 * Setup: Add to ~/.foxfang/foxfang.json:
 * {
 *   "braveSearch": {
 *     "apiKey": "BS-your-api-key"
 *   }
 * }
 * 
 * Or set environment variable: BRAVE_API_KEY
 */

import { Tool, ToolCategory } from '../traits';
import { loadConfigWithCredentials } from '../../config';

// Brave Search API response types
interface BraveWebResult {
  title: string;
  url: string;
  description: string;
  age?: string;
  page_age?: string;
  meta?: {
    url?: {
      scheme?: string;
      netloc?: string;
    };
  };
}

interface BraveSearchResponse {
  web?: {
    results?: BraveWebResult[];
  };
  query?: {
    original?: string;
  };
}

// Get Brave API key from config
async function getBraveConfig(): Promise<{ apiKey?: string }> {
  try {
    const config = await loadConfigWithCredentials();
    return {
      apiKey: config.braveSearch?.apiKey || process.env.BRAVE_API_KEY,
    };
  } catch {
    return {
      apiKey: process.env.BRAVE_API_KEY,
    };
  }
}

/**
 * Brave Search Tool
 * Search the web using Brave Search API with high-quality results
 */
export class BraveSearchTool implements Tool {
  name = 'brave_search';
  description = 'Search the web using Brave Search API (requires API key). High-quality, privacy-focused search results.';
  category = ToolCategory.EXTERNAL;
  parameters = {
    type: 'object' as const,
    properties: {
      query: { 
        type: 'string', 
        description: 'Search query' 
      },
      count: { 
        type: 'number', 
        description: 'Number of results (max 20, default 10)',
        default: 10 
      },
      offset: {
        type: 'number',
        description: 'Result offset for pagination (default: 0)',
        default: 0
      },
      freshness: {
        type: 'string',
        description: 'Filter by freshness: pd (past day), pw (past week), pm (past month), py (past year)',
        enum: ['pd', 'pw', 'pm', 'py']
      }
    },
    required: ['query'],
  };

  async execute(args: { 
    query: string; 
    count?: number;
    offset?: number;
    freshness?: 'pd' | 'pw' | 'pm' | 'py';
  }): Promise<{ 
    success: boolean; 
    data?: BraveWebResult[]; 
    error?: string 
  }> {
    const config = await getBraveConfig();
    
    if (!config.apiKey) {
      return {
        success: false,
        error: 'Brave API key not configured. Add to ~/.foxfang/foxfang.json: {"braveSearch": {"apiKey": "your-key"}} or set BRAVE_API_KEY env var. Get free API key at: https://brave.com/search/api/'
      };
    }

    try {
      const results = await searchBrave(
        config.apiKey, 
        args.query, 
        Math.min(args.count || 10, 20),
        args.offset || 0,
        args.freshness
      );
      return { success: true, data: results };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Brave search failed' 
      };
    }
  }
}

/**
 * Search using Brave Search API
 * 
 * Brave Search API docs: https://api.search.brave.com/
 */
async function searchBrave(
  apiKey: string, 
  query: string, 
  count: number,
  offset: number,
  freshness?: string
): Promise<BraveWebResult[]> {
  const params = new URLSearchParams({
    q: query,
    count: count.toString(),
    offset: offset.toString(),
  });

  if (freshness) {
    params.append('freshness', freshness);
  }

  const response = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'X-Subscription-Token': apiKey,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    if (response.status === 401) {
      throw new Error('Invalid Brave API key. Please check your configuration.');
    }
    if (response.status === 429) {
      throw new Error('Rate limit exceeded. Please try again later.');
    }
    throw new Error(`Brave API error: ${response.status} - ${error}`);
  }

  const result = await response.json() as BraveSearchResponse;
  
  return result.web?.results || [];
}

/**
 * Format search results for display
 */
export function formatBraveResults(results: BraveWebResult[]): string {
  if (results.length === 0) {
    return 'No results found.';
  }

  return results.map((r, i) => {
    let output = `${i + 1}. ${r.title}\n`;
    output += `   🔗 ${r.url}\n`;
    if (r.description) {
      output += `   ${r.description.slice(0, 200)}${r.description.length > 200 ? '...' : ''}\n`;
    }
    if (r.age) {
      output += `   📅 ${r.age}`;
    }
    return output;
  }).join('\n\n');
}

/**
 * Format a single result
 */
export function formatBraveResult(result: BraveWebResult): string {
  let output = `📄 ${result.title}\n`;
  output += `🔗 ${result.url}\n`;
  if (result.description) {
    output += `\n${result.description}\n`;
  }
  if (result.age) {
    output += `\n📅 ${result.age}`;
  }
  return output;
}
