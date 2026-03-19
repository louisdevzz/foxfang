/**
 * Outreach Service
 * 
 * Main service for marketing automation
 */

import { ContentService } from '../content/service';
import { OutreachScheduler } from './scheduler';
import type { ChannelAdapter } from '../channels/types';
import type { 
  Contact, 
  ContactList, 
  Campaign, 
  Sequence,
  SequenceEnrollment,
  SegmentFilter,
  OutreachAnalytics,
  MessageTemplate 
} from './types';

// Re-export all functions from submodules
export * from './contacts';
export * from './campaigns';
export * from './sequences';
export { OutreachScheduler };

import { 
  initContactsTables, 
  createContact, 
  getContact, 
  updateContact,
  listContacts,
  importContacts,
  getAllTags,
  createContactList,
  getContactList,
  listContactLists,
  getContactsInList,
  queryContactsBySegment,
} from './contacts';

import { 
  initCampaignsTables,
  createCampaign,
  getCampaign,
  updateCampaign,
  listCampaigns,
  launchCampaign,
  pauseCampaign,
  resumeCampaign,
  cancelCampaign,
  duplicateCampaign,
  getCampaignContacts,
} from './campaigns';

import { 
  initSequencesTables,
  createSequence,
  getSequence,
  updateSequence,
  listSequences,
  enrollContact,
  getEnrollment,
  listEnrollments,
  exitEnrollment,
} from './sequences';

export class OutreachService {
  private contentService: ContentService;
  private scheduler: OutreachScheduler;
  private isInitialized: boolean = false;

  constructor() {
    this.contentService = new ContentService();
    this.scheduler = new OutreachScheduler(this.contentService);
  }

  /**
   * Initialize the outreach service
   */
  initialize(): void {
    if (this.isInitialized) return;
    
    // Initialize database tables
    initContactsTables();
    initCampaignsTables();
    initSequencesTables();
    
    console.log('[OutreachService] Database tables initialized');
    
    this.isInitialized = true;
  }

  /**
   * Register a channel adapter
   */
  registerChannel(adapter: ChannelAdapter): void {
    this.scheduler.registerChannel(adapter);
  }

  /**
   * Start the scheduler
   */
  start(): void {
    this.scheduler.start();
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    this.scheduler.stop();
  }

  // ==================== CONTACTS ====================

  createContact(contact: Omit<Contact, 'id' | 'createdAt' | 'updatedAt'>): Contact {
    this.ensureInitialized();
    return createContact(contact);
  }

  getContact(id: string): Contact | null {
    return getContact(id);
  }

  updateContact(id: string, updates: Partial<Contact>): Contact | null {
    return updateContact(id, updates);
  }

  listContacts(options?: Parameters<typeof listContacts>[0]): { contacts: Contact[]; total: number } {
    return listContacts(options);
  }

  importContacts(
    contacts: Array<Omit<Contact, 'id' | 'createdAt' | 'updatedAt'>>,
    options?: Parameters<typeof importContacts>[1]
  ) {
    this.ensureInitialized();
    return importContacts(contacts, options);
  }

  getAllTags(): string[] {
    return getAllTags();
  }

  // ==================== LISTS ====================

  createContactList(list: Omit<ContactList, 'id' | 'createdAt' | 'updatedAt'>): ContactList {
    this.ensureInitialized();
    return createContactList(list);
  }

  getContactList(id: string): ContactList | null {
    return getContactList(id);
  }

  listContactLists(): ContactList[] {
    return listContactLists();
  }

  getContactsInList(listId: string): Contact[] {
    return getContactsInList(listId);
  }

  queryContactsBySegment(filter: SegmentFilter): Contact[] {
    return queryContactsBySegment(filter);
  }

  // ==================== CAMPAIGNS ====================

  createCampaign(campaign: Omit<Campaign, 'id' | 'createdAt' | 'updatedAt' | 'stats' | 'status'>): Campaign {
    this.ensureInitialized();
    return createCampaign(campaign);
  }

  getCampaign(id: string): Campaign | null {
    return getCampaign(id);
  }

  updateCampaign(id: string, updates: Partial<Campaign>): Campaign | null {
    return updateCampaign(id, updates);
  }

  listCampaigns(options?: Parameters<typeof listCampaigns>[0]): { campaigns: Campaign[]; total: number } {
    return listCampaigns(options);
  }

  launchCampaign(id: string): Campaign | null {
    this.ensureInitialized();
    return launchCampaign(id);
  }

  pauseCampaign(id: string): Campaign | null {
    return pauseCampaign(id);
  }

  resumeCampaign(id: string): Campaign | null {
    return resumeCampaign(id);
  }

  cancelCampaign(id: string): Campaign | null {
    return cancelCampaign(id);
  }

  duplicateCampaign(id: string, newName?: string): Campaign | null {
    return duplicateCampaign(id, newName);
  }

  getCampaignContacts(campaign: Campaign): ReturnType<typeof getCampaignContacts> {
    return getCampaignContacts(campaign);
  }

  // ==================== SEQUENCES ====================

  createSequence(sequence: Omit<Sequence, 'id' | 'createdAt' | 'updatedAt' | 'activeContacts' | 'completedContacts'>): Sequence {
    this.ensureInitialized();
    return createSequence(sequence);
  }

  getSequence(id: string): Sequence | null {
    return getSequence(id);
  }

  updateSequence(id: string, updates: Partial<Sequence>): Sequence | null {
    return updateSequence(id, updates);
  }

