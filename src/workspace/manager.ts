// src/workspace/manager.ts
// Workspace file manager

import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'fs';
import { join } from 'path';
import { resolveFoxFangHome } from '../config/defaults';
import { expandHomePath, seedManagedSkills, syncBrowserGuide } from '../skill-system';
import { WorkspaceFile, WorkspaceConfig, IdentityData, UserData, SoulData } from './types';
import { seedWorkspacePresets } from './preset-seed';
import {
  IDENTITY_TEMPLATE,
  IDENTITY_BRAND_TEMPLATE,
  SOUL_TEMPLATE,
  SOUL_BRAND_TEMPLATE,
  USER_TEMPLATE,
  MEMORY_TEMPLATE,
  AGENTS_TEMPLATE,
  TOOLS_TEMPLATE,
  HEARTBEAT_TEMPLATE,
  AGENT_AGENTS_TEMPLATE,
  renderTemplate
} from './templates';

// ─── Layer 1: Stat-based file cache (process lifetime) ────────────────────
// Avoids re-reading file content when it hasn't changed on disk.
// Key = absolute path, value = { content, identity: "size:mtimeMs" }
const fileCache = new Map<string, { content: string; identity: string }>();

function fileIdentity(filepath: string): string | null {
  try {
    const st = statSync(filepath);
    return `${st.size}:${st.mtimeMs}`;
  } catch {
    return null;
  }
}

function readFileCached(filepath: string): string | null {
  const identity = fileIdentity(filepath);
  if (!identity) return null; // file doesn't exist

  const cached = fileCache.get(filepath);
  if (cached && cached.identity === identity) {
    return cached.content; // cache hit — no re-read
  }

  try {
    const content = readFileSync(filepath, 'utf-8');
    fileCache.set(filepath, { content, identity });
    return content;
  } catch {
    return null;
  }
}

// Invalidate a single file from cache (called after writes)
function invalidateFileCache(filepath: string): void {
  fileCache.delete(filepath);
}

// ─── Layer 2: Session-level bootstrap snapshot ────────────────────────────
// Once a session loads workspace files, subsequent messages in that session
// skip ALL file I/O — they reuse the cached snapshot.
type BootstrapSnapshot = Map<string, string | null>;
const sessionSnapshots = new Map<string, BootstrapSnapshot>();

export function getSessionSnapshot(sessionKey: string): BootstrapSnapshot | undefined {
  return sessionSnapshots.get(sessionKey);
}

export function setSessionSnapshot(sessionKey: string, snapshot: BootstrapSnapshot): void {
  sessionSnapshots.set(sessionKey, snapshot);
}

export function clearSessionSnapshot(sessionKey: string): void {
  sessionSnapshots.delete(sessionKey);
}

/**
 * Bootstrap the ~/.foxfang home directory on first run.
 * Creates the top-level folder structure (workspace, sessions, skills, data).
 */
export function initFoxFangHome(homeDir?: string): string {
  const home = expandHomePath(homeDir || resolveFoxFangHome());
  const dirs = [
    home,
    join(home, 'workspace'),
    join(home, 'workspace', 'presets'),
    join(home, 'sessions'),
    join(home, 'skills'),
    join(home, 'data'),
  ];

  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  const seeded = seedManagedSkills(home);
  if (seeded.copied > 0) {
    console.log(`[FoxFang] Seeded ${seeded.copied} default skill(s) to: ${seeded.managedDir}`);
  }
  const guideSync = syncBrowserGuide(home);
  if (guideSync.copied && guideSync.targetPath) {
    console.log(`[FoxFang] Synced browser guide: ${guideSync.targetPath}`);
  }

  const presetSeed = seedWorkspacePresets(home);
  if (presetSeed.copied > 0) {
    console.log(`[FoxFang] Seeded ${presetSeed.copied} workspace preset file(s) to: ${presetSeed.targetDir}`);
  }

  console.log(`[FoxFang] Home directory initialized at: ${home}`);
  return home;
}

export class WorkspaceManager {
  private config: WorkspaceConfig;
  private files: Map<string, WorkspaceFile> = new Map();
  
  constructor(config: WorkspaceConfig) {
    this.config = config;
    this.ensureWorkspaceExists();
  }
  
  private ensureWorkspaceExists(): void {
    const workspacePath = this.getWorkspacePath();
    if (!existsSync(workspacePath)) {
      mkdirSync(workspacePath, { recursive: true });
    }
  }
  
  private getWorkspacePath(): string {
    // ~/.foxfang/ (user root — workspace files live here directly)
    // ~/.foxfang/workspace/projects/<projectId>/
    // ~/.foxfang/workspace/projects/<projectId>/agents/<agentId>/
    if (this.config.projectId) {
      const projectPath = join(this.config.workspaceDir, 'workspace', 'projects', this.config.projectId);
      if (this.config.agentId) {
        return join(projectPath, 'agents', this.config.agentId);
      }
      return projectPath;
    }
    return this.config.workspaceDir;
  }
  
