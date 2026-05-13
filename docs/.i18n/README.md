# FoxFang docs i18n assets

This folder stores **generated** and **config** files for documentation translations.

## Files

- `glossary.<lang>.json` — preferred term mappings (used in prompt guidance).
- `<lang>.tm.jsonl` — translation memory (cache) keyed by workflow + model + text hash.

## Glossary format

`glossary.<lang>.json` is an array of entries:

```json
{
  "source": "troubleshooting",
  "target": "故障排除",
  "ignore_case": true,
  "whole_word": false
}
```

Fields:

- `source`: English (or source) phrase to prefer.
- `target`: preferred translation output.

## Notes

- Glossary entries are passed to the model as **prompt guidance** (no deterministic rewrites).
- The translation memory is updated by `scripts/docs-i18n.mjs`.
- Vietnamese docs are generated under `docs/vi-VN/**` from English source docs. The
  pipeline skips generated locale folders such as `docs/zh-CN/**`, `docs/ja-JP/**`,
  and `docs/vi-VN/**`.

## Vietnamese pipeline

Dry-run the source file discovery without calling the translation API:

```bash
pnpm docs:i18n:vi:dry-run
```

Generate Vietnamese docs and update `docs/docs.json` navigation:

```bash
OPENAI_API_KEY=... pnpm docs:i18n:vi
```

Useful narrow runs:

```bash
OPENAI_API_KEY=... pnpm docs:i18n -- --lang vi-VN --write --file concepts/architecture.md
OPENAI_API_KEY=... pnpm docs:i18n -- --lang vi-VN --write --limit 5
```
