/**
 * Brand Management Tools
 * 
 * Tools for creating and managing brands.
 */

import { Tool, ToolCategory } from '../traits';
import { run, queryOne } from '../../database/sqlite';
import { randomUUID } from 'crypto';

export class CreateBrandTool implements Tool {
  name = 'create_brand';
  description = 'Create a new brand with BRAND.md. Use when user wants to set up a new brand or company.';
  category = ToolCategory.DATA;
  parameters = {
    type: 'object' as const,
    properties: {
      name: { type: 'string', description: 'Brand/company name' },
      description: { type: 'string', description: 'What the brand does' },
      industry: { type: 'string', description: 'Industry (e.g., coffee, tech, fashion)' },
      target_audience: { type: 'string', description: 'Who the brand serves' },
      tone: { type: 'string', description: 'Brand voice (professional, casual, witty, etc.)' },
      key_values: { type: 'string', description: 'Core brand values' },
    },
    required: ['name', 'description'],
  };

  async execute(args: {
    name: string;
    description: string;
    industry?: string;
    target_audience?: string;
    tone?: string;
    key_values?: string;
  }): Promise<{ brand_id: string; message: string }> {
    const brandId = randomUUID();
    
    const brandProfile = {
      name: args.name,
      description: args.description,
      industry: args.industry || 'general',
      target_audience: args.target_audience || '',
      tone: args.tone || 'professional',
      key_values: args.key_values || '',
    };

    const brandMdContent = generateBrandMd(args);

    run(
      `INSERT INTO brands (id, name, description, industry, brand_profile, brand_md_content) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        brandId,
        args.name,
        args.description,
        args.industry || null,
        JSON.stringify(brandProfile),
        brandMdContent,
      ]
    );

    return {
      brand_id: brandId,
      message: `Created brand "${args.name}" with BRAND.md. You can now create projects under this brand.`,
    };
  }
}

export class ListBrandsTool implements Tool {
  name = 'list_brands';
  description = 'List all brands for the user';
  category = ToolCategory.DATA;
  parameters = {
    type: 'object' as const,
    properties: {},
    required: [],
  };

  async execute(): Promise<{ brands: Array<{ id: string; name: string; description: string }> }> {
    const brands = run(
      `SELECT id, name, description FROM brands WHERE user_id = 'default_user' AND status = 'active'`
    );

    return { brands: brands as any };
  }
}

export class GetBrandTool implements Tool {
  name = 'get_brand';
  description = 'Get brand details including BRAND.md content';
  category = ToolCategory.DATA;
  parameters = {
    type: 'object' as const,
    properties: {
      brand_id: { type: 'string', description: 'Brand ID' },
    },
    required: ['brand_id'],
  };

  async execute(args: { brand_id: string }): Promise<any> {
    const brand = queryOne<any>(
      `SELECT * FROM brands WHERE id = ? AND user_id = 'default_user'`,
      [args.brand_id]
    );

    if (!brand) {
      return { error: 'Brand not found' };
    }

    return {
      id: brand.id,
      name: brand.name,
      description: brand.description,
      industry: brand.industry,
      brand_profile: brand.brand_profile ? JSON.parse(brand.brand_profile) : null,
      brand_md: brand.brand_md_content,
    };
  }
}

function generateBrandMd(args: {
  name: string;
  description: string;
  industry?: string;
  target_audience?: string;
  tone?: string;
  key_values?: string;
}): string {
  return `# ${args.name} - Brand Guide

## Overview
${args.description}

${args.industry ? `**Industry:** ${args.industry}` : ''}

## Target Audience
${args.target_audience || 'Define your target audience here'}

## Voice & Tone
**Primary Tone:** ${args.tone || 'professional'}

Our brand communicates in a ${args.tone || 'professional'} manner that resonates with our audience.

## Key Values
${args.key_values || '- Add your core values here\n- What your brand stands for'}

## Content Guidelines

### Do
- Stay true to brand voice
- Focus on audience value
- Be authentic and transparent
- Use clear, concise language

### Don't
- Use jargon or buzzwords
- Copy competitor messaging
- Be overly promotional
- Deviate from brand values

## Messaging Framework

### For Awareness
- Focus on the problem we solve
- Use educational content
- Build trust through expertise

### For Consideration
- Highlight unique benefits
- Share customer stories
- Compare with alternatives

### For Conversion
- Clear CTAs
- Address objections
- Create urgency appropriately

---
*This BRAND.md was created by FoxFang. Update as your brand evolves.*
`;
}
