/**
 * Outreach System Types
 * 
 * Marketing automation for FoxFang
 * - Contact/Audience management
 * - Campaign management
 * - Message sequences (drip campaigns)
 * - Scheduling and delivery
 */

// ==================== CONTACTS ====================

export interface Contact {
  id: string;
  channel: 'signal' | 'telegram' | 'discord' | 'slack' | 'email';
  identifier: string;  // phone number, username, email, etc.
  name?: string;
  tags: string[];
  attributes: Record<string, string | number | boolean>;
  source?: string;  // how they were added
  status: 'active' | 'unsubscribed' | 'bounced' | 'complained';
  createdAt: number;
  updatedAt: number;
  lastContactedAt?: number;
  metadata?: Record<string, any>;
}

export interface ContactList {
  id: string;
  name: string;
  description?: string;
  tags: string[];  // auto-include contacts with these tags
  contactIds: string[];  // explicit contacts
  dynamic: boolean;  // if true, auto-updates based on tags
  createdAt: number;
  updatedAt: number;
}

export interface ContactImportResult {
  imported: number;
  skipped: number;
  failed: number;
  errors: Array<{ row: number; error: string }>;
}

// ==================== CAMPAIGNS ====================

export type CampaignStatus = 
  | 'draft' 
  | 'scheduled' 
  | 'running' 
  | 'paused' 
  | 'completed' 
  | 'cancelled';

export type CampaignType = 
  | 'broadcast'      // One-time message to list
  | 'sequence'       // Multi-step drip campaign
  | 'recurring'      // Repeating campaign
  | 'triggered';     // Event-based campaign

export interface Campaign {
  id: string;
  name: string;
  description?: string;
  type: CampaignType;
  status: CampaignStatus;
  
  // Targeting
  listId?: string;
  segment?: SegmentFilter;
  
  // Content
  content: CampaignContent;
  
  // Scheduling
  schedule?: CampaignSchedule;
  
  // For sequences
  sequenceId?: string;
  
  // For triggered campaigns
  trigger?: CampaignTrigger;
  
  // Settings
  settings: CampaignSettings;
  
  // Stats
  stats: CampaignStats;
  
  createdAt: number;
  updatedAt: number;
  createdBy: string;
}

export interface CampaignContent {
  subject?: string;  // for email-style messages
  body: string;
  variables?: string[];  // {{name}}, {{company}}, etc.
  personalization?: PersonalizationConfig;
}

export interface PersonalizationConfig {
  fallbackValues: Record<string, string>;
  aiEnhance?: boolean;  // use AI to personalize
  aiPrompt?: string;    // custom prompt for AI
}

export interface CampaignSchedule {
  type: 'immediate' | 'one-time' | 'recurring';
  
  // One-time
  sendAt?: number;  // timestamp
  
  // Recurring
  cronExpression?: string;
  timezone?: string;
  
  // Throttling
  throttle?: {
    maxPerHour: number;
    delayBetweenMs: number;
  };
  
  // Send time optimization
  optimizeSendTime?: boolean;  // send at optimal time per contact
}

export interface CampaignTrigger {
  type: 'event' | 'contact_added' | 'contact_tagged' | 'contact_attribute';
  eventName?: string;
  tag?: string;
  attributeFilter?: Record<string, string>;
  delayMs?: number;  // delay after trigger
}

export interface CampaignSettings {
  trackOpens: boolean;
  trackClicks: boolean;
  replyHandling: 'auto' | 'manual' | 'ignore';
  replyAgentId?: string;  // agent to handle replies
  unsubscribeEnabled: boolean;
  unsubscribeMessage?: string;
  resendOnEdit?: boolean;  // resend if content edited
  maxRetries: number;
}

export interface CampaignStats {
  totalContacts: number;
  sent: number;
  delivered: number;
  failed: number;
  opened: number;
  clicked: number;
  replied: number;
  unsubscribed: number;
  bounced: number;
  lastSentAt?: number;
  estimatedCompletionAt?: number;
}

// ==================== SEQUENCES (DRIP) ====================

export interface Sequence {
  id: string;
  name: string;
  description?: string;
  status: 'draft' | 'active' | 'paused' | 'archived';
  
  steps: SequenceStep[];
  exitConditions: ExitCondition[];
  
  // Global settings
  settings: SequenceSettings;
  
  // Stats
  activeContacts: number;
  completedContacts: number;
  
  createdAt: number;
  updatedAt: number;
}

export interface SequenceStep {
  id: string;
  order: number;
  name: string;
  
  // Timing
  delay: StepDelay;
  
  // Content
  content: CampaignContent;
  
  // Conditions
  condition?: StepCondition;  // only send if condition met
  
  // Actions
  actions: StepAction[];
  
  // Tracking
  stats: StepStats;
}

export interface StepDelay {
  type: 'immediate' | 'fixed' | 'business_hours' | 'smart';
  
  // Fixed delay
  minutes?: number;
  hours?: number;
  days?: number;
  
  // Business hours
  businessHours?: {
    timezone: string;
    workDays: number[];  // 0-6, Sunday=0
    workHours: { start: number; end: number };  // 24h format
  };
  
  // Smart delay - based on contact engagement
  smartConfig?: {
    optimizeFor: 'open_rate' | 'reply_rate';
    fallbackHours: number;
  };
}

export interface StepCondition {
  type: 'previous_opened' | 'previous_clicked' | 'previous_replied' | 'contact_attribute' | 'contact_tag';
  
