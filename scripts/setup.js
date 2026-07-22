#!/usr/bin/env node
// One-time (idempotent) setup: migrates any pre-existing state into the
// ~/.jarvis-bridge-system/ layout, scaffolds agents.json by detecting
// installed backend CLIs on PATH, and copies .env.example -> .env.
// Runs automatically via "postinstall"; re-runnable any time via
// `npm run setup`. No prompts — auto-detect + defaults only, so it's safe
// to run non-interactively (npm ci, CI, Docker builds, npx installs).

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const REPO_ROOT = path.join(__dirname, "..");

function expandHome(p) {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

function resolvePaths(env) {
  env = env || {};
  const workspace = expandHome(env.JARVIS_BRIDGE_WORKSPACE || "~/.jarvis-bridge");
  const systemDir = expandHome(env.JARVIS_BRIDGE_SYSTEM_DIR || "~/.jarvis-bridge-system");
  const configDir = path.join(systemDir, "config");
  return {
    workspace,
    systemDir,
    configDir,
    agentsJsonPath: path.join(configDir, "agents.json"),
    settingsJsonPath: path.join(systemDir, "settings.json"),
    sessionMetaPath: path.join(systemDir, "session_metadata.json"),
  };
}

function ensureDirs(p) {
  fs.mkdirSync(p.workspace, { recursive: true });
  fs.mkdirSync(p.configDir, { recursive: true });
}

// Moves `from` to `to` only if `from` exists and `to` doesn't yet, so it
// never clobbers state already migrated (or created fresh) in the new
// location, and is safe to call on every run.
function migrateFile(from, to, log) {
  if (fs.existsSync(from) && !fs.existsSync(to)) {
    try {
      fs.renameSync(from, to);
    } catch (err) {
      if (err && err.code === "EXDEV") {
        // renameSync can't cross filesystem/mount boundaries (e.g. workspace
        // and system dir overridden onto different Docker volume mounts).
        // Fall back to copy-then-delete, which achieves the same "moved,
        // not duplicated" semantics across filesystems.
        fs.copyFileSync(from, to);
        fs.unlinkSync(from);
      } else {
        throw err;
      }
    }
    log(`migrated ${from} -> ${to}`);
    return true;
  }
  return false;
}

function migrateOldState(p, repoRoot, log) {
  migrateFile(path.join(p.workspace, "settings.json"), p.settingsJsonPath, log);
  migrateFile(path.join(p.workspace, "session_metadata.json"), p.sessionMetaPath, log);
  migrateFile(path.join(repoRoot, "agents.json"), p.agentsJsonPath, log);
}

// Known backend CLIs setup can auto-detect. `detectBinary` is the
// executable checked for on PATH; `profile` is what gets written into
// agents.json when it's found.
const KNOWN_BACKENDS = [
  {
    detectBinary: "opencode",
    profile: { name: "opencode", kind: "opencode", command: "opencode", args: ["acp"], env: {} },
  },
  {
    detectBinary: "claude",
    profile: {
      name: "claude",
      kind: "claude-acp",
      command: "npx",
      args: ["-y", "@agentclientprotocol/claude-agent-acp@latest"],
      env: {},
    },
  },
];

function findOnPath(binName, pathEnv) {
  const dirs = String(pathEnv || "").split(path.delimiter).filter(Boolean);
  const exts = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, binName + ext);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {
        // not here, keep looking
      }
    }
  }
  return null;
}

function detectBackends(pathEnv) {
  const effective = pathEnv === undefined ? process.env.PATH : pathEnv;
  return KNOWN_BACKENDS.filter((b) => findOnPath(b.detectBinary, effective) !== null).map(
    (b) => b.profile,
  );
}

function ensureAgentsJson(p, repoRoot, pathEnv, log) {
  if (fs.existsSync(p.agentsJsonPath)) return { created: false, detected: [] };
  const detected = detectBackends(pathEnv);
  if (detected.length > 0) {
    fs.writeFileSync(p.agentsJsonPath, JSON.stringify({ backends: detected }, null, 2) + "\n", "utf8");
    log(`wrote ${p.agentsJsonPath} (auto-detected: ${detected.map((d) => d.name).join(", ")})`);
    return { created: true, detected };
  }
  const examplePath = path.join(repoRoot, "agents.json.example");
  fs.copyFileSync(examplePath, p.agentsJsonPath);
  log(`wrote ${p.agentsJsonPath} from agents.json.example — no known backend CLI found on PATH, edit it by hand`);
  return { created: true, detected: [] };
}

function ensureEnvFile(repoRoot, log) {
  const envPath = path.join(repoRoot, ".env");
  const examplePath = path.join(repoRoot, ".env.example");
  if (fs.existsSync(envPath)) return false;
  fs.copyFileSync(examplePath, envPath);
  log(`wrote ${envPath} from .env.example`);
  return true;
}

function runSetup(env, log, repoRoot) {
  env = env || process.env;
  log = log || console.log;
  repoRoot = repoRoot || REPO_ROOT;

  const p = resolvePaths(env);
  ensureDirs(p);
  migrateOldState(p, repoRoot, log);
  const agentsResult = ensureAgentsJson(p, repoRoot, env.PATH, log);
  ensureEnvFile(repoRoot, log);

  log("[jarvis-bridge setup] done.");
  if (agentsResult.created && agentsResult.detected.length === 0) {
    log(`[jarvis-bridge setup] edit ${p.agentsJsonPath} before running npm run dev.`);
  } else {
    log("[jarvis-bridge setup] run `npm run dev` to start the gateway.");
  }
  return p;
}

module.exports = {
  expandHome,
  resolvePaths,
  ensureDirs,
  migrateFile,
  migrateOldState,
  findOnPath,
  detectBackends,
  ensureAgentsJson,
  ensureEnvFile,
  runSetup,
  KNOWN_BACKENDS,
};

if (require.main === module) {
  try {
    runSetup();
  } catch (err) {
    process.stderr.write(`[jarvis-bridge setup] failed: ${err && err.stack ? err.stack : err}\n`);
    process.exit(1);
  }
}
