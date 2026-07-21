#!/usr/bin/env node
// npx entry point (`npx github:<owner>/jarvis_bridge`). Lazily builds
// dist/ and public/ if they're missing (a fresh git/npx checkout has
// neither — devDependencies like typescript/vite are present since npm
// installs them by default), runs the same idempotent setup as
// `npm run setup`, then starts the built gateway.

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const REPO_ROOT = path.join(__dirname, "..");
const distEntry = path.join(REPO_ROOT, "dist", "index.js");
const publicIndex = path.join(REPO_ROOT, "public", "index.html");

if (!fs.existsSync(distEntry) || !fs.existsSync(publicIndex)) {
  execFileSync("npm", ["run", "build"], { cwd: REPO_ROOT, stdio: "inherit" });
  execFileSync("npm", ["run", "build:web"], { cwd: REPO_ROOT, stdio: "inherit" });
}

const { runSetup } = require("../scripts/setup");

runSetup();
require(distEntry);
