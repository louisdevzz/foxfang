# Notion Integration Setup

FoxFang can connect to your Notion workspace to read and write marketing content. This enables powerful workflows like:

- Reading content calendars and inspiration posts from Notion
- Creating new content drafts directly in your Notion databases
- Querying databases to find relevant content for campaigns
- Updating existing pages with new information

## Getting Your Notion API Key

### 1. Create a Notion Integration

1. Go to [https://www.notion.so/my-integrations](https://www.notion.so/my-integrations)
2. Click **"New integration"**
3. Give it a name (e.g., "FoxFang Marketing")
4. Select the workspace you want to connect
5. Click **"Submit"**
6. Copy the **"Internal Integration Token"** (starts with `secret_`)

### 2. Share Databases with Your Integration

Your integration can only access pages and databases you explicitly share with it:

1. In Notion, go to the database or page you want FoxFang to access
2. Click the **"..."** menu (top right)
3. Select **"Add connections"**
4. Find and select your integration (e.g., "FoxFang Marketing")
5. Repeat for all databases FoxFang should access

## Setup Methods

### Option 1: Web Setup (Recommended)

If running FoxFang with the web gateway:

1. Open `/setup` in your browser
2. Scroll to **"Notion Integration"** section
3. Paste your API key (starts with `secret_`)
4. Click **"Save & Restart"**

### Option 2: CLI Wizard

Run the setup wizard:

```bash
pnpm foxfang wizard
```

During setup, you'll be prompted for the Notion API key.

### Option 3: Manual Config

Edit `~/.foxfang/foxfang.json`:

```json
{
  "notion": {
    "apiKey": "secret_your_key_here"
  }
}
```

Or set the environment variable:

```bash
export NOTION_API_KEY="secret_your_key_here"
```

## How It Works

Once connected, FoxFang agents can:

1. **Search** your Notion workspace for pages and databases
2. **Read** page content (converted to markdown for the agent)
3. **Query databases** with filters to find specific content
4. **Create pages** in databases (e.g., add new content ideas)
5. **Update pages** with new properties or appended content

### Content-Specialist Agent

The `content-specialist` agent has full Notion access and can:

```bash
# Read inspiration from Notion and create content
pnpm foxfang run "Read my content calendar from Notion and draft a Twitter thread about the next campaign"

# Search for specific content
pnpm foxfang run "Search Notion for posts about product launches"

# Create new content in Notion
pnpm foxfang run "Create a new blog post draft in my Content Calendar database about AI marketing trends"
```

### Available Tools

| Tool | Purpose |
|------|---------|
| `notion_search` | Search pages/databases in your workspace |
| `notion_get_page` | Read page content (blocks → markdown) |
| `notion_query_database` | Query database with filters/sorts |
| `notion_create_page` | Create new page in a database |
| `notion_update_page` | Update properties/content of existing page |

## Security Notes

- Your API key is stored securely in the OS keychain or encrypted credentials file
- The key is never logged or exposed in error messages
- FoxFang only accesses pages/databases you explicitly share with the integration
- You can revoke access anytime from Notion's integration settings

## Troubleshooting

**"Notion API key not configured"**
- Run `pnpm foxfang wizard` to set up the API key
- Or check `~/.foxfang/foxfang.json` has the `notion.apiKey` field

**"Database not found" or "Page not found"**
- Make sure you've shared the database/page with your integration (see Step 2 above)
- The integration can only access explicitly shared content

**"Failed to search Notion"**
- Verify your API key is correct and starts with `secret_`
- Check that the integration has access to your workspace

## Next Steps

After setup, try these commands:

```bash
# Test the connection
pnpm foxfang run "Search my Notion workspace and list available databases"

# Find inspiration
pnpm foxfang run "Query my Inspiration Posts database for ideas about social media"

# Create content
pnpm foxfang run "Create a new page in my Content Calendar with a draft LinkedIn post about our product launch"
```

For more advanced usage, see the [Tools Reference](../features/tools.md).
