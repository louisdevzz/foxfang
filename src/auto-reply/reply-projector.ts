import {
  isInternalToolPlaceholderText,
  parseReplyControls,
  sanitizeReplyTextContent,
} from '../agents/governance';
import type { StreamChunk, ToolCall } from '../agents/types';
import { isProgressOnlyStatusUpdate } from '../agents/runtime';
import type { ReplyDispatcher } from './dispatcher';
import type { ReplyPayload } from './types';

export interface ReplyProjectionResult {
  content?: string;
  toolCalls?: ToolCall[];
  mediaUrls?: string[];
}

export interface ReplyProjector {
  consume: (chunk: StreamChunk) => Promise<void>;
  finalize: () => Promise<ReplyProjectionResult>;
}

interface ReplyProjectorOptions {
  dispatcher: ReplyDispatcher;
  currentMessageId: string;
  defaultReplyToMessageId?: string;
  threadId?: string;
}

const MAX_PARTIAL_REPLIES = 2;
const MIN_PARTIAL_REPLY_CHARS = 140;
const MAX_PARTIAL_REPLY_CHARS = 520;

function normalizeComparableText(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isInternalPlaceholderReply(value: string): boolean {
  return isInternalToolPlaceholderText(value);
}

function sanitizeVisibleText(raw: string, currentMessageId: string): string {
  const parsed = parseReplyControls(raw, { currentMessageId });
  const visible = sanitizeReplyTextContent(String(parsed.content || '').trim());
  if (!visible) return '';
  if (isInternalPlaceholderReply(visible)) return '';
  return visible;
}

function truncateAtNaturalBoundary(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const slice = text.slice(0, maxChars);
  const boundary = Math.max(
    slice.lastIndexOf('\n\n'),
    slice.lastIndexOf('. '),
    slice.lastIndexOf('! '),
    slice.lastIndexOf('? '),
  );
  if (boundary >= Math.max(80, Math.floor(maxChars * 0.5))) {
    return slice.slice(0, boundary + 1).trim();
  }
  return `${slice.trim()}...`;
}

function selectProjectableVisibleText(raw: string, currentMessageId: string): string {
  const visible = sanitizeVisibleText(raw, currentMessageId);
  if (!visible) return '';
  const normalizedWhitespace = visible.replace(/\n{3,}/g, '\n\n').trim();
  const paragraphs = normalizedWhitespace
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);

  let candidate = normalizedWhitespace;
  if (paragraphs.length >= 2 && normalizedWhitespace.length > MAX_PARTIAL_REPLY_CHARS) {
    candidate = `${paragraphs[0]}\n\n${paragraphs[1]}`.trim();
  } else if (paragraphs.length >= 1 && normalizedWhitespace.length > MAX_PARTIAL_REPLY_CHARS) {
    candidate = paragraphs[0];
  }

  return truncateAtNaturalBoundary(candidate, MAX_PARTIAL_REPLY_CHARS);
}

