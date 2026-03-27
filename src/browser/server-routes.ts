/**
 * Server Routes
 * 
 * HTTP route handlers for browser server
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { URL } from 'url';
import type { BrowserServerState, BrowserTab } from './types';
import { getStatus, listKnownProfiles } from './server-context';
import { ProfileManager } from './profiles';
import { takeSnapshot } from './snapshot';
import { performAction } from './act';
import type { BrowserActRequest } from './types';

export function createRouteHandler(state: BrowserServerState) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const pathname = url.pathname;
    const method = req.method || 'GET';
    const profileName = url.searchParams.get('profile') || undefined;

    try {
      // CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      // Route: GET / - Status
      if (pathname === '/' && method === 'GET') {
        const status = getStatus(state, profileName);
        sendJson(res, status);
        return;
      }

      // Route: POST /start - Start browser
      if (pathname === '/start' && method === 'POST') {
        const manager = new ProfileManager(state.config);
        await manager.startProfile(profileName);
        const status = getStatus(state, profileName);
        sendJson(res, status);
        return;
      }

      // Route: POST /stop - Stop browser
      if (pathname === '/stop' && method === 'POST') {
        const manager = new ProfileManager(state.config);
        await manager.stopProfile(profileName);
        const status = getStatus(state, profileName);
        sendJson(res, status);
        return;
      }

      // Route: GET /profiles - List profiles
      if (pathname === '/profiles' && method === 'GET') {
        const manager = new ProfileManager(state.config);
        const profiles = manager.listProfiles();
        sendJson(res, { profiles });
        return;
      }

      // Route: GET /tabs - List tabs
      if (pathname === '/tabs' && method === 'GET') {
        const manager = new ProfileManager(state.config);
        const runtime = manager.getRuntime(profileName);
        
        if (!runtime) {
          sendError(res, 400, 'Browser not running');
          return;
        }

        const tabs: BrowserTab[] = Array.from(runtime.pages.values()).map((session) => ({
          targetId: session.targetId,
          title: session.title,
          url: session.url,
          type: 'page',
        }));

        sendJson(res, { tabs });
        return;
      }

      // Route: POST /tabs/open - Open new tab
      if (pathname === '/tabs/open' && method === 'POST') {
        const body = await parseBody(req);
        const targetUrl = body.url || 'about:blank';

        const manager = new ProfileManager(state.config);
        const runtime = await manager.getOrCreateRuntime(profileName);

        // Create new page
        const page = await runtime.context.newPage();
        await page.goto(targetUrl);

        const targetId = `page-${Date.now()}`;
        const title = await page.title();
        const url = page.url();

        runtime.pages.set(targetId, {
          targetId,
          page,
          title,
          url,
          createdAt: Date.now(),
        });

        sendJson(res, {
          targetId,
          url,
          title,
        });
        return;
      }

      // Route: POST /tabs/focus - Focus tab
      if (pathname === '/tabs/focus' && method === 'POST') {
        const body = await parseBody(req);
        const { targetId } = body;

        const manager = new ProfileManager(state.config);
        const runtime = manager.getRuntime(profileName);

        if (!runtime) {
          sendError(res, 400, 'Browser not running');
          return;
        }

        const session = runtime.pages.get(targetId);
        if (!session) {
          sendError(res, 404, 'Tab not found');
          return;
        }

        await session.page.bringToFront();
        sendJson(res, { ok: true });
        return;
      }

      // Route: DELETE /tabs/:targetId - Close tab
      if (pathname.startsWith('/tabs/') && method === 'DELETE') {
        const targetId = pathname.replace('/tabs/', '');

        const manager = new ProfileManager(state.config);
        const runtime = manager.getRuntime(profileName);

        if (!runtime) {
          sendError(res, 400, 'Browser not running');
          return;
        }

        const session = runtime.pages.get(targetId);
        if (session) {
          await session.page.close();
          runtime.pages.delete(targetId);
        }

        sendJson(res, { ok: true });
        return;
      }

      // Route: POST /snapshot - Take snapshot
      if (pathname === '/snapshot' && method === 'POST') {
        const body = await parseBody(req);
        const { targetId, format, limit, maxChars, interactive, refs } = body;

        const manager = new ProfileManager(state.config);
        const runtime = manager.getRuntime(profileName);

        if (!runtime) {
          sendError(res, 400, 'Browser not running');
          return;
        }

        // Get page (use first if no targetId specified)
        let page;
        if (targetId) {
          const session = runtime.pages.get(targetId);
          if (!session) {
            sendError(res, 404, 'Tab not found');
            return;
          }
          page = session.page;
        } else {
          const firstSession = runtime.pages.values().next().value;
          if (!firstSession) {
            sendError(res, 400, 'No tabs open');
            return;
          }
          page = firstSession.page;
        }

        const snapshot = await takeSnapshot(page, {
          format: format || 'ai',
          limit: limit || 1000,
          maxChars: maxChars || 8000,
          interactive: interactive || false,
          refs: refs || 'role',
        });

        sendJson(res, snapshot);
        return;
      }

      // Route: POST /screenshot - Take screenshot
      if (pathname === '/screenshot' && method === 'POST') {
        const body = await parseBody(req);
        const { targetId, fullPage, ref, element, type = 'png' } = body;

        const manager = new ProfileManager(state.config);
        const runtime = manager.getRuntime(profileName);

        if (!runtime) {
          sendError(res, 400, 'Browser not running');
          return;
        }

        // Get page
        let page;
        if (targetId) {
          const session = runtime.pages.get(targetId);
          if (!session) {
            sendError(res, 404, 'Tab not found');
            return;
          }
          page = session.page;
        } else {
          const firstSession = runtime.pages.values().next().value;
          if (!firstSession) {
            sendError(res, 400, 'No tabs open');
            return;
          }
          page = firstSession.page;
        }

        const screenshotPath = `/tmp/foxfang-screenshot-${Date.now()}.${type}`;
        
        await page.screenshot({
          path: screenshotPath,
          fullPage: fullPage || false,
          type: type as any,
        });

        sendJson(res, {
          path: screenshotPath,
          url: `file://${screenshotPath}`,
        });
        return;
      }

      // Route: POST /act - Perform action
      if (pathname === '/act' && method === 'POST') {
        const body = await parseBody(req);
        const { targetId, ...actionRequest } = body;

        const manager = new ProfileManager(state.config);
        const runtime = manager.getRuntime(profileName);

        if (!runtime) {
          sendError(res, 400, 'Browser not running');
          return;
        }

        // Get page
        let page;
        if (targetId) {
          const session = runtime.pages.get(targetId);
          if (!session) {
            sendError(res, 404, 'Tab not found');
            return;
          }
          page = session.page;
        } else {
          const firstSession = runtime.pages.values().next().value;
          if (!firstSession) {
            sendError(res, 400, 'No tabs open');
            return;
          }
          page = firstSession.page;
        }

        const result = await performAction(page, actionRequest as BrowserActRequest);
        sendJson(res, result);
        return;
      }

      // Route: POST /navigate - Navigate to URL
      if (pathname === '/navigate' && method === 'POST') {
        const body = await parseBody(req);
        const { url: targetUrl, targetId } = body;

        if (!targetUrl) {
          sendError(res, 400, 'URL required');
          return;
        }

        const manager = new ProfileManager(state.config);
        const runtime = manager.getRuntime(profileName);

        if (!runtime) {
          sendError(res, 400, 'Browser not running');
          return;
        }

        // Get page
        let page;
        if (targetId) {
          const session = runtime.pages.get(targetId);
          if (!session) {
            sendError(res, 404, 'Tab not found');
            return;
          }
          page = session.page;
        } else {
          const firstSession = runtime.pages.values().next().value;
          if (!firstSession) {
            sendError(res, 400, 'No tabs open');
            return;
          }
          page = firstSession.page;
        }

        await page.goto(targetUrl);
        
        const session = runtime.pages.get(targetId || runtime.pages.keys().next().value);
        if (session) {
          session.url = page.url();
          session.title = await page.title();
        }

        sendJson(res, {
          url: page.url(),
          title: await page.title(),
        });
        return;
      }

      // 404 Not Found
      sendError(res, 404, 'Not Found');

    } catch (error) {
      console.error('[BrowserServer] Error:', error);
      sendError(res, 500, error instanceof Error ? error.message : 'Internal Server Error');
    }
  };
}

function sendJson(res: ServerResponse, data: any): void {
  res.setHeader('Content-Type', 'application/json');
  res.writeHead(200);
  res.end(JSON.stringify(data, null, 2));
}

function sendError(res: ServerResponse, statusCode: number, message: string): void {
  res.setHeader('Content-Type', 'application/json');
  res.writeHead(statusCode);
  res.end(JSON.stringify({ error: message }, null, 2));
}

async function parseBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        if (body) {
          resolve(JSON.parse(body));
        } else {
          resolve({});
        }
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}