  // For previous_* conditions
  stepId?: string;  // check specific step, or 'any' for any previous
  
  // For attribute/tag conditions
  attribute?: string;
  tag?: string;
  operator?: 'equals' | 'not_equals' | 'contains' | 'exists';
  value?: string;
}

export interface StepAction {
  type: 'send_message' | 'add_tag' | 'remove_tag' | 'update_attribute' | 'move_to_list' | 'webhook';
  
  // Action config
  config: Record<string, any>;
}

export interface StepStats {
  sent: number;
  opened: number;
  clicked: number;
  replied: number;
  skipped: number;  // condition not met
}

export interface ExitCondition {
  type: 'replied' | 'clicked' | 'tag_added' | 'attribute_set' | 'max_steps';
  config?: Record<string, any>;
}

export interface SequenceSettings {
  allowMultipleEnrollments: boolean;  // can contact be enrolled multiple times
  exitOnReply: boolean;
  exitOnClick: boolean;
  maxStepsPerDay: number;
  respectUnsubscribe: boolean;
}

export interface SequenceEnrollment {
  id: string;
  sequenceId: string;
  contactId: string;
  status: 'active' | 'completed' | 'exited' | 'paused';
  currentStepIndex: number;
  
  // Tracking
  startedAt: number;
  completedAt?: number;
  lastStepAt?: number;
  nextStepAt?: number;
  
  // State
  stepHistory: StepHistoryEntry[];
  variables: Record<string, any>;  // per-enrollment variables
}

export interface StepHistoryEntry {
  stepId: string;
  sentAt: number;
  openedAt?: number;
  clickedAt?: number;
  repliedAt?: number;
  messageId?: string;
}

// ==================== SEGMENTS ====================

export interface SegmentFilter {
  operator: 'and' | 'or';
  conditions: SegmentCondition[];
}

export interface SegmentCondition {
  type: 'tag' | 'attribute' | 'channel' | 'status' | 'engagement' | 'date';
  
  // Tag condition
  tag?: string;
  tagOperator?: 'has' | 'not_has';
  
  // Attribute condition
  attribute?: string;
  attributeOperator?: 'equals' | 'not_equals' | 'contains' | 'gt' | 'lt' | 'exists';
  attributeValue?: string | number;
  
  // Channel condition
  channel?: string;
  
  // Status condition
  status?: Contact['status'];
  
  // Engagement condition
  engagementType?: 'opened' | 'clicked' | 'replied';
  engagementCampaignId?: string;
  engagementCount?: number;
  engagementTimeframe?: number;  // days
  
  // Date condition
  dateField?: 'created' | 'last_contacted' | 'updated';
  dateOperator?: 'before' | 'after' | 'between';
  dateValue?: number | { start: number; end: number };
}

// ==================== ANALYTICS ====================

export interface OutreachAnalytics {
  // Overall stats
  totalContacts: number;
  activeCampaigns: number;
  totalSent: number;
  
  // Engagement
  openRate: number;
  clickRate: number;
  replyRate: number;
  unsubscribeRate: number;
  bounceRate: number;
  
  // Trends (last 30 days)
  dailyStats: DailyStat[];
  
  // Channel breakdown
  channelStats: ChannelStat[];
  
  // Top performing
  topCampaigns: CampaignPerformance[];
  topSequences: SequencePerformance[];
}

export interface DailyStat {
  date: string;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  replied: number;
  unsubscribed: number;
}

export interface ChannelStat {
  channel: string;
  sent: number;
  delivered: number;
  openRate: number;
  clickRate: number;
}

export interface CampaignPerformance {
  campaignId: string;
  campaignName: string;
  sent: number;
  openRate: number;
  clickRate: number;
  replyRate: number;
}

export interface SequencePerformance {
  sequenceId: string;
  sequenceName: string;
  enrolled: number;
  completed: number;
  completionRate: number;
  avgTimeToComplete: number;  // hours
}

// ==================== DELIVERY ====================

export interface DeliveryJob {
  id: string;
  type: 'campaign' | 'sequence_step' | 'triggered';
  
  // Target
  contactId: string;
  channel: string;
  identifier: string;
  
  // Content
  content: string;
  
  // Context
  campaignId?: string;
  sequenceId?: string;
  stepId?: string;
  enrollmentId?: string;
  
  // Variables for personalization
  variables: Record<string, any>;
  
  // Scheduling
  scheduledAt: number;
  priority: 'high' | 'normal' | 'low';
  
  // Status
  status: 'pending' | 'sent' | 'delivered' | 'failed' | 'cancelled';
  attempts: number;
  lastAttemptAt?: number;
  error?: string;
  messageId?: string;  // from channel
  
  createdAt: number;
}

// ==================== TEMPLATES ====================

export interface MessageTemplate {
  id: string;
  name: string;
  category: 'marketing' | 'onboarding' | 'follow_up' | 'announcement' | 'custom';
  
  // Content
  content: CampaignContent;
  
  // Variables
  variables: TemplateVariable[];
  
  // Usage
  usageCount: number;
  lastUsedAt?: number;
  
  // AI
  aiGenerated?: boolean;
  aiPrompt?: string;
  
  createdAt: number;
  updatedAt: number;
}

export interface TemplateVariable {
  name: string;
  type: 'text' | 'number' | 'date' | 'contact_field' | 'custom';
  required: boolean;
  defaultValue?: string;
  description?: string;
}
