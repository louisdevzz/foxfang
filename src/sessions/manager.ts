/**
 * Session Manager
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { SessionSummary } from '../agents/types';

const SESSIONS_DIR = join(homedir(), '.foxfang', 'sessions');

export interface SessionMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  metadata?: Record<string, any>;
}

export interface Session {
  id: string;
  agentId: string;
  projectId?: string;
  messages: SessionMessage[];
  createdAt: number;
  lastActive: number;
  metadata?: Record<string, any>;
}

export interface SessionListItem extends Session {
  messageCount: number;
}

export interface SessionConfig {
  maxSessions: number;
  ttl: number;
}

export interface SessionListOptions {
  limit?: number;
  offset?: number;
}

export class SessionManager {
  private config: SessionConfig;
  private sessions: Map<string, Session> = new Map();
  private initialized = false;

  constructor(config: SessionConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    await mkdir(SESSIONS_DIR, { recursive: true });
    
    // Load existing sessions
    await this.loadAllSessions();
    
    this.initialized = true;
  }

  async createSession(id: string, options: { agentId: string; projectId?: string }): Promise<Session> {
    await this.initialize();
    
    const session: Session = {
      id,
      agentId: options.agentId,
      projectId: options.projectId,
      messages: [],
      createdAt: Date.now(),
      lastActive: Date.now(),
    };
    
    this.sessions.set(id, session);
    await this.saveSession(id);
    
    // Cleanup old sessions if over limit
    await this.cleanupOldSessions();
    
    return session;
  }

  async getSession(id: string): Promise<Session | undefined> {
    await this.initialize();
    return this.sessions.get(id);
  }

  async addMessage(sessionId: string, message: SessionMessage): Promise<void> {
    await this.initialize();
    
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = await this.createSession(sessionId, { agentId: 'default' });
    }
    
    session.messages.push(message);
    session.lastActive = Date.now();
    
    await this.saveSession(sessionId);
  }

  async getSessionSummary(sessionId: string): Promise<SessionSummary | undefined> {
    await this.initialize();
    const session = this.sessions.get(sessionId);
    const summary = session?.metadata?.sessionSummary;
    if (!summary || typeof summary !== 'object') {
      return undefined;
    }
    return summary as SessionSummary;
  }

  async updateSessionSummary(sessionId: string, summary: SessionSummary): Promise<void> {
    await this.initialize();
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = await this.createSession(sessionId, { agentId: 'default' });
    }
    session.metadata = {
      ...(session.metadata || {}),
      sessionSummary: summary,
    };
    session.lastActive = Date.now();
    await this.saveSession(sessionId);
  }

  async clearSession(sessionId: string): Promise<void> {
    await this.initialize();
    
    const session = this.sessions.get(sessionId);
    if (session) {
      session.messages = [];
      session.lastActive = Date.now();
      await this.saveSession(sessionId);
    }
  }

  async deleteSession(id: string): Promise<void> {
    await this.initialize();
    
    this.sessions.delete(id);
    
    try {
      const filePath = join(SESSIONS_DIR, `${id}.json`);
      const { unlink } = await import('fs/promises');
      await unlink(filePath);
    } catch {
      // Ignore if file doesn't exist
    }
  }

  async listSessions(options: SessionListOptions = {}): Promise<SessionListItem[]> {
    await this.initialize();
    
    let sessions = Array.from(this.sessions.values());
    
    // Sort by last active
    sessions.sort((a, b) => b.lastActive - a.lastActive);
    
    if (options.offset) {
      sessions = sessions.slice(options.offset);
    }
    
    if (options.limit) {
      sessions = sessions.slice(0, options.limit);
    }
    
    return sessions.map(s => ({
      ...s,
      messageCount: s.messages.length,
    }));
  }

  async clearAllSessions(): Promise<void> {
    await this.initialize();
    
    this.sessions.clear();
    
    // Delete all session files
    const { readdir, unlink } = await import('fs/promises');
    const files = await readdir(SESSIONS_DIR);
    
    for (const file of files) {
      if (file.endsWith('.json')) {
        await unlink(join(SESSIONS_DIR, file));
      }
    }
  }

  async saveSession(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) return;
    
    const filePath = join(SESSIONS_DIR, `${id}.json`);
    await writeFile(filePath, JSON.stringify(session, null, 2));
  }

  private async loadAllSessions(): Promise<void> {
    try {
      const { readdir } = await import('fs/promises');
      const files = await readdir(SESSIONS_DIR);
      
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        
        try {
          const content = await readFile(join(SESSIONS_DIR, file), 'utf-8');
          const session = JSON.parse(content) as Session;
          
          // Check TTL
          const age = Date.now() - session.lastActive;
          if (age < this.config.ttl) {
            this.sessions.set(session.id, session);
          }
        } catch {
          // Ignore corrupt session files
        }
      }
    } catch {
      // Directory might not exist yet
    }
  }

  private async cleanupOldSessions(): Promise<void> {
    if (this.sessions.size <= this.config.maxSessions) return;
    
    // Sort by last active and remove oldest
    const sorted = Array.from(this.sessions.entries())
      .sort((a, b) => a[1].lastActive - b[1].lastActive);
    
    const toRemove = sorted.slice(0, sorted.length - this.config.maxSessions);
    
    for (const [id] of toRemove) {
      await this.deleteSession(id);
    }
  }
}
