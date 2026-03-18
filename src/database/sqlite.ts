/**
 * SQLite Database Client
 * 
 * Uses Node.js built-in node:sqlite for persistence.
 */

import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const DB_DIR = join(homedir(), '.foxfang');
const DB_PATH = join(DB_DIR, 'foxfang.db');

let db: DatabaseSync | null = null;

/**
 * Initialize SQLite database
 */
export function initDatabase(): DatabaseSync {
  if (db) return db;

  // Ensure directory exists
  if (!existsSync(DB_DIR)) {
    mkdirSync(DB_DIR, { recursive: true });
  }

  // Open database
  db = new DatabaseSync(DB_PATH);

  // Enable WAL mode for better concurrency
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');

  // Run schema inline (since we can't reliably get __dirname in CJS)
  db.exec(`
    -- Users table
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY DEFAULT 'default_user',
      name TEXT,
      email TEXT,
      preferences TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Projects table
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'default_user',
      name TEXT NOT NULL,
      description TEXT,
      brand_profile TEXT,
      brand_md_content TEXT,
      status TEXT DEFAULT 'active' CHECK (status IN ('active','archived')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);

    -- Memories table
    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL DEFAULT 'default_user',
      project_id TEXT,
      session_id TEXT,
      content TEXT NOT NULL,
      category TEXT CHECK (category IN ('fact','preference','pattern','feedback','idea')),
      importance INTEGER DEFAULT 5,
      embedding BLOB,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_memories_user_id ON memories(user_id);
    CREATE INDEX IF NOT EXISTS idx_memories_project_id ON memories(project_id);

    -- FTS for memories
    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      content,
      content_rowid,
      user_id UNINDEXED
    );

    -- Tasks table
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'default_user',
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'todo' CHECK (status IN ('todo','in_progress','review','done','cancelled')),
      priority TEXT DEFAULT 'medium' CHECK (priority IN ('low','medium','high')),
      assignee TEXT,
      due_date DATETIME,
      tags TEXT,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);

    -- Ideas table
    CREATE TABLE IF NOT EXISTS ideas (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'default_user',
      project_id TEXT,
      title TEXT NOT NULL,
      content TEXT,
      source TEXT,
      tags TEXT,
      status TEXT DEFAULT 'new' CHECK (status IN ('new','used','archived')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_ideas_user_id ON ideas(user_id);

    -- Sessions table
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'default_user',
      project_id TEXT,
      title TEXT,
      messages TEXT,
      context TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

    -- Artifacts table
    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'default_user',
      project_id TEXT,
      session_id TEXT,
      type TEXT NOT NULL,
      title TEXT,
      content TEXT NOT NULL,
      platform TEXT,
      status TEXT DEFAULT 'draft' CHECK (status IN ('draft','approved','published','archived')),
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_artifacts_user_id ON artifacts(user_id);

    -- Cron jobs table
    CREATE TABLE IF NOT EXISTS cron_jobs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'default_user',
      name TEXT NOT NULL,
      schedule TEXT NOT NULL,
      command TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      last_run_at DATETIME,
      next_run_at DATETIME,
      run_count INTEGER DEFAULT 0,
      fail_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_cron_jobs_user_id ON cron_jobs(user_id);

    -- Insert default user
    INSERT OR IGNORE INTO users (id, name) VALUES ('default_user', 'Default User');
  `);

  return db;
}

/**
 * Get database instance
 */
export function getDatabase(): DatabaseSync {
  if (!db) {
    return initDatabase();
  }
  return db;
}

/**
 * Close database connection
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * Execute a query with parameters
 */
export function query<T = any>(sql: string, params: any[] = []): T[] {
  const database = getDatabase();
  const stmt = database.prepare(sql);
  return stmt.all(...params) as T[];
}

/**
 * Execute a single row query
 */
export function queryOne<T = any>(sql: string, params: any[] = []): T | null {
  const database = getDatabase();
  const stmt = database.prepare(sql);
  const result = stmt.get(...params);
  return result as T || null;
}

/**
 * Execute an insert/update/delete
 */
export function run(sql: string, params: any[] = []): { lastInsertRowid: number; changes: number } {
  const database = getDatabase();
  const stmt = database.prepare(sql);
  return stmt.run(...params);
}

/**
 * Execute within a transaction
 */
export function transaction<T>(fn: () => T): T {
  const database = getDatabase();
  database.exec('BEGIN TRANSACTION');
  try {
    const result = fn();
    database.exec('COMMIT');
    return result;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}
