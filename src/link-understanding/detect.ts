/**
 * Link Detection
 * 
 * Extract URLs from user messages.
 */

// Match bare URLs (http:// or https://)
const BARE_LINK_RE = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi;
const SCHEMELESS_LINK_RE =
  /(^|[\s(<["'`])((?:www\.)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+(?:\/[^\s<>"{}|\\^`\[\]]*)?)/gi;

// Match markdown links [text](url)
const MARKDOWN_LINK_RE = /\[[^\]]*\]\((https?:\/\/[^\s<>"{}|\\^`\[\]]+?)\)/gi;
const FILE_LIKE_TLDS = new Set([
  'avif',
  'cjs',
  'css',
  'csv',
  'gif',
  'gz',
  'html',
  'jpeg',
  'jpg',
  'js',
  'json',
  'jsx',
  'lock',
  'md',
  'mjs',
  'pdf',
  'png',
  'scss',
  'sql',
  'svg',
  'toml',
  'ts',
  'tsx',
  'txt',
  'webp',
  'xml',
  'yaml',
  'yml',
  'zip',
]);

// IPv4 address pattern
const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/**
 * Returns 4 if the string is a valid IPv4 address, 6 if it looks like an IPv6
 * address, 0 otherwise. Intentionally lightweight — exact IETF conformance is
 * not required because we err on the side of caution.
 */
function detectIpVersion(host: string): 0 | 4 | 6 {
  if (IPV4_RE.test(host)) {
    const parts = host.split('.').map(Number);
    if (parts.every(p => p >= 0 && p <= 255)) return 4;
  }
  // Very broad IPv6 heuristic: contains at least one colon
  if (host.includes(':')) return 6;
  return 0;
}

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

  if (results.length >= maxLinks) {
    return results;
  }

  const schemelessSource = markdownStripped.replace(BARE_LINK_RE, ' ');
  for (const match of schemelessSource.matchAll(SCHEMELESS_LINK_RE)) {
    const rawCandidate = match[2]?.trim();
    if (!rawCandidate) continue;

    const normalizedCandidate = rawCandidate
      .replace(/^[<([{'"`]+/g, '')
      .replace(/[),.!?\]>}"'`]+$/g, '');
    if (!normalizedCandidate || normalizedCandidate.includes('@')) continue;

    const hostname = normalizedCandidate.split(/[/?#]/, 1)[0]?.toLowerCase() || '';
    if (!hostname || hostname === 'localhost' || !hostname.includes('.')) continue;

    const tld = hostname.split('.').pop() || '';
    if (FILE_LIKE_TLDS.has(tld)) continue;

    const url = `https://${normalizedCandidate}`;
    if (seen.has(url)) continue;
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
 * Check if an IP address (v4 or v6) is in a private/reserved range.
 * Covers: loopback, link-local, RFC1918, CGNAT, documentation, ULA, IPv4-mapped.
 */
function isPrivateIp(ip: string): boolean {
  const version = detectIpVersion(ip);
  if (version === 4) {
    // Parse octets
    const parts = ip.split('.').map(Number);
    const [a, b] = parts;
    // 127.0.0.0/8 – loopback
    if (a === 127) return true;
    // 10.0.0.0/8 – RFC1918
    if (a === 10) return true;
    // 172.16.0.0/12 – RFC1918
    if (a === 172 && b >= 16 && b <= 31) return true;
    // 192.168.0.0/16 – RFC1918
    if (a === 192 && b === 168) return true;
    // 169.254.0.0/16 – link-local
    if (a === 169 && b === 254) return true;
    // 100.64.0.0/10 – CGNAT
    if (a === 100 && b >= 64 && b <= 127) return true;
    // 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24 – documentation
    if (a === 192 && b === 0 && parts[2] === 2) return true;
    if (a === 198 && b === 51 && parts[2] === 100) return true;
    if (a === 203 && b === 0 && parts[2] === 113) return true;
    // 0.0.0.0/8
    if (a === 0) return true;
    return false;
  }
  if (version === 6) {
    const lower = ip.toLowerCase();
    // ::1 – loopback
    if (lower === '::1') return true;
    // fe80::/10 – link-local (fe80 – febf)
    if (/^fe[89ab]/.test(lower)) return true;
    // fc00::/7 – ULA (fc00:: and fd00::)
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
    // ::ffff:0:0/96 – IPv4-mapped
    if (lower.startsWith('::ffff:')) return true;
    return false;
  }
  // Unknown IP version — treat as private to be safe
  return true;
}

/**
 * Validate if a URL is safe to fetch.
 * Blocks private IPs, localhost, and non-http(s) schemes.
 */
export function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    
    // Only http/https
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    
    const hostname = parsed.hostname.toLowerCase();

    // Block "localhost" hostname
    if (hostname === 'localhost') return false;

    // If the hostname is a bare IP address, check for private ranges
    if (detectIpVersion(hostname) !== 0) {
      return !isPrivateIp(hostname);
    }

    // For hostnames, do a basic sanity check (non-empty)
    if (!hostname) return false;

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
