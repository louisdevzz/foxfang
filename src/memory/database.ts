/**
 * Memory Database Operations
 * 
 * SQLite-backed memory storage with FTS search.
 */

import { query, run, queryOne } from '../database/sqlite';
import { randomUUID } from 'crypto';

export interface MemoryEntry {
  id: number;
  content: string;
  category: 'fact' | 'preference' | 'pattern' | 'feedback' | 'idea';
  importance: number;
  projectId?: string;
  sessionId?: string;
  metadata?: Record<string, any>;
  createdAt: Date;
}

/**
 * Store a memory
 */
export function storeMemory(
  content: string,
  category: MemoryEntry['category'] = 'fact',
  options?: {
    importance?: number;
    projectId?: string;
    sessionId?: string;
    metadata?: Record<string, any>;
  }
): number {
  const result = run(
    `INSERT INTO memories (content, category, importance, project_id, session_id, metadata) 
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      content,
      category,
      options?.importance ?? 5,
      options?.projectId ?? null,
      options?.sessionId ?? null,
      options?.metadata ? JSON.stringify(options.metadata) : null
    ]
  );
  return result.lastInsertRowid;
}

/**
 * Search memories by content (FTS)
 */
export function searchMemories(queryStr: string, limit: number = 10): MemoryEntry[] {
  return query<MemoryEntry>(`
    SELECT m.* FROM memories m
    JOIN memories_fts fts ON m.id = fts.rowid
    WHERE memories_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `, [queryStr, limit]);
}

/**
 * Get memories by category
 */
export function getMemoriesByCategory(category: MemoryEntry['category'], limit: number = 50): MemoryEntry[] {
  return query<MemoryEntry>(
    `SELECT * FROM memories 
     WHERE category = ? AND user_id = 'default_user'
     ORDER BY importance DESC, created_at DESC
     LIMIT ?`,
    [category, limit]
  );
}

/**
 * Get memories for a project
 */
export function getProjectMemories(projectId: string, limit: number = 50): MemoryEntry[] {
  return query<MemoryEntry>(
    `SELECT * FROM memories 
     WHERE project_id = ?
     ORDER BY importance DESC, created_at DESC
     LIMIT ?`,
    [projectId, limit]
  );
}

/**
 * Get memory by ID
 */
export function getMemory(id: number): MemoryEntry | null {
  return queryOne<MemoryEntry>(
    `SELECT * FROM memories WHERE id = ?`,
    [id]
  );
}

/**
 * Update memory importance
 */
export function updateImportance(id: number, importance: number): void {
  run(
    `UPDATE memories SET importance = ? WHERE id = ?`,
    [importance, id]
  );
}

/**
 * Delete memory
 */
export function deleteMemory(id: number): void {
  run(`DELETE FROM memories WHERE id = ?`, [id]);
}

/**
 * Get memory statistics
 */
export function getMemoryStats(): Record<string, number> {
  const rows = query<{ category: string; count: number }>(
    `SELECT category, COUNT(*) as count 
     FROM memories 
     WHERE user_id = 'default_user'
     GROUP BY category`
  );
  
  return rows.reduce((acc, row) => {
    acc[row.category] = row.count;
    return acc;
  }, {} as Record<string, number>);
}
