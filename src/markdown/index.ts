/**
 * Markdown Utilities
 * 
 * Parse and generate markdown content.
 */

/**
 * Parse markdown frontmatter
 */
export function parseFrontmatter(content: string): { data: Record<string, any>; content: string } {
  const frontmatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    return { data: {}, content };
  }

  const data: Record<string, any> = {};
  const frontmatter = match[1];
  
  // Simple YAML-like parsing
  for (const line of frontmatter.split('\n')) {
    const [key, ...valueParts] = line.split(':');
    if (key && valueParts.length > 0) {
      const value = valueParts.join(':').trim();
      // Try to parse as JSON, otherwise keep as string
      try {
        data[key.trim()] = JSON.parse(value);
      } catch {
        data[key.trim()] = value;
      }
    }
  }

  return { data, content: match[2].trim() };
}

/**
 * Generate markdown with frontmatter
 */
export function generateMarkdown(data: Record<string, any>, content: string): string {
  const frontmatter = Object.entries(data)
    .map(([key, value]) => {
      const val = typeof value === 'string' ? value : JSON.stringify(value);
      return `${key}: ${val}`;
    })
    .join('\n');

  return `---\n${frontmatter}\n---\n\n${content}`;
}

/**
 * Extract headings from markdown
 */
export function extractHeadings(content: string): Array<{ level: number; text: string }> {
  const headingRegex = /^(#{1,6})\s+(.+)$/gm;
  const headings: Array<{ level: number; text: string }> = [];
  let match;

  while ((match = headingRegex.exec(content)) !== null) {
    headings.push({
      level: match[1].length,
      text: match[2].trim()
    });
  }

  return headings;
}

/**
 * Convert markdown to plain text
 */
export function markdownToText(content: string): string {
  return content
    .replace(/#{1,6}\s+/g, '') // Remove headings
    .replace(/\*\*|__/g, '') // Remove bold
    .replace(/\*|_/g, '') // Remove italic
    .replace(/`{3}[\s\S]*?`{3}/g, '') // Remove code blocks
    .replace(/`([^`]+)`/g, '$1') // Remove inline code
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Convert links to text
    .replace(/\n+/g, ' ') // Collapse newlines
    .trim();
}
