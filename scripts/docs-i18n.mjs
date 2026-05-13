#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DEFAULT_LANG = "vi-VN";
const DEFAULT_MODEL = "gpt-5.4-mini";
const WORKFLOW = "docs-i18n-v1";
const TRANSLATED_PREFIXES = ["zh-CN/", "ja-JP/", "vi-VN/"];
const TRANSLATABLE_FRONTMATTER_KEYS = new Set([
  "description",
  "read_when",
  "sidebarTitle",
  "summary",
  "title",
]);
const TRANSLATABLE_MDX_ATTRIBUTES = new Set(["alt", "label", "summary", "title"]);

function parseArgs(argv) {
  const options = {
    apiBase: process.env.FOXFANG_DOCS_I18N_API_BASE ?? "https://api.openai.com/v1",
    concurrency: Number(process.env.FOXFANG_DOCS_I18N_CONCURRENCY ?? 2),
    docsDir: "docs",
    files: [],
    force: false,
    lang: process.env.FOXFANG_DOCS_I18N_LANG ?? DEFAULT_LANG,
    limit: undefined,
    model: process.env.FOXFANG_DOCS_I18N_MODEL ?? DEFAULT_MODEL,
    provider: "openai",
    write: false,
    writeNav: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (!value) {
        throw new Error(`Missing value for ${arg}`);
      }
      return value;
    };

    switch (arg) {
      case "--api-base":
        options.apiBase = next();
        break;
      case "--concurrency":
        options.concurrency = Number(next());
        break;
      case "--docs-dir":
        options.docsDir = next();
        break;
      case "--file":
        options.files.push(normalizeSlashes(next()));
        break;
      case "--force":
        options.force = true;
        break;
      case "--lang":
        options.lang = next();
        break;
      case "--limit":
        options.limit = Number(next());
        break;
      case "--model":
        options.model = next();
        break;
      case "--provider":
        options.provider = next();
        break;
      case "--write":
        options.write = true;
        break;
      case "--write-nav":
        options.writeNav = true;
        break;
      case "--dry-run":
        options.write = false;
        options.writeNav = false;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!Number.isFinite(options.concurrency) || options.concurrency < 1) {
    throw new Error("--concurrency must be a positive number");
  }
  if (options.limit !== undefined && (!Number.isFinite(options.limit) || options.limit < 1)) {
    throw new Error("--limit must be a positive number");
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/docs-i18n.mjs [options]

Generates localized docs with glossary guidance and translation memory.

Options:
  --lang <locale>        Target locale (default: ${DEFAULT_LANG})
  --model <model>        Chat Completions model (default: ${DEFAULT_MODEL})
  --write                Write docs/<locale> files. Without this, dry-run only.
  --write-nav            Add or replace the locale navigation in docs/docs.json.
  --file <path>          Translate one source doc path, repeatable.
  --limit <n>            Translate at most n docs.
  --force                Ignore existing translation memory.
  --concurrency <n>      Translation concurrency (default: 2).
  --api-base <url>       OpenAI-compatible API base.
`);
}

function normalizeSlashes(value) {
  return value.replace(/\\/g, "/");
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function walk(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(full));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

function isSourceDoc(relPath) {
  if (!/\.(md|mdx)$/i.test(relPath)) {
    return false;
  }
  if (relPath.startsWith(".generated/") || relPath.startsWith(".i18n/")) {
    return false;
  }
  return !TRANSLATED_PREFIXES.some((prefix) => relPath.startsWith(prefix));
}

function loadJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function loadGlossary(docsDir, lang) {
  const glossaryPath = path.join(docsDir, ".i18n", `glossary.${lang}.json`);
  const glossary = loadJson(glossaryPath, []);
  if (!Array.isArray(glossary)) {
    throw new Error(`${normalizeSlashes(path.relative(ROOT, glossaryPath))} must be an array`);
  }
  return glossary.filter(
    (entry) =>
      entry &&
      typeof entry === "object" &&
      typeof entry.source === "string" &&
      typeof entry.target === "string",
  );
}

function loadTranslationMemory(tmPath) {
  const byCacheKey = new Map();
  if (!fs.existsSync(tmPath)) {
    return byCacheKey;
  }
  const lines = fs.readFileSync(tmPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    const entry = JSON.parse(line);
    if (typeof entry.cache_key === "string" && typeof entry.translated === "string") {
      byCacheKey.set(entry.cache_key, entry);
    }
  }
  return byCacheKey;
}

function cacheKey({ model, sourceLang, targetLang, text }) {
  const textHash = sha256(text);
  return {
    cacheKey: sha256(`${WORKFLOW}:${model}:${sourceLang}:${targetLang}:${textHash}`),
    textHash,
  };
}

function shouldTranslateText(text) {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  if (!/[A-Za-z]/.test(trimmed)) {
    return false;
  }
  if (/^[-*_]{3,}$/.test(trimmed)) {
    return false;
  }
  if (/^(import|export)\s/.test(trimmed)) {
    return false;
  }
  if (/^<\/?[A-Z][^>]*>$/.test(trimmed) && !TRANSLATABLE_MDX_ATTRIBUTES_REGEX.test(trimmed)) {
    return false;
  }
  return true;
}

const TRANSLATABLE_MDX_ATTRIBUTES_REGEX =
  /\s(?:alt|label|summary|title)=["'][^"']*[A-Za-z][^"']*["']/;

function protectInline(text) {
  const protectedValues = [];
  const add = (value) => {
    const token = `__FOXFANG_I18N_${protectedValues.length}__`;
    protectedValues.push({ token, value });
    return token;
  };

  let out = text
    .replace(/`[^`\n]+`/g, add)
    .replace(
      /(!?\[[^\]]*\]\()([^)]+)(\))/g,
      (_match, open, url, close) => `${open}${add(url)}${close}`,
    )
    .replace(/https?:\/\/[^\s)<]+/g, add)
    .replace(/<(\/?)([a-z][a-z0-9-]*)(\s[^>]*)?>/gi, add);

  return {
    text: out,
    restore(value) {
      let restored = value;
      for (const item of protectedValues) {
        restored = restored.split(item.token).join(item.value);
      }
      return restored;
    },
  };
}