export function createReplyProjector(options: ReplyProjectorOptions): ReplyProjector {
  let finalized = false;
  let quoteConsumed = false;
  let lastProjectedVisibleText = '';
  let partialRepliesSent = 0;
  let finalContent = '';
  let finalToolCalls: ToolCall[] | undefined;
  const seenProjectionSignatures = new Set<string>();
  const allMediaUrls: string[] = [];
  const sentMediaUrls = new Set<string>();

  const rememberMediaUrls = (urls?: string[]): void => {
    for (const mediaUrl of urls || []) {
      const trimmed = String(mediaUrl || '').trim();
      if (!trimmed || allMediaUrls.includes(trimmed)) continue;
      allMediaUrls.push(trimmed);
    }
  };

  const takeReplyToMessageId = (allowDefaultReplyQuote: boolean, explicitReplyToMessageId?: string): string | undefined => {
    if (explicitReplyToMessageId) {
      return explicitReplyToMessageId;
    }
    if (!allowDefaultReplyQuote || quoteConsumed || !options.defaultReplyToMessageId) {
      return undefined;
    }
    quoteConsumed = true;
    return options.defaultReplyToMessageId;
  };

  const buildPayload = (params: {
    text?: string;
    mediaUrl?: string;
    explicitReplyToMessageId?: string;
    allowDefaultReplyQuote?: boolean;
  }): ReplyPayload => {
    const payload: ReplyPayload = {
      threadId: options.threadId,
    };

    const text = String(params.text || '').trim();
    const mediaUrl = String(params.mediaUrl || '').trim();
    if (text) payload.text = text;
    if (mediaUrl) payload.mediaUrl = mediaUrl;

    const replyToMessageId = takeReplyToMessageId(
      params.allowDefaultReplyQuote === true,
      params.explicitReplyToMessageId,
    );
    if (replyToMessageId) payload.replyToMessageId = replyToMessageId;

    return payload;
  };

  const selectUnsentMediaUrl = (): string | undefined => {
    for (const mediaUrl of allMediaUrls) {
      if (sentMediaUrls.has(mediaUrl)) continue;
      sentMediaUrls.add(mediaUrl);
      return mediaUrl;
    }
    return undefined;
  };

  const enqueuePartialReply = (text: string): boolean => {
    if (partialRepliesSent >= MAX_PARTIAL_REPLIES) return false;

    const visible = selectProjectableVisibleText(text, options.currentMessageId);
    if (!visible) return false;
    if (isProgressOnlyStatusUpdate(visible)) return false;
    if (visible.length < MIN_PARTIAL_REPLY_CHARS && !visible.includes('\n')) return false;

    const signature = normalizeComparableText(visible);
    if (!signature || seenProjectionSignatures.has(signature)) return false;
    seenProjectionSignatures.add(signature);

    const sent = options.dispatcher.sendBlockReply(buildPayload({
      text: visible,
      allowDefaultReplyQuote: true,
    }));
    if (sent) {
      partialRepliesSent += 1;
      lastProjectedVisibleText = visible;
    }
    return sent;
  };

  const consume = async (chunk: StreamChunk): Promise<void> => {
    if (finalized) return;

    if (chunk.type === 'assistant_update') {
      enqueuePartialReply(chunk.content || '');
      return;
    }

    if (chunk.type === 'tool_call') {
      return;
    }

    if (chunk.type === 'tool_result') {
      rememberMediaUrls(chunk.mediaUrls);
      return;
    }

    if (chunk.type === 'done') {
      finalized = true;
      finalToolCalls = chunk.toolCalls;
      rememberMediaUrls(chunk.mediaUrls);
      finalContent = String(chunk.finalContent || '').trim();
      return;
    }
  };

  const finalize = async (): Promise<ReplyProjectionResult> => {
    const rawFinalContent = String(finalContent || '').trim();
    const parsedReply = parseReplyControls(rawFinalContent, {
      currentMessageId: options.currentMessageId,
    });
    const parsedContentRaw = String(parsedReply.content || '').trim();
    const sanitizedParsedContent = sanitizeReplyTextContent(parsedContentRaw);
    const sanitizedRawFinalContent = sanitizeReplyTextContent(rawFinalContent);
    const rawIsInternalPlaceholder = isInternalPlaceholderReply(rawFinalContent);
    const mediaUrl = selectUnsentMediaUrl();
    const fallbackTextFromRaw =
      !sanitizedParsedContent &&
      mediaUrl &&
      sanitizedRawFinalContent &&
      !rawIsInternalPlaceholder
        ? sanitizedRawFinalContent
        : '';
    const mediaOnlyFallbackText =
      !sanitizedParsedContent && !fallbackTextFromRaw && mediaUrl
        ? 'Partial result attached.'
        : '';
    const placeholderOnlyFallbackText =
      !sanitizedParsedContent && !fallbackTextFromRaw && !mediaUrl
        ? lastProjectedVisibleText
        : '';
    const visibleFinalText =
      sanitizedParsedContent
      || fallbackTextFromRaw
      || mediaOnlyFallbackText
      || placeholderOnlyFallbackText;

    const normalizedFinal = normalizeComparableText(visibleFinalText);
    const shouldSuppressFinal =
      Boolean(parsedReply.suppress) && !mediaUrl;
    const isDuplicateFinal =
      Boolean(visibleFinalText) &&
      !mediaUrl &&
      Boolean(normalizedFinal) &&
      seenProjectionSignatures.has(normalizedFinal);

    if (!shouldSuppressFinal && (visibleFinalText || mediaUrl) && !isDuplicateFinal) {
      options.dispatcher.sendFinalReply(buildPayload({
        text: visibleFinalText,
        mediaUrl,
        explicitReplyToMessageId: parsedReply.replyToMessageId,
        allowDefaultReplyQuote: true,
      }));
    }

    return {
      content: visibleFinalText || lastProjectedVisibleText || undefined,
      toolCalls: finalToolCalls,
      mediaUrls: allMediaUrls.length > 0 ? allMediaUrls : undefined,
    };
  };

  return {
    consume,
    finalize,
  };
}
