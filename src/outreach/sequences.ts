/**
 * Sequence Management (Drip Campaigns)
 * 
 * Multi-step automated message sequences
 */

import { query, run } from '../database/sqlite';
import { randomUUID } from 'crypto';
import type { 
  Sequence, 
  SequenceStep, 
  SequenceEnrollment, 
  StepHistoryEntry,
  StepDelay,
  SequenceSettings,
  StepCondition,
  ExitCondition,
  CampaignContent
} from './types';
import { getContact, updateContact } from './contacts';
import { personalizeContent } from './campaigns';

// ==================== SEQUENCE CRUD ====================

export function createSequence(sequence: Omit<Sequence, 'id' | 'createdAt' | 'updatedAt' | 'activeContacts' | 'completedContacts'>): Sequence {
  const id = randomUUID();
  const now = Date.now();
  
  const newSequence: Sequence = {
    ...sequence,
    id,
    activeContacts: 0,
    completedContacts: 0,
    createdAt: now,
    updatedAt: now,
  };
  
  run(
    `INSERT INTO outreach_sequences 
     (id, name, description, status, steps, exit_conditions, settings, active_contacts, completed_contacts, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      newSequence.name,
      newSequence.description || null,
      newSequence.status,
      JSON.stringify(newSequence.steps),
      JSON.stringify(newSequence.exitConditions),
      JSON.stringify(newSequence.settings),
      0,
      0,
      now,
      now,
    ]
  );
  
  return newSequence;
}

export function getSequence(id: string): Sequence | null {
  const row = query<{
    id: string;
    name: string;
    description: string;
    status: string;
    steps: string;
    exit_conditions: string;
    settings: string;
    active_contacts: number;
    completed_contacts: number;
    created_at: number;
    updated_at: number;
  }>(`SELECT * FROM outreach_sequences WHERE id = ?`, [id])[0];
  
  if (!row) return null;
  
  return rowToSequence(row);
}

export function updateSequence(id: string, updates: Partial<Sequence>): Sequence | null {
  const sequence = getSequence(id);
  if (!sequence) return null;
  
  const updated: Sequence = {
    ...sequence,
    ...updates,
    updatedAt: Date.now(),
  };
  
  run(
    `UPDATE outreach_sequences 
     SET name = ?, description = ?, status = ?, steps = ?, exit_conditions = ?, 
         settings = ?, active_contacts = ?, completed_contacts = ?, updated_at = ?
     WHERE id = ?`,
    [
      updated.name,
      updated.description || null,
      updated.status,
      JSON.stringify(updated.steps),
      JSON.stringify(updated.exitConditions),
      JSON.stringify(updated.settings),
      updated.activeContacts,
      updated.completedContacts,
      updated.updatedAt,
      id,
    ]
  );
  
  return updated;
}

export function deleteSequence(id: string): boolean {
  const result = run(`DELETE FROM outreach_sequences WHERE id = ?`, [id]);
  return result.changes > 0;
}

export function listSequences(options?: {
  status?: Sequence['status'];
}): Sequence[] {
  let sql = `SELECT * FROM outreach_sequences`;
  const params: any[] = [];
  
  if (options?.status) {
    sql += ` WHERE status = ?`;
    params.push(options.status);
  }
  
  sql += ` ORDER BY created_at DESC`;
  
  const rows = query<{
    id: string;
    name: string;
    description: string;
    status: string;
    steps: string;
    exit_conditions: string;
    settings: string;
    active_contacts: number;
    completed_contacts: number;
    created_at: number;
    updated_at: number;
  }>(sql, params);
  
  return rows.map(rowToSequence);
}

// ==================== ENROLLMENT ====================

export function enrollContact(
  sequenceId: string,
  contactId: string,
  options?: {
    variables?: Record<string, any>;
    startAt?: number;
  }
): SequenceEnrollment | null {
  const sequence = getSequence(sequenceId);
  if (!sequence) return null;
  
  const contact = getContact(contactId);
  if (!contact) return null;
  
  // Check if contact is already enrolled
  const existing = getActiveEnrollment(sequenceId, contactId);
  if (existing && !sequence.settings.allowMultipleEnrollments) {
    return existing;
  }
  
  const id = randomUUID();
  const now = options?.startAt || Date.now();
  
  const enrollment: SequenceEnrollment = {
    id,
    sequenceId,
    contactId,
    status: 'active',
    currentStepIndex: 0,
    startedAt: now,
    stepHistory: [],
    variables: {
      name: contact.name || contact.identifier,
      channel: contact.channel,
      identifier: contact.identifier,
      ...contact.attributes,
      ...options?.variables,
    },
  };
  
  run(
    `INSERT INTO outreach_enrollments 
     (id, sequence_id, contact_id, status, current_step_index, started_at, step_history, variables)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      enrollment.sequenceId,
      enrollment.contactId,
      enrollment.status,
      enrollment.currentStepIndex,
      enrollment.startedAt,
      JSON.stringify(enrollment.stepHistory),
      JSON.stringify(enrollment.variables),
    ]
  );
  
  // Update sequence stats
  updateSequence(sequenceId, {
    activeContacts: sequence.activeContacts + 1,
  });
  
  // Schedule first step
  scheduleNextStep(enrollment);
  
  return enrollment;
}