async function translateMdxAttributes(line, translateText) {
  let output = line;
  const matches = [...line.matchAll(/\s([A-Za-z][A-Za-z0-9_-]*)=(["'])(.*?)\2/g)];
  for (const match of matches) {
    const attr = match[1];
    const quote = match[2];
    const value = match[3];
    if (!TRANSLATABLE_MDX_ATTRIBUTES.has(attr) || !shouldTranslateText(value)) {
      continue;
    }
    const translated = await translateText(value);
    output = output.replace(
      `${attr}=${quote}${value}${quote}`,
      `${attr}=${quote}${translated}${quote}`,
    );
  }
  return output;
}

async function translateMarkdownLine(line, translateText) {
  const withTranslatedAttrs = await translateMdxAttributes(line, translateText);
  if (!shouldTranslateText(withTranslatedAttrs)) {
    return withTranslatedAttrs;
  }
  const protectedLine = protectInline(withTranslatedAttrs);
  const translated = await translateText(protectedLine.text);
  return protectedLine.restore(translated);
}

function splitFrontmatter(raw) {
  if (!raw.startsWith("---\n")) {
    return { frontmatter: undefined, body: raw };
  }
  const end = raw.indexOf("\n---", 4);
  if (end === -1) {
    return { frontmatter: undefined, body: raw };
  }
  const afterEnd = raw.indexOf("\n", end + 4);
  const bodyStart = afterEnd === -1 ? raw.length : afterEnd + 1;
  return {
    frontmatter: raw.slice(0, bodyStart),
    body: raw.slice(bodyStart),
  };
}

async function translateFrontmatter(frontmatter, translateText) {
  const lines = frontmatter.split("\n");
  let activeListKey = undefined;
  const translated = [];
  for (const line of lines) {
    const keyMatch = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (keyMatch) {
      activeListKey = keyMatch[1];
      const value = keyMatch[2];
      if (TRANSLATABLE_FRONTMATTER_KEYS.has(activeListKey) && /^["'].*["']$/.test(value.trim())) {
        const quote = value.trim()[0];
        const inner = value.trim().slice(1, -1);
        if (shouldTranslateText(inner)) {
          const translatedInner = await translateText(inner);
          translated.push(`${activeListKey}: ${quote}${translatedInner}${quote}`);
          continue;
        }
      }
      if (TRANSLATABLE_FRONTMATTER_KEYS.has(activeListKey) && shouldTranslateText(value)) {
        translated.push(`${activeListKey}: ${await translateText(value)}`);
        continue;
      }
      translated.push(line);
      continue;
    }

    const listMatch = line.match(/^(\s*-\s+)(.+)$/);
    if (
      listMatch &&
      activeListKey &&
      TRANSLATABLE_FRONTMATTER_KEYS.has(activeListKey) &&
      shouldTranslateText(listMatch[2])
    ) {
      translated.push(`${listMatch[1]}${await translateText(listMatch[2])}`);
      continue;
    }

    translated.push(line);
  }
  return translated.join("\n");
}

async function translateMarkdown(raw, translateText) {
  const { frontmatter, body } = splitFrontmatter(raw);
  const translatedFrontmatter = frontmatter
    ? await translateFrontmatter(frontmatter, translateText)
    : "";
  const lines = body.split("\n");
  const out = [];
  let inFence = false;
  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      inFence = !inFence;
      out.push(line);
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }
    out.push(await translateMarkdownLine(line, translateText));
  }
  return `${translatedFrontmatter}${out.join("\n")}`;
}

function glossaryPrompt(glossary) {
  if (glossary.length === 0) {
    return "No glossary entries.";
  }
  return glossary.map((entry) => `- ${entry.source} => ${entry.target}`).join("\n");
}

async function openAiTranslate({ apiBase, apiKey, glossary, model, targetLang, text }) {
  const response = await fetch(`${apiBase.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        {
          role: "system",
          content: [
            `Translate English documentation text to ${targetLang}.`,
            "Return only the translated text.",
            "Preserve Markdown, MDX placeholders, whitespace, punctuation shape, commands, config keys, URLs, and code identifiers.",
            "Keep product names and technical identifiers unchanged when the glossary says so.",
            "Use natural Vietnamese for prose when target locale is vi-VN.",
            "Glossary:",
            glossaryPrompt(glossary),
          ].join("\n"),
        },
        { role: "user", content: text },
      ],
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Translation API failed (${response.status}): ${detail.slice(0, 500)}`);
  }
  const payload = await response.json();
  const translated = payload?.choices?.[0]?.message?.content;
  if (typeof translated !== "string") {
    throw new Error("Translation API returned no message content");
  }
  return translated.trimEnd();
}

function createTranslator({ glossary, options, tm, tmEntriesToAppend }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (options.write && options.provider === "openai" && !apiKey) {
    throw new Error("OPENAI_API_KEY is required when running with --write and --provider openai");
  }

  return async function translateText(text, sourcePath) {
    if (!shouldTranslateText(text)) {
      return text;
    }
    const { cacheKey: key, textHash } = cacheKey({
      model: options.model,
      sourceLang: "en",
      targetLang: options.lang,
      text,
    });
    if (!options.force && tm.has(key)) {
      return tm.get(key).translated;
    }
    if (!options.write) {
      return text;
    }

    const translated =
      options.provider === "openai"
        ? await openAiTranslate({
            apiBase: options.apiBase,
            apiKey,
            glossary,
            model: options.model,
            targetLang: options.lang,
            text,
          })
        : text;
    const entry = {
      cache_key: key,
      segment_id: `${sourcePath}:${textHash.slice(0, 16)}`,
      source_path: sourcePath,
      text_hash: textHash,
      text,
      translated,
      provider: options.provider,
      model: options.model,
      src_lang: "en",
      tgt_lang: options.lang,
      updated_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    };
    tm.set(key, entry);
    tmEntriesToAppend.push(entry);
    return translated;
  };
}

async function mapLimit(items, limit, fn) {
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = index++;
      await fn(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

function collectSourceDocs(docsDir, options) {
  const all = walk(docsDir)
    .map((absolutePath) => normalizeSlashes(path.relative(docsDir, absolutePath)))
    .filter(isSourceDoc)
    .toSorted();
  const selected =
    options.files.length > 0 ? all.filter((rel) => options.files.includes(rel)) : all;
  return selected.slice(0, options.limit ?? selected.length);
}

async function addLocaleNavigation(docsConfig, lang, translateText) {
  const english = docsConfig.navigation?.languages?.find((item) => item.language === "en");
  if (!english) {
    throw new Error("docs/docs.json does not contain an English navigation language block");
  }
  const localeNav = JSON.parse(JSON.stringify(english));
  localeNav.language = lang;
  prefixPages(localeNav, lang);
  await translateNavigationLabels(localeNav, translateText);
  const withoutExisting = docsConfig.navigation.languages.filter((item) => item.language !== lang);
  docsConfig.navigation.languages = [...withoutExisting, localeNav];
}

function prefixPages(node, lang) {
  if (Array.isArray(node)) {
    for (const item of node) {
      prefixPages(item, lang);
    }
    return;
  }
  if (!node || typeof node !== "object") {
    return;
  }
  if (Array.isArray(node.pages)) {
    node.pages = node.pages.map((page) => {
      if (typeof page === "string") {
        return page.startsWith(`${lang}/`) ? page : `${lang}/${page}`;
      }
      prefixPages(page, lang);
      return page;
    });
  }
  for (const value of Object.values(node)) {
    if (value !== node.pages) {
      prefixPages(value, lang);
    }
  }
}

async function translateNavigationLabels(node, translateText) {
  if (Array.isArray(node)) {
    for (const item of node) {
      await translateNavigationLabels(item, translateText);
    }
    return;
  }
  if (!node || typeof node !== "object") {
    return;
  }
  for (const key of ["group", "tab"]) {
    if (typeof node[key] === "string" && shouldTranslateText(node[key])) {
      node[key] = await translateText(node[key]);
    }
  }
  for (const value of Object.values(node)) {
    await translateNavigationLabels(value, translateText);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const docsDir = path.resolve(ROOT, options.docsDir);
  const i18nDir = path.join(docsDir, ".i18n");
  const tmPath = path.join(i18nDir, `${options.lang}.tm.jsonl`);
  const glossary = loadGlossary(docsDir, options.lang);
  const tm = loadTranslationMemory(tmPath);
  const tmEntriesToAppend = [];
  const sourceDocs = collectSourceDocs(docsDir, options);
  const targetRoot = path.join(docsDir, options.lang);

  const translateText = createTranslator({ glossary, options, tm, tmEntriesToAppend });
  console.log(
    `${options.write ? "Writing" : "Dry run"} ${sourceDocs.length} docs to ${normalizeSlashes(
      path.relative(ROOT, targetRoot),
    )}`,
  );

  await mapLimit(sourceDocs, options.concurrency, async (relPath) => {
    const sourcePath = path.join(docsDir, relPath);
    const targetPath = path.join(targetRoot, relPath);
    const raw = fs.readFileSync(sourcePath, "utf8");
    const translated = await translateMarkdown(raw, (text) => translateText(text, relPath));
    if (options.write) {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, translated, "utf8");
    }
    return { relPath, bytes: Buffer.byteLength(translated) };
  });

  if (options.write && options.writeNav) {
    const docsJsonPath = path.join(docsDir, "docs.json");
    const docsConfig = loadJson(docsJsonPath, {});
    await addLocaleNavigation(docsConfig, options.lang, (text) =>
      translateText(text, "docs.json:navigation"),
    );
    fs.writeFileSync(docsJsonPath, `${JSON.stringify(docsConfig, null, 2)}\n`, "utf8");
  }

  if (options.write && tmEntriesToAppend.length > 0) {
    fs.mkdirSync(i18nDir, { recursive: true });
    fs.appendFileSync(
      tmPath,
      `${tmEntriesToAppend.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
    );
  }

  console.log(
    `Done. translated=${sourceDocs.length} new_tm_entries=${tmEntriesToAppend.length} glossary=${glossary.length}`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