  private getFilePath(filename: string): string {
    return join(this.getWorkspacePath(), filename);
  }

  private getProjectRootPath(): string | null {
    if (!this.config.projectId) return null;
    return join(this.config.workspaceDir, 'workspace', 'projects', this.config.projectId);
  }

  private getRootAgentsSpec(): string | null {
    const rootPath = join(process.cwd(), 'AGENTS.md');
    if (!existsSync(rootPath)) return null;
    try {
      return readFileSync(rootPath, 'utf-8');
    } catch (error) {
      console.warn('[Workspace] Failed to read root AGENTS.md:', error);
      return null;
    }
  }
  
  // Initialize workspace with default files
  initializeWorkspace(
    identity: IdentityData,
    user: UserData,
    soul?: Partial<SoulData>
  ): void {
    const timestamp = new Date();
    
    // Create IDENTITY.md
    this.writeFile('IDENTITY.md', renderTemplate(IDENTITY_TEMPLATE, {
      name: identity.name,
      role: identity.role,
      description: identity.description,
      capabilities: identity.capabilities.map(c => `- ${c}`).join('\n'),
      tone: identity.tone || 'Professional, creative, and strategic'
    }), 'identity');
    
    // Create SOUL.md
    this.writeFile('SOUL.md', renderTemplate(SOUL_TEMPLATE, {}), 'identity');
    
    // Create USER.md
    this.writeFile('USER.md', renderTemplate(USER_TEMPLATE, {
      userName: user.name,
      userEmail: user.email,
      timezone: user.timezone ? `- **Timezone:** ${user.timezone}` : '',
      language: user.language ? `- **Language:** ${user.language}` : '',
      organization: user.preferences?.organization || 'Not specified',
      industry: user.preferences?.industry || 'Not specified',
      userRole: user.preferences?.role || 'Not specified',
      preferences: '- Professional and direct communication\n- Data-driven recommendations\n- Creative and innovative solutions',
      focus: '- Current marketing campaigns\n- Brand development\n- Content strategy'
    }), 'user');
    
    // Create MEMORY.md
    this.writeFile('MEMORY.md', renderTemplate(MEMORY_TEMPLATE, {
      keyFacts: '- FoxFang workspace initialized\n- Ready to assist with marketing tasks',
      decisions: '- None yet',
      lessons: '- None yet',
      openLoops: '- None yet'
    }), 'memory');
    
    // Create AGENTS.md
    const rootAgents = this.getRootAgentsSpec();
    this.writeFile('AGENTS.md', rootAgents || renderTemplate(AGENTS_TEMPLATE, {}), 'protocol');

    // Create TOOLS.md
    this.writeFile('TOOLS.md', renderTemplate(TOOLS_TEMPLATE, {}), 'protocol');

    // Create HEARTBEAT.md
    this.writeFile('HEARTBEAT.md', renderTemplate(HEARTBEAT_TEMPLATE, {}), 'protocol');
    
    console.log(`[Workspace] Initialized workspace for user: ${this.config.userId}`);
  }

  // Initialize a project workspace with minimal metadata
  initializeProjectWorkspace(project: { name: string; description?: string }): void {
    const content = `# PROJECT — ${project.name}

## Description
${project.description || 'No description provided.'}

## Notes
- Created: ${new Date().toISOString()}
- Owner: ${this.config.userId}
`;

    this.writeFile('PROJECT.md', content, 'user');
  }

