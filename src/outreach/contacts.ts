/**
 * Contact Management
 * 
 * Manage contacts, lists, and segments for marketing outreach
 */

import { query, run } from '../database/sqlite';
import { randomUUID } from 'crypto';
import type { Contact, ContactList, SegmentFilter, ContactImportResult, SegmentCondition } from './types';

// ==================== CONTACT CRUD ====================

export function createContact(contact: Omit<Contact, 'id' | 'createdAt' | 'updatedAt'>): Contact {
  const id = randomUUID();
  const now = Date.now();
  
  const newContact: Contact = {
    ...contact,
    id,
    createdAt: now,
    updatedAt: now,
  };
  
  run(
    `INSERT INTO outreach_contacts (id, channel, identifier, name, tags, attributes, source, status, created_at, updated_at, last_contacted_at, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      newContact.channel,
      newContact.identifier,
      newContact.name || null,
      JSON.stringify(newContact.tags),
      JSON.stringify(newContact.attributes),
      newContact.source || null,
      newContact.status,
      now,
      now,
      newContact.lastContactedAt || null,
      JSON.stringify(newContact.metadata || {}),
    ]
  );
  
  return newContact;
}

export function getContact(id: string): Contact | null {
  const row = query<{
    id: string;
    channel: string;
    identifier: string;
    name: string;
    tags: string;
    attributes: string;
    source: string;
    status: string;
    created_at: number;
    updated_at: number;
    last_contacted_at: number;
    metadata: string;
  }>(`SELECT * FROM outreach_contacts WHERE id = ?`, [id])[0];
  
  if (!row) return null;
  
  return rowToContact(row);
}

export function getContactByIdentifier(channel: string, identifier: string): Contact | null {
  const row = query<{
    id: string;
    channel: string;
    identifier: string;
    name: string;
    tags: string;
    attributes: string;
    source: string;
    status: string;
    created_at: number;
    updated_at: number;
    last_contacted_at: number;
    metadata: string;
  }>(`SELECT * FROM outreach_contacts WHERE channel = ? AND identifier = ?`, [channel, identifier])[0];
  
  if (!row) return null;
  
  return rowToContact(row);
}

export function updateContact(id: string, updates: Partial<Contact>): Contact | null {
  const contact = getContact(id);
  if (!contact) return null;
  
  const updated: Contact = {
    ...contact,
    ...updates,
    updatedAt: Date.now(),
  };
  
  run(
    `UPDATE outreach_contacts 
     SET name = ?, tags = ?, attributes = ?, source = ?, status = ?, updated_at = ?, last_contacted_at = ?, metadata = ?
     WHERE id = ?`,
    [
      updated.name || null,
      JSON.stringify(updated.tags),
      JSON.stringify(updated.attributes),
      updated.source || null,
      updated.status,
      updated.updatedAt,
      updated.lastContactedAt || null,
      JSON.stringify(updated.metadata || {}),
      id,
    ]
  );
  
  return updated;
}

export function deleteContact(id: string): boolean {
  const result = run(`DELETE FROM outreach_contacts WHERE id = ?`, [id]);
  return result.changes > 0;
}

export function listContacts(options?: {
  status?: Contact['status'];
  channel?: string;
  tag?: string;
  limit?: number;
  offset?: number;
}): { contacts: Contact[]; total: number } {
  let whereClause = '';
  const params: any[] = [];
  
  if (options?.status) {
    whereClause += ' WHERE status = ?';
    params.push(options.status);
  }
  
  if (options?.channel) {
    whereClause += whereClause ? ' AND channel = ?' : ' WHERE channel = ?';
    params.push(options.channel);
  }
  
  if (options?.tag) {
    whereClause += whereClause ? ' AND tags LIKE ?' : ' WHERE tags LIKE ?';
    params.push(`%"${options.tag}"%`);
  }
  
  const countRow = query<{ count: number }>(`SELECT COUNT(*) as count FROM outreach_contacts ${whereClause}`, params)[0];
  const total = countRow?.count || 0;
  
  let sql = `SELECT * FROM outreach_contacts ${whereClause} ORDER BY created_at DESC`;
  
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
    channel: string;
    identifier: string;
    name: string;
    tags: string;
    attributes: string;
    source: string;
    status: string;
    created_at: number;
    updated_at: number;
    last_contacted_at: number;
    metadata: string;
  }>(sql, params);
  
  return {
    contacts: rows.map(rowToContact),
    total,
  };
}

// ==================== CONTACT LISTS ====================

export function createContactList(list: Omit<ContactList, 'id' | 'createdAt' | 'updatedAt'>): ContactList {
  const id = randomUUID();
  const now = Date.now();
  
  const newList: ContactList = {
    ...list,
    id,
    createdAt: now,
    updatedAt: now,
  };
  
  run(
    `INSERT INTO outreach_lists (id, name, description, tags, contact_ids, dynamic, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      newList.name,
      newList.description || null,
      JSON.stringify(newList.tags),
      JSON.stringify(newList.contactIds),
      newList.dynamic ? 1 : 0,
      now,
      now,
    ]
  );
  
  return newList;
}

