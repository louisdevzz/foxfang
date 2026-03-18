/**
 * Channel Text Formatters
 * 
 * Converts markdown content to channel-specific formats:
 * - Telegram: HTML
 * - Slack: mrkdwn  
 * - Discord: Native markdown (with enhancements)
 * - Signal: Plain text (strip markdown)
 * 
 * Inspired by OpenClaw's approach: parse once, render per-channel
 */

export type ChannelFormat = 'html' | 'mrkdwn' | 'markdown' | 'plain';

/**
 * Format text for a specific channel
 */
export function formatForChannel(text: string, channel: string): string {
  switch (channel) {
    case 'telegram':
      return markdownToTelegramHtml(text);
    case 'slack':
      return markdownToSlackMrkdwn(text);
    case 'signal':
      return stripMarkdown(text);
    case 'discord':
      return formatForDiscord(text);
    default:
      return text;
  }
}

// ============================================================================
// Telegram HTML Formatter
// ============================================================================

/**
 * Convert markdown to Telegram HTML
 * Telegram supports: <b>, <i>, <s>, <u>, <code>, <pre>, <a>, <tg-spoiler>, <blockquote>
 */
export function markdownToTelegramHtml(text: string): string {
  if (!text) return '';

  // Process in order: code blocks → inline code → links → formatting
  let html = text;

  // 1. Code blocks first (before inline code)
  html = html.replace(/```(\w+)?\n?([\s\S]*?)```/g, (match, lang, code) => {
    const escapedCode = escapeHtml(code.trim());
    if (lang) {
      return `<pre><code class="language-${lang}">${escapedCode}</code></pre>`;
    }
    return `<pre>${escapedCode}</pre>`;
  });

  // 2. Inline code (after code blocks)
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // 3. Links (before formatting to avoid conflicts)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, label, url) => {
    return `<a href="${escapeHtmlAttr(url)}">${escapeHtml(label)}</a>`;
  });

  // 4. Bold: **text** → <b>text</b>
  html = html.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');

  // 5. Italic: *text* or _text_ → <i>text</i>
  // Must avoid matching inside HTML tags we already created
  html = html.replace(/(^|[^*])\*([^*]+)\*(?![*])/g, '$1<i>$2</i>');
  html = html.replace(/(^|[^_])_([^_]+)_(?!_)/g, '$1<i>$2</i>');

  // 6. Strikethrough: ~~text~~ → <s>text</s>
  html = html.replace(/~~([^~]+)~~/g, '<s>$1</s>');

  // 7. Spoiler: ||text|| → <tg-spoiler>text</tg-spoiler>
  html = html.replace(/\|\|([^|]+)\|\|/g, '<tg-spoiler>$1</tg-spoiler>');

  // 8. Underline: __text__ (if not already processed as bold) → <u>text</u>
  // Note: __ is already handled as bold, so we skip this or use alternative syntax

  // 9. Headers: ### Title → <b>Title</b>
  html = html.replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>');

  // 10. Blockquote: > text → <blockquote>text</blockquote>
  // Handle multi-line by joining consecutive lines
  const lines = html.split('\n');
  const result: string[] = [];
  let inBlockquote = false;

  for (const line of lines) {
    const blockquoteMatch = line.match(/^(\s*)>&gt;\s?(.*)$/);
    if (blockquoteMatch) {
      if (!inBlockquote) {
        result.push('<blockquote>');
        inBlockquote = true;
      }
      result.push(blockquoteMatch[2]);
    } else {
      if (inBlockquote) {
        result.push('</blockquote>');
        inBlockquote = false;
      }
      result.push(line);
    }
  }
  if (inBlockquote) {
    result.push('</blockquote>');
  }
  html = result.join('\n');

  // Clean up: remove excessive newlines
  html = html.replace(/\n{3,}/g, '\n\n');

  return html;
}

// ============================================================================
// Slack mrkdwn Formatter  
// ============================================================================

