#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const I18N_DIR = path.join(ROOT, "docs", ".i18n");

function normalizeSlashes(value) {
  return value.replace(/\\/g, "/");
}

function fail(message) {
  console.error(`docs:check-i18n-glossary: ${message}`);
  process.exitCode = 1;
}

if (!fs.existsSync(I18N_DIR)) {
  fail("missing docs/.i18n directory");
  process.exit();
}

const files = fs.readdirSync(I18N_DIR).toSorted();
const glossaryFiles = files.filter((file) => /^glossary\.[^.]+(?:-[^.]+)?\.json$/.test(file));

if (glossaryFiles.length === 0) {
  fail("no glossary.<lang>.json files found");
}

for (const file of glossaryFiles) {
  const lang = file.replace(/^glossary\./, "").replace(/\.json$/, "");
  const filePath = path.join(I18N_DIR, file);
  let entries;
  try {
    entries = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    fail(`${normalizeSlashes(path.relative(ROOT, filePath))} is not valid JSON: ${error.message}`);
    continue;
  }

  if (!Array.isArray(entries)) {
    fail(`${normalizeSlashes(path.relative(ROOT, filePath))} must contain an array`);
    continue;
  }

  const seenSources = new Set();
  for (const [index, entry] of entries.entries()) {
    const location = `${normalizeSlashes(path.relative(ROOT, filePath))}[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      fail(`${location} must be an object`);
      continue;
    }
    if (typeof entry.source !== "string" || entry.source.trim() === "") {
      fail(`${location}.source must be a non-empty string`);
    }
    if (typeof entry.target !== "string" || entry.target.trim() === "") {
      fail(`${location}.target must be a non-empty string`);
    }
    if (entry.ignore_case !== undefined && typeof entry.ignore_case !== "boolean") {
      fail(`${location}.ignore_case must be a boolean when present`);
    }
    if (entry.whole_word !== undefined && typeof entry.whole_word !== "boolean") {
      fail(`${location}.whole_word must be a boolean when present`);
    }
    const sourceKey = entry.source;
    if (seenSources.has(sourceKey)) {
      fail(`${location}.source duplicates another entry in ${file}`);
    }
    seenSources.add(sourceKey);
  }

  const tmPath = path.join(I18N_DIR, `${lang}.tm.jsonl`);
  if (!fs.existsSync(tmPath)) {
    fail(`missing translation memory for ${lang}: docs/.i18n/${lang}.tm.jsonl`);
    continue;
  }
  const tmLines = fs.readFileSync(tmPath, "utf8").split(/\r?\n/);
  for (const [index, line] of tmLines.entries()) {
    if (!line.trim()) {
      continue;
    }
    try {
      const entry = JSON.parse(line);
      if (
        typeof entry.cache_key !== "string" ||
        typeof entry.text_hash !== "string" ||
        typeof entry.text !== "string" ||
        typeof entry.translated !== "string"
      ) {
        fail(`docs/.i18n/${lang}.tm.jsonl:${index + 1} is missing required fields`);
      }
    } catch (error) {
      fail(`docs/.i18n/${lang}.tm.jsonl:${index + 1} is not valid JSON: ${error.message}`);
    }
  }
}

if (process.exitCode) {
  process.exit();
}

console.log(`docs:check-i18n-glossary: checked ${glossaryFiles.length} glossaries`);
