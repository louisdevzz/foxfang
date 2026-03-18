/**
 * Link Fetcher
 * 
 * Fetch and extract content from URLs.
 * Tries Firecrawl first (if configured), falls back to native fetch.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { isValidUrl } from './detect';

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

// Lazily-cached Firecrawl config to avoid repeated synchronous I/O
let _firecrawlConfigCache: { apiKey: string; baseUrl: string } | null = null;

function getFirecrawlConfig(): { apiKey: string; baseUrl: string } {
  if (_firecrawlConfigCache) return _firecrawlConfigCache;

  // Config file takes priority; env vars are the fallback (matching firecrawl.ts tool)
  let fileApiKey = '';
  let fileBaseUrl = '';
  try {
    const configPath = join(homedir(), '.foxfang', 'foxfang.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    fileApiKey = config.firecrawl?.apiKey || '';
    fileBaseUrl = config.firecrawl?.baseUrl || '';
  } catch {
    // Config doesn't exist or is invalid — fall through to env vars
  }

  _firecrawlConfigCache = {
    apiKey: fileApiKey || process.env.FIRECRAWL_API_KEY || '',
    baseUrl: fileBaseUrl || process.env.FIRECRAWL_BASE_URL || 'https://api.firecrawl.dev',
  };
  return _firecrawlConfigCache;
}

/** Max response body size for native fetch (500 KB) */
const MAX_NATIVE_BODY_BYTES = 500 * 1024;
/** Timeout for native fetch requests (10 seconds) */
const NATIVE_FETCH_TIMEOUT_MS = 10_000;

async function scrapeFirecrawl(url: string): Promise<FirecrawlScrapeResult> {
  const { apiKey, baseUrl } = getFirecrawlConfig();
  
  if (!apiKey) {
    return { success: false, error: 'Firecrawl API key not configured' };
  }

  try {
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
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : String(error) 
    };
  }
}

/**
 * Simple HTML to text conversion (fallback when Firecrawl unavailable)
 */
function htmlToText(html: string): string {
  // Remove script and style tags with content
  let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  
  // Replace common block elements with newlines
  text = text.replace(/<\/(div|p|section|article|header|footer|li|tr)>/gi, '\n');
  text = text.replace(/<(br|hr)\s*\/?>/gi, '\n');
  
  // Remove all remaining HTML tags
  text = text.replace(/<[^>]+>/g, '');
  
  // Decode common HTML entities
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&nbsp;/g, ' ');
  
  // Clean up whitespace
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.trim();
  
  return text;
}

/**
 * Extract title from HTML
 */
function extractTitle(html: string): string | undefined {
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (titleMatch) return titleMatch[1].trim();
  
  const h1Match = html.match(/<h1[^>]*>([^<]*)<\/h1>/i);
  if (h1Match) return h1Match[1].trim();
  
  return undefined;
}

/**
 * Extract description from HTML meta tags
 */
function extractDescription(html: string): string | undefined {
  const metaDesc = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i) 
                  || html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["']/i)
                  || html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']*)["']/i);
  
  if (metaDesc) return metaDesc[1].trim();
  
  return undefined;
}

/**
 * Native fetch fallback (no API key required).
 * Enforces a timeout, a maximum response body size, and re-validates
 * the final URL after any redirects to guard against SSRF.
 */
async function fetchNative(url: string): Promise<FirecrawlScrapeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NATIVE_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
      signal: controller.signal,
    });

    // Re-validate the final URL after redirects to block SSRF via open-redirect
    if (!isValidUrl(response.url)) {
      return { success: false, error: 'Redirect target is a private/blocked address' };
    }

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    const contentType = response.headers.get('content-type') || '';
    
    // Only process HTML content
    if (!contentType.includes('text/html')) {
      return { 
        success: true, 
        markdown: `[Non-HTML content: ${contentType}]`,
        metadata: { title: url }
      };
    }

    // Read body with a hard size limit to prevent memory exhaustion
    const reader = response.body?.getReader();
    if (!reader) {
      return { success: false, error: 'No response body' };
    }

    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_NATIVE_BODY_BYTES) {
        reader.cancel();
        break;
      }
      chunks.push(value);
    }

    const bodyBuffer = Buffer.concat(chunks);
    const html = bodyBuffer.toString('utf-8');
    const text = htmlToText(html);
    const title = extractTitle(html);
    const description = extractDescription(html);

    return {
      success: true,
      markdown: text,
      metadata: { title, description },
    };
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : String(error) 
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch content from a single URL
 * Tries Firecrawl first, falls back to native fetch
 */
export async function fetchLinkContent(url: string): Promise<LinkContent> {
  // Try Firecrawl first (if configured)
  const firecrawlResult = await scrapeFirecrawl(url);
  
  if (firecrawlResult.success) {
    const titleMatch = firecrawlResult.markdown?.match(/^#\s+(.+)$/m);
    const title = titleMatch?.[1] || firecrawlResult.metadata?.title;
    const description = firecrawlResult.metadata?.description || 
                       firecrawlResult.markdown?.split('\n\n')[1]?.slice(0, 200);

    return {
      url,
      title,
      description,
      content: firecrawlResult.markdown || '',
    };
  }

  // Firecrawl failed or not configured - try native fetch
  const nativeResult = await fetchNative(url);
  
  if (nativeResult.success) {
    return {
      url,
      title: nativeResult.metadata?.title,
      description: nativeResult.metadata?.description,
      content: nativeResult.markdown || '',
    };
  }

  // Both failed
  return {
    url,
    error: `Firecrawl: ${firecrawlResult.error}, Native: ${nativeResult.error}`,
    content: '',
  };
}

/**
 * Fetch content from multiple URLs in parallel (max `concurrency` at a time).
 * Uses a shared index counter — safe in single-threaded JS since index++ is
 * synchronous and never interleaved across async boundaries.
 */
export async function fetchMultipleLinks(urls: string[], concurrency = 3): Promise<LinkContent[]> {
  if (urls.length === 0) return [];

  const limit = Math.max(1, concurrency);
  const results: LinkContent[] = new Array(urls.length);
  let next = 0;

  async function worker(): Promise<void> {
    // Each iteration atomically claims an index before awaiting
    let i = next++;
    while (i < urls.length) {
      results[i] = await fetchLinkContent(urls[i]);
      i = next++;
    }
  }

  const pool = Array.from({ length: Math.min(limit, urls.length) }, worker);
  await Promise.all(pool);

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
