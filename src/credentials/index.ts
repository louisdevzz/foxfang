/**
 * Credentials Store - OS Keychain Integration
 * 
 * Level 3 Security: Store API keys in OS keychain instead of plain JSON
 * 
 * Supported platforms:
 * - macOS: Keychain (security command)
 * - Linux: encrypted file fallback (VPS/headless-friendly)
 * - Windows: Windows Credential Manager (vault/cmdkey)
 * 
 * Fallback: Encrypted file if keychain unavailable
 */

import { execSync } from 'child_process';
import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const SERVICE_NAME = 'FoxFang';
const ACCOUNT_PREFIX = 'provider:';

// Fallback encryption key derived from machine-specific data
function getMachineKey(): Buffer {
  const machineId = `${homemodir()}-${process.env.USER || process.env.USERNAME}`;
  return scryptSync(machineId, 'FoxFangSalt', 32);
}

function homemodir(): string {
  return homedir();
}

export interface CredentialEntry {
  provider: string;
  apiKey: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  apiType?: string;
  createdAt: string;
}

export interface CredentialRef {
  source: 'keychain' | 'file' | 'env';
  provider: string;
}

/**
 * Detect OS platform
 */
function getPlatform(): 'macos' | 'linux' | 'windows' | 'unknown' {
  const platform = process.platform;
  if (platform === 'darwin') return 'macos';
  if (platform === 'linux') return 'linux';
  if (platform === 'win32') return 'windows';
  return 'unknown';
}

/**
 * Check if keychain is available
 */
export function isKeychainAvailable(): boolean {
  const platform = getPlatform();
  
  try {
    if (platform === 'macos') {
      execSync('which security', { stdio: 'ignore' });
      return true;
    }
    if (platform === 'linux') {
      // Match OpenClaw behavior: Linux uses file-backed credentials by default.
      // This avoids hard dependency on libsecret + DBus session on VPS/headless hosts.
      return false;
    }
    if (platform === 'windows') {
      // Windows has built-in vault via PowerShell
      return true;
    }
  } catch {
    // Fall through
  }
  return false;
}

/**
 * Save credential to OS keychain
 */
export async function saveCredential(provider: string, entry: CredentialEntry): Promise<void> {
  const platform = getPlatform();
  const account = `${ACCOUNT_PREFIX}${provider}`;
  const data = JSON.stringify(entry);
  
  try {
    if (platform === 'macos') {
      // macOS Keychain
      execSync(
        `security add-generic-password -s "${SERVICE_NAME}" -a "${account}" -w "${data.replace(/"/g, '\\"')}" -U`,
        { stdio: 'ignore' }
      );
      return;
    }
    
    if (platform === 'windows') {
      // Windows Credential Manager via PowerShell
      const script = `
        $credential = New-Object System.Management.Automation.PSCredential -ArgumentList @(
          '${account}',
          (ConvertTo-SecureString -String '${data.replace(/'/g, "''")}' -AsPlainText -Force)
        );
        $credential.Password | ConvertFrom-SecureString | Out-File -FilePath "$env:TEMP\\${SERVICE_NAME}_${provider}.cred" -Encoding UTF8;
        cmdkey /generic:${SERVICE_NAME}_${account} /user:${account} /pass:$($credential.GetNetworkCredential().Password)
      `;
      execSync(`powershell -Command "${script}"`, { stdio: 'ignore' });
      return;
    }
  } catch (error) {
    console.warn(`Keychain save failed, using encrypted file fallback: ${error}`);
  }
  
  // Fallback: Encrypted file
  await saveCredentialToFile(provider, entry);
}

/**
 * Get credential from OS keychain
 */
