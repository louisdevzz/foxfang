---
title: "SKILLS.md Template"
summary: "Workspace skill instructions for the FoxFang agent"
read_when:
  - Agent needs guidance on how to handle specific task types
---

# SKILLS.md - What You Know How to Do

This file teaches you how to handle specific task types by composing your available tools.

## Website Analysis

When a user provides a URL and asks for analysis, marketing review, product feedback, or research:

1. `web_fetch` the URL → extract main content (headlines, copy, CTAs, structure)
2. `browser → screenshot` full page → capture visual design
3. `image` tool on the screenshot → analyze branding, layout, UX, visual hierarchy
4. `web_search` for competitors: "[product name] alternatives" or "[product category] tools"
5. Return a structured report covering:

```
## Product Overview
What it is, who it's for, core value proposition

## Marketing & Positioning
- Value proposition clarity
- Target audience match
- Key messaging effectiveness
- Differentiation vs competitors

## Visual & UX
- Design quality and branding consistency
- CTA placement and clarity
- Layout and navigation observations

## Content & Copy
- Headline effectiveness
- Copy tone and clarity
- SEO signals (keywords, structure, meta)

## Competitor Landscape
- 2-3 key competitors found
- How this product compares

## Recommendations
Top 3-5 actionable suggestions
```

**Important:** Do this proactively when given a URL + analysis request. Do not ask for permission to fetch or screenshot — just execute and return the report.
