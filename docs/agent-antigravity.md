# Agent Binding Profile — Antigravity (`agent-antigravity.md`)

> **Status:** Confirmed against `antigravity-acp 1.1.0` (bundled `agy` CLI `1.1.19`) via live ACP handshake + probe on 2026-08-23.

This document outlines the Antigravity ACP adapter binding profile, capturing wire shapes, capabilities, and session lifecycle details from a live probe.

---

## 1. Invocation

| Knob | Value |
|---|---|
| `command` / `args` | `agy-acp` (precompiled binary in `~/.local/bin/agy-acp`) or `bunx antigravity-acp@latest` |
| Working dir | passed via `session/new`'s `cwd` |
| Auth | CLI-delegated: uses Google OAuth credentials managed by the `agy` CLI |
| CLI Binary resolution | adapter looks for `agy` on `$PATH` or via `AGY_BIN` environment variable (e.g. `/Users/bhanu-mac/.local/bin/agy`) |

---

## 2. Transport

Newline-delimited JSON-RPC 2.0 over stdio, one JSON object per line. `src/agent/acp/jsonrpc.ts` requires no changes.

---

## 3. Handshake (`initialize`)

**Request:**
```json
{
  "protocolVersion": 1,
  "clientCapabilities": { "elicitation": { "form": {} } },
  "clientInfo": { "name": "jarvis-bridge", "version": "0.1.0" }
}
```

**Response (live probe):**
```json
{
  "protocolVersion": 1,
  "agentInfo": { "name": "Antigravity", "version": "1.1.0" },
  "agentCapabilities": {
    "loadSession": true,
    "promptCapabilities": { "embeddedContext": true },
    "sessionCapabilities": {
      "list": {},
      "delete": {},
      "resume": {},
      "close": {},
      "additionalDirectories": {}
    },
    "auth": { "logout": {} }
  },
  "authMethods": [
    {
      "id": "agy-agent",
      "name": "Google Sign In",
      "description": "Antigravity uses Google OAuth2 credentials managed by the agy CLI. Run `agy` to configure authentication if needed."
    }
  ]
}
```

### Capability Surface

| Capability | Antigravity value | Implication |
|---|---|---|
| `loadSession` | `true` | Resume works across sessions |
| `promptCapabilities.embeddedContext` | `true` | Supports embedded file contexts |
| `sessionCapabilities.delete` | `{}` present | Session deletion supported (`sessionDelete = true`) |
| `sessionCapabilities.list` | `{}` present | Session listing supported |
| `sessionCapabilities.resume` | `{}` present | Resume supported |

---

## 4. Session Lifecycle & Config

### `session/new`

**Request:**
```json
{
  "cwd": "/path/to/workspace",
  "mcpServers": []
}
```

**Response:**
```json
{
  "sessionId": "d6a63952-c72c-4c70-ac3a-e11631d6bff2",
  "configOptions": [
    {
      "id": "mode",
      "name": "Mode",
      "category": "mode",
      "type": "select",
      "currentValue": "default",
      "options": [
        { "value": "default", "name": "Standard", "description": "Antigravity's standard mode" },
        { "value": "plan", "name": "Plan Mode", "description": "Read-only exploration: agent may only read and search, then returns a step-by-step plan without making any changes" },
        { "value": "bypassPermissions", "name": "Skip Permissions", "description": "Run without permission prompts — use with caution, as this may allow the agent to make changes without confirmation" }
      ]
    }
  ]
}
```

### Turn Stream (`session/prompt`)

During a prompt turn, the adapter streams:
1. `session/update` (`sessionUpdate: "available_commands_update"`) advertising available slash commands (`/goal`, `/schedule`, `/grill-me`, `/teamwork-preview`, `/learn`, `/usage`).
2. `session/update` (`sessionUpdate: "config_option_update"`) with available models (e.g. Gemini 3.7 Flash High/Medium/Low, Gemini 3.6, Gemini 3.5, Gemini 3.1 Pro, Claude Sonnet 4.6, Claude Opus 4.6, GPT-OSS 120B).
3. `session/update` (`sessionUpdate: "session_info_update"`) with auto-generated session title.
4. `session/update` (`sessionUpdate: "agent_message_chunk"`) with text tokens.
5. Final response: `{ "stopReason": "end_turn" }`.

---

## 5. Configuration Profile

In `~/.jarvis-bridge-system/config/agents.json`:

```json
{
  "name": "antigravity",
  "kind": "antigravity-acp",
  "command": "agy-acp",
  "args": [],
  "env": {
    "AGY_BIN": "/Users/bhanu-mac/.local/bin/agy"
  }
}
```