export async function getCredential(provider: string): Promise<CredentialEntry | null> {
  const platform = getPlatform();
  const account = `${ACCOUNT_PREFIX}${provider}`;
  
  try {
    if (platform === 'macos') {
      const result = execSync(
        `security find-generic-password -s "${SERVICE_NAME}" -a "${account}" -w`,
        { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
      );
      return JSON.parse(result.trim());
    }
    
    if (platform === 'windows') {
      const script = `
        $cred = cmdkey /list | Select-String -Pattern "${SERVICE_NAME}_${account}";
        if ($cred) {
          $output = cmdkey /list:${SERVICE_NAME}_${account} 2>&1;
          Write-Output $output;
        }
      `;
      const result = execSync(`powershell -Command "${script}"`, { 
        encoding: 'utf8', 
        stdio: ['pipe', 'pipe', 'pipe'] 
      });
      // Parse credential from output
      const match = result.match(/Password:\s*(.+)/);
      if (match) {
        return JSON.parse(match[1].trim());
      }
    }
  } catch {
    // Try file fallback
  }
  
  // Fallback: Encrypted file
  return getCredentialFromFile(provider);
}

/**
 * Delete credential from keychain
 */
export async function deleteCredential(provider: string): Promise<void> {
  const platform = getPlatform();
  const account = `${ACCOUNT_PREFIX}${provider}`;
  
  try {
    if (platform === 'macos') {
      execSync(
        `security delete-generic-password -s "${SERVICE_NAME}" -a "${account}"`,
        { stdio: 'ignore' }
      );
      return;
    }
    
    if (platform === 'windows') {
      execSync(`cmdkey /delete:${SERVICE_NAME}_${account}`, { stdio: 'ignore' });
      return;
    }
  } catch {
    // Try file fallback
  }
  
  // Delete from file fallback
  deleteCredentialFromFile(provider);
}

/**
 * List all saved credential providers
 */
export async function listCredentials(): Promise<string[]> {
  const platform = getPlatform();
  const providers: string[] = [];
  
  try {
    if (platform === 'macos') {
      const result = execSync(
        `security dump-keychain 2>/dev/null | grep -E 'svce|acct' | grep -A1 '"${SERVICE_NAME}"' || true`,
        { encoding: 'utf8' }
      );
      const matches = result.match(new RegExp(`${ACCOUNT_PREFIX}([^"]+)`, 'g'));
      if (matches) {
        matches.forEach(m => providers.push(m.replace(ACCOUNT_PREFIX, '')));
      }
    }
    
    // For Linux and Windows, list from file fallback
    providers.push(...listCredentialsFromFile());
  } catch {
    providers.push(...listCredentialsFromFile());
  }
  
  return [...new Set(providers)]; // Deduplicate
}

// ============================================================================
// Encrypted File Fallback (when keychain unavailable)
// ============================================================================

const CREDENTIALS_DIR = join(homedir(), '.foxfang', 'credentials');
const CREDENTIALS_FILE = join(CREDENTIALS_DIR, 'store.enc');

function ensureCredentialsDir(): void {
  if (!existsSync(CREDENTIALS_DIR)) {
    mkdirSync(CREDENTIALS_DIR, { recursive: true, mode: 0o700 });
  }
}

function encrypt(data: string): string {
  const key = getMachineKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return iv.toString('base64') + ':' + authTag.toString('base64') + ':' + encrypted.toString('base64');
}

function decrypt(encryptedData: string): string {
  const key = getMachineKey();
  const [ivBase64, authTagBase64, dataBase64] = encryptedData.split(':');
  const iv = Buffer.from(ivBase64, 'base64');
  const authTag = Buffer.from(authTagBase64, 'base64');
  const encrypted = Buffer.from(dataBase64, 'base64');
  
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}

async function saveCredentialToFile(provider: string, entry: CredentialEntry): Promise<void> {
  ensureCredentialsDir();
  
  const store = loadCredentialsFile();
  store[provider] = entry;
  
  const data = JSON.stringify(store, null, 2);
  const encrypted = encrypt(data);
  
  writeFileSync(CREDENTIALS_FILE, encrypted, { mode: 0o600 });
}

async function getCredentialFromFile(provider: string): Promise<CredentialEntry | null> {
  if (!existsSync(CREDENTIALS_FILE)) {
    return null;
  }
  
  try {
    const encrypted = readFileSync(CREDENTIALS_FILE, 'utf8');
    const data = decrypt(encrypted);
    const store = JSON.parse(data);
    return store[provider] || null;
  } catch {
    return null;
  }
}

function deleteCredentialFromFile(provider: string): void {
  if (!existsSync(CREDENTIALS_FILE)) {
    return;
  }
  
  try {
    const encrypted = readFileSync(CREDENTIALS_FILE, 'utf8');
    const data = decrypt(encrypted);
    const store = JSON.parse(data);
    delete store[provider];
    
    const newEncrypted = encrypt(JSON.stringify(store, null, 2));
    writeFileSync(CREDENTIALS_FILE, newEncrypted, { mode: 0o600 });
  } catch {
    // Ignore errors
  }
}

function listCredentialsFromFile(): string[] {
  if (!existsSync(CREDENTIALS_FILE)) {
    return [];
  }
  
  try {
    const encrypted = readFileSync(CREDENTIALS_FILE, 'utf8');
    const data = decrypt(encrypted);
    const store = JSON.parse(data);
    return Object.keys(store);
  } catch {
    return [];
  }
}

function loadCredentialsFile(): Record<string, CredentialEntry> {
  if (!existsSync(CREDENTIALS_FILE)) {
    return {};
  }
  
  try {
    const encrypted = readFileSync(CREDENTIALS_FILE, 'utf8');
    const data = decrypt(encrypted);
    return JSON.parse(data);
  } catch {
    return {};
  }
}

// ============================================================================
// Migration from old config
// ============================================================================

/**
 * Migrate API keys from foxfang.json to credentials store
 */
export async function migrateFromConfig(config: any): Promise<string[]> {
  const migrated: string[] = [];
  
  if (!config.providers) return migrated;
  
  for (const provider of config.providers) {
    if (provider.apiKey) {
      await saveCredential(provider.id, {
        provider: provider.id,
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
        headers: provider.headers,
        apiType: provider.apiType,
        createdAt: new Date().toISOString(),
      });
      migrated.push(provider.id);
      
      // Remove from config
      delete provider.apiKey;
    }
  }
  
  // Also migrate channel tokens
  if (config.channels) {
    for (const [channel, settings] of Object.entries(config.channels)) {
      const channelSettings = settings as any;
      if (channelSettings.botToken) {
        await saveCredential(`channel:${channel}`, {
          provider: `channel:${channel}`,
          apiKey: channelSettings.botToken,
          createdAt: new Date().toISOString(),
        });
        migrated.push(`channel:${channel}`);
        delete channelSettings.botToken;
      }
    }
  }
  
  return migrated;
}
