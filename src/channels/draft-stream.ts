/**
 * Draft Stream System for Channel Content Editing
 * 
 * Provides live streaming of content with edit capabilities.
 * For Signal: Uses message deletion + resend pattern since Signal
 * doesn't support native message editing.
 * 
 * Inspired by OpenClaw's draft-stream implementation
 */

export interface DraftStreamConfig {
  /** Throttle delay between updates (ms) */
  throttleMs?: number;
  /** Max message length */
  maxChars?: number;
  /** Prefix for edited messages */
  editPrefix?: string;
}

export interface DraftStream {
  /** Update the draft content */
  update(content: string): void;
  /** Finalize and send the content */
  finalize(): Promise<string | void>;
  /** Cancel and cleanup */
  cancel(): Promise<void>;
  /** Check if stream is active */
  isActive(): boolean;
}

export interface DraftStreamState {
  /** Whether the stream is stopped */
  stopped: boolean;
  /** Whether the stream is finalized */
  final: boolean;
  /** Current pending content */
  pendingContent: string;
  /** Last sent content */
  lastSentContent: string;
  /** Message ID of sent message */
  messageId?: string;
}

type SendOrEditFn = (content: string, isEdit?: boolean) => Promise<string | void>;

/**
 * Create a throttled draft stream loop
 */
function createDraftStreamLoop(params: {
  throttleMs: number;
  isStopped: () => boolean;
  sendOrEdit: SendOrEditFn;
}): {
  update: (content: string) => void;
  flush: () => Promise<void>;
  stop: () => void;
} {
  let lastSentAt = 0;
  let pendingContent = '';
  let inFlightPromise: Promise<string | void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = async (): Promise<void> => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }

    while (!params.isStopped()) {
      if (inFlightPromise) {
        await inFlightPromise;
        continue;
      }

      const content = pendingContent;
      if (!content.trim()) {
        pendingContent = '';
        return;
      }

      pendingContent = '';
      
      const current = params.sendOrEdit(content).finally(() => {
        if (inFlightPromise === current) {
          inFlightPromise = undefined;
        }
      });

      inFlightPromise = current;
      const sent = await current;
      
      if (sent === undefined) {
        // Send failed, restore pending
        pendingContent = content;
        return;
      }

      lastSentAt = Date.now();
      
      if (!pendingContent) {
        return;
      }
    }
  };

  const schedule = () => {
    if (timer) return;
    
    const delay = Math.max(0, params.throttleMs - (Date.now() - lastSentAt));
    timer = setTimeout(() => {
      void flush();
    }, delay);
  };

  return {
    update: (content: string) => {
      if (params.isStopped()) return;
      
      pendingContent = content;
      
      if (inFlightPromise) {
        schedule();
        return;
      }
      
      if (!timer && Date.now() - lastSentAt >= params.throttleMs) {
        void flush();
        return;
      }
      
      schedule();
    },
    flush,
    stop: () => {
      pendingContent = '';
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
    },
  };
}

/**
 * Create a draft stream for Signal channel
 * 
 * Since Signal doesn't support native editing, we use:
 * 1. First send: Normal message
 * 2. Updates: Delete previous + send new with "✏️" prefix
 */