/**
 * Convert markdown to Slack mrkdwn format
 * Slack uses: *bold*, _italic_, ~strikethrough~, `code`, ```code```, <url|label>
 */
export function markdownToSlackMrkdwn(text: string): string {
  if (!text) return '';

  let mrkdwn = text;

  // 1. Code blocks first
  mrkdwn = mrkdwn.replace(/```(\w+)?\n?([\s\S]*?)```/g, '```$2```');

  // 2. Inline code (preserve as-is)
  // mrkdwn uses `code` same as markdown

  // 3. Links: [text](url) → <url|text>
  mrkdwn = mrkdwn.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, label, url) => {
    // Escape | in label to avoid breaking Slack link format
    const safeLabel = label.replace(/\|/g, '\\|');
    return `<${url}|${safeLabel}>`;
  });

  // 4. Bold: **text** → *text* (Slack uses single asterisk)
  mrkdwn = mrkdwn.replace(/\*\*([^*]+)\*\*/g, '*$1*');

  // 5. Italic: *text* or _text_ → _text_ (Slack uses underscore)
  // Convert single asterisks to underscores
  mrkdwn = mrkdwn.replace(/(?<![*])\*(?![*])([^*]+)(?<![*])\*(?![*])/g, '_$1_');

  // 6. Strikethrough: ~~text~~ → ~text~
  mrkdwn = mrkdwn.replace(/~~([^~]+)~~/g, '~$1~');

  // 7. Spoiler: ||text|| → _text_ (Slack doesn't have spoiler)
  mrkdwn = mrkdwn.replace(/\|\|([^|]+)\|\|/g, '_$1_');

  // 8. Headers: ### Title → *Title*
  mrkdwn = mrkdwn.replace(/^#{1,6}\s+(.+)$/gm, '*$1*');

  // 9. Lists: convert - or * to proper Slack bullets
  mrkdwn = mrkdwn.replace(/^(\s*)[-*]\s(.+)$/gm, '$1• $2');

  // 10. Escape special characters (&, <, >) outside of valid tokens
  mrkdwn = escapeSlackMrkdwn(mrkdwn);

  return mrkdwn;
}

/**
 * Escape Slack mrkdwn special characters while preserving valid tokens
 */
function escapeSlackMrkdwn(text: string): string {
  // Valid Slack angle-bracket tokens: <@user>, <#channel>, <!command>, <url>, <url|label>
  const ANGLE_TOKEN_RE = /<[^>\n]+>/g;

  let result = '';
  let lastIndex = 0;

  for (const match of text.matchAll(ANGLE_TOKEN_RE)) {
    const matchIndex = match.index ?? 0;
    const token = match[0];

    // Escape text before the token
    result += escapeSlackSegment(text.slice(lastIndex, matchIndex));

    // Check if it's a valid Slack token
    if (isValidSlackToken(token)) {
      result += token;
    } else {
      result += escapeSlackSegment(token);
    }

    lastIndex = matchIndex + token.length;
  }

  // Escape remaining text
  result += escapeSlackSegment(text.slice(lastIndex));

  return result;
}

