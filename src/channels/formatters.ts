/**
 * Channel Text Formatters
 * 
 * Converts markdown content to channel-specific formats:
 * - Telegram: HTML
 * - Slack: mrkdwn
 * - Discord: Native markdown (no conversion)
 * - Signal: Plain text (strip markdown)
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
    default:
      // Discord supports native markdown
      return text;
  }
}

/**
 * Convert markdown to Telegram HTML
 * Supports: <b>, <i>, <s>, <code>, <pre>, <a>, <tg-spoiler>, <blockquote>
 */
export function markdownToTelegramHtml(text: string): string {
  if (!text) return '';

  let html = escapeHtml(text);

  // Bold: **text** or __text__ → <b>text</b>
  html = html.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  html = html.replace(/__([^_]+)__/g, '<b>$1</b>');

  // Italic: *text* or _text_ → <i>text</i>
  // Note: Must come after bold, and avoid matching ** or __
  html = html.replace(/(?<![*_])\*(?![*])([^*]+)(?<![*])\*(?![*])/g, '<i>$1</i>');
  html = html.replace(/(?<!_)_(?!_)([^_]+)(?<!_)_(?!_)/g, '<i>$1</i>');

  // Strikethrough: ~~text~~ → <s>text</s>
  html = html.replace(/~~([^~]+)~~/g, '<s>$1</s>');

  // Spoiler: ||text|| → <tg-spoiler>text</tg-spoiler>
  html = html.replace(/\|\|([^|]+)\|\|/g, '<tg-spoiler>$1</tg-spoiler>');

  // Inline code: `code` → <code>code</code>
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Code block: ```lang\ncode``` → <pre><code class="language-lang">code</code></pre>
  html = html.replace(/```(\w+)?\n?([\s\S]*?)```/g, (match, lang, code) => {
    const escapedCode = escapeHtml(code.trim());
    if (lang) {
      return `<pre><code class="language-${lang}">${escapedCode}</code></pre>`;
    }
    return `<pre>${escapedCode}</pre>`;
  });

  // Links: [text](url) → <a href="url">text</a>
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Blockquote: > text → <blockquote>text</blockquote>
  // Handle multi-line blockquotes
  html = html.replace(/^&gt;\s?(.*)$/gm, '<blockquote>$1</blockquote>');

  // Clean up multiple consecutive blockquotes
  html = html.replace(/<\/blockquote>\s*<blockquote>/g, '\n');

  return html;
}

/**
 * Convert markdown to Slack mrkdwn
 * Supports: *bold*, _italic_, ~strikethrough~, `code`, ```code```, <url|label>
 */
export function markdownToSlackMrkdwn(text: string): string {
  if (!text) return '';

  let mrkdwn = escapeSlackText(text);

  // Bold: **text** or __text__ → *text*
  mrkdwn = mrkdwn.replace(/\*\*([^*]+)\*\*/g, '*$1*');
  mrkdwn = mrkdwn.replace(/__([^_]+)__/g, '*$1*');

  // Italic: *text* or _text_ → _text_
  // Note: Slack uses _ for italic, but we need to avoid matching ** or __
  mrkdwn = mrkdwn.replace(/(?<![*_])\*(?![*])([^*]+)(?<![*])\*(?![*])/g, '_$1_');

  // Strikethrough: ~~text~~ → ~text~
  mrkdwn = mrkdwn.replace(/~~([^~]+)~~/g, '~$1~');

  // Spoiler: ||text|| → ~text~ (Slack doesn't have spoiler, use strikethrough)
  mrkdwn = mrkdwn.replace(/\|\|([^|]+)\|\|/g, '~$1~');

  // Links: [text](url) → <url|text>
  mrkdwn = mrkdwn.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<$2|$1>');

  // Headers: ### Title → *Title*
  mrkdwn = mrkdwn.replace(/^#{1,6}\s+(.+)$/gm, '*$1*');

  // Blockquote: > text → > text (Slack supports this)
  // No conversion needed, but ensure proper escaping

  return mrkdwn;
}

/**
 * Strip markdown formatting for plain text output (Signal, etc.)
 */
export function stripMarkdown(text: string): string {
  if (!text) return '';

  let plain = text;

  // Remove bold: **text** or __text__
  plain = plain.replace(/\*\*([^*]+)\*\*/g, '$1');
  plain = plain.replace(/__([^_]+)__/g, '$1');

  // Remove italic: *text* or _text_
  plain = plain.replace(/(?<![*_])\*(?![*])([^*]+)(?<![*])\*(?![*])/g, '$1');
  plain = plain.replace(/(?<!_)_(?!_)([^_]+)(?<!_)_(?!_)/g, '$1');

  // Remove strikethrough: ~~text~~
  plain = plain.replace(/~~([^~]+)~~/g, '$1');

  // Remove spoiler: ||text||
  plain = plain.replace(/\|\|([^|]+)\|\|/g, '$1');

  // Remove headers: ### Title
  plain = plain.replace(/^#{1,6}\s+(.+)$/gm, '$1');

  // Remove blockquote markers: > text
  plain = plain.replace(/^>\s?(.*)$/gm, '$1');

  // Remove inline code: `code`
  plain = plain.replace(/`([^`]+)`/g, '$1');

  // Remove code blocks: ```lang\ncode```
  plain = plain.replace(/```(\w+)?\n?([\s\S]*?)```/g, '$2');

  // Convert links: [text](url) → text (url)
  plain = plain.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');

  // Clean up extra whitespace
  plain = plain.replace(/\n{3,}/g, '\n\n');
  plain = plain.trim();

  return plain;
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Escape Slack mrkdwn special characters while preserving valid tokens
 */
function escapeSlackText(text: string): string {
  if (!text) return '';

  // Slack mrkdwn special chars: &, <, >
  // But we need to preserve valid angle-bracket tokens like <@user>, <#channel>, <!command>, <url>

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
  if (!token.startsWith('<') || !token.endsWith('>')) {
    return false;
  }
  const inner = token.slice(1, -1);
  return (
    inner.startsWith('@') ||
    inner.startsWith('#') ||
    inner.startsWith('!') ||
    inner.startsWith('mailto:') ||
    inner.startsWith('tel:') ||
    inner.startsWith('http://') ||
    inner.startsWith('https://') ||
    inner.startsWith('slack://')
  );
}
