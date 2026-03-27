/**
 * Fetch URL Tool
 * 
 * Crawl and extract content from websites without API keys.
 * Uses native fetch + HTML parsing to extract readable content.
 */

import { Tool, ToolCategory } from '../traits';

export interface FetchUrlResult {
  url: string;
  title: string;
  content: string;
  excerpt: string;
  links: string[];
  images: string[];
}

export class FetchUrlTool implements Tool {
  name = 'fetch_url';
  description = 'Fetch and extract static page content from a website URL (HTML text, title, links). Best for article-like/static content. Do not use this as the primary tool for footer/header/nav/button text, what-is-visible, or scroll/click tasks; prefer the `browser` tool if enabled.';
  category = ToolCategory.EXTERNAL;
  parameters = {
    type: 'object' as const,
    properties: {
      url: { 
        type: 'string', 
        description: 'Website URL to fetch (e.g., https://example.com/article). Must be a valid HTTP/HTTPS URL.' 
      },
      maxLength: { 
        type: 'number', 
        description: 'Maximum content length in characters (default: 10000)',
        default: 10000 
      },
      includeLinks: {
        type: 'boolean',
        description: 'Include extracted links (default: true)',
        default: true
      }
    },
    required: ['url'],
  };

  async execute(args: { 
    url: string; 
    maxLength?: number;
    includeLinks?: boolean;
  }): Promise<{ 
    success: boolean; 
    data?: FetchUrlResult; 
    error?: string 
  }> {
    try {
      const url = typeof args?.url === 'string' ? args.url.trim() : '';
      if (!url) {
        return {
          success: false,
          error: 'URL is required',
        };
      }

      const result = await fetchAndExtract(args.url, args.maxLength || 10000, args.includeLinks !== false);
      return { success: true, data: result };
    } catch (error) {
      let message = error instanceof Error ? error.message : 'Failed to fetch URL';
      const cause = error instanceof Error ? (error as any).cause : undefined;
      if (cause instanceof Error && cause.message) {
        message = `${message} (${cause.message})`;
      }
      return { 
        success: false, 
        error: message 
      };
    }
  }
}

/**
 * Fetch URL and extract readable content
 */
async function fetchAndExtract(url: string, maxLength: number, includeLinks: boolean): Promise<FetchUrlResult> {
  // Validate URL
  let parsedUrl: URL;
  let normalizedUrl = url.trim();
  try {
    parsedUrl = new URL(normalizedUrl);
  } catch {
    try {
      parsedUrl = new URL(`https://${normalizedUrl}`);
      normalizedUrl = parsedUrl.href;
    } catch {
      throw new Error('Invalid URL format');
    }
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('URL must be http or https');
  }

  // Fetch with browser-like headers
  const response = await fetch(normalizedUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'DNT': '1',
      'Connection': 'keep-alive',
    },
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get('content-type') || '';
  
  // Handle non-HTML content
  if (!contentType.includes('text/html')) {
    const text = await response.text();
    return {
      url: response.url || url,
      title: parsedUrl.hostname,
      content: text.slice(0, maxLength),
      excerpt: text.slice(0, 200),
      links: [],
      images: [],
    };
  }

  const html = await response.text();
  const extracted = extractContent(html, response.url || url);
  
  // Truncate content if needed
  let content = extracted.content;
  if (content.length > maxLength) {
    content = content.slice(0, maxLength) + '\n\n[Content truncated...]';
  }

  return {
    url: response.url || url,
    title: extracted.title,
    content,
    excerpt: extracted.excerpt,
    links: includeLinks ? extracted.links.slice(0, 50) : [],
    images: extracted.images.slice(0, 20),
  };
}

/**
 * Extract readable content from HTML
 * Simple extraction without external dependencies (no jsdom/cheerio)
 */
