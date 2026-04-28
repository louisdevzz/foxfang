---
summary: "CLI reference for `foxfang reset` (reset local state/config)"
read_when:
  - You want to wipe local state while keeping the CLI installed
  - You want a dry-run of what would be removed
title: "reset"
---

# `foxfang reset`

Reset local config/state (keeps the CLI installed).

```bash
foxfang backup create
foxfang reset
foxfang reset --dry-run
foxfang reset --scope config+creds+sessions --yes --non-interactive
```

Run `foxfang backup create` first if you want a restorable snapshot before removing local state.
