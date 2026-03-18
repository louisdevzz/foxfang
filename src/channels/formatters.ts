/**
 * Channel Text Formatters
 * 
 * Converts markdown content to channel-specific formats.
 * 
 * Approach:
 * 1. Parse markdown to tokens
 * 2. Render tokens to channel-specific format
 * 
 * This handles nesting correctly (bold inside links, etc.)
 */

export type ChannelFormat = 'html' | 'mrkdwn' | 'markdown' | 'plain';

// ============================================================================
// Token Types
// ============================================================================

type TokenType = 
  | 'text' 
  | 'bold' 
  | 'italic' 
  | 'strikethrough'
  | 'underline'
  | 'code'
  | 'codeblock'
  | 'link'
  | 'spoiler'
  | 'blockquote'
  | 'heading'
  | 'list_item'
  | 'line_break';

interface Token {
  type: TokenType;
  content: string;
  children?: Token[];
  language?: string; // for code blocks
  url?: string; // for links
  level?: number; // for headings
}

// ============================================================================
// Markdown Parser
// ============================================================================

/**
 * Parse markdown into tokens
 * Handles nesting by processing in correct order
 */
function parseMarkdown(text: string): Token[] {
  if (!text) return [];
  
  const tokens: Token[] = [];
  const lines = text.split('\n');
  let i = 0;
  
  while (i < lines.length) {
    const line = lines[i];
    
    // Code blocks (must be before other processing)
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      tokens.push({
        type: 'codeblock',
        content: codeLines.join('\n'),
        language: lang || undefined
      });
      i++;
      continue;
    }
    
    // Blockquote
    if (line.startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith('>')) {
        quoteLines.push(lines[i].slice(1).trim());
        i++;
      }
      tokens.push({
        type: 'blockquote',
        content: quoteLines.join('\n'),
        children: parseInline(quoteLines.join('\n'))
      });
      continue;
    }
    
    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      tokens.push({
        type: 'heading',
        content: headingMatch[2],
        level: headingMatch[1].length,
        children: parseInline(headingMatch[2])
      });
      i++;
      continue;
    }
    
    // List item
    const listMatch = line.match(/^(\s*)[-*]\s+(.+)$/);
    if (listMatch) {
      tokens.push({
        type: 'list_item',
        content: listMatch[2],
        children: parseInline(listMatch[2])
      });
      i++;
      continue;
    }
    
    // Empty line (paragraph break)
    if (line.trim() === '') {
      tokens.push({ type: 'line_break', content: '' });
      i++;
      continue;
    }
    
    // Regular paragraph with inline formatting
    tokens.push({
      type: 'text',
      content: line,
      children: parseInline(line)
    });
    i++;
  }
  
  return tokens;
}

/**
 * Parse inline markdown (bold, italic, code, links, etc.)
 * Uses a stack-based approach to handle nesting
 */
