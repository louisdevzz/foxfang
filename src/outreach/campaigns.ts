/**
 * Campaign Management
 * 
 * Create and manage marketing campaigns
 */

import { query, run } from '../database/sqlite';
import { randomUUID } from 'crypto';
import type { 
  Campaign, 
  CampaignContent, 
  CampaignSchedule, 
  CampaignSettings, 
  CampaignStats,
  CampaignTrigger,
  PersonalizationConfig,
  DeliveryJob 
} from './types';
import { getContactsInList, queryContactsBySegment } from './contacts';

// ==================== CAMPAIGN CRUD ====================

export function createCampaign(campaign: Omit<Campaign, 'id' | 'createdAt' | 'updatedAt' | 'stats' | 'status'>): Campaign {
  const id = randomUUID();
  const now = Date.now();
  
  const newCampaign: Campaign = {
    ...campaign,
    id,
    status: campaign.schedule?.type === 'immediate' ? 'running' : 'draft',
    stats: {
      totalContacts: 0,
      sent: 0,
      delivered: 0,
      failed: 0,
      opened: 0,
      clicked: 0,
      replied: 0,
      unsubscribed: 0,
      bounced: 0,
    },
    createdAt: now,
    updatedAt: now,
  };
  
  run(
    `INSERT INTO outreach_campaigns 
     (id, name, description, type, status, list_id, segment, content, schedule, sequence_id, trigger, settings, stats, created_at, updated_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      newCampaign.name,
      newCampaign.description || null,
      newCampaign.type,
      newCampaign.status,
      newCampaign.listId || null,
      newCampaign.segment ? JSON.stringify(newCampaign.segment) : null,
      JSON.stringify(newCampaign.content),
      newCampaign.schedule ? JSON.stringify(newCampaign.schedule) : null,
      newCampaign.sequenceId || null,
      newCampaign.trigger ? JSON.stringify(newCampaign.trigger) : null,
      JSON.stringify(newCampaign.settings),
      JSON.stringify(newCampaign.stats),
      now,
      now,
      newCampaign.createdBy,
    ]
  );
  
  return newCampaign;
}

export function getCampaign(id: string): Campaign | null {
  const row = query<{
    id: string;
    name: string;
    description: string;
    type: string;
    status: string;
    list_id: string;
    segment: string;
    content: string;
    schedule: string;
    sequence_id: string;
    trigger: string;
    settings: string;
    stats: string;
    created_at: number;
    updated_at: number;
    created_by: string;
  }>(`SELECT * FROM outreach_campaigns WHERE id = ?`, [id])[0];
  
  if (!row) return null;
  
  return rowToCampaign(row);
}

export function updateCampaign(id: string, updates: Partial<Campaign>): Campaign | null {
  const campaign = getCampaign(id);
  if (!campaign) return null;
  
  const updated: Campaign = {
    ...campaign,
    ...updates,
    updatedAt: Date.now(),
  };
  
  run(
    `UPDATE outreach_campaigns 
     SET name = ?, description = ?, status = ?, list_id = ?, segment = ?, content = ?, 
         schedule = ?, sequence_id = ?, trigger = ?, settings = ?, stats = ?, updated_at = ?
     WHERE id = ?`,
    [
      updated.name,
      updated.description || null,
      updated.status,
      updated.listId || null,
      updated.segment ? JSON.stringify(updated.segment) : null,
      JSON.stringify(updated.content),
      updated.schedule ? JSON.stringify(updated.schedule) : null,
      updated.sequenceId || null,
      updated.trigger ? JSON.stringify(updated.trigger) : null,
      JSON.stringify(updated.settings),
      JSON.stringify(updated.stats),
      updated.updatedAt,
      id,
    ]
  );
  
  return updated;
}

export function deleteCampaign(id: string): boolean {
  const result = run(`DELETE FROM outreach_campaigns WHERE id = ?`, [id]);
  return result.changes > 0;
}

export function listCampaigns(options?: {
  status?: Campaign['status'];
  type?: Campaign['type'];
  limit?: number;
  offset?: number;
}): { campaigns: Campaign[]; total: number } {
  let whereClause = '';
  const params: any[] = [];
  
  if (options?.status) {
    whereClause += ' WHERE status = ?';
    params.push(options.status);
  }
  
  if (options?.type) {
    whereClause += whereClause ? ' AND type = ?' : ' WHERE type = ?';
    params.push(options.type);
  }
  
  const countRow = query<{ count: number }>(`SELECT COUNT(*) as count FROM outreach_campaigns ${whereClause}`, params)[0];
  const total = countRow?.count || 0;
  
  let sql = `SELECT * FROM outreach_campaigns ${whereClause} ORDER BY created_at DESC`;
  
  if (options?.limit) {
    sql += ` LIMIT ?`;
    params.push(options.limit);
  }
  
  if (options?.offset) {
    sql += ` OFFSET ?`;
    params.push(options.offset);
  }
  
  const rows = query<{
    id: string;
    name: string;
    description: string;
    type: string;
    status: string;
    list_id: string;
    segment: string;
    content: string;
    schedule: string;
    sequence_id: string;
    trigger: string;
    settings: string;
    stats: string;
    created_at: number;
    updated_at: number;
    created_by: string;
  }>(sql, params);
  
  return {
    campaigns: rows.map(rowToCampaign),
    total,
  };
}

// ==================== CAMPAIGN OPERATIONS ====================

export function launchCampaign(id: string): Campaign | null {
  const campaign = getCampaign(id);
  if (!campaign) return null;
  
  if (campaign.status !== 'draft' && campaign.status !== 'scheduled') {
    throw new Error(`Cannot launch campaign with status: ${campaign.status}`);
  }
  
  // Get target contacts
  const contacts = getCampaignContacts(campaign);
  
  // Update campaign
  const updated = updateCampaign(id, {
    status: 'running',
    stats: {
      ...campaign.stats,
      totalContacts: contacts.length,
    },
  });
  
  // Create delivery jobs
  createDeliveryJobs(campaign, contacts);
  
  return updated;
}

export function pauseCampaign(id: string): Campaign | null {
  const campaign = getCampaign(id);
  if (!campaign) return null;
  
  if (campaign.status !== 'running') {
    throw new Error(`Cannot pause campaign with status: ${campaign.status}`);
  }
  
  // Pause pending delivery jobs
  run(
    `UPDATE outreach_delivery_jobs SET status = 'cancelled' 
     WHERE campaign_id = ? AND status = 'pending'`,
    [id]
  );
  
  return updateCampaign(id, { status: 'paused' });
}

export function resumeCampaign(id: string): Campaign | null {
  const campaign = getCampaign(id);
  if (!campaign) return null;
  
  if (campaign.status !== 'paused') {
    throw new Error(`Cannot resume campaign with status: ${campaign.status}`);
  }
  
  return updateCampaign(id, { status: 'running' });
}

export function cancelCampaign(id: string): Campaign | null {
  const campaign = getCampaign(id);
  if (!campaign) return null;
  
  // Cancel all pending delivery jobs
  run(
    `UPDATE outreach_delivery_jobs SET status = 'cancelled' 
     WHERE campaign_id = ? AND status IN ('pending', 'failed')`,
    [id]
  );
  
  return updateCampaign(id, { status: 'cancelled' });
}

export function duplicateCampaign(id: string, newName?: string): Campaign | null {
  const campaign = getCampaign(id);
  if (!campaign) return null;
  
  const { id: oldId, createdAt, updatedAt, stats, status, ...rest } = campaign;
  
  return createCampaign({
    ...rest,
    name: newName || `${campaign.name} (Copy)`,
  });
}

// ==================== TARGETING ====================

export function getCampaignContacts(campaign: Campaign): Array<{
  id: string;
  channel: string;
  identifier: string;
  name?: string;
  attributes: Record<string, any>;
}> {
  let contacts: Array<{
    id: string;
    channel: string;
    identifier: string;
    name?: string;
    attributes: Record<string, any>;
  }> = [];
  
  // Get from list
  if (campaign.listId) {
    const listContacts = getContactsInList(campaign.listId);
    contacts = listContacts.map(c => ({
      id: c.id,
      channel: c.channel,
      identifier: c.identifier,
      name: c.name,
      attributes: c.attributes,
    }));
  }
  
  // Apply segment filter
  if (campaign.segment) {
    const segmentContacts = queryContactsBySegment(campaign.segment);
    contacts = segmentContacts.map(c => ({
      id: c.id,
      channel: c.channel,
      identifier: c.identifier,
      name: c.name,
      attributes: c.attributes,
    }));
  }
  
  // Remove duplicates
  const seen = new Set<string>();
  contacts = contacts.filter(c => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });
  
  return contacts;
}

// ==================== DELIVERY JOBS ====================

function createDeliveryJobs(
  campaign: Campaign,
  contacts: Array<{
    id: string;
    channel: string;
    identifier: string;
    name?: string;
    attributes: Record<string, any>;
  }>
): DeliveryJob[] {
  const jobs: DeliveryJob[] = [];
  const now = Date.now();
  
  // Calculate send times based on throttling
  let scheduledAt = now;
  const throttleMs = campaign.schedule?.throttle?.delayBetweenMs || 1000;
  
  for (let i = 0; i < contacts.length; i++) {
    const contact = contacts[i];
    
    // Personalize content
    const content = personalizeContent(campaign.content, contact);
    
    // Calculate variables
    const variables = {
      name: contact.name || contact.identifier,
      channel: contact.channel,
      identifier: contact.identifier,
      ...contact.attributes,
    };
    
    const job: DeliveryJob = {
      id: randomUUID(),
      type: 'campaign',
      contactId: contact.id,
      channel: contact.channel,
      identifier: contact.identifier,
      content,
      campaignId: campaign.id,
      variables,
      scheduledAt: scheduledAt + (i * throttleMs),
      priority: 'normal',
      status: 'pending',
      attempts: 0,
      createdAt: now,
    };
    
    // Insert into database
    run(
      `INSERT INTO outreach_delivery_jobs 
       (id, type, contact_id, channel, identifier, content, campaign_id, variables, scheduled_at, priority, status, attempts, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        job.id,
        job.type,
        job.contactId,
        job.channel,
        job.identifier,
        job.content,
        job.campaignId,
        JSON.stringify(job.variables),
        job.scheduledAt,
        job.priority,
        job.status,
        job.attempts,
        job.createdAt,
      ]
    );
    
    jobs.push(job);
  }
  
  return jobs;
}