export function getEnrollment(id: string): SequenceEnrollment | null {
  const row = query<{
    id: string;
    sequence_id: string;
    contact_id: string;
    status: string;
    current_step_index: number;
    started_at: number;
    completed_at: number;
    last_step_at: number;
    next_step_at: number;
    step_history: string;
    variables: string;
  }>(`SELECT * FROM outreach_enrollments WHERE id = ?`, [id])[0];
  
  if (!row) return null;
  
  return rowToEnrollment(row);
}

export function getActiveEnrollment(sequenceId: string, contactId: string): SequenceEnrollment | null {
  const row = query<{
    id: string;
    sequence_id: string;
    contact_id: string;
    status: string;
    current_step_index: number;
    started_at: number;
    completed_at: number;
    last_step_at: number;
    next_step_at: number;
    step_history: string;
    variables: string;
  }>(
    `SELECT * FROM outreach_enrollments 
     WHERE sequence_id = ? AND contact_id = ? AND status = 'active'`,
    [sequenceId, contactId]
  )[0];
  
  if (!row) return null;
  
  return rowToEnrollment(row);
}

export function updateEnrollment(id: string, updates: Partial<SequenceEnrollment>): SequenceEnrollment | null {
  const enrollment = getEnrollment(id);
  if (!enrollment) return null;
  
  const updated = { ...enrollment, ...updates };
  
  run(
    `UPDATE outreach_enrollments 
     SET status = ?, current_step_index = ?, completed_at = ?, last_step_at = ?, next_step_at = ?, step_history = ?
     WHERE id = ?`,
    [
      updated.status,
      updated.currentStepIndex,
      updated.completedAt || null,
      updated.lastStepAt || null,
      updated.nextStepAt || null,
      JSON.stringify(updated.stepHistory),
      id,
    ]
  );
  
  return updated;
}

export function listEnrollments(options?: {
  sequenceId?: string;
  contactId?: string;
  status?: SequenceEnrollment['status'];
}): SequenceEnrollment[] {
  let whereClause = '';
  const params: any[] = [];
  
  if (options?.sequenceId) {
    whereClause += ' WHERE sequence_id = ?';
    params.push(options.sequenceId);
  }
  
  if (options?.contactId) {
    whereClause += whereClause ? ' AND contact_id = ?' : ' WHERE contact_id = ?';
    params.push(options.contactId);
  }
  
  if (options?.status) {
    whereClause += whereClause ? ' AND status = ?' : ' WHERE status = ?';
    params.push(options.status);
  }
  
  const rows = query<{
    id: string;
    sequence_id: string;
    contact_id: string;
    status: string;
    current_step_index: number;
    started_at: number;
    completed_at: number;
    last_step_at: number;
    next_step_at: number;
    step_history: string;
    variables: string;
  }>(`SELECT * FROM outreach_enrollments ${whereClause} ORDER BY started_at DESC`, params);
  
  return rows.map(rowToEnrollment);
}

