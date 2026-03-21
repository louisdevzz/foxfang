# Router, Handoff, Compact Context

## Goal

Move the orchestrator from a "long reasoning + full transcript handoff" pattern to a thin router that only:
- classify request
- select the primary agent
- decide tool and reviewer requirements
- build handoff packet

## Core Components

- Route + handoff + output spec:
  - `src/agents/routing.ts`
- Thin orchestration flow:
  - `src/agents/orchestrator.ts`
- Context assembler:
  - `src/context/assembler.ts`

## Current Behavior

- Keep only up to `4` recent messages in handoff.
- Load session summary instead of full transcript.
- Handoff packet includes:
  - user intent
  - task goal
  - target audience and brand voice
  - constraints
  - key facts
  - expected output
- Output spec is normalized by format and length.

## Benefits

- Reduces context noise.
- Preserves enough task brief detail to keep output quality high.
- Reduces unnecessary agent hops in the default flow.
