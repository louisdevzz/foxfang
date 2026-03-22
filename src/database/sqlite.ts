/**
 * SQLite Database Client
 * 
 * Uses Node.js built-in node:sqlite for persistence.
 */

import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'fs';
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

  // Run schema
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

    -- Brands table - each user can have multiple brands
    CREATE TABLE IF NOT EXISTS brands (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'default_user',
      name TEXT NOT NULL,
      description TEXT,
      industry TEXT,
      brand_profile TEXT, -- JSON: tone, voice, audience, etc.
      brand_md_content TEXT, -- Full BRAND.md content
      status TEXT DEFAULT 'active' CHECK (status IN ('active','archived')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_brands_user_id ON brands(user_id);

    -- Projects table - belongs to a brand
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      brand_id TEXT NOT NULL,
      user_id TEXT NOT NULL DEFAULT 'default_user',
      name TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'active' CHECK (status IN ('active','archived','completed')),
      start_date DATETIME,
      end_date DATETIME,
      goals TEXT, -- JSON: project goals/metrics
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_projects_brand_id ON projects(brand_id);
    CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);

    -- Memories - can be associated with brand or project
    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL DEFAULT 'default_user',
      brand_id TEXT,
      project_id TEXT,
      session_id TEXT,
      content TEXT NOT NULL,
      category TEXT CHECK (category IN ('fact','preference','pattern','feedback','idea')),
      importance INTEGER DEFAULT 5,
      embedding BLOB,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_memories_user_id ON memories(user_id);
    CREATE INDEX IF NOT EXISTS idx_memories_brand_id ON memories(brand_id);
    CREATE INDEX IF NOT EXISTS idx_memories_project_id ON memories(project_id);

    -- FTS for memories
    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      content,
      content_rowid,
      user_id UNINDEXED
    );

    -- Backfill FTS index for existing memory rows
    INSERT INTO memories_fts (rowid, content, content_rowid, user_id)
    SELECT m.id, m.content, m.id, m.user_id
    FROM memories m
    WHERE NOT EXISTS (
      SELECT 1 FROM memories_fts f WHERE f.rowid = m.id
    );

    -- Keep FTS index synchronized with memories table
    CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
      INSERT INTO memories_fts (rowid, content, content_rowid, user_id)
      VALUES (new.id, new.content, new.id, new.user_id);
    END;

    CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
      DELETE FROM memories_fts WHERE rowid = old.id;
    END;

    CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
      DELETE FROM memories_fts WHERE rowid = old.id;
      INSERT INTO memories_fts (rowid, content, content_rowid, user_id)
      VALUES (new.id, new.content, new.id, new.user_id);
    END;

    -- Tasks - belong to a project
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'default_user',
      project_id TEXT NOT NULL,
      brand_id TEXT,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'todo' CHECK (status IN ('todo','in_progress','review','done','cancelled')),
      priority TEXT DEFAULT 'medium' CHECK (priority IN ('low','medium','high')),
      assignee TEXT, -- agent name or 'user'
      due_date DATETIME,
      completed_at DATETIME,
      tags TEXT, -- JSON array
      metadata TEXT, -- JSON
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON projects(id);
    CREATE INDEX IF NOT EXISTS idx_tasks_brand_id ON tasks(brand_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

    -- Ideas - can be associated with brand
    CREATE TABLE IF NOT EXISTS ideas (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'default_user',
      brand_id TEXT,
      project_id TEXT,
      title TEXT NOT NULL,
      content TEXT,
      source TEXT,
      tags TEXT,
      status TEXT DEFAULT 'new' CHECK (status IN ('new','used','archived')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE SET NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_ideas_brand_id ON ideas(brand_id);

    -- Sessions - associated with a project
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'default_user',
      project_id TEXT,
      brand_id TEXT,
      title TEXT,
      messages TEXT,
      context TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
      FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_project_id ON sessions(project_id);

    -- Content artifacts
    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'default_user',
      brand_id TEXT,
      project_id TEXT,
      task_id TEXT,
      session_id TEXT,
      type TEXT NOT NULL,
      title TEXT,
      content TEXT NOT NULL,
      platform TEXT,
      status TEXT DEFAULT 'draft' CHECK (status IN ('draft','approved','published','archived')),
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_artifacts_project_id ON artifacts(project_id);

    -- Cron jobs
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
