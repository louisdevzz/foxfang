/**
 * Link Understanding
 * 
 * Extract and analyze links from content.
 */

export interface LinkInfo {
  url: string;
  title?: string;
  domain: string;
  type: 'article' | 'video' | 'image' | 'other';
}

/**
 * Extract links from text
 */
export function extractLinks(text: string): LinkInfo[] {
  const urlRegex = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/g;
  const markdownLinkRegex = /\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g;
  
  const links: LinkInfo[] = [];
  const seen = new Set<string>();

  // Extract markdown links
  let match;
  while ((match = markdownLinkRegex.exec(text)) !== null) {
    const url = match[2];
    if (!seen.has(url)) {
      seen.add(url);
      links.push(parseLink(url, match[1]));
    }
  }

  // Extract plain URLs
  while ((match = urlRegex.exec(text)) !== null) {
    const url = match[0];
    if (!seen.has(url)) {
      seen.add(url);
      links.push(parseLink(url));
    }
  }

  return links;
}

/**
 * Parse a single link
 */
function parseLink(url: string, title?: string): LinkInfo {
  const domain = new URL(url).hostname.replace('www.', '');
  
  let type: LinkInfo['type'] = 'other';
  if (domain.includes('youtube') || domain.includes('vimeo')) {
    type = 'video';
  } else if (/\.(jpg|jpeg|png|gif|webp)$/i.test(url)) {
    type = 'image';
  } else if (domain.includes('medium') || domain.includes('blog') || url.length > 60) {
    type = 'article';
  }

  return { url, title, domain, type };
}

/**
 * Summarize link content (placeholder)
 */
export async function summarizeLink(url: string): Promise<string> {
  // TODO: Implement with firecrawl or similar
  return `[Summary of ${url}]`;
}
