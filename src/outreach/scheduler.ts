/**
 * Outreach Scheduler
 * 
 * Background job processor for campaign delivery
 */

import { getPendingDeliveryJobs, updateDeliveryJob, incrementCampaignStat } from './campaigns';
import { getPendingSequenceSteps, processStep, advanceEnrollment } from './sequences';
import { getContact, updateContact } from './contacts';
import { ContentService } from '../content/service';
import type { ChannelAdapter } from '../channels/types';
import type { DeliveryJob } from './types';

export interface SchedulerConfig {
  enabled: boolean;
  checkIntervalMs: number;
  maxConcurrentJobs: number;
  retryAttempts: number;
  retryDelayMs: number;
}

export class OutreachScheduler {
  private config: SchedulerConfig;
  private contentService: ContentService;
  private channels: Map<string, ChannelAdapter> = new Map();
  private isRunning: boolean = false;
  private timer: NodeJS.Timeout | null = null;
  private processing: Set<string> = new Set();

  constructor(
    contentService: ContentService,
    config: Partial<SchedulerConfig> = {}
  ) {
    this.contentService = contentService;
    this.config = {
      enabled: true,
      checkIntervalMs: 5000,  // Check every 5 seconds
      maxConcurrentJobs: 5,
      retryAttempts: 3,
      retryDelayMs: 60000,  // 1 minute between retries
      ...config,
    };
  }

  registerChannel(adapter: ChannelAdapter): void {
    this.channels.set(adapter.name, adapter);
    this.contentService.registerChannel(adapter);
  }

  start(): void {
    if (!this.config.enabled || this.isRunning) return;
    
    this.isRunning = true;
    console.log('[OutreachScheduler] Started');
    
    // Run immediately
    this.processJobs();
    
    // Schedule recurring checks
    this.timer = setInterval(() => {
      this.processJobs();
    }, this.config.checkIntervalMs);
  }

  stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log('[OutreachScheduler] Stopped');
  }

  async processJobs(): Promise<void> {
    if (!this.isRunning) return;
    
    // Check concurrent limit
    if (this.processing.size >= this.config.maxConcurrentJobs) {
      return;
    }
    
    // Get pending campaign jobs
    const campaignJobs = getPendingDeliveryJobs(
      this.config.maxConcurrentJobs - this.processing.size
    );
    
    for (const job of campaignJobs) {
      if (this.processing.size >= this.config.maxConcurrentJobs) break;
      this.processCampaignJob(job);
    }
    
    // Get pending sequence steps
    const availableSlots = this.config.maxConcurrentJobs - this.processing.size;
    if (availableSlots > 0) {
      const sequenceSteps = getPendingSequenceSteps(availableSlots);
      
      for (const { enrollment, step } of sequenceSteps) {
        if (this.processing.size >= this.config.maxConcurrentJobs) break;
        this.processSequenceStep(enrollment.id, step.id);
      }
    }
  }

  private async processCampaignJob(job: DeliveryJob): Promise<void> {
    if (this.processing.has(job.id)) return;
    
    this.processing.add(job.id);
    
    try {
      console.log(`[OutreachScheduler] Processing job ${job.id} for ${job.identifier}`);
      
      // Update status to sent
      updateDeliveryJob(job.id, {
        status: 'sent',
        attempts: job.attempts + 1,
        lastAttemptAt: Date.now(),
      });
      
      // Send via content service
      const result = await this.sendMessage(
        job.channel,
        job.identifier,
        job.content,
        job.campaignId
      );
      
      if (result.success) {
        // Update to delivered
        updateDeliveryJob(job.id, {
          status: 'delivered',
          messageId: result.messageId,
        });
        
        // Update campaign stats
        if (job.campaignId) {
          incrementCampaignStat(job.campaignId, 'sent');
          incrementCampaignStat(job.campaignId, 'delivered');
        }
        
        // Update contact last contacted
        updateContact(job.contactId, {
          lastContactedAt: Date.now(),
        });
        
        console.log(`[OutreachScheduler] Job ${job.id} delivered`);
      } else {
        throw new Error(result.error || 'Unknown error');
      }
    } catch (error) {
      console.error(`[OutreachScheduler] Job ${job.id} failed:`, error);
      
      const errorMsg = error instanceof Error ? error.message : String(error);
      const shouldRetry = job.attempts < this.config.retryAttempts;
      
      if (shouldRetry) {
        // Schedule retry
        const retryAt = Date.now() + this.config.retryDelayMs;
        updateDeliveryJob(job.id, {
          status: 'pending',
          attempts: job.attempts + 1,
          lastAttemptAt: Date.now(),
          error: errorMsg,
        });
        
        // Update scheduled time for retry (hacky but works)
        // In production, you'd have a separate retry queue
      } else {
        // Mark as failed
        updateDeliveryJob(job.id, {
          status: 'failed',
          attempts: job.attempts + 1,
          lastAttemptAt: Date.now(),
          error: errorMsg,
        });
        
        // Update campaign stats
        if (job.campaignId) {
          incrementCampaignStat(job.campaignId, 'failed');
        }
      }
    } finally {
      this.processing.delete(job.id);
    }
  }

  private async processSequenceStep(
    enrollmentId: string,
    stepId: string
  ): Promise<void> {
    const processKey = `seq:${enrollmentId}`;
    if (this.processing.has(processKey)) return;
    
    this.processing.add(processKey);
    
    try {
      const result = processStep(enrollmentId, stepId);
      if (!result) return;
      
      const { enrollment, shouldSend, content, actions } = result;
      
      if (!shouldSend || !content) {
        // Skip this step
        advanceEnrollment(enrollmentId, { sent: false });
        return;
      }
      
      console.log(`[OutreachScheduler] Processing sequence step ${stepId} for enrollment ${enrollmentId}`);
      
      // Execute actions
      for (const actionJson of actions) {
        try {
          const action = JSON.parse(actionJson);
          await this.executeAction(action, enrollment);
        } catch (error) {
          console.error('[OutreachScheduler] Action failed:', error);
        }
      }
      
      // Get contact info
      const contact = getContact(enrollment.contactId);
      if (!contact) {
        advanceEnrollment(enrollmentId, { sent: false });
        return;
      }
      
      // Send message
      const sendResult = await this.sendMessage(
        contact.channel,
        contact.identifier,
        content,
        undefined,
        enrollment.sequenceId
      );
      
      // Advance enrollment
      advanceEnrollment(enrollmentId, {
        sent: sendResult.success,
        messageId: sendResult.messageId,
      });
      
      if (sendResult.success) {
        // Update contact
        updateContact(enrollment.contactId, {
          lastContactedAt: Date.now(),
        });
      }
      
      console.log(`[OutreachScheduler] Sequence step ${stepId} processed`);
    } catch (error) {
      console.error(`[OutreachScheduler] Sequence step ${stepId} failed:`, error);
    } finally {
      this.processing.delete(processKey);
    }
  }

  private async sendMessage(
    channel: string,
    identifier: string,
    content: string,
    campaignId?: string,
    sequenceId?: string
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const adapter = this.channels.get(channel);
    if (!adapter) {
      return { success: false, error: `Channel ${channel} not available` };
    }
    
    try {
      const result = await this.contentService.send(
        channel,
        identifier,
        content,
        { replyToMessageId: undefined }
      );
      
      if (result) {
        return { success: true, messageId: result.messageId };
      } else {
        return { success: false, error: 'Send returned null' };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async executeAction(
    action: { type: string; config: Record<string, any> },
    enrollment: { contactId: string; variables: Record<string, any> }
  ): Promise<void> {
    const contact = getContact(enrollment.contactId);
    if (!contact) return;
    
    switch (action.type) {
      case 'add_tag':
        if (action.config.tag && !contact.tags.includes(action.config.tag)) {
          contact.tags.push(action.config.tag);
          updateContact(enrollment.contactId, { tags: contact.tags });
        }
        break;
        
      case 'remove_tag':
        if (action.config.tag) {
          contact.tags = contact.tags.filter(t => t !== action.config.tag);
          updateContact(enrollment.contactId, { tags: contact.tags });
        }
        break;
        
      case 'update_attribute':
        if (action.config.attribute) {
          contact.attributes[action.config.attribute] = action.config.value;
          updateContact(enrollment.contactId, { attributes: contact.attributes });
        }
        break;
        
      case 'webhook':
        // Call external webhook
        try {
          await fetch(action.config.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contactId: enrollment.contactId,
              variables: enrollment.variables,
              timestamp: Date.now(),
            }),
          });
        } catch (error) {
          console.error('[OutreachScheduler] Webhook failed:', error);
        }
        break;
    }
  }

  // ==================== TRACKING ====================

  async trackOpen(campaignId: string, contactId: string): Promise<void> {
    incrementCampaignStat(campaignId, 'opened');
    
    // Could also track per-contact opens
    console.log(`[OutreachScheduler] Open tracked: ${contactId} for campaign ${campaignId}`);
  }

  async trackClick(campaignId: string, contactId: string, url: string): Promise<void> {
    incrementCampaignStat(campaignId, 'clicked');
    
    console.log(`[OutreachScheduler] Click tracked: ${contactId} clicked ${url}`);
  }

  async trackReply(campaignId: string, contactId: string): Promise<void> {
    incrementCampaignStat(campaignId, 'replied');
    
    console.log(`[OutreachScheduler] Reply tracked: ${contactId} for campaign ${campaignId}`);
  }

  async trackUnsubscribe(campaignId: string, contactId: string): Promise<void> {
    incrementCampaignStat(campaignId, 'unsubscribed');
    
    // Update contact status
    updateContact(contactId, { status: 'unsubscribed' });
    
    console.log(`[OutreachScheduler] Unsubscribe: ${contactId} from campaign ${campaignId}`);
  }
}
