# Content Editing Feature

FoxFang now supports editing content across multiple messaging channels, including Signal, Telegram, Discord, and Slack.

## Overview

Since Signal doesn't have native message editing like Telegram, we implement editing using a **delete + resend** pattern:
1. Delete the original message using `remoteDelete`
2. Send a new message with `✏️` prefix

For Telegram, Discord, and Slack, native editing APIs are used.

## Supported Channels

| Channel | Edit Method | Delete Method | Notes |
|---------|-------------|---------------|-------|
| Signal | `remoteDelete` + resend with ✏️ prefix | `remoteDelete` | Deletes only work for recent unread messages |
| Telegram | `editMessageText` | `deleteMessage` | Native support |
| Discord | `PATCH /messages/{id}` | `DELETE /messages/{id}` | Native support |
| Slack | `chat.update` | `chat.delete` | Native support |

## CLI Commands

### Signal

```bash
# Send a message
foxfang channels signal send -n +1234567890 -m "Hello World"

# Edit a message (delete + resend with ✏️ prefix)
foxfang channels signal edit -n +1234567890 -t <timestamp> -m "Updated message"

# Delete a message
foxfang channels signal delete -n +1234567890 -t <timestamp>

# Stream content with live editing
foxfang channels signal stream -n +1234567890 -m "Draft content"
```

### Using Content Service (Programmatic)

```typescript
import { ContentService } from './content/service';
import { SignalAdapter } from './channels/adapters/signal';

const contentService = new ContentService();
const adapter = new SignalAdapter();
await adapter.connect();
contentService.registerChannel(adapter);

// Send a message
const message = await contentService.send('signal', '+1234567890', 'Hello!');

// Edit the message
await contentService.edit(message!.id, 'Hello, updated!');

// Delete the message
await contentService.delete(message!.id);
```

### Draft Stream (Live Editing)

For streaming content that updates in real-time:

```typescript
import { createSignalDraftStream } from './channels/draft-stream';

const stream = createSignalDraftStream({
  send: async (content) => {
    return adapter.send(recipient, content);
  },
  delete: async (msgId) => {
    return adapter.delete(msgId, recipient);
  },
  config: {
    throttleMs: 2000,      // Update interval
    maxChars: 4096,        // Max message length
    editPrefix: '✏️ ',     // Prefix for edited messages
  },
});

// Update content (will delete old + send new)
stream.update("First version");
stream.update("Second version");

// Finalize
await stream.finalize();

// Or cancel
await stream.cancel();
```

## Technical Details

### Signal Adapter

The Signal adapter stores sent messages internally for editing:

```typescript
private sentMessages: Map<string, { to: string; timestamp: number }>
```

When editing:
1. Look up the message by ID
2. Call `remoteDelete` with the stored timestamp
3. Send new message with `✏️` prefix
4. Update the stored message ID

### Limitations

**Signal:**
- `remoteDelete` only works for messages that haven't been read yet
- Messages older than ~24 hours usually can't be deleted
- The recipient will see a "message deleted" indicator before the new message

**All Channels:**
- Message IDs are stored in memory and lost on restart
- For persistent editing, integrate with a database

## Future Improvements

- [ ] Persistent message storage in database
- [ ] WebSocket-based real-time streaming
- [ ] Edit history tracking
- [ ] Bulk edit operations
- [ ] Scheduled message editing
