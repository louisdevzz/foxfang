# FoxFang Outreach System

Marketing automation module for FoxFang. Inspired by OpenClaw's cron scheduling patterns.

## Overview

The Outreach System enables automated marketing campaigns across multiple channels:

```
┌─────────────────────────────────────────────────────────────────┐
│                    OUTREACH SYSTEM                               │
├─────────────────────────────────────────────────────────────────┤
│  Contacts  →  Lists/Segments  →  Campaigns  →  Scheduler  →  Send│
│      ↓              ↓              ↓                             │
│   Attributes     Dynamic       Sequences                        │
│   Tags           Filters       Drip Campaigns                    │
└─────────────────────────────────────────────────────────────────┘
```

## Features

### Contact Management
- Multi-channel contacts (Signal, Telegram, Discord, Slack, Email)
- Tags and attributes for segmentation
- Source tracking
- Unsubscribe handling

### Campaigns
- **Broadcast**: One-time messages to lists
- **Recurring**: Scheduled recurring campaigns
- **Triggered**: Event-based campaigns
- **Sequences**: Multi-step drip campaigns

### Personalization
- Variable substitution: `{{name}}`, `{{company}}`, `{{custom_attr}}`
- AI-powered personalization (optional)
- Fallback values

### Scheduling
- Cron expressions
- Throttling (max per hour)
- Send-time optimization
- Retry logic

### Analytics
- Open rates
- Click rates
- Reply rates
- Unsubscribe rates
- Channel breakdown

## Quick Start

### 1. Add Contacts

```bash
# Add a single contact
foxfang outreach contacts add \
  --channel signal \
  --identifier +1234567890 \
  --name "John Doe" \
  --tags "prospect,tech"

# Bulk import from CSV
foxfang outreach bulk-import contacts.csv \
  --channel telegram \
  --source "import_2024" \
  --tags "imported"
```

### 2. Create a List

```bash
# Static list
foxfang outreach lists create \
  --name "Tech Prospects" \
  --description "Prospects in tech industry"

# Dynamic list (auto-updates based on tags)
foxfang outreach lists create \
  --name "Beta Testers" \
  --tags "beta-tester" \
  --dynamic
```

### 3. Create a Campaign

```bash
# Simple broadcast campaign
foxfang outreach campaigns create \
  --name "Product Launch" \
  --type broadcast \
  --list LIST_ID \
  --message "Hi {{name}}! Check out our new product..."

# Scheduled campaign
foxfang outreach campaigns create \
  --name "Weekly Newsletter" \
  --type recurring \
  --list LIST_ID \
  --message "Weekly update for {{name}}..." \
  --schedule "0 9 * * MON"  # Every Monday at 9am
```

### 4. Launch Campaign

```bash
# Launch immediately
foxfang outreach campaigns launch CAMPAIGN_ID

# Check status
foxfang outreach campaigns list

# View stats
foxfang outreach campaigns stats
```

## Sequences (Drip Campaigns)

Multi-step automated messaging with conditions:

```
Step 1: Welcome message (immediate)
   ↓ (wait 2 days)
Step 2: Feature highlight (if not opened Step 1)
   ↓ (wait 3 days)
Step 3: Case study (if opened any previous)
   ↓ (wait 5 days)
Step 4: Final offer (exit if replied)
```

### Create a Sequence

```bash
# Create sequence
foxfang outreach sequences create \
  --name "Onboarding Flow" \
  --description "Welcome new users"

# Add steps (would need additional CLI commands or API)
```

### Enroll Contacts

```bash
# Enroll single contact
foxfang outreach sequences enroll SEQUENCE_ID CONTACT_ID

# Exit enrollment
foxfang outreach sequences exit ENROLLMENT_ID --reason completed
```

## Personalization Variables

Use variables in your message content:

```markdown
Hi {{name}},

Thanks for joining {{company}}! As a {{role}} in the {{industry}} 
industry, you'll find our platform especially useful.

Best,
The Team
```

**Built-in variables:**
- `{{name}}` - Contact name
- `{{channel}}` - Contact channel
- `{{identifier}}` - Contact identifier

**Custom attributes:**
Any attribute added to a contact can be used as `{{attribute_name}}`.

## Campaign Types

### Broadcast
One-time message to a list.

```typescript
const campaign = service.createCampaign({
  name: "Product Launch",
  type: "broadcast",
  listId: "LIST_ID",
  content: {
    body: "Hi {{name}}! Our product is now live!",
  },
});
```

### Recurring
Scheduled repeating campaigns using cron expressions.

```typescript
const campaign = service.createCampaign({
  name: "Weekly Update",
  type: "recurring",
  listId: "LIST_ID",
  schedule: {
    type: "recurring",
    cronExpression: "0 9 * * MON",  // Every Monday 9am
    timezone: "America/New_York",
  },
});
```

