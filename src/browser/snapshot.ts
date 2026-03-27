/**
 * Snapshot Logic
 * 
 * Page snapshot and accessibility tree extraction
 */

import type { Page } from 'playwright';
import type { SnapshotResult, SnapshotAriaNode } from './types';

export async function takeSnapshot(
  page: Page,
  options: {
    format?: 'aria' | 'ai';
    limit?: number;
    maxChars?: number;
    interactive?: boolean;
    compact?: boolean;
    refs?: 'role' | 'aria';
  } = {}
): Promise<SnapshotResult> {
  const {
    format = 'ai',
    limit = 1000,
    maxChars = 8000,
    interactive = false,
    compact = false,
    refs = 'role',
  } = options;

  const url = page.url();

  if (format === 'aria') {
    const nodes = await buildAriaTree(page, { limit, interactive });

    return {
      ok: true,
      format: 'aria',
      targetId: 'main',
      url,
      nodes,
    };
  }

  const content = await page.evaluate(() => {
    const getText = (el: Element): string => {
      const tag = el.tagName.toLowerCase();
      const text = el.textContent?.trim() || '';
      
      if (tag === 'a') {
        const href = (el as HTMLAnchorElement).href;
        return text ? `[${text}](${href})` : `[link](${href})`;
      }
      
      if (tag === 'button' || tag === 'input' || tag === 'select' || tag === 'textarea') {
        const input = el as HTMLInputElement;
        const value = input.value || text;
        const placeholder = input.placeholder;
        return `${tag}${value ? `: "${value}"` : ''}${placeholder ? ` (placeholder: "${placeholder}")` : ''}`;
      }
      
      return text;
    };

    const walk = (el: Element, depth: number): string[] => {
      const results: string[] = [];
      
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') {
        return results;
      }

      const text = getText(el);
      if (text && depth < 20) {
        results.push('  '.repeat(depth) + text.slice(0, 200));
      }

      Array.from(el.children).forEach((child) => {
        results.push(...walk(child, depth + 1));
      });

      return results;
    };

    return walk(document.body, 0).slice(0, 500).join('\n');
  });

  const truncated = content.length > maxChars;
  const snapshot = content.slice(0, maxChars);

  return {
    ok: true,
    format: 'ai',
    targetId: 'main',
    url,
    snapshot,
    truncated,
    stats: {
      lines: snapshot.split('\n').length,
      chars: snapshot.length,
      refs: 0,
      interactive: 0,
    },
  };
}

async function buildAriaTree(
  page: Page,
  options: { limit?: number; interactive?: boolean }
): Promise<SnapshotAriaNode[]> {
  const { limit = 1000, interactive = false } = options;

  return await page.evaluate((opts) => {
    const limit = opts.limit || 1000;
    const interactive = opts.interactive || false;
    const nodes: SnapshotAriaNode[] = [];
    let refCounter = 1;

    const isInteractive = (el: Element): boolean => {
      const tag = el.tagName.toLowerCase();
      const interactiveTags = ['a', 'button', 'input', 'select', 'textarea', 'details'];
      return interactiveTags.includes(tag) || el.hasAttribute('onclick');
    };

    const walk = (el: Element, depth: number) => {
      if (nodes.length >= limit) return;

      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') {
        return;
      }

      const role = el.getAttribute('role') || el.tagName.toLowerCase();
      const name = el.getAttribute('aria-label') || 
                   (el as any).innerText?.slice(0, 100) || 
                   el.textContent?.slice(0, 100) || 
                   '';

      if (interactive && !isInteractive(el)) {
        Array.from(el.children).forEach((child) => {
          walk(child, depth);
        });
        return;
      }

      if (name.trim()) {
        const ref = `e${refCounter++}`;
        nodes.push({
          ref,
          role,
          name: name.trim(),
          depth,
        });
      }

      Array.from(el.children).forEach((child) => {
        walk(child, depth + 1);
      });
    };

    walk(document.body, 0);
    return nodes;
  }, options as any);
}

export async function findElementByRef(
  page: Page,
  ref: string
): Promise<any | null> {
  try {
    const element = await page.locator(ref).first();
    if (await element.count() > 0) {
      return element;
    }
  } catch {
    // Not a valid CSS selector
  }

  return null;
}