export function getPendingDeliveryJobs(limit: number = 100): DeliveryJob[] {
  const now = Date.now();
  
  const rows = query<{
    id: string;
    type: string;
    contact_id: string;
    channel: string;
    identifier: string;
    content: string;
    campaign_id: string;
    sequence_id: string;
    step_id: string;
    enrollment_id: string;
    variables: string;
    scheduled_at: number;
    priority: string;
    status: string;
    attempts: number;
    last_attempt_at: number;
    error: string;
    message_id: string;
    created_at: number;
  }>(
    `SELECT * FROM outreach_delivery_jobs 
     WHERE status = 'pending' AND scheduled_at <= ?
     ORDER BY scheduled_at ASC, 
       CASE priority 
         WHEN 'high' THEN 1 
         WHEN 'normal' THEN 2 
         WHEN 'low' THEN 3 
       END
     LIMIT ?`,
    [now, limit]
  );
  
  return rows.map(rowToDeliveryJob);
}

export function updateDeliveryJob(
  id: string, 
  updates: Partial<DeliveryJob>
): DeliveryJob | null {
  const job = getDeliveryJob(id);
  if (!job) return null;
  
  const updated = { ...job, ...updates };
  
  run(
    `UPDATE outreach_delivery_jobs 
     SET status = ?, attempts = ?, last_attempt_at = ?, error = ?, message_id = ?
     WHERE id = ?`,
    [
      updated.status,
      updated.attempts,
      updated.lastAttemptAt || null,
      updated.error || null,
      updated.messageId || null,
      id,
    ]
  );
  
  return updated;
}