export function exitEnrollment(
  enrollmentId: string,
  reason: 'completed' | 'manual' | 'condition_met' | 'unsubscribed'
): SequenceEnrollment | null {
  const enrollment = getEnrollment(enrollmentId);
  if (!enrollment) return null;
  
  const now = Date.now();
  
  const updated = updateEnrollment(enrollmentId, {
    status: reason === 'completed' ? 'completed' : 'exited',
    completedAt: now,
  });
  
  // Update sequence stats
  const sequence = getSequence(enrollment.sequenceId);
  if (sequence) {
    updateSequence(sequence.id, {
      activeContacts: Math.max(0, sequence.activeContacts - 1),
      completedContacts: reason === 'completed' 
        ? sequence.completedContacts + 1 
        : sequence.completedContacts,
    });
  }
  
  return updated;
}

// ==================== STEP PROCESSING ====================

export function getPendingSequenceSteps(limit: number = 100): Array<{
  enrollment: SequenceEnrollment;
  step: SequenceStep;
}> {
  const now = Date.now();
  
  const rows = query<{
    enrollment_id: string;
  }>(
    `SELECT id as enrollment_id FROM outreach_enrollments 
     WHERE status = 'active' AND next_step_at <= ?
     ORDER BY next_step_at ASC
     LIMIT ?`,
    [now, limit]
  );
  
  const results: Array<{ enrollment: SequenceEnrollment; step: SequenceStep }> = [];
  
  for (const row of rows) {
    const enrollment = getEnrollment(row.enrollment_id);
    if (!enrollment) continue;
    
    const sequence = getSequence(enrollment.sequenceId);
    if (!sequence || sequence.status !== 'active') continue;
    
    const step = sequence.steps[enrollment.currentStepIndex];
    if (!step) {
      // No more steps, complete enrollment
      exitEnrollment(enrollment.id, 'completed');
      continue;
    }
    
    results.push({ enrollment, step });
  }
  
  return results;
}

export function processStep(
  enrollmentId: string,
  stepId: string
): {
  enrollment: SequenceEnrollment;
  shouldSend: boolean;
  content?: string;
  actions: string[];
} | null {
  const enrollment = getEnrollment(enrollmentId);
  if (!enrollment) return null;
  
  const sequence = getSequence(enrollment.sequenceId);
  if (!sequence) return null;
  
  const step = sequence.steps.find(s => s.id === stepId);
  if (!step) return null;
  
  // Check step condition
  const shouldSend = checkStepCondition(enrollment, step.condition);
  
  // Personalize content
  const contact = getContact(enrollment.contactId);
  let content: string | undefined;
  
  if (shouldSend && contact) {
    content = personalizeContent(step.content, {
      name: contact.name,
      attributes: { ...contact.attributes, ...enrollment.variables },
    });
  }
  
  // Collect actions
  const actions: string[] = [];
  if (shouldSend) {
    for (const action of step.actions) {
      actions.push(JSON.stringify(action));
    }
  }
  
  return { enrollment, shouldSend, content, actions };
}