function parseInline(text: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;
  
  // Patterns for inline elements (order matters - longer patterns first)
  const patterns = [
    { type: 'spoiler' as TokenType, regex: /^\|\|(.+?)\|\|/ },
    { type: 'bold' as TokenType, regex: /^\*\*(.+?)\*\*/ },
    { type: 'bold' as TokenType, regex: /^__(.+?)__/ },
    { type: 'code' as TokenType, regex: /^`([^`]+)`/ },
    { type: 'strikethrough' as TokenType, regex: /^~~(.+?)~~/ },
    { type: 'underline' as TokenType, regex: /^_(.+?)_/ },
    { type: 'italic' as TokenType, regex: /^\*(.+?)\*/ },
    { type: 'link' as TokenType, regex: /^\[([^\]]+)\]\(([^)]+)\)/ },
  ];
  
  while (pos < text.length) {
    let matched = false;
    
    // Try each pattern
    for (const pattern of patterns) {
      const substr = text.slice(pos);
      const match = substr.match(pattern.regex);
      
      if (match) {
        const token: Token = {
          type: pattern.type,
          content: match[1],
        };
        
        if (pattern.type === 'link') {
          token.url = match[2];
          // Parse nested content inside link text
          token.children = parseInline(match[1]);
        } else {
          // Parse nested content for other inline elements
          token.children = parseInline(match[1]);
        }
        
        tokens.push(token);
        pos += match[0].length;
        matched = true;
        break;
      }
    }
    
    if (!matched) {
      // No pattern matched, consume one character as text
      const char = text[pos];
      const lastToken = tokens[tokens.length - 1];
      
      if (lastToken?.type === 'text') {
        lastToken.content += char;
      } else {
        tokens.push({ type: 'text', content: char });
      }
      pos++;
    }
  }
  
  return tokens;
}

// ============================================================================
// Telegram HTML Renderer
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

function renderTelegramToken(token: Token): string {
  switch (token.type) {
    case 'text':
      // If children exist (parsed inline), render them; otherwise escape content
      return token.children?.map(renderTelegramToken).join('') || escapeHtml(token.content);
    
    case 'bold':
      return `<b>${token.children?.map(renderTelegramToken).join('') || escapeHtml(token.content)}</b>`;
    
    case 'italic':
      return `<i>${token.children?.map(renderTelegramToken).join('') || escapeHtml(token.content)}</i>`;
    
    case 'underline':
      // Telegram uses <u> or <i> for underline (using <i> for compatibility)
      return `<i>${token.children?.map(renderTelegramToken).join('') || escapeHtml(token.content)}</i>`;
    
    case 'strikethrough':
      return `<s>${token.children?.map(renderTelegramToken).join('') || escapeHtml(token.content)}</s>`;
    
    case 'spoiler':
      return `<tg-spoiler>${token.children?.map(renderTelegramToken).join('') || escapeHtml(token.content)}</tg-spoiler>`;
    
    case 'code':
      return `<code>${escapeHtml(token.content)}</code>`;
    
    case 'codeblock':
      if (token.language) {
        return `<pre><code class="language-${token.language}">${escapeHtml(token.content)}</code></pre>`;
      }
      return `<pre>${escapeHtml(token.content)}</pre>`;
    
    case 'link':
      const linkContent = token.children?.map(renderTelegramToken).join('') || escapeHtml(token.content);
      return `<a href="${escapeHtmlAttr(token.url || '')}">${linkContent}</a>`;
    
    case 'blockquote':
      return `<blockquote>${token.children?.map(renderTelegramToken).join('') || escapeHtml(token.content)}</blockquote>`;
    
    case 'heading':
      // Telegram doesn't support headings, use bold
      return `<b>${token.children?.map(renderTelegramToken).join('') || escapeHtml(token.content)}</b>`;
    
    case 'list_item':
      return `• ${token.children?.map(renderTelegramToken).join('') || escapeHtml(token.content)}`;
    
    case 'line_break':
      return '\n';
    
    default:
      return escapeHtml(token.content);
  }
}

export function markdownToTelegramHtml(text: string): string {
  const tokens = parseMarkdown(text);
  return tokens.map(renderTelegramToken).join('\n').replace(/\n{3,}/g, '\n\n');
}

// ============================================================================
// Slack mrkdwn Renderer
// ============================================================================

function escapeSlackText(text: string): string {
  // Preserve valid Slack tokens: <@user>, <#channel>, <!command>, <url>, <url|label>
  const ANGLE_TOKEN_RE = /<[^>\n]+>/g;
  let result = '';
  let lastIndex = 0;
  
  for (const match of text.matchAll(ANGLE_TOKEN_RE)) {
    const matchIndex = match.index ?? 0;
    const token = match[0];
    const inner = token.slice(1, -1);
    
    // Escape text before token
    result += text.slice(lastIndex, matchIndex).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    
    // Check if valid Slack token
    const isValid = inner.startsWith('@') || inner.startsWith('#') || inner.startsWith('!') ||
                   inner.startsWith('mailto:') || inner.startsWith('tel:') ||
                   inner.startsWith('http://') || inner.startsWith('https://') ||
                   inner.startsWith('slack://') || inner.includes('|');
    
    if (isValid) {
      result += token;
    } else {
      result += token.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    
    lastIndex = matchIndex + token.length;
  }
  
  result += text.slice(lastIndex).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return result;
}

function renderSlackToken(token: Token): string {
  switch (token.type) {
    case 'text':
      return token.children?.map(renderSlackToken).join('') || token.content;
    
    case 'bold':
      return `*${token.children?.map(renderSlackToken).join('') || token.content}*`;
    
    case 'italic':
    case 'underline':
      return `_${token.children?.map(renderSlackToken).join('') || token.content}_`;
    
    case 'strikethrough':
    case 'spoiler':
      return `~${token.children?.map(renderSlackToken).join('') || token.content}~`;
    
    case 'code':
      return `\`${token.content}\``;
    
    case 'codeblock':
      return `\`\`\`${token.language || ''}\n${token.content}\`\`\``;
    
    case 'link':
      const linkContent = token.children?.map(renderSlackToken).join('') || token.content;
      return `<${token.url}|${linkContent.replace(/\|/g, '\\|')}>`;
    
    case 'blockquote':
      return `> ${token.content.split('\n').join('\n> ')}`;
    
    case 'heading':
      return `*${token.children?.map(renderSlackToken).join('') || token.content}*`;
    
    case 'list_item':
      return `• ${token.children?.map(renderSlackToken).join('') || token.content}`;
    
    case 'line_break':
      return '\n';
    
    default:
      return token.content;
  }
}