  listSequences(options?: Parameters<typeof listSequences>[0]): Sequence[] {
    return listSequences(options);
  }

  enrollContact(
    sequenceId: string,
    contactId: string,
    options?: Parameters<typeof enrollContact>[2]
  ): SequenceEnrollment | null {
    this.ensureInitialized();
    return enrollContact(sequenceId, contactId, options);
  }

  getEnrollment(id: string): SequenceEnrollment | null {
    return getEnrollment(id);
  }

  listEnrollments(options?: Parameters<typeof listEnrollments>[0]): SequenceEnrollment[] {
    return listEnrollments(options);
  }

  exitEnrollment(enrollmentId: string, reason: Parameters<typeof exitEnrollment>[1]): SequenceEnrollment | null {
    return exitEnrollment(enrollmentId, reason);
  }

  // ==================== ANALYTICS ====================

  getAnalytics(): OutreachAnalytics {
    const { contacts: allContacts } = listContacts();
    const { campaigns } = listCampaigns();
    const sequences = listSequences();
    
    const activeCampaigns = campaigns.filter(c => c.status === 'running').length;
    
    // Calculate stats
    let totalSent = 0;
    let totalDelivered = 0;
    let totalOpened = 0;
    let totalClicked = 0;
    let totalReplied = 0;
    let totalUnsubscribed = 0;
    let totalFailed = 0;
    
    for (const campaign of campaigns) {
      totalSent += campaign.stats.sent;
      totalDelivered += campaign.stats.delivered;
      totalOpened += campaign.stats.opened;
      totalClicked += campaign.stats.clicked;
      totalReplied += campaign.stats.replied;
      totalUnsubscribed += campaign.stats.unsubscribed;
      totalFailed += campaign.stats.failed;
    }
    
    const openRate = totalDelivered > 0 ? (totalOpened / totalDelivered) * 100 : 0;
    const clickRate = totalDelivered > 0 ? (totalClicked / totalDelivered) * 100 : 0;
    const replyRate = totalDelivered > 0 ? (totalReplied / totalDelivered) * 100 : 0;
    const unsubscribeRate = totalSent > 0 ? (totalUnsubscribed / totalSent) * 100 : 0;
    const bounceRate = totalSent > 0 ? (totalFailed / totalSent) * 100 : 0;
    
    // Channel breakdown
    const channelStats = this.calculateChannelStats(allContacts);
    
    // Top campaigns
    const topCampaigns = campaigns
      .filter(c => c.stats.sent > 0)
      .map(c => ({
        campaignId: c.id,
        campaignName: c.name,
        sent: c.stats.sent,
        openRate: c.stats.delivered > 0 ? (c.stats.opened / c.stats.delivered) * 100 : 0,
        clickRate: c.stats.delivered > 0 ? (c.stats.clicked / c.stats.delivered) * 100 : 0,
        replyRate: c.stats.delivered > 0 ? (c.stats.replied / c.stats.delivered) * 100 : 0,
      }))
      .sort((a, b) => b.sent - a.sent)
      .slice(0, 5);
    
    // Top sequences
    const topSequences = sequences
      .map(s => ({
        sequenceId: s.id,
        sequenceName: s.name,
        enrolled: s.activeContacts + s.completedContacts,
        completed: s.completedContacts,
        completionRate: (s.activeContacts + s.completedContacts) > 0
          ? (s.completedContacts / (s.activeContacts + s.completedContacts)) * 100
          : 0,
        avgTimeToComplete: 0, // Would need more detailed tracking
      }))
      .sort((a, b) => b.enrolled - a.enrolled)
      .slice(0, 5);
    
    // Daily stats (last 30 days)
    const dailyStats = this.calculateDailyStats(campaigns);
    
    return {
      totalContacts: allContacts.length,
      activeCampaigns,
      totalSent,
      openRate,
      clickRate,
      replyRate,
      unsubscribeRate,
      bounceRate,
      dailyStats,
      channelStats,
      topCampaigns,
      topSequences,
    };
  }

  private calculateChannelStats(contacts: Contact[]) {
    const channelMap = new Map<string, { sent: number; delivered: number; opened: number; clicked: number }>();
    
    for (const contact of contacts) {
      const existing = channelMap.get(contact.channel) || { sent: 0, delivered: 0, opened: 0, clicked: 0 };
      channelMap.set(contact.channel, existing);
    }
    
    // In a real implementation, you'd track per-channel stats
    return Array.from(channelMap.entries()).map(([channel, stats]) => ({
      channel,
      sent: stats.sent,
      delivered: stats.delivered,
      openRate: stats.delivered > 0 ? (stats.opened / stats.delivered) * 100 : 0,
      clickRate: stats.delivered > 0 ? (stats.clicked / stats.delivered) * 100 : 0,
    }));
  }

  private calculateDailyStats(campaigns: Campaign[]) {
    const days = 30;
    const dailyStats = [];
    const now = new Date();
    
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      
      dailyStats.push({
        date: dateStr,
        sent: 0,
        delivered: 0,
        opened: 0,
        clicked: 0,
        replied: 0,
        unsubscribed: 0,
      });
    }
    
    return dailyStats;
  }

  private ensureInitialized(): void {
    if (!this.isInitialized) {
      this.initialize();
    }
  }
}

// Singleton instance
let outreachService: OutreachService | null = null;

export function getOutreachService(): OutreachService {
  if (!outreachService) {
    outreachService = new OutreachService();
  }
  return outreachService;
}

export function resetOutreachService(): void {
  outreachService = null;
}
