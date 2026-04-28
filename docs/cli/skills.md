---
summary: "CLI reference for `foxfang skills` (search/install/update/list/info/check)"
read_when:
  - You want to see which skills are available and ready to run
  - You want to search, install, or update skills from ClawHub
  - You want to debug missing binaries/env/config for skills
title: "skills"
---

# `foxfang skills`

Inspect local skills and install/update skills from ClawHub.

Related:

- Skills system: [Skills](/tools/skills)
- Skills config: [Skills config](/tools/skills-config)
- ClawHub installs: [ClawHub](/tools/clawhub)

## Commands

```bash
foxfang skills search "calendar"
foxfang skills install <slug>
foxfang skills install <slug> --version <version>
foxfang skills update <slug>
foxfang skills update --all
foxfang skills list
foxfang skills list --eligible
foxfang skills info <name>
foxfang skills check
```

`search`/`install`/`update` use ClawHub directly and install into the active
workspace `skills/` directory. `list`/`info`/`check` still inspect the local
skills visible to the current workspace and config.
