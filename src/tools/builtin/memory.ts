/**
 * Memory Tools
 */

import { Tool, ToolCategory } from '../traits';
import { searchMemories, storeMemory } from '../../memory/database';

export class MemoryStoreTool implements Tool {
  name = 'memory_store';
  description = 'Store information in memory';
  category = ToolCategory.DATA;
  parameters = {
    type: 'object' as const,
    properties: {
      key: { type: 'string', description: 'Memory key' },
      value: { type: 'string', description: 'Memory value' },
    },
    required: ['key', 'value'],
  };

  async execute(args: { key: string; value: string }): Promise<{ success: boolean; data?: any }> {
    const content = `${args.key}: ${args.value}`;
    const id = storeMemory(content, 'fact', { importance: 6 });
    return { success: true, data: { id, key: args.key } };
  }
}

export class MemoryRecallTool implements Tool {
  name = 'memory_recall';
  description = 'Recall information from memory';
  category = ToolCategory.DATA;
  parameters = {
    type: 'object' as const,
    properties: {
      key: { type: 'string', description: 'Memory key' },
    },
    required: ['key'],
  };

  async execute(args: { key: string }): Promise<{ found: boolean; value?: string; data?: any }> {
    const hits = searchMemories(args.key, 4);
    if (hits.length === 0) {
      return { found: false };
    }
    return {
      found: true,
      value: hits[0].content,
      data: {
        key: args.key,
        matches: hits.map((hit) => ({
          id: hit.id,
          category: hit.category,
          content: hit.content,
          importance: hit.importance,
        })),
      },
    };
  }
}
