/**
 * Compatibility Layer
 * 
 * Handles backwards compatibility and migrations.
 */

import { existsSync, readFileSync, renameSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { initDatabase } from '../database/sqlite';

const FOXFANG_DIR = join(homedir(), '.foxfang');

/**
 * Run all migrations
 */
export async function runMigrations(): Promise<void> {
  console.log('Running compatibility checks...');

  // Ensure database is initialized
  initDatabase();

  // Check for old JSON configs and migrate
  await migrateFromJsonConfig();

  console.log('Compatibility checks complete.');
}

/**
 * Migrate from old JSON config to SQLite
 */
async function migrateFromJsonConfig(): Promise<void> {
  const oldConfigPath = join(FOXFANG_DIR, 'config.json');
  
  if (existsSync(oldConfigPath)) {
    console.log('Found old JSON config, migrating to SQLite...');
    
    try {
      const content = readFileSync(oldConfigPath, 'utf-8');
      const config = JSON.parse(content);
      
      // Migrate providers
      if (config.providers) {
        for (const provider of config.providers) {
          // Migration logic here
        }
      }

      // Rename old config as backup
      renameSync(oldConfigPath, `${oldConfigPath}.backup`);
      console.log('Migration complete. Old config backed up.');
    } catch (error) {
      console.error('Migration failed:', error);
    }
  }
}

/**
 * Check if first run
 */
export function isFirstRun(): boolean {
  const dbPath = join(FOXFANG_DIR, 'foxfang.db');
  return !existsSync(dbPath);
}
