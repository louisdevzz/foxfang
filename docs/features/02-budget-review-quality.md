# Budget, Reviewer, Quality Floor

## Token Budget

- File: `src/agents/budget.ts`
- Budget is defined by agent role and reasoning mode:
  - `orchestrator`
  - `content-specialist`
  - `strategy-lead`
  - `growth-analyst`
- Runtime trims message history to fit input budget.

## Reviewer Flow

- File: `src/agents/orchestrator.ts`
- Reviewer returns a short structured JSON critique:
  - `verdict`
  - `issues`
  - `strengths`
  - `recommendedEdits`
- Rewrite only runs when `verdict=revise` and concrete edits are provided.

## Quality Floor

- Before returning final output, run a quality check for:
  - goal match
  - specificity
  - actionable content
  - generic/too-short detection
- If it fails, run a short mini-fix pass instead of expanding into a long review chain.

## Status

- Per-agent budget: done.
- Request-global hard cap: partial.
