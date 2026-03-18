/**
 * Web Search Tool
 * 
 * Search the web without API keys.
 * Uses SearX public instances for keyless searches.
 */

import { Tool, ToolCategory } from '../traits';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export class WebSearchTool implements Tool {
  name = 'web_search';
  description = 'Search the web for information. No API key needed.';
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
        description: 'Number of results (max 10)',
        default: 5 
      },
    },
    required: ['query'],
  };

  async execute(args: { query: string; limit?: number }): Promise<{ 
    success: boolean; 
    results?: SearchResult[]; 
    error?: string 
  }> {
    try {
      const results = await searchSearx(args.query, Math.min(args.limit || 5, 10));
      return { success: true, results };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Search failed' 
      };
    }
  }
}

/**
 * Search using SearX public instances
 * SearX is a meta-search engine that aggregates results from multiple sources
 */
async function searchSearx(query: string, limit: number): Promise<SearchResult[]> {
  // Public SearX instances - these come and go
  // Using well-known public instances
  const searxInstances = [
    'https://search.sapti.me',
    'https://search.bus-hit.me',
    'https://search.demoniak.ch',
    'https://search.serginho.dev',
    'https://searx.be',
  ];
  
  const encodedQuery = encodeURIComponent(query);
  
  for (const instance of searxInstances) {
    try {
      // Try JSON API first
      const url = `${instance}/search?q=${encodedQuery}&format=json&engines=google,bing,duckduckgo`;
      
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) continue;

      const data = await response.json() as { results?: SearxResult[] };
      
      if (data.results && Array.isArray(data.results) && data.results.length > 0) {
        return data.results.slice(0, limit).map((r: SearxResult) => ({
          title: r.title || '',
          url: r.url || '',
          snippet: cleanSnippet(r.content || r.abstract || ''),
        }));
      }
    } catch {
      // Try next instance
      continue;
    }
  }
  
  // If all SearX instances fail, try direct Bing
  try {
    return await searchBing(query, limit);
  } catch {
    // Fall through to error
  }
  
  throw new Error('All search instances failed');
}

interface SearxResult {
  title?: string;
  url?: string;
  content?: string;
  abstract?: string;
}

/**
 * Fallback: Search using Bing
 */
async function searchBing(query: string, limit: number): Promise<SearchResult[]> {
  const encodedQuery = encodeURIComponent(query);
  const url = `https://www.bing.com/search?q=${encodedQuery}&count=${limit}`;

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.0',
      'Accept': 'text/html',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

  if (!response.ok) {
    throw new Error(`Bing search failed: ${response.status}`);
  }

  const html = await response.text();
  return parseBingResults(html, limit);
}

/**
 * Parse Bing HTML results
 */
function parseBingResults(html: string, limit: number): SearchResult[] {
  const results: SearchResult[] = [];
  
  // Bing results are in .b_algo containers
  const algoBlocks = html.split('<li class="b_algo').slice(1);
  
  for (let i = 0; i < Math.min(algoBlocks.length, limit); i++) {
    const block = algoBlocks[i];
    
    // Extract title and URL
    const titleMatch = block.match(/<a[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/i);
    if (!titleMatch) continue;
    
    const url = decodeHtmlEntities(titleMatch[1]);
    const title = stripHtml(decodeHtmlEntities(titleMatch[2]));
    
    // Extract snippet
    const snippetMatch = block.match(/<p[^>]*>(.*?)<\/p>/i) || 
                         block.match(/<span class="b_caption">.*?<p>(.*?)<\/p>/i);
    const snippet = snippetMatch ? cleanSnippet(stripHtml(decodeHtmlEntities(snippetMatch[1]))) : '';
    
    results.push({ title, url, snippet });
  }
  
  return results;
}

/**
 * Clean up snippet text
 */
function cleanSnippet(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\.\.\./g, ' ')
    .trim()
    .slice(0, 200);
}

/**
 * Strip HTML tags from string
 */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Decode HTML entities
 */
function decodeHtmlEntities(str: string): string {
  const entities: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&nbsp;': ' ',
    '&#x27;': "'",
  };
  
  return str.replace(/&[^;]+;/g, (match) => entities[match] || match);
}

/**
 * Format search results for display
 */
export function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) {
    return 'No results found.';
  }

  return results.map((r, i) => 
    `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet.slice(0, 150)}${r.snippet.length > 150 ? '...' : ''}`
  ).join('\n\n');
}
