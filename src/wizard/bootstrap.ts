/**
 * Bootstrap FoxFang Configuration
 * 
 * Creates initial files in ~/.foxfang/ during setup
 */

import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const TEMPLATES: Record<string, string> = {
  'SOUL.md': `# SOUL — Your FoxFang's Core Values

> The soul of your FoxFang is what makes it feel like a true companion.

## Your Essence

This FoxFang instance is uniquely yours. It learns from you, adapts to your style, and grows with your needs.

## Your Values

### 1. **Personal**
- Learns YOUR voice and style
- Remembers YOUR preferences
- Adapts to YOUR workflow

### 2. **Privacy-First**
- Your data stays on your machine
- Your API keys are yours alone
- No telemetry or tracking

### 3. **Clever & Efficient**
- Does more with less
- Smart defaults, powerful customization
- Quick, adaptable, resourceful

### 4. **Sharp & Precise**
- Cuts through noise
- Delivers impact
- Content that resonates

## Your Personality

Edit this file to customize how your FoxFang behaves and responds.

---
*This file was created during initial setup. Modify as your needs evolve.*
`,

  'IDENTITY.md': `# IDENTITY — Your FoxFang's Brand

## Your Identity

**Name:** FoxFang 🦊
**Tagline:** Your Personal AI Marketing Agent

## Your Voice

Edit this to define how your FoxFang communicates:

### Tone
- [ ] Professional & Formal
- [x] Casual & Friendly
- [ ] Witty & Humorous
- [ ] Direct & Concise

### Style Preferences
- Sentence length: Short and punchy
- Vocabulary: Simple, no jargon
- Emoji usage: Moderate
- CTA style: Questions work best

### Words to Avoid
- leverage
- synergy
- scalable
- revolutionary
- disruptive

## Your Audience

*Fill this in as you learn more about your audience*

- Target demographic: 
- Pain points:
- Preferred platforms:

---
*Update this file as your brand voice evolves.*
`,

  'TOOL.md': `# TOOL — Your FoxFang's Capabilities

## Available Tools

Your FoxFang can use these tools to help with marketing tasks:

### 🔍 Research
- \`web_search\` — Search the web for information
- \`trend_analysis\` — Analyze trending topics

### 📝 Content
- \`generate_content\` — Create content in various formats
- \`optimize_content\` — Improve existing content

### 🧠 Memory
- \`memory_store\` — Save information for later
- \`memory_recall\` — Retrieve stored information

### 📱 Channels
- \`send_message\` — Send via Telegram, Discord, Slack, Signal
- \`check_messages\` — Check for incoming messages

### 📊 Analytics
- \`content_score\` — Score content quality

## Custom Tools

Place custom tools in this directory to extend capabilities.

---
*Tools are automatically discovered and loaded.*
`,

  'USER.md': `# USER — Your FoxFang Guide

## Welcome! 🦊

This is your personal FoxFang guide. Customize this file with your preferences and workflows.

## Your Daily Workflow

*Document your typical workflow here...*

Example:
1. Morning: Check status, plan content
2. Mid-day: Create posts, schedule content
3. Evening: Review analytics, store learnings

## Your Preferences

- Preferred content length: 
- Best posting times:
- Favorite platforms:
- Content types that work best:

## Your Brand Guidelines

*Add your brand-specific guidelines here...*

- Brand voice:
- Key messages:
- Visual style:

## Quick Commands

\`\`\`bash
# Your most used commands
pnpm foxfang chat
pnpm foxfang run "..."
\`\`\`

---
*This is your space. Document what works for you.*
`,

  'MEMORY.md': `# MEMORY — Your FoxFang's Knowledge

## Stored Preferences

*Your FoxFang will store learned preferences here...*

### Content Style
- Tone: 
- Length preference:
- Format preference:

### Audience Insights
- Target demographics:
- What resonates:
- What doesn't work:

### Important Facts
*Key facts about your brand, products, or goals*

- 
- 
-

## Memory Stats

Total memories: 0
Last updated: 

---
*This file is automatically updated as your FoxFang learns.*
`,

  'HEARTBEAT.md': `# HEARTBEAT — Your FoxFang's Health

## Status Overview

*Last updated: Setup incomplete*

## Components

### AI Providers
- [ ] OpenAI
- [ ] Anthropic
- [ ] Kimi

### Channels
- [ ] Telegram
- [ ] Discord
- [ ] Slack
- [ ] Signal

### Storage
- Status: ✓ Healthy
- Memory entries: 0
- Sessions: 0

## Recent Activity

*No activity yet*

## Configuration

Heartbeat enabled: true
Check interval: 30 seconds

---
*Run \`pnpm foxfang status\` for real-time health info.*
`,

  'AGENT.md': `# AGENT — Your FoxFang Agent Configuration

## Agent System

Your FoxFang uses specialist agents to handle different marketing tasks:

### Orchestrator
Routes tasks to the right specialist based on your request.

### Content Specialist
- Drafting content
- Tone enforcement
- Multi-format creation

### Strategy Lead
- Campaign planning
- Research synthesis
- Content calendars

### Growth Analyst
- Quality review
- Optimization suggestions
- Performance analysis

## Agent Communication

Agents can delegate tasks to each other:
\`\`\`
MESSAGE_AGENT: Content Specialist | Draft a post about...
\`\`\`

## Memory System

- **UserPreferences**: Your style, tone, formats
- **WorkingMemory**: Current session context
- **LongTermMemory**: Past work and patterns

## Feedback Loop

1. You review and provide feedback
2. FoxFang extracts improvement signals
3. Memory updates with confidence
4. Future outputs improve

---
*Your agents learn from every interaction.*
`,
};

const FOXFANG_DIR = join(homedir(), '.foxfang');

/**
 * Bootstrap FoxFang home directory with default files
 */
export async function bootstrapFoxFang(): Promise<void> {
  // Create .foxfang directory
  await mkdir(FOXFANG_DIR, { recursive: true });
  
  // Create subdirectories
  await mkdir(join(FOXFANG_DIR, 'memory'), { recursive: true });
  await mkdir(join(FOXFANG_DIR, 'sessions'), { recursive: true });
  await mkdir(join(FOXFANG_DIR, 'workspace'), { recursive: true });
  await mkdir(join(FOXFANG_DIR, 'tools'), { recursive: true });
  
  // Write template files if they don't exist
  for (const [filename, content] of Object.entries(TEMPLATES)) {
    const targetPath = join(FOXFANG_DIR, filename);
    
    if (!existsSync(targetPath)) {
      await writeFile(targetPath, content, 'utf-8');
    }
  }
}

/**
 * Check if FoxFang has been bootstrapped
 */
export function isBootstrapped(): boolean {
  return existsSync(join(FOXFANG_DIR, 'AGENT.md'));
}
