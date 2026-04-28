---
summary: "CLI reference for `foxfang uninstall` (remove gateway service + local data)"
read_when:
  - You want to remove the gateway service and/or local state
  - You want a dry-run first
title: "uninstall"
---

# `foxfang uninstall`

Uninstall the gateway service + local data (CLI remains).

```bash
foxfang backup create
foxfang uninstall
foxfang uninstall --all --yes
foxfang uninstall --dry-run
```

Run `foxfang backup create` first if you want a restorable snapshot before removing state or workspaces.
