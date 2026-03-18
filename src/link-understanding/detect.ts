/**
 * Link Detection
 * 
 * Extract URLs from user messages.
 * Inspired by OpenClaw's link-understanding/detect.ts
 */

// Match bare URLs (http:// or https://)
const BARE_LINK_RE = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi;

// Match markdown links [text](url)
const MARKDOWN_LINK_RE = /\[[^\]]*\]\((https?:\/\/[^\s<>"{}|\\^`\[\]]+?)\)/gi;

/**
 * Extract all URLs from a message
 * Returns unique URLs only
 */
export function extractLinksFromMessage(message: string, opts?: { maxLinks?: number }): string[] {
  if (!message?.trim()) {
    return [];
  }

  const maxLinks = opts?.maxLinks ?? 5;
  const seen = new Set<string>();
  const results: string[] = [];

  // First, extract URLs from markdown links
  for (const match of message.matchAll(MARKDOWN_LINK_RE)) {
    const url = match[1]?.trim();
    if (url && !seen.has(url)) {
      seen.add(url);
      results.push(url);
      if (results.length >= maxLinks) {
        return results;
      }
    }
  }

  // Then extract bare URLs (excluding those already found in markdown)
  const markdownStripped = message.replace(MARKDOWN_LINK_RE, ' ');
  
  for (const match of markdownStripped.matchAll(BARE_LINK_RE)) {
    const url = match[0]?.trim();
    if (!url) continue;
    
    // Skip if already found
    if (seen.has(url)) continue;
    
    // Basic validation
    if (!isValidUrl(url)) continue;
    
    seen.add(url);
    results.push(url);
    
    if (results.length >= maxLinks) {
      break;
    }
  }

  return results;
}

/**
 * Validate if a URL is safe to fetch
 */
function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    
    // Only http/https
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    
    // Block private IPs and localhost
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === 'localhost' || 
        hostname.startsWith('127.') ||
        hostname.startsWith('192.168.') ||
        hostname.startsWith('10.') ||
        hostname.startsWith('172.')) {
      return false;
    }
    
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if message contains any links
 */
export function containsLinks(message: string): boolean {
  return extractLinksFromMessage(message, { maxLinks: 1 }).length > 0;
}
