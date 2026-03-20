#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const srcHtml = path.join(projectRoot, 'src', 'web', 'setup', 'setup-page.html');
const distDir = path.join(projectRoot, 'dist', 'daemon');
const distHtml = path.join(distDir, 'setup-page.html');

if (!fs.existsSync(srcHtml)) {
  console.error(`[copy-static] Missing source file: ${srcHtml}`);
  process.exit(1);
}

fs.mkdirSync(distDir, { recursive: true });
fs.copyFileSync(srcHtml, distHtml);

console.log(`[copy-static] Copied setup page to ${distHtml}`);