export function advanceEnrollment(
  enrollmentId: string,
  stepResult: {
    sent: boolean;
    messageId?: string;
    opened?: boolean;
    clicked?: boolean;
    replied?: boolean;
  }
): SequenceEnrollment | null {
  const enrollment = getEnrollment(enrollmentId);
  if (!enrollment) return null;
  
  const sequence = getSequence(enrollment.sequenceId);
  if (!sequence) return null;
  
  const step = sequence.steps[enrollment.currentStepIndex];
  if (!step) return null;
  
  // Record history
  const historyEntry: StepHistoryEntry = {
    stepId: step.id,
    sentAt: Date.now(),
    messageId: stepResult.messageId,
  };
  
  if (stepResult.opened) historyEntry.openedAt = Date.now();
  if (stepResult.clicked) historyEntry.clickedAt = Date.now();
  if (stepResult.replied) historyEntry.repliedAt = Date.now();
  
  enrollment.stepHistory.push(historyEntry);
  
  // Check exit conditions
  const shouldExit = checkExitConditions(enrollment, sequence.exitConditions, stepResult);
  if (shouldExit) {
    return exitEnrollment(enrollmentId, stepResult.replied ? 'completed' : 'condition_met') || null;
  }
  
  // Advance to next step
  const nextStepIndex = enrollment.currentStepIndex + 1;
  
  if (nextStepIndex >= sequence.steps.length) {
    // Completed all steps
    enrollment.currentStepIndex = nextStepIndex;
    enrollment.lastStepAt = Date.now();
    updateEnrollment(enrollmentId, {
      currentStepIndex: enrollment.currentStepIndex,
      lastStepAt: enrollment.lastStepAt,
      stepHistory: enrollment.stepHistory,
    });
    return exitEnrollment(enrollmentId, 'completed') || null;
  }
  
  // Continue to next step
  enrollment.currentStepIndex = nextStepIndex;
  enrollment.lastStepAt = Date.now();
  
  const updated = updateEnrollment(enrollmentId, {
    currentStepIndex: enrollment.currentStepIndex,
    lastStepAt: enrollment.lastStepAt,
    stepHistory: enrollment.stepHistory,
  });
  
  if (updated) {
    scheduleNextStep(updated);
  }
  
  return updated;
}

// ==================== SCHEDULING ====================

function scheduleNextStep(enrollment: SequenceEnrollment): void {
  const sequence = getSequence(enrollment.sequenceId);
  if (!sequence) return;
  
  const step = sequence.steps[enrollment.currentStepIndex];
  if (!step) return;
  
  const delayMs = calculateDelay(step.delay);
  const nextStepAt = Date.now() + delayMs;
  
  updateEnrollment(enrollment.id, { nextStepAt });
}

function calculateDelay(delay: StepDelay): number {
  const now = Date.now();
  
  switch (delay.type) {
    case 'immediate':
      return 0;
      
    case 'fixed':
      const minutes = delay.minutes || 0;
      const hours = delay.hours || 0;
      const days = delay.days || 0;
      return (minutes * 60 * 1000) + (hours * 60 * 60 * 1000) + (days * 24 * 60 * 60 * 1000);
      
    case 'business_hours':
      // Simplified: just add hours for now
      return (delay.hours || 24) * 60 * 60 * 1000;
      
    case 'smart':
      // Simplified: use fallback
      return (delay.smartConfig?.fallbackHours || 24) * 60 * 60 * 1000;
      
    default:
      return 24 * 60 * 60 * 1000; // 24 hours default
  }
}

// ==================== CONDITIONS ====================

function checkStepCondition(
  enrollment: SequenceEnrollment,
  condition?: StepCondition
): boolean {
  if (!condition) return true;
  
  switch (condition.type) {
    case 'previous_opened':
      const openedEntry = enrollment.stepHistory.find(h => 
        condition.stepId === 'any' || h.stepId === condition.stepId
      );
      return openedEntry?.openedAt !== undefined;
      
    case 'previous_clicked':
      const clickedEntry = enrollment.stepHistory.find(h => 
        condition.stepId === 'any' || h.stepId === condition.stepId
      );
      return clickedEntry?.clickedAt !== undefined;
      
    case 'previous_replied':
      const repliedEntry = enrollment.stepHistory.find(h => 
        condition.stepId === 'any' || h.stepId === condition.stepId
      );
      return repliedEntry?.repliedAt !== undefined;
      
    case 'contact_attribute':
      const value = enrollment.variables[condition.attribute || ''];
      if (value === undefined) return false;
      
      switch (condition.operator) {
        case 'equals':
          return String(value) === String(condition.value);
        case 'not_equals':
          return String(value) !== String(condition.value);
        case 'contains':
          return String(value).includes(String(condition.value));
        case 'exists':
          return true;
        default:
          return true;
      }
      
    case 'contact_tag':
      // Tags would need to be loaded from contact
      return true; // Simplified
      
    default:
      return true;
  }
}

