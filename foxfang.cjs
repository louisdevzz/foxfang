#!/usr/bin/env node

// Suppress Node.js warnings (e.g., SQLite experimental)
process.env.NODE_NO_WARNINGS = '1';
process.removeAllListeners('warning');

const nodeModule = require("node:module");
const { dirname, join } = require("node:path");
const { existsSync } = require("node:fs");

const MIN_NODE_MAJOR = 18;
const MIN_NODE_MINOR = 0;
const MIN_NODE_VERSION = `${MIN_NODE_MAJOR}.${MIN_NODE_MINOR}`;

const parseNodeVersion = (rawVersion) => {
  const [majorRaw = "0", minorRaw = "0"] = rawVersion.split(".");
  return {
    major: Number(majorRaw),
    minor: Number(minorRaw),
  };
};

const isSupportedNodeVersion = (version) =>
  version.major > MIN_NODE_MAJOR ||
  (version.major === MIN_NODE_MAJOR && version.minor >= MIN_NODE_MINOR);

const ensureSupportedNodeVersion = () => {
  if (isSupportedNodeVersion(parseNodeVersion(process.versions.node))) {
    return;
  }

  process.stderr.write(
    `foxfang: Node.js v${MIN_NODE_VERSION}+ is required (current: v${process.versions.node}).\n` +
      "If you use nvm, run:\n" +
      `  nvm install ${MIN_NODE_MAJOR}\n` +
      `  nvm use ${MIN_NODE_MAJOR}\n` +
      `  nvm alias default ${MIN_NODE_MAJOR}\n`,
  );
  process.exit(1);
};

ensureSupportedNodeVersion();

// Enable compile cache for faster startup
if (nodeModule.enableCompileCache && !process.env.NODE_DISABLE_COMPILE_CACHE) {
  try {
    nodeModule.enableCompileCache();
  } catch {
    // Ignore errors
  }
}

// Check for dist version first (production), then src (development)
const entryPoints = [
  join(__dirname, "dist", "cli", "entry.js"),
  join(__dirname, "src", "cli", "entry.ts"),
];

let loaded = false;
for (const entry of entryPoints) {
  if (existsSync(entry)) {
    try {
      require(entry);
      loaded = true;
      break;
    } catch (err) {
      if (err.code === "MODULE_NOT_FOUND" || err.code === "ENOENT") {
        continue;
      }
      throw err;
    }
  }
}

if (!loaded) {
  process.stderr.write(
    "foxfang: Failed to load entry point.\n" +
      "Please run: pnpm build\n",
  );
  process.exit(1);
}