function extractContent(html: string, baseUrl: string): {
  title: string;
  content: string;
  excerpt: string;
  links: string[];
  images: string[];
} {
  // Remove script and style tags
  let cleanHtml = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  // Extract title
  const titleMatch = cleanHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeHtmlEntities(stripTags(titleMatch[1])) : '';

  // Extract meta description for excerpt
  const metaDescMatch = cleanHtml.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i) ||
                        cleanHtml.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["']/i);
  const excerpt = metaDescMatch ? decodeHtmlEntities(metaDescMatch[1]) : '';

  // Try to find main content area
  let contentHtml = cleanHtml;
  
  // Look for common content containers
  const contentPatterns = [
    /<article[^>]*>([\s\S]*?)<\/article>/i,
    /<main[^>]*>([\s\S]*?)<\/main>/i,
    /<div[^>]*class=["'][^"']*content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class=["'][^"']*article[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class=["'][^"']*post[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*id=["']content["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*id=["']main["'][^>]*>([\s\S]*?)<\/div>/i,
  ];

  for (const pattern of contentPatterns) {
    const match = cleanHtml.match(pattern);
    if (match && match[1].length > 500) {
      contentHtml = match[1];
      break;
    }
  }

  // Remove navigation, header, footer, sidebar if still in full HTML
  if (contentHtml === cleanHtml) {
    contentHtml = contentHtml
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<header[\s\S]*?<\/header>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '')
      .replace(/<aside[\s\S]*?<\/aside>/gi, '');
  }

  // Extract links
  const links: string[] = [];
  const linkRegex = /<a[^>]*href=["']([^"']+)["'][^>]*>/gi;
  let linkMatch;
  while ((linkMatch = linkRegex.exec(contentHtml)) !== null) {
    const href = linkMatch[1];
    if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
      try {
        const absoluteUrl = new URL(href, baseUrl).href;
        if (!links.includes(absoluteUrl)) {
          links.push(absoluteUrl);
        }
      } catch {
        // Invalid URL, skip
      }
    }
  }

  // Extract images
  const images: string[] = [];
  const imgRegex = /<img[^>]*src=["']([^"']+)["'][^>]*>/gi;
  let imgMatch;
  while ((imgMatch = imgRegex.exec(contentHtml)) !== null) {
    const src = imgMatch[1];
    if (src && !src.startsWith('data:')) {
      try {
        const absoluteUrl = new URL(src, baseUrl).href;
        if (!images.includes(absoluteUrl)) {
          images.push(absoluteUrl);
        }
      } catch {
        // Invalid URL, skip
      }
    }
  }

  // Convert HTML to text
  let content = htmlToText(contentHtml);
  
  // Clean up whitespace
  content = content
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();

  return {
    title: title || 'Untitled',
    content,
    excerpt: excerpt || content.slice(0, 200),
    links,
    images,
  };
}

/**
 * Convert HTML to plain text with basic formatting
 */
function htmlToText(html: string): string {
  let text = html;

  // Convert headers
  text = text.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n\n# $1\n\n');
  text = text.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n\n## $1\n\n');
  text = text.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n\n### $1\n\n');
  text = text.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '\n\n#### $1\n\n');
  text = text.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, '\n\n##### $1\n\n');
  text = text.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, '\n\n###### $1\n\n');

  // Convert paragraphs and divs
  text = text.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '\n\n$1\n\n');
  text = text.replace(/<div[^>]*>([\s\S]*?)<\/div>/gi, '\n$1\n');

  // Convert line breaks
  text = text.replace(/<br\s*\/?>/gi, '\n');

  // Convert lists
  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '\n• $1');
  text = text.replace(/<ul[\s\S]*?<\/ul>/gi, (match) => match.replace(/•/g, '  •'));
  text = text.replace(/<ol[\s\S]*?<\/ol>/gi, (match) => {
    let counter = 1;
    return match.replace(/•/g, () => `  ${counter++}.`);
  });

  // Convert emphasis
  text = text.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**');
  text = text.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*');

  // Convert links
  text = text.replace(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');

  // Remove remaining tags
  text = stripTags(text);

  // Decode entities
  text = decodeHtmlEntities(text);

  // Clean up
  text = text
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();

  return text;
}

/**
 * Strip HTML tags
 */
function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ');
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
    '&apos;': "'",
    '&nbsp;': ' ',
    '&ndash;': '–',
    '&mdash;': '—',
    '&lsquo;': '\u2018',
    '&rsquo;': '\u2019',
    '&ldquo;': '"',
    '&rdquo;': '"',
    '&hellip;': '…',
    '&#x27;': "'",
  };
  
  return str.replace(/&[^;]+;/g, (match) => {
    if (entities[match]) return entities[match];
    // Handle numeric entities
    const decimal = match.match(/&#(\d+);/);
    if (decimal) return String.fromCharCode(parseInt(decimal[1], 10));
    const hex = match.match(/&#x([0-9a-f]+);/i);
    if (hex) return String.fromCharCode(parseInt(hex[1], 16));
    return match;
  });
}

/**
 * Format fetch result for display
 */
export function formatFetchResult(result: FetchUrlResult): string {
  let output = `📄 ${result.title}\n`;
  output += `🔗 ${result.url}\n`;
  output += `${'─'.repeat(50)}\n\n`;
  output += result.content.slice(0, 3000);
  
  if (result.content.length > 3000) {
    output += '\n\n[...truncated]';
  }

  if (result.links.length > 0) {
    output += `\n\n📎 Found ${result.links.length} links`;
  }
  
  if (result.images.length > 0) {
    output += `\n🖼 Found ${result.images.length} images`;
  }

  return output;
}
