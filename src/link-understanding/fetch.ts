/**
 * Link Fetcher
 * 
 * Fetch and extract content from URLs.
 * Uses Firecrawl for reliable web scraping.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface LinkContent {
  url: string;
  title?: string;
  description?: string;
  content: string;
  error?: string;
}

interface FirecrawlScrapeResult {
  success: boolean;
  markdown?: string;
  metadata?: {
    title?: string;
    description?: string;
  };
  error?: string;
}

function getFirecrawlConfig(): { apiKey: string; baseUrl: string } {
  try {
    const configPath = join(homedir(), '.foxfang', 'foxfang.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    return {
      apiKey: config.firecrawl?.apiKey || '',
      baseUrl: config.firecrawl?.baseUrl || 'https://api.firecrawl.dev',
    };
  } catch {
    return { apiKey: '', baseUrl: 'https://api.firecrawl.dev' };
  }
}

async function scrapeFirecrawl(url: string): Promise<FirecrawlScrapeResult> {
  const { apiKey, baseUrl } = getFirecrawlConfig();
  
  if (!apiKey) {
    return { success: false, error: 'Firecrawl API key not configured' };
  }

  const response = await fetch(`${baseUrl}/v1/scrape`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      url,
      formats: ['markdown'],
      onlyMainContent: true,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    return { success: false, error: `HTTP ${response.status}: ${error}` };
  }

  const result = await response.json() as { success: boolean; error?: string; data?: { markdown?: string; metadata?: { title?: string; description?: string } } };
  
  if (!result.success) {
    return { success: false, error: result.error || 'Scrape failed' };
  }

  return {
    success: true,
    markdown: result.data?.markdown,
    metadata: result.data?.metadata,
  };
}

/**
 * Fetch content from a single URL
 */
export async function fetchLinkContent(url: string): Promise<LinkContent> {
  try {
    const result = await scrapeFirecrawl(url);
    
    if (!result.success) {
      return {
        url,
        error: result.error || 'Failed to fetch content',
        content: '',
      };
    }

    // Extract title from markdown (first # heading) or metadata
    const titleMatch = result.markdown?.match(/^#\s+(.+)$/m);
    const title = titleMatch?.[1] || result.metadata?.title;
    
    // Get description from meta or first paragraph
    const description = result.metadata?.description || 
                       result.markdown?.split('\n\n')[1]?.slice(0, 200);

    return {
      url,
      title,
      description,
      content: result.markdown || '',
    };
  } catch (error) {
    return {
      url,
      error: error instanceof Error ? error.message : String(error),
      content: '',
    };
  }
}

/**
 * Fetch content from multiple URLs
 */
export async function fetchMultipleLinks(urls: string[]): Promise<LinkContent[]> {
  const results: LinkContent[] = [];
  
  for (const url of urls) {
    const content = await fetchLinkContent(url);
    results.push(content);
  }
  
  return results;
}

/**
 * Format link content for agent context
 */
export function formatLinkContext(contents: LinkContent[]): string {
  if (contents.length === 0) return '';
  
  const sections: string[] = ['## Links from your message\n'];
  
  for (const content of contents) {
    if (content.error) {
      sections.push(`**${content.url}** - Could not fetch: ${content.error}\n`);
      continue;
    }
    
    sections.push(`### ${content.title || content.url}`);
    sections.push(`URL: ${content.url}`);
    
    if (content.description) {
      sections.push(`Description: ${content.description}`);
    }
    
    // Truncate content to avoid token overflow
    const truncatedContent = content.content.slice(0, 2000);
    if (truncatedContent) {
      sections.push(`\nContent:\n${truncatedContent}${content.content.length > 2000 ? '\n...(truncated)' : ''}`);
    }
    
    sections.push(''); // Empty line separator
  }
  
  return sections.join('\n');
}