  // Initialize an agent workspace with identity + collaboration files.
  // Pass brandContent to make the agent brand-aware from the start.
  initializeAgentWorkspace(params: {
    agentName: string;
    agentEmail: string;
    userName: string;
    userEmail: string;
    brandContent?: string;
  }): void {
    const { agentName, agentEmail, userName, userEmail, brandContent } = params;

    const identityContent = renderTemplate(IDENTITY_TEMPLATE, {
      name: agentName,
      role: 'Marketing Specialist Agent',
      description: 'Specialized marketing agent for campaign execution',
      capabilities: [
        'Marketing strategy execution',
        'Content creation',
        'Campaign optimization',
        'Channel analysis',
        'Audience messaging'
      ].map(c => `- ${c}`).join('\n'),
      tone: 'Professional, concise, and collaborative'
    });

    const userContent = renderTemplate(USER_TEMPLATE, {
      userName,
      userEmail,
      timezone: '',
      language: '',
      organization: 'FoxFang',
      industry: 'Marketing',
      userRole: 'Operator',
      preferences: '- Clear status updates\n- Actionable next steps\n- Ask questions when blocked',
      focus: '- Active marketing priorities'
    });

    this.writeFile('IDENTITY.md', identityContent, 'identity');
    this.writeFile('SOUL.md', renderTemplate(SOUL_TEMPLATE, {}), 'identity');
    this.writeFile('USER.md', userContent, 'user');
    this.writeFile('MEMORY.md', renderTemplate(MEMORY_TEMPLATE, {
      keyFacts: `- Agent ${agentName} initialized\n- Agent email: ${agentEmail}`,
      decisions: '- None yet',
      lessons: '- None yet',
      openLoops: '- None yet'
    }), 'memory');
    const rootAgentsSpec = this.getRootAgentsSpec();
    const agentAgents = rootAgentsSpec
      ? `${rootAgentsSpec}\n\n${renderTemplate(AGENT_AGENTS_TEMPLATE, {})}`
      : renderTemplate(AGENT_AGENTS_TEMPLATE, {});
    this.writeFile('AGENTS.md', agentAgents, 'protocol');
    this.writeFile('TOOLS.md', renderTemplate(TOOLS_TEMPLATE, {}), 'protocol');
    this.writeFile('HEARTBEAT.md', renderTemplate(HEARTBEAT_TEMPLATE, {}), 'protocol');

    // If brand content provided, overwrite SOUL.md and IDENTITY.md with brand-aware versions
    if (brandContent && brandContent.trim()) {
      this.applyBrandContext({ brandContent, agentName, agentRole: 'Marketing Specialist Agent' });
    }
  }
  
  // Read a workspace file (stat-cached — only re-reads when file changes on disk)
  readFile(filename: string): string | null {
    const filepath = this.getFilePath(filename);
    const localContent = readFileCached(filepath);
    if (localContent != null) return localContent;

    // Agent workspaces inherit shared project files when not overridden locally.
    if (this.config.projectId && this.config.agentId) {
      const projectRoot = this.getProjectRootPath();
      if (projectRoot) {
        const sharedPath = join(projectRoot, filename);
        if (sharedPath !== filepath) {
          const sharedContent = readFileCached(sharedPath);
          if (sharedContent != null) return sharedContent;
        }
      }
    }

    // Global workspace presets (shared across agents/projects):
    // ~/.foxfang/workspace/presets/*.md
    if (filename.startsWith('presets/')) {
      const presetPath = join(this.config.workspaceDir, 'workspace', filename);
      const presetContent = readFileCached(presetPath);
      if (presetContent != null) return presetContent;
    }

    return null;
  }
  
  // Write a workspace file (invalidates stat cache so next read picks up changes)
  writeFile(filename: string, content: string, category: WorkspaceFile['category']): void {
    const filepath = this.getFilePath(filename);

    try {
      writeFileSync(filepath, content, 'utf-8');
      invalidateFileCache(filepath);

      this.files.set(filename, {
        name: filename,
        content,
        lastModified: new Date(),
        category
      });

      console.log(`[Workspace] Updated ${filename}`);
    } catch (error) {
      console.error(`[Workspace] Failed to write ${filename}:`, error);
      throw error;
    }
  }
  
  // Append to a file
  appendToFile(filename: string, content: string): void {
    const existing = this.readFile(filename) || '';
    this.writeFile(filename, existing + '\n' + content, 'memory');
  }
  
  // Get all workspace files
  getAllFiles(): WorkspaceFile[] {
    return Array.from(this.files.values());
  }
  
  // Get system prompt from workspace files
  getSystemPrompt(): string {
    const files = [
      { name: 'AGENTS.md', required: true },
      { name: 'SOUL.md', required: true },
      { name: 'BRAND_VOICE.md', required: false }, // Brand voice profile (project-specific)
      { name: 'BRAND.md', required: false },   // Brand context — highest priority content signal
      { name: 'PROJECT.md', required: false },
      { name: 'TOOLS.md', required: true },
      { name: 'IDENTITY.md', required: true },
      { name: 'USER.md', required: false },
      { name: 'HEARTBEAT.md', required: false },
      { name: 'MEMORY.md', required: false },
    ];

    const sections: string[] = [];

    for (const file of files) {
      const content = this.readFile(file.name);
      if (content) {
        sections.push(`--- ${file.name} ---\n${content}`);
      } else if (file.required) {
        console.warn(`[Workspace] Required file ${file.name} not found`);
      }
    }

    return sections.join('\n\n');
  }

