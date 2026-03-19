/**
 * Outreach Module
 * 
 * Marketing automation for FoxFang
 * - Contact management
 * - Campaign management  
 * - Sequence/drip campaigns
 * - Analytics
 */

export {
  OutreachService,
  getOutreachService,
  resetOutreachService,
} from './service';

export {
  OutreachScheduler,
} from './scheduler';

export type {
  // Contacts
  Contact,
  ContactList,
  ContactImportResult,
  
  // Campaigns
  Campaign,
  CampaignStatus,
  CampaignType,
  CampaignContent,
  CampaignSchedule,
  CampaignSettings,
  CampaignStats,
  CampaignTrigger,
  PersonalizationConfig,
  
  // Sequences
  Sequence,
  SequenceStep,
  SequenceEnrollment,
  StepHistoryEntry,
  StepDelay,
  SequenceSettings,
  StepCondition,
  ExitCondition,
  StepAction,
  StepStats,
  
  // Segments
  SegmentFilter,
  SegmentCondition,
  
  // Analytics
  OutreachAnalytics,
  DailyStat,
  ChannelStat,
  CampaignPerformance,
  SequencePerformance,
  
  // Delivery
  DeliveryJob,
  
  // Templates
  MessageTemplate,
  TemplateVariable,
} from './types';