export function getDeliveryJob(id: string): DeliveryJob | null {
  const row = query<{
    id: string;
    type: string;
    contact_id: string;
    channel: string;
    identifier: string;
    content: string;
    campaign_id: string;
    sequence_id: string;
    step_id: string;
    enrollment_id: string;
    variables: string;
    scheduled_at: number;
    priority: string;
    status: string;
    attempts: number;
    last_attempt_at: number;
    error: string;
    message_id: string;
    created_at: number;
  }>(`SELECT * FROM outreach_delivery_jobs WHERE id = ?`, [id])[0];
  
  if (!row) return null;
  
  return rowToDeliveryJob(row);
}

// ==================== PERSONALIZATION ====================

export function personalizeContent(
  content: CampaignContent,
  contact: {
    name?: string;
    attributes: Record<string, any>;
  }
): string {
  let result = content.body;
  
  // Replace variables
  const variables = {
    name: contact.name || 'there',
    ...contact.attributes,
  };
  
  for (const [key, value] of Object.entries(variables)) {
    const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'gi');
    result = result.replace(regex, String(value || ''));
  }
  
  // Clean up any remaining variables with fallbacks
  result = result.replace(/{{\s*([^}]+)\s*}}/g, (match, varName) => {
    const trimmed = varName.trim();
    return content.personalization?.fallbackValues?.[trimmed] || match;
  });
  
  return result;
}

