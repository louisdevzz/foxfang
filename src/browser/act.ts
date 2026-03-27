/**
 * Browser Actions
 * 
 * Perform actions on browser pages (click, type, etc.)
 */

import type { Page } from 'playwright';
import type { BrowserActRequest } from './types';

export async function performAction(
  page: Page,
  request: BrowserActRequest
): Promise<{ success: boolean; error?: string }> {
  const { kind } = request;

  try {
    switch (kind) {
      case 'click':
        return await performClick(page, request);
      case 'type':
        return await performType(page, request);
      case 'press':
        return await performPress(page, request);
      case 'hover':
        return await performHover(page, request);
      case 'fill':
        return await performFill(page, request);
      case 'wait':
        return await performWait(page, request);
      case 'evaluate':
        return await performEvaluate(page, request);
      case 'close':
        return await performClose(page);
      default:
        return { success: false, error: `Unknown action kind: ${kind}` };
    }
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : String(error) 
    };
  }
}

async function performClick(
  page: Page,
  request: BrowserActRequest
): Promise<{ success: boolean; error?: string }> {
  const { ref, selector, doubleClick, button = 'left' } = request;

  const target = selector || ref;
  if (!target) {
    return { success: false, error: 'No target specified for click' };
  }

  if (doubleClick) {
    await page.dblclick(target, { button: button as any });
  } else {
    await page.click(target, { button: button as any });
  }

  return { success: true };
}

async function performType(
  page: Page,
  request: BrowserActRequest
): Promise<{ success: boolean; error?: string }> {
  const { ref, selector, text = '', submit = false, slowly = false } = request;

  const target = selector || ref;
  if (!target) {
    return { success: false, error: 'No target specified for type' };
  }

  await page.type(target, text, { 
    delay: slowly ? 50 : undefined,
  });

  if (submit) {
    await page.press(target, 'Enter');
  }

  return { success: true };
}

async function performPress(
  page: Page,
  request: BrowserActRequest
): Promise<{ success: boolean; error?: string }> {
  const { ref, selector, key = '' } = request;

  const target = selector || ref;
  if (!target) {
    // Press globally
    await page.keyboard.press(key);
  } else {
    await page.press(target, key);
  }

  return { success: true };
}

async function performHover(
  page: Page,
  request: BrowserActRequest
): Promise<{ success: boolean; error?: string }> {
  const { ref, selector } = request;

  const target = selector || ref;
  if (!target) {
    return { success: false, error: 'No target specified for hover' };
  }

  await page.hover(target);
  return { success: true };
}

async function performFill(
  page: Page,
  request: BrowserActRequest
): Promise<{ success: boolean; error?: string }> {
  const { ref, selector, text = '' } = request;

  const target = selector || ref;
  if (!target) {
    return { success: false, error: 'No target specified for fill' };
  }

  await page.fill(target, text);
  return { success: true };
}

async function performWait(
  page: Page,
  request: BrowserActRequest
): Promise<{ success: boolean; error?: string }> {
  const { timeMs, selector, loadState } = request;

  if (timeMs) {
    await page.waitForTimeout(timeMs);
    return { success: true };
  }

  if (selector) {
    await page.waitForSelector(selector);
    return { success: true };
  }

  if (loadState) {
    await page.waitForLoadState(loadState as any);
    return { success: true };
  }

  // Default: wait for network idle
  await page.waitForLoadState('networkidle');
  return { success: true };
}

async function performEvaluate(
  page: Page,
  request: BrowserActRequest
): Promise<{ success: boolean; error?: string; result?: any }> {
  const { fn = '' } = request;

  if (!fn) {
    return { success: false, error: 'No function provided for evaluate' };
  }

  const result = await page.evaluate((code) => {
    try {
      // eslint-disable-next-line no-eval
      return eval(code);
    } catch (e) {
      return { error: String(e) };
    }
  }, fn);

  if (result?.error) {
    return { success: false, error: result.error };
  }

  return { success: true, result };
}

async function performClose(
  page: Page
): Promise<{ success: boolean; error?: string }> {
  await page.close();
  return { success: true };
}