export function markdownToSlackMrkdwn(text: string): string {
  const tokens = parseMarkdown(text);
  const result = tokens.map(renderSlackToken).join('\n').replace(/\n{3,}/g, '\n\n');
  return escapeSlackText(result);
}

// ============================================================================
// Discord Renderer
// ============================================================================

function renderDiscordToken(token: Token): string {
  switch (token.type) {
    case 'text':
      return token.children?.map(renderDiscordToken).join('') || token.content;
    
    case 'bold':
      return `**${token.children?.map(renderDiscordToken).join('') || token.content}**`;
    
    case 'italic':
      return `*${token.children?.map(renderDiscordToken).join('') || token.content}*`;
    
    case 'underline':
      return `__${token.children?.map(renderDiscordToken).join('') || token.content}__`;
    
    case 'strikethrough':
      return `~~${token.children?.map(renderDiscordToken).join('') || token.content}~~`;
    
    case 'spoiler':
      return `||${token.children?.map(renderDiscordToken).join('') || token.content}||`;
    
    case 'code':
      return `\`${token.content}\``;
    
    case 'codeblock':
      return `\`\`\`${token.language || ''}\n${token.content}\`\`\``;
    
    case 'link':
      const linkContent = token.children?.map(renderDiscordToken).join('') || token.content;
      return `[${linkContent}](${token.url})`;
    
    case 'blockquote':
      return `> ${token.content.split('\n').join('\n> ')}`;
    
    case 'heading':
      // Discord supports # ## ### for headers
      if (token.level && token.level <= 3) {
        return `${'#'.repeat(token.level)} ${token.children?.map(renderDiscordToken).join('') || token.content}`;
      }
      return `**${token.children?.map(renderDiscordToken).join('') || token.content}**`;
    
    case 'list_item':
      return `• ${token.children?.map(renderDiscordToken).join('') || token.content}`;
    
    case 'line_break':
      return '\n';
    
    default:
      return token.content;
  }
}

function formatForDiscord(text: string): string {
  const tokens = parseMarkdown(text);
  return tokens.map(renderDiscordToken).join('\n').replace(/\n{4,}/g, '\n\n\n');
}

// ============================================================================
// Plain Text Renderer (Signal, etc.)
// ============================================================================

function renderPlainToken(token: Token): string {
  switch (token.type) {
    case 'text':
      return token.children?.map(renderPlainToken).join('') || token.content;
    
    case 'bold':
    case 'italic':
    case 'underline':
    case 'strikethrough':
    case 'spoiler':
      return token.children?.map(renderPlainToken).join('') || token.content;
    
    case 'code':
      return token.content;
    
    case 'codeblock':
      return token.content;
    
    case 'link':
      const linkContent = token.children?.map(renderPlainToken).join('') || token.content;
      return `${linkContent} (${token.url})`;
    
    case 'blockquote':
      return token.content;
    
    case 'heading':
      return token.children?.map(renderPlainToken).join('') || token.content;
    
    case 'list_item':
      return `• ${token.children?.map(renderPlainToken).join('') || token.content}`;
    
    case 'line_break':
      return '\n';
    
    default:
      return token.content;
  }
}

export function stripMarkdown(text: string): string {
  const tokens = parseMarkdown(text);
  return tokens.map(renderPlainToken).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ============================================================================
// Main Export
// ============================================================================

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
// Utilities
// ============================================================================

export function containsMarkdown(text: string): boolean {
  const markdownPatterns = [
    /\*\*[^*]+\*\*/, /__[^_]+__/, /\*[^*]+\*/, /_[^_]+_/,
    /~~[^~]+~~/, /`[^`]+`/, /```[\s\S]*?```/,
    /\[[^\]]+\]\([^)]+\)/, /^#{1,6}\s+/m, /^>\s?/m, /\|\|[^|]+\|\|/,
  ];
  return markdownPatterns.some(p => p.test(text));
}

export function chunkText(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];
  
  const chunks: string[] = [];
  let remaining = text;
  
  while (remaining.length > 0) {
    let breakPoint = maxLength;
    
    // Try newline first
    const lastNewline = remaining.lastIndexOf('\n', maxLength);
    if (lastNewline > maxLength * 0.8) {
      breakPoint = lastNewline;
    } else {
      // Try sentence end
      const lastSentence = remaining.lastIndexOf('. ', maxLength);
      if (lastSentence > maxLength * 0.7) {
        breakPoint = lastSentence + 1;
      } else {
        // Word boundary
        const lastSpace = remaining.lastIndexOf(' ', maxLength);
        if (lastSpace > 0) breakPoint = lastSpace;
      }
    }
    
    chunks.push(remaining.slice(0, breakPoint).trim());
    remaining = remaining.slice(breakPoint).trim();
  }
  
  return chunks;
}
