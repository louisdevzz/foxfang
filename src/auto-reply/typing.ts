/**
 * Typing Controller
 * 
 * Handles typing lifecycle with TTL and proper cleanup.
 */

import { TypingController } from './types';

export interface TypingControllerOptions {
  onReplyStart?: () => Promise<void> | void;
  onCleanup?: () => void;
  typingIntervalSeconds?: number;
  typingTtlMs?: number;
  log?: (message: string) => void;
}

/**
 * Create a typing controller that manages indicator lifecycle
 */
export function createTypingController(options: TypingControllerOptions): TypingController {
  const {
    onReplyStart,
    onCleanup,
    typingIntervalSeconds = 6,
    typingTtlMs = 2 * 60_000, // 2 minutes max
    log,
  } = options;

  let started = false;
  let active = false;
  let runComplete = false;
  let dispatchIdle = false;
  let sealed = false;
  let typingTtlTimer: NodeJS.Timeout | undefined;
  let typingLoopInterval: NodeJS.Timeout | undefined;
  const typingIntervalMs = typingIntervalSeconds * 1000;

  const formatTypingTtl = (ms: number): string => {
    if (ms % 60_000 === 0) {
      return `${ms / 60_000}m`;
    }
    return `${Math.round(ms / 1000)}s`;
  };

  const resetCycle = (): void => {
    started = false;
    active = false;
    runComplete = false;
    dispatchIdle = false;
  };

  const cleanup = (): void => {
    if (sealed) return;
    
    if (typingTtlTimer) {
      clearTimeout(typingTtlTimer);
      typingTtlTimer = undefined;
    }
    if (typingLoopInterval) {
      clearInterval(typingLoopInterval);
      typingLoopInterval = undefined;
    }
    
    // Notify cleanup
    if (active) {
      onCleanup?.();
    }
    
    resetCycle();
    sealed = true;
  };

  const refreshTypingTtl = (): void => {
    if (sealed) return;
    if (!typingIntervalMs || typingIntervalMs <= 0) return;
    if (typingTtlMs <= 0) return;

    if (typingTtlTimer) {
      clearTimeout(typingTtlTimer);
    }
    
    typingTtlTimer = setTimeout(() => {
      if (!typingLoopInterval) return;
      log?.(`Typing TTL reached (${formatTypingTtl(typingTtlMs)}); stopping`);
      cleanup();
    }, typingTtlMs);
  };

  const isActive = (): boolean => active && !sealed;

  const triggerTyping = async (): Promise<void> => {
    if (sealed || runComplete) return;
    await onReplyStart?.();
  };

  const ensureStart = async (): Promise<void> => {
    if (sealed || runComplete) return;
    if (!active) {
      active = true;
    }
    if (started) return;
    
    started = true;
    await triggerTyping();
  };

  const maybeStopOnIdle = (): void => {
    if (!active) return;
    // Stop only when run complete AND dispatcher idle
    if (runComplete && dispatchIdle) {
      cleanup();
    }
  };

  const startTypingLoop = async (): Promise<void> => {
    if (sealed || runComplete) return;
    
    refreshTypingTtl();
    
    if (!onReplyStart) return;
    if (typingLoopInterval) return;

    await ensureStart();
    
    // Start keepalive loop
    typingLoopInterval = setInterval(async () => {
      if (!sealed && !runComplete) {
        await triggerTyping();
      }
    }, typingIntervalMs);
  };

  const startTypingOnText = async (text?: string): Promise<void> => {
    if (sealed) return;
    const trimmed = text?.trim();
    if (!trimmed) return;
    
    refreshTypingTtl();
    await startTypingLoop();
  };

  let dispatchIdleTimer: NodeJS.Timeout | undefined;
  const DISPATCH_IDLE_GRACE_MS = 10_000;

  const markRunComplete = (): void => {
    runComplete = true;
    maybeStopOnIdle();
    
    // Safety: force cleanup if dispatch idle never arrives
    if (!sealed && !dispatchIdle) {
      dispatchIdleTimer = setTimeout(() => {
        if (!sealed && !dispatchIdle) {
          log?.('Typing: dispatch idle not received; forcing cleanup');
          cleanup();
        }
      }, DISPATCH_IDLE_GRACE_MS);
    }
  };

  const markDispatchIdle = (): void => {
    dispatchIdle = true;
    if (dispatchIdleTimer) {
      clearTimeout(dispatchIdleTimer);
      dispatchIdleTimer = undefined;
    }
    maybeStopOnIdle();
  };

  return {
    onReplyStart: ensureStart,
    startTypingLoop,
    refreshTypingTtl,
    isActive,
    markRunComplete,
    markDispatchIdle,
    cleanup,
  };
}
