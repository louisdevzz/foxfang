import { Tool, ToolCategory } from '../traits';
import { expandCachedResult, getCachedSnippet } from '../tool-result-cache';

export class ExpandCachedResultTool implements Tool {
  name = 'expand_cached_result';
  description = 'Expand a previously compacted tool result by rawRef.';
  category = ToolCategory.UTILITY;
  parameters = {
    type: 'object' as const,
    properties: {
      rawRef: { type: 'string', description: 'Cached raw reference returned by compact tool results' },
      maxChars: { type: 'number', description: 'Maximum chars to return (default: 8000)' },
    },
    required: ['rawRef'],
  };

  async execute(args: { rawRef: string; maxChars?: number }) {
    const result = expandCachedResult(args.rawRef, args.maxChars ?? 8000);
    if (!result.found) {
      return { success: false, error: `No cached result found for rawRef: ${args.rawRef}` };
    }
    return {
      success: true,
      output: `Expanded cached result from ${result.source}`,
      data: result,
    };
  }
}

export class GetCachedSnippetTool implements Tool {
  name = 'get_cached_snippet';
  description = 'Get a snippet slice from a cached tool result by rawRef.';
  category = ToolCategory.UTILITY;
  parameters = {
    type: 'object' as const,
    properties: {
      rawRef: { type: 'string', description: 'Cached raw reference returned by compact tool results' },
      start: { type: 'number', description: 'Start offset in characters' },
      length: { type: 'number', description: 'Snippet length in characters (default: 800)' },
    },
    required: ['rawRef'],
  };

  async execute(args: { rawRef: string; start?: number; length?: number }) {
    const result = getCachedSnippet(args.rawRef, args.start ?? 0, args.length ?? 800);
    if (!result.found) {
      return { success: false, error: `No cached result found for rawRef: ${args.rawRef}` };
    }
    return {
      success: true,
      output: `Snippet from cached result (${result.source})`,
      data: result,
    };
  }
}

