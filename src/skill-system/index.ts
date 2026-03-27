/**
 * Skills subsystem
 *
 * Loads skills from bundled + managed locations,
 * formats catalog for prompts, and seeds managed skills on first run.
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'fs';
import { homedir } from 'os';
import { basename, join, resolve } from 'path';
import { resolveFoxFangHome } from '../config/defaults';

export type SkillSource = 'bundled' | 'managed';

export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  source: SkillSource;
  content?: string;
}

export interface LoadSkillsOptions {
  homeDir?: string;
  // Kept for backward compatibility; ignored in current resolver.
  workspacePath?: string;
  includeContent?: boolean;
  maxContentChars?: number;
  maxSkills?: number;
}

const DEFAULT_MAX_CONTENT_CHARS = 12_000;
const DEFAULT_MAX_PROMPT_SKILLS = 40;
const BROWSER_GUIDE_FILENAME = 'BROWSER_COMMANDS.md';

function isDirectory(pathname: string): boolean {
  try {
    return statSync(pathname).isDirectory();
  } catch {
    return false;
  }
}

export function expandHomePath(pathname?: string): string {
  const raw = pathname?.trim();
  if (!raw) {
    return resolveFoxFangHome();
  }

  if (raw === '~') {
    return homedir();
  }

  if (raw.startsWith('~/')) {
    return join(homedir(), raw.slice(2));
  }

  return resolve(raw);
}

export function resolveFoxFangHomePath(homeDir?: string): string {
  return expandHomePath(homeDir);
}

export function resolveManagedSkillsDir(homeDir?: string): string {
  return join(resolveFoxFangHomePath(homeDir), 'skills');
}

export function resolveBundledSkillsDir(): string | null {
  const envPath = process.env.FOXFANG_BUNDLED_SKILLS_DIR;
  const candidates = [
    envPath,
    join(process.cwd(), 'skills'),
    join(__dirname, '..', '..', 'skills'),
    join(__dirname, '..', 'skills'),
  ].filter(Boolean) as string[];

  const seen = new Set<string>();
  for (const candidate of candidates) {
    const resolved = resolve(expandHomePath(candidate));
    if (seen.has(resolved)) {
      continue;
    }
    seen.add(resolved);
    if (isDirectory(resolved)) {
      return resolved;
    }
  }

  return null;
}

function resolveBrowserGuideSourcePath(): string | null {
  const candidates = [
    join(process.cwd(), 'docs', BROWSER_GUIDE_FILENAME),
    join(__dirname, '..', '..', 'docs', BROWSER_GUIDE_FILENAME),
    join(__dirname, '..', 'docs', BROWSER_GUIDE_FILENAME),
  ];

  const seen = new Set<string>();
  for (const candidate of candidates) {
    const resolved = resolve(expandHomePath(candidate));
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    try {
      if (statSync(resolved).isFile()) {
        return resolved;
      }
    } catch {
      // ignore
    }
  }
  return null;
}

export function syncBrowserGuide(homeDir?: string): {
  copied: boolean;
  targetPath?: string;
  reason?: string;
} {
  const home = resolveFoxFangHomePath(homeDir);
  const sourcePath = resolveBrowserGuideSourcePath();
  if (!sourcePath) {
    return { copied: false, reason: 'source-missing' };
  }

  const targetDir = join(resolveManagedSkillsDir(home), 'browser');
  const targetPath = join(targetDir, BROWSER_GUIDE_FILENAME);

  try {
    mkdirSync(targetDir, { recursive: true });
    cpSync(sourcePath, targetPath, { force: true });
    return { copied: true, targetPath };
  } catch {
    return { copied: false, targetPath, reason: 'copy-failed' };
  }
}

function parseFrontmatter(raw: string): Record<string, string> {
  const match = raw.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
  if (!match) {
    return {};
  }

  const frontmatter: Record<string, string> = {};
  const lines = match[1].split(/\r?\n/);
  for (const line of lines) {
    const keyValue = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.+)$/);
    if (!keyValue) {
      continue;
    }
    const key = keyValue[1].trim();
    let value = keyValue[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    frontmatter[key] = value;
  }

  return frontmatter;
}

function stripFrontmatter(raw: string): string {
  return raw.replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/, '');
}

function extractDescriptionFromBody(body: string): string {
  const lines = body.split(/\r?\n/).map((line) => line.trim());
  const paragraph: string[] = [];

  for (const line of lines) {
    if (!line) {
      if (paragraph.length > 0) {
        break;
      }
      continue;
    }

    if (
      line.startsWith('#') ||
      line.startsWith('```') ||
      line.startsWith('-') ||
      line.startsWith('*') ||
      line.startsWith('|') ||
      /^\d+\./.test(line)
    ) {
      if (paragraph.length > 0) {
        break;
      }
      continue;
    }

    paragraph.push(line);
    if (paragraph.join(' ').length >= 280) {
      break;
    }
  }

  return paragraph.join(' ').slice(0, 280);
}

function extractNameFromBody(body: string): string | null {
  const heading = body.match(/^#\s+(.+)$/m);
  if (!heading) {
    return null;
  }
  return heading[1].trim();
}

function normalizeSkillId(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function listSkillDirectories(skillsRoot: string): string[] {
  if (!isDirectory(skillsRoot)) {
    return [];
  }

  const rootSkillMd = join(skillsRoot, 'SKILL.md');
  if (existsSync(rootSkillMd)) {
    return [skillsRoot];
  }

  const skillDirs: string[] = [];
  const entries = readdirSync(skillsRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    if (entry.name.startsWith('.')) {
      continue;
    }
    const baseDir = join(skillsRoot, entry.name);
    const skillMd = join(baseDir, 'SKILL.md');
    if (existsSync(skillMd)) {
      skillDirs.push(baseDir);
    }
  }
  return skillDirs;
}

function loadSkillsFromRoot(
  skillsRoot: string,
  source: SkillSource,
  options?: Pick<LoadSkillsOptions, 'includeContent' | 'maxContentChars' | 'maxSkills'>,
): SkillDefinition[] {
  const includeContent = options?.includeContent === true;
  const maxContentChars = options?.maxContentChars ?? DEFAULT_MAX_CONTENT_CHARS;
  const maxSkills = options?.maxSkills ?? Infinity;

  const dirs = listSkillDirectories(skillsRoot);
  const skills: SkillDefinition[] = [];

  for (const dir of dirs) {
    if (skills.length >= maxSkills) {
      break;
    }

    const skillMdPath = join(dir, 'SKILL.md');
    let raw = '';
    try {
      raw = readFileSync(skillMdPath, 'utf-8');
    } catch {
      continue;
    }

    const frontmatter = parseFrontmatter(raw);
    const body = stripFrontmatter(raw);
    const fallbackName = basename(dir);
    const name = frontmatter.name?.trim() || extractNameFromBody(body) || fallbackName;
    const description =
      frontmatter.description?.trim() ||
      extractDescriptionFromBody(body) ||
      `Skill instructions for ${name}.`;

    skills.push({
      id: normalizeSkillId(basename(dir)),
      name,
      description,
      filePath: skillMdPath,
      baseDir: dir,
      source,
      ...(includeContent ? { content: raw.slice(0, maxContentChars) } : {}),
    });
  }

  return skills;
}

export function loadAvailableSkills(options?: LoadSkillsOptions): SkillDefinition[] {
  const homeDir = resolveFoxFangHomePath(options?.homeDir);
  const maxSkills = options?.maxSkills;
  const includeContent = options?.includeContent;
  const maxContentChars = options?.maxContentChars;

  const bundledDir = resolveBundledSkillsDir();
  const managedDir = resolveManagedSkillsDir(homeDir);

  const merged = new Map<string, SkillDefinition>();

  const putSkills = (skills: SkillDefinition[]) => {
    for (const skill of skills) {
      merged.set(skill.name.toLowerCase(), skill);
    }
  };

  if (bundledDir) {
    putSkills(loadSkillsFromRoot(bundledDir, 'bundled', { includeContent, maxContentChars, maxSkills }));
  }
  putSkills(loadSkillsFromRoot(managedDir, 'managed', { includeContent, maxContentChars, maxSkills }));

  return Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function escapeXml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function formatSkillsForPrompt(skills: SkillDefinition[], maxSkills = DEFAULT_MAX_PROMPT_SKILLS): string {
  const visible = skills.slice(0, Math.max(0, maxSkills));
  if (visible.length === 0) {
    return '';
  }

  const lines: string[] = [];
  lines.push('<available_skills>');
  for (const skill of visible) {
    lines.push('  <skill>');
    lines.push(`    <name>${escapeXml(skill.name)}</name>`);
    lines.push(`    <description>${escapeXml(skill.description)}</description>`);
    lines.push(`    <location>${escapeXml(skill.filePath)}</location>`);
    lines.push('  </skill>');
  }
  lines.push('</available_skills>');

  return lines.join('\n');
}

function countSkillsInDir(skillsRoot: string): number {
  return listSkillDirectories(skillsRoot).length;
}

export function seedManagedSkills(homeDir?: string): {
  managedDir: string;
  copied: number;
  skipped: number;
  reason?: string;
} {
  const home = resolveFoxFangHomePath(homeDir);
  const managedDir = resolveManagedSkillsDir(home);

  mkdirSync(managedDir, { recursive: true });

  if (countSkillsInDir(managedDir) > 0) {
    return {
      managedDir,
      copied: 0,
      skipped: 0,
      reason: 'managed-not-empty',
    };
  }

  const bundledDir = resolveBundledSkillsDir();
  if (!bundledDir) {
    return {
      managedDir,
      copied: 0,
      skipped: 0,
      reason: 'bundled-missing',
    };
  }

  let copied = 0;
  let skipped = 0;
  const bundledSkillDirs = listSkillDirectories(bundledDir);
  for (const sourceDir of bundledSkillDirs) {
    const targetDir = join(managedDir, basename(sourceDir));
    if (existsSync(targetDir)) {
      skipped += 1;
      continue;
    }
    cpSync(sourceDir, targetDir, { recursive: true, force: false });
    copied += 1;
  }

  return { managedDir, copied, skipped };
}

export function sanitizeSkillSlug(input: string): string {
  const slug = normalizeSkillId(input);
  return slug || 'custom-skill';
}