  // Apply brand context to this agent workspace.
  // Writes BRAND.md + BRAND_VOICE.md and rewrites SOUL.md + IDENTITY.md to be brand-aware.
  applyBrandContext(params: {
    brandContent: string;
    agentName: string;
    agentRole?: string;
  }): void {
    const { brandContent, agentName } = params;
    const agentRole = params.agentRole || 'Marketing Specialist Agent';

    // Extract a short brand name from the content (first heading or first line)
    const brandNameMatch = brandContent.match(/^#\s+(.+)$/m) || brandContent.match(/\*\*Brand[:\s]+(.+?)\*\*/i);
    const brandName = brandNameMatch ? brandNameMatch[1].trim() : 'Brand';

    // Extract a brief summary — first non-heading paragraph (up to 300 chars)
    const summaryMatch = brandContent.replace(/^#.*$/gm, '').match(/([^\n]{40,})/);
    const brandSummary = summaryMatch
      ? summaryMatch[1].trim().slice(0, 300) + (summaryMatch[1].length > 300 ? '...' : '')
      : 'See full brand guidelines below.';

    // Write the raw brand document
    this.writeFile('BRAND.md', brandContent, 'user');

    // Write a concise brand voice profile that can be swapped per project.
    const brandVoiceContent = `# Brand Voice — ${brandName}

## Core Tone
${brandSummary}

## Voice Principles
- Keep writing consistent with ${brandName}'s positioning and audience.
- Prefer clear, specific language over generic marketing phrasing.
- Use this file as the highest-priority voice reference for this project.

## Source
- Derived from BRAND.md
- Updated at: ${new Date().toISOString()}
`;
    this.writeFile('BRAND_VOICE.md', brandVoiceContent, 'user');

    // Rewrite SOUL.md with brand-aware template
    const soulContent = renderTemplate(SOUL_BRAND_TEMPLATE, { brandName, brandSummary });
    this.writeFile('SOUL.md', soulContent, 'identity');

    // Rewrite IDENTITY.md with brand-aware template
    const identityContent = renderTemplate(IDENTITY_BRAND_TEMPLATE, {
      name: agentName,
      role: agentRole,
      brandName,
      description: `Brand-aligned marketing agent for ${brandName}`,
      capabilities: [
        'Brand-aligned marketing strategy execution',
        'On-brand content creation and copywriting',
        'Campaign optimization within brand guidelines',
        'Channel analysis aligned to brand audience',
        'Brand-consistent audience messaging'
      ].map(c => `- ${c}`).join('\n'),
      tone: `Professional, concise, and aligned with ${brandName} brand voice`
    });
    this.writeFile('IDENTITY.md', identityContent, 'identity');

    // Update MEMORY.md to note brand application
    const memory = this.readFile('MEMORY.md') || '';
    const brandNote = `\n- **[brand]** Brand context applied from BRAND.md for "${brandName}". BRAND_VOICE.md, SOUL.md and IDENTITY.md updated. (${new Date().toISOString()})`;
    this.writeFile('MEMORY.md', memory + brandNote, 'memory');

    console.log(`[Workspace] Brand context applied for agent ${agentName}: "${brandName}"`);
  }
  
  // Update memory with new entry
  addMemoryEntry(content: string, category: string = 'core'): void {
    const memoryFile = this.readFile('MEMORY.md') || '';
    const entry = `\n- **[${category}]** ${content} (${new Date().toISOString()})`;
    
    this.writeFile('MEMORY.md', memoryFile + entry, 'memory');
  }
  
  // Write a binary asset file to the workspace assets directory
  writeAsset(filename: string, buffer: Buffer): string {
    const assetsDir = join(this.getWorkspacePath(), 'assets');
    if (!existsSync(assetsDir)) {
      mkdirSync(assetsDir, { recursive: true });
    }
    const filepath = join(assetsDir, filename);
    writeFileSync(filepath, buffer);
    console.log(`[Workspace] Asset written: assets/${filename}`);
    return `assets/${filename}`;
  }

  // Read a binary asset file from the workspace
  readAsset(relativePath: string): Buffer | null {
    const filepath = join(this.getWorkspacePath(), relativePath);
    if (!existsSync(filepath)) return null;
    try {
      return readFileSync(filepath) as Buffer;
    } catch (error) {
      console.error(`[Workspace] Failed to read asset ${relativePath}:`, error);
      return null;
    }
  }

  // Check if workspace exists
  exists(): boolean {
    return existsSync(this.getWorkspacePath());
  }
  
  // Get workspace info
  getInfo(): { path: string; files: string[]; userId: string } {
    return {
      path: this.getWorkspacePath(),
      files: Array.from(this.files.keys()),
      userId: this.config.userId
    };
  }

  // Runtime hook for skills + prompt context resolution.
  getWorkspaceInfo(): { homeDir: string; workspacePath: string } {
    return {
      homeDir: this.config.workspaceDir,
      workspacePath: this.getWorkspacePath(),
    };
  }
}

// Factory function
export function createWorkspaceManager(
  userId: string,
  workspaceDir?: string,
  projectId?: string,
  agentId?: string
): WorkspaceManager {
  return new WorkspaceManager({
    workspaceDir: expandHomePath(workspaceDir || resolveFoxFangHome()),
    userId,
    projectId,
    agentId
  });
}