### Sequence
Multi-step drip campaign.

```typescript
const sequence = service.createSequence({
  name: "Onboarding",
  steps: [
    {
      order: 1,
      name: "Welcome",
      delay: { type: "immediate" },
      content: { body: "Welcome {{name}}!" },
      actions: [],
    },
    {
      order: 2,
      name: "Feature Highlight",
      delay: { type: "fixed", days: 2 },
      condition: { type: "previous_opened", stepId: "any" },
      content: { body: "Check out this feature!" },
      actions: [],
    },
  ],
  exitConditions: [
    { type: "replied" },
  ],
});
```

## Segmentation

Filter contacts based on multiple criteria:

```typescript
const segment: SegmentFilter = {
  operator: "and",
  conditions: [
    { type: "tag", tag: "prospect", tagOperator: "has" },
    { type: "channel", channel: "signal" },
    { type: "attribute", attribute: "company_size", operator: "gt", value: 50 },
  ],
};

const contacts = service.queryContactsBySegment(segment);
```

## Analytics

```bash
# View overall stats
foxfang outreach campaigns stats
```

Sample output:
```
📊 Outreach Analytics

Overview:
  Total Contacts: 1,234
  Active Campaigns: 3
  Total Sent: 5,678

Engagement Rates:
  Open Rate: 45.2%
  Click Rate: 12.8%
  Reply Rate: 3.5%
  Unsubscribe Rate: 0.8%

Top Campaigns:
  Product Launch
    Sent: 500 | Open: 52.1% | Click: 15.3%
```

## Programmatic Usage

```typescript
import { getOutreachService } from './outreach';
import { SignalAdapter } from './channels/adapters/signal';

// Initialize
const service = getOutreachService();
service.initialize();

// Register channel
const signalAdapter = new SignalAdapter();
await signalAdapter.connect();
service.registerChannel(signalAdapter);

// Start scheduler
service.start();

// Create contact
const contact = service.createContact({
  channel: 'signal',
  identifier: '+1234567890',
  name: 'John Doe',
  tags: ['prospect'],
  attributes: { company: 'Acme Inc' },
  status: 'active',
});

// Create campaign
const campaign = service.createCampaign({
  name: 'Welcome Campaign',
  type: 'broadcast',
  listId: 'LIST_ID',
  content: {
    body: 'Hi {{name}} from {{company}}!',
  },
  settings: {
    trackOpens: true,
    trackClicks: true,
    replyHandling: 'auto',
    unsubscribeEnabled: true,
    maxRetries: 3,
  },
  createdBy: 'user',
});

// Launch
service.launchCampaign(campaign.id);

// Create and enroll in sequence
const sequence = service.createSequence({
  name: 'Nurture Flow',
  steps: [
    {
      order: 1,
      name: 'Welcome',
      delay: { type: 'immediate' },
      content: { body: 'Welcome!' },
      actions: [{ type: 'add_tag', config: { tag: 'enrolled' } }],
    },
  ],
  exitConditions: [{ type: 'replied' }],
});

service.enrollContact(sequence.id, contact.id);
```

## Architecture

```
┌────────────────────────────────────────────────────────────┐
│                      OUTREACH SERVICE                       │
├────────────────────────────────────────────────────────────┤
│  Contacts → Campaigns → Sequences → Scheduler → Delivery   │
│     ↓          ↓           ↓          ↓          ↓        │
│   SQLite    SQLite      SQLite    In-Memory   Channels    │
└────────────────────────────────────────────────────────────┘
```

### Database Schema

**outreach_contacts**
- id, channel, identifier, name, tags, attributes, status, timestamps

**outreach_lists**
- id, name, description, tags, contact_ids, dynamic, timestamps

**outreach_campaigns**
- id, name, type, status, list_id, content, schedule, stats, timestamps

**outreach_sequences**
- id, name, status, steps, exit_conditions, settings, timestamps

**outreach_enrollments**
- id, sequence_id, contact_id, status, current_step_index, step_history

**outreach_delivery_jobs**
- id, type, contact_id, content, campaign_id, scheduled_at, status, attempts

## Best Practices

1. **Segmentation**: Use tags and attributes for effective targeting
2. **Throttling**: Set appropriate send rates to avoid rate limits
3. **Personalization**: Use variables but provide fallbacks
4. **Testing**: Test campaigns with small lists first
5. **Unsubscribes**: Always respect unsubscribe requests
6. **Exit Conditions**: Set clear exit conditions for sequences
7. **Analytics**: Monitor engagement and adjust accordingly

## Future Enhancements

- [ ] A/B testing for campaigns
- [ ] AI-powered send-time optimization
- [ ] Advanced segmentation with engagement history
- [ ] Webhook integrations
- [ ] Email template builder
- [ ] Visual sequence builder
- [ ] Real-time analytics dashboard
- [ ] Contact scoring/lead qualification