function checkExitConditions(
  enrollment: SequenceEnrollment,
  exitConditions: ExitCondition[],
  stepResult: { replied?: boolean; clicked?: boolean }
): boolean {
  for (const condition of exitConditions) {
    switch (condition.type) {
      case 'replied':
        if (stepResult.replied) return true;
        break;
      case 'clicked':
        if (stepResult.clicked) return true;
        break;
      case 'max_steps':
        if (enrollment.currentStepIndex >= (condition.config?.max || 999)) return true;
        break;
    }
  }
  
  return false;
}

// ==================== HELPERS ====================

function rowToSequence(row: {
  id: string;
  name: string;
  description: string;
  status: string;
  steps: string;
  exit_conditions: string;
  settings: string;
  active_contacts: number;
  completed_contacts: number;
  created_at: number;
  updated_at: number;
}): Sequence {
  return {
    id: row.id,
    name: row.name,
    description: row.description || undefined,
    status: row.status as Sequence['status'],
    steps: JSON.parse(row.steps),
    exitConditions: JSON.parse(row.exit_conditions),
    settings: JSON.parse(row.settings),
    activeContacts: row.active_contacts,
    completedContacts: row.completed_contacts,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToEnrollment(row: {
  id: string;
  sequence_id: string;
  contact_id: string;
  status: string;
  current_step_index: number;
  started_at: number;
  completed_at: number;
  last_step_at: number;
  next_step_at: number;
  step_history: string;
  variables: string;
}): SequenceEnrollment {
  return {
    id: row.id,
    sequenceId: row.sequence_id,
    contactId: row.contact_id,
    status: row.status as SequenceEnrollment['status'],
    currentStepIndex: row.current_step_index,
    startedAt: row.started_at,
    completedAt: row.completed_at || undefined,
    lastStepAt: row.last_step_at || undefined,
    nextStepAt: row.next_step_at || undefined,
    stepHistory: JSON.parse(row.step_history),
    variables: JSON.parse(row.variables),
  };
}

// ==================== DATABASE INIT ====================

export function initSequencesTables(): void {
  run(`
    CREATE TABLE IF NOT EXISTS outreach_sequences (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      steps TEXT NOT NULL,
      exit_conditions TEXT NOT NULL,
      settings TEXT NOT NULL,
      active_contacts INTEGER NOT NULL DEFAULT 0,
      completed_contacts INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  
  run(`
    CREATE INDEX IF NOT EXISTS idx_sequences_status ON outreach_sequences(status);
  `);
  
  run(`
    CREATE TABLE IF NOT EXISTS outreach_enrollments (
      id TEXT PRIMARY KEY,
      sequence_id TEXT NOT NULL,
      contact_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      current_step_index INTEGER NOT NULL DEFAULT 0,
      started_at INTEGER NOT NULL,
      completed_at INTEGER,
      last_step_at INTEGER,
      next_step_at INTEGER,
      step_history TEXT NOT NULL,
      variables TEXT NOT NULL,
      FOREIGN KEY (sequence_id) REFERENCES outreach_sequences(id) ON DELETE CASCADE,
      FOREIGN KEY (contact_id) REFERENCES outreach_contacts(id) ON DELETE CASCADE
    )
  `);
  
  run(`
    CREATE INDEX IF NOT EXISTS idx_enrollments_sequence ON outreach_enrollments(sequence_id);
  `);
  
  run(`
    CREATE INDEX IF NOT EXISTS idx_enrollments_contact ON outreach_enrollments(contact_id);
  `);
  
  run(`
    CREATE INDEX IF NOT EXISTS idx_enrollments_status ON outreach_enrollments(status);
  `);
  
  run(`
    CREATE INDEX IF NOT EXISTS idx_enrollments_next_step ON outreach_enrollments(next_step_at);
  `);
}