export function getContactList(id: string): ContactList | null {
  const row = query<{
    id: string;
    name: string;
    description: string;
    tags: string;
    contact_ids: string;
    dynamic: number;
    created_at: number;
    updated_at: number;
  }>(`SELECT * FROM outreach_lists WHERE id = ?`, [id])[0];
  
  if (!row) return null;
  
  return rowToList(row);
}

export function updateContactList(id: string, updates: Partial<ContactList>): ContactList | null {
  const list = getContactList(id);
  if (!list) return null;
  
  const updated: ContactList = {
    ...list,
    ...updates,
    updatedAt: Date.now(),
  };
  
  run(
    `UPDATE outreach_lists 
     SET name = ?, description = ?, tags = ?, contact_ids = ?, dynamic = ?, updated_at = ?
     WHERE id = ?`,
    [
      updated.name,
      updated.description || null,
      JSON.stringify(updated.tags),
      JSON.stringify(updated.contactIds),
      updated.dynamic ? 1 : 0,
      updated.updatedAt,
      id,
    ]
  );
  
  return updated;
}

export function deleteContactList(id: string): boolean {
  const result = run(`DELETE FROM outreach_lists WHERE id = ?`, [id]);
  return result.changes > 0;
}

export function listContactLists(): ContactList[] {
  const rows = query<{
    id: string;
    name: string;
    description: string;
    tags: string;
    contact_ids: string;
    dynamic: number;
    created_at: number;
    updated_at: number;
  }>(`SELECT * FROM outreach_lists ORDER BY created_at DESC`);
  
  return rows.map(rowToList);
}

export function getContactsInList(listId: string): Contact[] {
  const list = getContactList(listId);
  if (!list) return [];
  
  const contacts: Contact[] = [];
  
  // Get explicit contacts
  for (const contactId of list.contactIds) {
    const contact = getContact(contactId);
    if (contact && contact.status === 'active') {
      contacts.push(contact);
    }
  }
  
  // Get dynamic contacts by tags
  if (list.dynamic && list.tags.length > 0) {
    const { contacts: tagContacts } = listContacts({ status: 'active' });
    for (const contact of tagContacts) {
      // Check if contact has any of the list tags
      const hasTag = list.tags.some(tag => contact.tags.includes(tag));
      if (hasTag && !contacts.find(c => c.id === contact.id)) {
        contacts.push(contact);
      }
    }
  }
  
  return contacts;
}

// ==================== SEGMENTS ====================

export function queryContactsBySegment(filter: SegmentFilter): Contact[] {
  // Get all active contacts
  const { contacts } = listContacts({ status: 'active' });
  
  return contacts.filter(contact => matchesSegment(contact, filter));
}

function matchesSegment(contact: Contact, filter: SegmentFilter): boolean {
  if (filter.conditions.length === 0) return true;
  
  const results = filter.conditions.map(condition => matchesCondition(contact, condition));
  
  return filter.operator === 'and' 
    ? results.every(r => r)
    : results.some(r => r);
}

function matchesCondition(contact: Contact, condition: SegmentCondition): boolean {
  switch (condition.type) {
    case 'tag':
      const hasTag = condition.tag ? contact.tags.includes(condition.tag) : false;
      return condition.tagOperator === 'not_has' ? !hasTag : hasTag;
      
    case 'attribute':
      const value = condition.attribute ? contact.attributes[condition.attribute] : undefined;
      if (value === undefined) return false;
      
      switch (condition.attributeOperator) {
        case 'equals':
          return String(value) === String(condition.attributeValue);
        case 'not_equals':
          return String(value) !== String(condition.attributeValue);
        case 'contains':
          return String(value).includes(String(condition.attributeValue));
        case 'gt':
          return Number(value) > Number(condition.attributeValue);
        case 'lt':
          return Number(value) < Number(condition.attributeValue);
        case 'exists':
          return true;
        default:
          return false;
      }
      
    case 'channel':
      return contact.channel === condition.channel;
      
    case 'status':
      return contact.status === condition.status;
      
    default:
      return true;
  }
}

