/**
 * Reply Dispatcher
 * 
 * Handles queuing and delivery of different reply types:
 * - Tool results (immediate)
 * - Block replies (streaming chunks)
 * - Final replies (complete response)
 */

import { ReplyPayload } from './types';

export type ReplyDispatchKind = 'tool' | 'block' | 'final';

export type ReplyDispatchDeliverer = (
  payload: ReplyPayload,
  info: { kind: ReplyDispatchKind }
) => Promise<void>;

export interface ReplyDispatcherOptions {
  deliver: ReplyDispatchDeliverer;
  onError?: (err: unknown, info: { kind: ReplyDispatchKind }) => void;
  onIdle?: () => void;
  /** Human-like delay between block replies for natural rhythm (ms) */
  humanDelayMs?: number;
}

export interface ReplyDispatcher {
  sendToolResult: (payload: ReplyPayload) => boolean;
  sendBlockReply: (payload: ReplyPayload) => boolean;
  sendFinalReply: (payload: ReplyPayload) => boolean;
  waitForIdle: () => Promise<void>;
  getQueuedCounts: () => Record<ReplyDispatchKind, number>;
  markComplete: () => void;
}

/**
 * Create a reply dispatcher that queues and delivers replies
 */
export function createReplyDispatcher(options: ReplyDispatcherOptions): ReplyDispatcher {
  let sendChain: Promise<void> = Promise.resolve();
  // Track in-flight deliveries
  let pending = 1; // Start with 1 as a "reservation"
  let completeCalled = false;
  let sentFirstBlock = false;

  // Serialize outbound replies to preserve order
  const queuedCounts: Record<ReplyDispatchKind, number> = {
    tool: 0,
    block: 0,
    final: 0,
  };

  const enqueue = (kind: ReplyDispatchKind, payload: ReplyPayload): boolean => {
    // Skip empty payloads
    if (!payload.text && !payload.mediaUrl && !payload.audioUrl) {
      return false;
    }

    queuedCounts[kind] += 1;
    pending += 1;

    // Human delay for block replies after the first
    const shouldDelay = kind === 'block' && sentFirstBlock && options.humanDelayMs;
    if (kind === 'block') {
      sentFirstBlock = true;
    }

    sendChain = sendChain
      .then(async () => {
        if (shouldDelay && options.humanDelayMs) {
          await sleep(options.humanDelayMs);
        }
        await options.deliver(payload, { kind });
      })
      .catch((err) => {
        options.onError?.(err, { kind });
      })
      .finally(() => {
        pending -= 1;
        // Clear reservation if pending is 1 and complete was called
        if (pending === 1 && completeCalled) {
          pending -= 1;
        }
        if (pending === 0) {
          options.onIdle?.();
        }
      });
    return true;
  };

  const markComplete = (): void => {
    if (completeCalled) return;
    completeCalled = true;
    
    // Schedule clearing reservation after microtasks
    void Promise.resolve().then(() => {
      if (pending === 1 && completeCalled) {
        pending -= 1;
        if (pending === 0) {
          options.onIdle?.();
        }
      }
    });
  };

  return {
    sendToolResult: (payload) => enqueue('tool', payload),
    sendBlockReply: (payload) => enqueue('block', payload),
    sendFinalReply: (payload) => enqueue('final', payload),
    waitForIdle: () => sendChain,
    getQueuedCounts: () => ({ ...queuedCounts }),
    markComplete,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