function escapeSlackSegment(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function isValidSlackToken(token: string): boolean {
  if (!token.startsWith('<') || !token.endsWith('>')) return false;
  const inner = token.slice(1, -1);
  return (
    inner.startsWith('@') ||
    inner.startsWith('#') ||
    inner.startsWith('!') ||
    inner.startsWith('mailto:') ||
    inner.startsWith('tel:') ||
    inner.startsWith('http://') ||
    inner.startsWith('https://') ||
    inner.startsWith('slack://') ||
    inner.includes('|') // <url|label> format
  );
}

// ============================================================================
// Discord Formatter
// ============================================================================

/**
 * Format for Discord - mostly native markdown with some enhancements
 * Discord supports: **bold**, *italic*, __underline__, ~~strikethrough~~, 
 * `code`, ```code```, ||spoiler||, > quote, # headers (level 1-3)
 */
function formatForDiscord(text: string): string {
  if (!text) return '';

  let discord = text;

  // Discord supports most standard markdown, but we can enhance:
  
  // Convert ####+ headers to bold (Discord only supports # ## ###)
  discord = discord.replace(/^#{4,6}\s+(.+)$/gm, '**$1**');

  // Ensure proper spacing around lists for better rendering
  discord = discord.replace(/^(\s*)[-*]\s(.+)$/gm, '$1• $2');

  // Clean up excessive newlines
  discord = discord.replace(/\n{4,}/g, '\n\n\n');

  return discord;
}

// ============================================================================
// Plain Text Formatter (Signal, etc.)
// ============================================================================

/**
 * Strip markdown formatting for plain text output
 */
export function stripMarkdown(text: string): string {
  if (!text) return '';

  let plain = text;

  // 1. Remove code blocks first
  plain = plain.replace(/```(\w+)?\n?([\s\S]*?)```/g, '$2');

  // 2. Remove inline code
  plain = plain.replace(/`([^`]+)`/g, '$1');

  // 3. Convert links: [text](url) → text (url)
  plain = plain.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');

  // 4. Remove bold: **text**
  plain = plain.replace(/\*\*([^*]+)\*\*/g, '$1');

  // 5. Remove italic: *text* or _text_
  plain = plain.replace(/\*([^*]+)\*/g, '$1');
  plain = plain.replace(/_([^_]+)_/g, '$1');

  // 6. Remove underline: __text__
  plain = plain.replace(/__([^_]+)__/g, '$1');

  // 7. Remove strikethrough: ~~text~~
  plain = plain.replace(/~~([^~]+)~~/g, '$1');

  // 8. Remove spoiler: ||text||
  plain = plain.replace(/\|\|([^|]+)\|\|/g, '$1');

  // 9. Remove headers: ### Title
  plain = plain.replace(/^#{1,6}\s+(.+)$/gm, '$1');

  // 10. Remove blockquote markers
  plain = plain.replace(/^>\s?(.*)$/gm, '$1');

  // Clean up whitespace
  plain = plain.replace(/\n{3,}/g, '\n\n');
  plain = plain.trim();

  return plain;
}

// ============================================================================
// HTML Utilities
// ============================================================================

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeHtmlAttr(text: string): string {
  return escapeHtml(text).replace(/"/g, '&quot;');
}

// ============================================================================
// Smart Format Detection
// ============================================================================

/**
 * Detect if text contains markdown that needs conversion
 */
export function containsMarkdown(text: string): boolean {
  const markdownPatterns = [
    /\*\*[^*]+\*\*/,      // Bold
    /\*[^*]+\*/,          // Italic
    /__[^_]+__/,          // Underline/Bold
    /_[^_]+_/,            // Italic
    /~~[^~]+~~/,          // Strikethrough
    /`[^`]+`/,            // Inline code
    /```[\s\S]*?```/,     // Code block
    /\[[^\]]+\]\([^)]+\)/, // Links
    /^#{1,6}\s+/m,        // Headers
    /^>\s?/m,             // Blockquotes
    /\|\|[^|]+\|\|/,      // Spoilers
  ];

  return markdownPatterns.some(pattern => pattern.test(text));
}

/**
 * Chunk text for channel limits
 */
export function chunkText(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    // Find a good break point
    let breakPoint = maxLength;
    
    // Try to break at newline
    const lastNewline = remaining.lastIndexOf('\n', maxLength);
    if (lastNewline > maxLength * 0.8) {
      breakPoint = lastNewline;
    } else {
      // Try to break at sentence end
      const lastSentence = remaining.lastIndexOf('. ', maxLength);
      if (lastSentence > maxLength * 0.7) {
        breakPoint = lastSentence + 1;
      } else {
        // Break at word boundary
        const lastSpace = remaining.lastIndexOf(' ', maxLength);
        if (lastSpace > 0) {
          breakPoint = lastSpace;
        }
      }
    }

    chunks.push(remaining.slice(0, breakPoint).trim());
    remaining = remaining.slice(breakPoint).trim();
  }

  return chunks;
}