export function createSignalDraftStream(params: {
  send: (content: string) => Promise<string | void>;
  delete: (messageId: string) => Promise<boolean>;
  config?: DraftStreamConfig;
  onError?: (error: Error) => void;
}): DraftStream {
  const config: Required<DraftStreamConfig> = {
    throttleMs: 2000,
    maxChars: 4096,
    editPrefix: '✏️ ',
    ...params.config,
  };

  const state: DraftStreamState = {
    stopped: false,
    final: false,
    pendingContent: '',
    lastSentContent: '',
  };

  const sendOrEdit: SendOrEditFn = async (content: string) => {
    const trimmed = content.trimEnd();
    if (!trimmed) return;

    // Check max length
    if (trimmed.length > config.maxChars) {
      state.stopped = true;
      params.onError?.(new Error(`Content exceeds max length: ${trimmed.length} > ${config.maxChars}`));
      return;
    }

    try {
      // If we have a message ID, delete the old one first (Signal edit pattern)
      if (state.messageId) {
        const deleted = await params.delete(state.messageId);
        if (!deleted) {
          console.warn('[SignalDraft] Could not delete previous message');
        }
        // Add edit prefix for subsequent messages
        const editedContent = `${config.editPrefix}${trimmed}`;
        const newMessageId = await params.send(editedContent);
        state.messageId = newMessageId || state.messageId;
      } else {
        // First send
        const messageId = await params.send(trimmed);
        if (messageId) {
          state.messageId = messageId;
        }
      }
      
      state.lastSentContent = trimmed;
      return state.messageId;
    } catch (error) {
      params.onError?.(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  };

  const loop = createDraftStreamLoop({
    throttleMs: config.throttleMs,
    isStopped: () => state.stopped || state.final,
    sendOrEdit,
  });

  return {
    update: (content: string) => {
      if (state.stopped || state.final) return;
      state.pendingContent = content;
      loop.update(content);
    },
    
    finalize: async (): Promise<string | void> => {
      if (state.final) return state.messageId;
      
      state.final = true;
      await loop.flush();
      
      return state.messageId;
    },
    
    cancel: async (): Promise<void> => {
      state.stopped = true;
      loop.stop();
      
      // Delete the message if it was sent
      if (state.messageId) {
        await params.delete(state.messageId);
        state.messageId = undefined;
      }
    },
    
    isActive: () => !state.stopped && !state.final,
  };
}

/**
 * Create a simple draft stream that buffers and sends at intervals
 * Useful for streaming agent responses
 */
export function createBufferingDraftStream(params: {
  send: (content: string) => Promise<string | void>;
  updateIntervalMs?: number;
  maxWaitMs?: number;
}): {
  append: (chunk: string) => void;
  finalize: () => Promise<string | void>;
  cancel: () => Promise<void>;
  getContent: () => string;
} {
  const { send, updateIntervalMs = 2000, maxWaitMs = 10000 } = params;
  
  let content = '';
  let messageId: string | undefined;
  let lastUpdateAt = 0;
  let updateTimer: ReturnType<typeof setTimeout> | undefined;
  let maxWaitTimer: ReturnType<typeof setTimeout> | undefined;
  let isFinalized = false;

  const doUpdate = async () => {
    if (!content.trim() || isFinalized) return;
    
    const now = Date.now();
    
    // Only update if content changed significantly or enough time passed
    if (now - lastUpdateAt >= updateIntervalMs) {
      try {
        messageId = await send(content) || messageId;
        lastUpdateAt = now;
      } catch (error) {
        console.error('[BufferingDraft] Update failed:', error);
      }
    }
    
    // Schedule next update
    if (!isFinalized) {
      updateTimer = setTimeout(doUpdate, updateIntervalMs);
    }
  };

  const scheduleMaxWait = () => {
    if (maxWaitTimer) clearTimeout(maxWaitTimer);
    maxWaitTimer = setTimeout(() => {
      void doUpdate();
    }, maxWaitMs);
  };

  return {
    append: (chunk: string) => {
      if (isFinalized) return;
      content += chunk;
      
      if (!updateTimer) {
        void doUpdate();
      }
      scheduleMaxWait();
    },
    
    finalize: async (): Promise<string | void> => {
      if (isFinalized) return messageId;
      isFinalized = true;
      
      if (updateTimer) clearTimeout(updateTimer);
      if (maxWaitTimer) clearTimeout(maxWaitTimer);
      
      if (content.trim()) {
        messageId = await send(content) || messageId;
      }
      
      return messageId;
    },
    
    cancel: async (): Promise<void> => {
      isFinalized = true;
      if (updateTimer) clearTimeout(updateTimer);
      if (maxWaitTimer) clearTimeout(maxWaitTimer);
    },
    
    getContent: () => content,
  };
}