// ==================== IMPORT/EXPORT ====================

export function importContacts(
  contacts: Array<Omit<Contact, 'id' | 'createdAt' | 'updatedAt'>>,
  options?: { 
    skipDuplicates?: boolean;
    source?: string;
    defaultTags?: string[];
  }
): ContactImportResult {
  const result: ContactImportResult = {
    imported: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };
  
  for (let i = 0; i < contacts.length; i++) {
    const contact = contacts[i];
    
    try {
      // Check for duplicates
      if (options?.skipDuplicates) {
        const existing = getContactByIdentifier(contact.channel, contact.identifier);
        if (existing) {
          result.skipped++;
          continue;
        }
      }
      
      // Add default tags
      if (options?.defaultTags) {
        contact.tags = [...new Set([...contact.tags, ...options.defaultTags])];
      }
      
      // Set source
      if (options?.source) {
        contact.source = options.source;
      }
      
      createContact(contact);
      result.imported++;
    } catch (error) {
      result.failed++;
      result.errors.push({
        row: i + 1,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  
  return result;
}

export function exportContacts(filter?: SegmentFilter): Contact[] {
  if (filter) {
    return queryContactsBySegment(filter);
  }
  
  const { contacts } = listContacts();
  return contacts;
}

// ==================== TAG MANAGEMENT ====================

export function addTagToContact(contactId: string, tag: string): boolean {
  const contact = getContact(contactId);
  if (!contact) return false;
  
  if (contact.tags.includes(tag)) return true;
  
  contact.tags.push(tag);
  updateContact(contactId, { tags: contact.tags });
  return true;
}

export function removeTagFromContact(contactId: string, tag: string): boolean {
  const contact = getContact(contactId);
  if (!contact) return false;
  
  contact.tags = contact.tags.filter(t => t !== tag);
  updateContact(contactId, { tags: contact.tags });
  return true;
}

export function getAllTags(): string[] {
  const rows = query<{ tags: string }>(`SELECT tags FROM outreach_contacts`);
  const allTags = new Set<string>();
  
  for (const row of rows) {
    try {
      const tags = JSON.parse(row.tags) as string[];
      for (const tag of tags) {
        allTags.add(tag);
      }
    } catch {
      // ignore parse errors
    }
  }
  
  return Array.from(allTags).sort();
}

// ==================== HELPERS ====================

function rowToContact(row: {
  id: string;
  channel: string;
  identifier: string;
  name: string;
  tags: string;
  attributes: string;
  source: string;
  status: string;
  created_at: number;
  updated_at: number;
  last_contacted_at: number;
  metadata: string;
}): Contact {
  return {
    id: row.id,
    channel: row.channel as Contact['channel'],
    identifier: row.identifier,
    name: row.name || undefined,
    tags: JSON.parse(row.tags),
    attributes: JSON.parse(row.attributes),
    source: row.source || undefined,
    status: row.status as Contact['status'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastContactedAt: row.last_contacted_at || undefined,
    metadata: row.metadata ? JSON.parse(row.metadata) : {},
  };
}

function rowToList(row: {
  id: string;
  name: string;
  description: string;
  tags: string;
  contact_ids: string;
  dynamic: number;
  created_at: number;
  updated_at: number;
}): ContactList {
  return {
    id: row.id,
    name: row.name,
    description: row.description || undefined,
    tags: JSON.parse(row.tags),
    contactIds: JSON.parse(row.contact_ids),
    dynamic: row.dynamic === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ==================== DATABASE INIT ====================

export function initContactsTables(): void {
  run(`
    CREATE TABLE IF NOT EXISTS outreach_contacts (
      id TEXT PRIMARY KEY,
      channel TEXT NOT NULL,
      identifier TEXT NOT NULL,
      name TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      attributes TEXT NOT NULL DEFAULT '{}',
      source TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_contacted_at INTEGER,
      metadata TEXT,
      UNIQUE(channel, identifier)
    )
  `);
  
  run(`
    CREATE INDEX IF NOT EXISTS idx_contacts_channel ON outreach_contacts(channel);
  `);
  
  run(`
    CREATE INDEX IF NOT EXISTS idx_contacts_status ON outreach_contacts(status);
  `);
  
  run(`
    CREATE INDEX IF NOT EXISTS idx_contacts_tags ON outreach_contacts(tags);
  `);
  
  run(`
    CREATE TABLE IF NOT EXISTS outreach_lists (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      contact_ids TEXT NOT NULL DEFAULT '[]',
      dynamic INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
}
