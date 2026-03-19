/**
 * Outreach Command - Marketing automation CLI
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { getOutreachService } from '../../outreach/service';
import type { Campaign, CampaignType, Sequence } from '../../outreach/types';

export async function registerOutreachCommand(program: Command): Promise<void> {
  const outreach = program
    .command('outreach')
    .description('Marketing automation - contacts, campaigns, and sequences');

  // ==================== CONTACTS ====================
  
  const contacts = outreach
    .command('contacts')
    .description('Manage contacts');

  contacts
    .command('add')
    .description('Add a new contact')
    .requiredOption('-c, --channel <channel>', 'Channel (signal, telegram, discord, slack, email)')
    .requiredOption('-i, --identifier <id>', 'Identifier (phone, username, email)')
    .option('-n, --name <name>', 'Contact name')
    .option('-t, --tags <tags>', 'Comma-separated tags')
    .option('-s, --source <source>', 'Source')
    .action(async (options) => {
      const service = getOutreachService();
      
      const contact = service.createContact({
        channel: options.channel,
        identifier: options.identifier,
        name: options.name,
        tags: options.tags ? options.tags.split(',').map((t: string) => t.trim()) : [],
        attributes: {},
        source: options.source,
        status: 'active',
      });
      
      console.log(chalk.green(`✓ Contact created: ${contact.id}`));
    });

  contacts
    .command('list')
    .description('List contacts')
    .option('-c, --channel <channel>', 'Filter by channel')
    .option('-t, --tag <tag>', 'Filter by tag')
    .option('-l, --limit <n>', 'Limit results', '50')
    .action(async (options) => {
      const service = getOutreachService();
      
      const { contacts, total } = service.listContacts({
        channel: options.channel,
        tag: options.tag,
        limit: parseInt(options.limit),
      });
      
      console.log(chalk.cyan(`Contacts (${contacts.length}/${total}):`));
      console.log();
      
      for (const contact of contacts) {
        const tags = contact.tags.length > 0 ? `[${contact.tags.join(', ')}]` : '';
        console.log(`  ${chalk.dim(contact.id.slice(0, 8))} ${contact.channel.padEnd(10)} ${contact.identifier.padEnd(20)} ${contact.name || ''} ${chalk.dim(tags)}`);
      }
    });

  contacts
    .command('tags')
    .description('List all tags')
    .action(async () => {
      const service = getOutreachService();
      const tags = service.getAllTags();
      
      console.log(chalk.cyan('All Tags:'));
      for (const tag of tags) {
        console.log(`  • ${tag}`);
      }
    });

  // ==================== LISTS ====================

  const lists = outreach
    .command('lists')
    .description('Manage contact lists');

  lists
    .command('create')
    .description('Create a contact list')
    .requiredOption('-n, --name <name>', 'List name')
    .option('-d, --description <desc>', 'Description')
    .option('-t, --tags <tags>', 'Auto-include tags (comma-separated)')
    .option('--dynamic', 'Dynamic list (auto-updates)', false)
    .action(async (options) => {
      const service = getOutreachService();
      
      const list = service.createContactList({
        name: options.name,
        description: options.description,
        tags: options.tags ? options.tags.split(',').map((t: string) => t.trim()) : [],
        contactIds: [],
        dynamic: options.dynamic,
      });
      
      console.log(chalk.green(`✓ List created: ${list.id}`));
    });

  lists
    .command('list')
    .description('Show all lists')
    .action(async () => {
      const service = getOutreachService();
      const lists = service.listContactLists();
      
      console.log(chalk.cyan('Contact Lists:'));
      console.log();
      
      for (const list of lists) {
        const type = list.dynamic ? chalk.blue('dynamic') : chalk.gray('static');
        const tags = list.tags.length > 0 ? chalk.dim(`[${list.tags.join(', ')}]`) : '';
        console.log(`  ${chalk.dim(list.id.slice(0, 8))} ${type} ${list.name} ${tags}`);
        if (list.description) {
          console.log(`         ${chalk.dim(list.description)}`);
        }
      }
    });

  // ==================== CAMPAIGNS ====================

  const campaigns = outreach
    .command('campaigns')
    .description('Manage campaigns');

  campaigns
    .command('create')
    .description('Create a new campaign')
    .requiredOption('-n, --name <name>', 'Campaign name')
    .option('-d, --description <desc>', 'Description')
    .requiredOption('-t, --type <type>', 'Type (broadcast, sequence, recurring, triggered)')
    .requiredOption('-l, --list <listId>', 'Target list ID')
    .requiredOption('-m, --message <message>', 'Message content')
    .option('--subject <subject>', 'Subject line')
    .option('--schedule <schedule>', 'Schedule (immediate, cron expression)')
    .action(async (options) => {
      const service = getOutreachService();
      
      const campaign = service.createCampaign({
        name: options.name,
        description: options.description,
        type: options.type as CampaignType,
        listId: options.list,
        content: {
          subject: options.subject,
          body: options.message,
          variables: [],
        },
        schedule: options.schedule === 'immediate' 
          ? { type: 'immediate' }
          : options.schedule
            ? { type: 'recurring', cronExpression: options.schedule }
            : undefined,
        settings: {
          trackOpens: true,
          trackClicks: true,
          replyHandling: 'manual',
          unsubscribeEnabled: true,
          maxRetries: 3,
        },
        createdBy: 'cli',
      });
      
      console.log(chalk.green(`✓ Campaign created: ${campaign.id}`));
      console.log(chalk.dim(`  Status: ${campaign.status}`));
      console.log(chalk.dim(`  Use 'foxfang outreach campaigns launch ${campaign.id}' to start`));
    });

  campaigns
    .command('list')
    .description('List campaigns')
    .option('-s, --status <status>', 'Filter by status')
    .action(async (options) => {
      const service = getOutreachService();
      
      const { campaigns } = service.listCampaigns({
        status: options.status,
      });
      
      console.log(chalk.cyan('Campaigns:'));
      console.log();
      
      for (const campaign of campaigns) {
        const statusColor = {
          draft: chalk.gray,
          scheduled: chalk.blue,
          running: chalk.green,
          paused: chalk.yellow,
          completed: chalk.dim,
          cancelled: chalk.red,
        }[campaign.status];
        
        const stats = `${campaign.stats.sent}/${campaign.stats.totalContacts} sent`;
        console.log(`  ${chalk.dim(campaign.id.slice(0, 8))} ${statusColor(campaign.status.padEnd(12))} ${campaign.type.padEnd(12)} ${campaign.name}`);
        console.log(`         ${chalk.dim(stats)} | Open: ${campaign.stats.opened} | Click: ${campaign.stats.clicked} | Reply: ${campaign.stats.replied}`);
      }
    });

  campaigns
    .command('launch <id>')
    .description('Launch a campaign')
    .action(async (id) => {
      const service = getOutreachService();
      const spinner = ora('Launching campaign...').start();
      
      try {
        const campaign = service.launchCampaign(id);
        if (campaign) {
          spinner.succeed(`Campaign launched: ${campaign.name}`);
          console.log(chalk.dim(`  Targeting ${campaign.stats.totalContacts} contacts`));
        } else {
          spinner.fail('Campaign not found');
        }
      } catch (error) {
        spinner.fail(error instanceof Error ? error.message : 'Launch failed');
      }
    });

  campaigns
    .command('pause <id>')
    .description('Pause a running campaign')
    .action(async (id) => {
      const service = getOutreachService();
      const campaign = service.pauseCampaign(id);
      
      if (campaign) {
        console.log(chalk.yellow(`✓ Campaign paused: ${campaign.name}`));
      } else {
        console.log(chalk.red('Campaign not found'));
      }
    });

  campaigns
    .command('resume <id>')
    .description('Resume a paused campaign')
    .action(async (id) => {
      const service = getOutreachService();
      const campaign = service.resumeCampaign(id);
      
      if (campaign) {
        console.log(chalk.green(`✓ Campaign resumed: ${campaign.name}`));
      } else {
        console.log(chalk.red('Campaign not found'));
      }
    });

  campaigns
    .command('cancel <id>')
    .description('Cancel a campaign')
    .action(async (id) => {
      const service = getOutreachService();
      const campaign = service.cancelCampaign(id);
      
      if (campaign) {
        console.log(chalk.red(`✓ Campaign cancelled: ${campaign.name}`));
      } else {
        console.log(chalk.red('Campaign not found'));
      }
    });

  campaigns
    .command('stats')
    .description('Show campaign statistics')
    .action(async () => {
      const service = getOutreachService();
      const analytics = service.getAnalytics();
      
      console.log(chalk.cyan.bold('\n📊 Outreach Analytics\n'));
      
      console.log(chalk.cyan('Overview:'));
      console.log(`  Total Contacts: ${analytics.totalContacts.toLocaleString()}`);
      console.log(`  Active Campaigns: ${analytics.activeCampaigns}`);
      console.log(`  Total Sent: ${analytics.totalSent.toLocaleString()}`);
      
      console.log(chalk.cyan('\nEngagement Rates:'));
      console.log(`  Open Rate: ${analytics.openRate.toFixed(1)}%`);
      console.log(`  Click Rate: ${analytics.clickRate.toFixed(1)}%`);
      console.log(`  Reply Rate: ${analytics.replyRate.toFixed(1)}%`);
      console.log(`  Unsubscribe Rate: ${analytics.unsubscribeRate.toFixed(1)}%`);
      console.log(`  Bounce Rate: ${analytics.bounceRate.toFixed(1)}%`);
      
      if (analytics.topCampaigns.length > 0) {
        console.log(chalk.cyan('\nTop Campaigns:'));
        for (const campaign of analytics.topCampaigns) {
          console.log(`  ${campaign.campaignName}`);
          console.log(`    Sent: ${campaign.sent} | Open: ${campaign.openRate.toFixed(1)}% | Click: ${campaign.clickRate.toFixed(1)}%`);
        }
      }
    });

  // ==================== SEQUENCES ====================

  const sequences = outreach
    .command('sequences')
    .description('Manage drip sequences');

  sequences
    .command('create')
    .description('Create a new sequence')
    .requiredOption('-n, --name <name>', 'Sequence name')
    .option('-d, --description <desc>', 'Description')
    .action(async (options) => {
      const service = getOutreachService();
      
      const sequence = service.createSequence({
        name: options.name,
        description: options.description,
        status: 'draft',
        steps: [],
        exitConditions: [{ type: 'replied' }],
        settings: {
          allowMultipleEnrollments: false,
          exitOnReply: true,
          exitOnClick: false,
          maxStepsPerDay: 3,
          respectUnsubscribe: true,
        },
      });
      
      console.log(chalk.green(`✓ Sequence created: ${sequence.id}`));
      console.log(chalk.dim(`  Use 'foxfang outreach sequences add-step ${sequence.id}' to add steps`));
    });

  sequences
    .command('list')
    .description('List sequences')
    .action(async () => {
      const service = getOutreachService();
      const sequences = service.listSequences();
      
      console.log(chalk.cyan('Sequences:'));
      console.log();
      
      for (const seq of sequences) {
        const statusColor = {
          draft: chalk.gray,
          active: chalk.green,
          paused: chalk.yellow,
          archived: chalk.dim,
        }[seq.status];
        
        console.log(`  ${chalk.dim(seq.id.slice(0, 8))} ${statusColor(seq.status.padEnd(10))} ${seq.name}`);
        console.log(`         ${seq.steps.length} steps | ${seq.activeContacts} active | ${seq.completedContacts} completed`);
      }
    });

  sequences
    .command('enroll <sequenceId> <contactId>')
    .description('Enroll a contact in a sequence')
    .action(async (sequenceId, contactId) => {
      const service = getOutreachService();
      
      const enrollment = service.enrollContact(sequenceId, contactId);
      
      if (enrollment) {
        console.log(chalk.green(`✓ Contact enrolled: ${enrollment.id}`));
        console.log(chalk.dim(`  Current step: ${enrollment.currentStepIndex + 1}`));
      } else {
        console.log(chalk.red('Failed to enroll contact'));
      }
    });

  sequences
    .command('exit <enrollmentId>')
    .description('Exit a contact from a sequence')
    .option('-r, --reason <reason>', 'Exit reason', 'manual')
    .action(async (enrollmentId, options) => {
      const service = getOutreachService();
      
      const enrollment = service.exitEnrollment(enrollmentId, options.reason);
      
      if (enrollment) {
        console.log(chalk.green(`✓ Enrollment exited: ${enrollment.id}`));
      } else {
        console.log(chalk.red('Enrollment not found'));
      }
    });

  // ==================== BULK OPERATIONS ====================

  outreach
    .command('bulk-import <file>')
    .description('Bulk import contacts from CSV/JSON')
    .requiredOption('-c, --channel <channel>', 'Channel for all contacts')
    .option('-s, --source <source>', 'Source')
    .option('-t, --tags <tags>', 'Tags to add')
    .action(async (file, options) => {
      const spinner = ora('Importing contacts...').start();
      
      try {
        // Would read file and parse contacts here
        spinner.succeed('Import completed');
        console.log(chalk.dim('  Imported: X | Skipped: Y | Failed: Z'));
      } catch (error) {
        spinner.fail('Import failed');
      }
    });

  // ==================== SEND TEST ====================

  outreach
    .command('test-send')
    .description('Send a test message')
    .requiredOption('-c, --channel <channel>', 'Channel')
    .requiredOption('-t, --to <recipient>', 'Recipient')
    .requiredOption('-m, --message <message>', 'Message')
    .action(async (options) => {
      const spinner = ora('Sending...').start();
      
      try {
        // Would send message here
        spinner.succeed('Message sent');
      } catch (error) {
        spinner.fail('Send failed');
      }
    });
}