// ==================== STATS ====================

export function incrementCampaignStat(
  campaignId: string,
  stat: keyof CampaignStats,
  value: number = 1
): void {
  const campaign = getCampaign(campaignId);
  if (!campaign) return;
  
  const stats = { ...campaign.stats };
  stats[stat] = (stats[stat] || 0) + value;
  
  updateCampaign(campaignId, { stats });
}

// ==================== HELPERS ====================

function rowToCampaign(row: {
  id: string;
  name: string;
  description: string;
  type: string;
  status: string;
  list_id: string;
  segment: string;
  content: string;
  schedule: string;
  sequence_id: string;
  trigger: string;
  settings: string;
  stats: string;
  created_at: number;
  updated_at: number;
  created_by: string;
}): Campaign {
  return {
    id: row.id,
    name: row.name,
    description: row.description || undefined,
    type: row.type as Campaign['type'],
    status: row.status as Campaign['status'],
    listId: row.list_id || undefined,
    segment: row.segment ? JSON.parse(row.segment) : undefined,
    content: JSON.parse(row.content),
    schedule: row.schedule ? JSON.parse(row.schedule) : undefined,
    sequenceId: row.sequence_id || undefined,
    trigger: row.trigger ? JSON.parse(row.trigger) : undefined,
    settings: JSON.parse(row.settings),
    stats: JSON.parse(row.stats),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
  };
}

function rowToDeliveryJob(row: {
  id: string;
  type: string;
  contact_id: string;
  channel: string;
  identifier: string;
  content: string;
  campaign_id: string;
  sequence_id: string;
  step_id: string;
  enrollment_id: string;
  variables: string;
  scheduled_at: number;
  priority: string;
  status: string;
  attempts: number;
  last_attempt_at: number;
  error: string;
  message_id: string;
  created_at: number;
}): DeliveryJob {
  return {
    id: row.id,
    type: row.type as DeliveryJob['type'],
    contactId: row.contact_id,
    channel: row.channel,
    identifier: row.identifier,
    content: row.content,
    campaignId: row.campaign_id || undefined,
    sequenceId: row.sequence_id || undefined,
    stepId: row.step_id || undefined,
    enrollmentId: row.enrollment_id || undefined,
    variables: JSON.parse(row.variables),
    scheduledAt: row.scheduled_at,
    priority: row.priority as DeliveryJob['priority'],
    status: row.status as DeliveryJob['status'],
    attempts: row.attempts,
    lastAttemptAt: row.last_attempt_at || undefined,
    error: row.error || undefined,
    messageId: row.message_id || undefined,
    createdAt: row.created_at,
  };
}

// ==================== DATABASE INIT ====================

export function initCampaignsTables(): void {
  run(`
    CREATE TABLE IF NOT EXISTS outreach_campaigns (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      list_id TEXT,
      segment TEXT,
      content TEXT NOT NULL,
      schedule TEXT,
      sequence_id TEXT,
      trigger TEXT,
      settings TEXT NOT NULL,
      stats TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      created_by TEXT NOT NULL
    )
  `);
  
  run(`
    CREATE INDEX IF NOT EXISTS idx_campaigns_status ON outreach_campaigns(status);
  `);
  
  run(`
    CREATE INDEX IF NOT EXISTS idx_campaigns_type ON outreach_campaigns(type);
  `);
  
  run(`
    CREATE TABLE IF NOT EXISTS outreach_delivery_jobs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      contact_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      identifier TEXT NOT NULL,
      content TEXT NOT NULL,
      campaign_id TEXT,
      sequence_id TEXT,
      step_id TEXT,
      enrollment_id TEXT,
      variables TEXT NOT NULL,
      scheduled_at INTEGER NOT NULL,
      priority TEXT NOT NULL DEFAULT 'normal',
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_attempt_at INTEGER,
      error TEXT,
      message_id TEXT,
      created_at INTEGER NOT NULL
    )
  `);
  
  run(`
    CREATE INDEX IF NOT EXISTS idx_delivery_status ON outreach_delivery_jobs(status);
  `);
  
  run(`
    CREATE INDEX IF NOT EXISTS idx_delivery_scheduled ON outreach_delivery_jobs(scheduled_at);
  `);
  
  run(`
    CREATE INDEX IF NOT EXISTS idx_delivery_campaign ON outreach_delivery_jobs(campaign_id);
  `);
}
