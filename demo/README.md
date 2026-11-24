# Demo mode

```bash
npm run dev:demo
```

This runs the gateway with a **scripted mock ACP agent** in place of Claude, opencode or Codex.
Every reply comes from [`demo-config.json`](./demo-config.json), so a demo costs nothing, needs
no agent CLI or login, and plays out the same way every time. That makes it handy for
demos and for manually testing UI flows like the question dialog.

The mock agent (`src/demo/mockAcpAgent.ts`) is a real ACP subprocess speaking JSON-RPC over
stdio. Everything from `AcpAgentBackend` upward (patch mapping, elicitation routing, SSE,
the React UI) runs the same production code it does with a real backend.

Open the app the usual way: `http://localhost:3001` (the built SPA), or run
`npm run dev:web` alongside and use `http://localhost:5173`. `./start.sh --demo` starts both.
If a chat's first message doesn't match a scenario, the chat shows an error (red border)
listing the trigger messages. Start a new chat and send one of them.

## How a conversation plays out

1. The **first message** of a chat is compared with each scenario's `firstMessage`. This is
   the only message that can start a scenario. The comparison ignores case and extra
   whitespace (`"Ask me  a QUESTION"` matches `"ask me a question"`). The matching scenario's
   `responses[0]` is played.
   If nothing matches, the turn fails with an error that lists each scenario's trigger
   message, shown like any other agent error. The chat can't run a scenario after that:
   every later message, even an exact trigger, gets an error telling you to start a new
   chat. Failed messages are left out of the chat history, so reloading the page shows the
   chat empty, and its next message counts as the first message again. (If the first
   message fails because the config file is broken, that doesn't count as a failed match:
   fix the file and send the message again in the same chat.)
2. Each **later message** plays the next entry in `responses`, whatever the message says.
3. After the last response, the next message gets a short "no more scripted responses" note.
   Any message after that gets an error (shown like other agent errors, also after a reload)
   telling you to start a new chat to run this or another scenario.

A response is a list of **parts**, played in order:

- **`text`**: agent text (markdown), streamed a few words at a time.
- **`tool_call`**: a tool call shown in the transcript. It doesn't do anything real: it
  shows as in progress for a moment, then completes with the scripted `output` or fails
  with `error`.
  - **Ask-user tools** (`AskUserQuestion`, or Codex's `request_user_input`) open the
    **question dialog** built from `input.questions`. The reply pauses until the user
    clicks **Submit** or **Skip**, then carries on with the next part. The tool's result
    shows the answers.

Pressing **Stop** cancels the current response. The next message plays the response after it.

## File format

```jsonc
{
  "timing": {                      // optional, all in ms
    "responseDelayMs": 400,        // pause before each response starts
    "textChunkDelayMs": 30,        // pause between streamed text chunks (0 = whole text at once)
    "toolCallDurationMs": 800      // default time a tool call shows as in progress
  },
  "scenarios": [
    {
      "name": "Question dialog",                 // shown in the no-match error
      "description": "Optional one-liner",       // for people reading the file
      "firstMessage": "ask me a question",       // selects this scenario
      "responses": [
        {                                        // reply to the first message
          "parts": [
            { "type": "text", "text": "Let me check something first." },
            {
              "type": "tool_call",
              "name": "Read",                    // tool name
              "title": "Read src/index.ts",      // optional display title (defaults to name)
              "kind": "read",                    // optional ACP tool kind
              "input": { "file_path": "src/index.ts" },
              "output": "file contents…",        // optional result
              "durationMs": 1200                 // optional, overrides timing.toolCallDurationMs
            },
            {
              "type": "tool_call",
              "name": "AskUserQuestion",         // opens the question dialog
              "input": {
                "questions": [
                  {
                    "question": "Which database?",
                    "header": "Database",        // optional short label
                    "options": [                 // omit for a free-text question
                      { "label": "PostgreSQL", "description": "optional" },
                      { "label": "SQLite" }
                    ],
                    "multiSelect": false         // true = checkboxes
                  }
                ]
              }
            },
            { "type": "text", "text": "Thanks!" }
          ]
        },
        { "parts": [ { "type": "text", "text": "Reply to the second message." } ] }
      ]
    }
  ]
}
```

Part reference:

| Part | Field | Notes |
|---|---|---|
| both | `delayMs` | Optional pause before this part starts. |
| `text` | `text` | Markdown. Back-to-back text parts are separated by a blank line. |
| `tool_call` | `name` | Required. `AskUserQuestion` / `request_user_input` (any case or `_` spelling) make it an ask-user tool. |
| | `title` | Display title; defaults to `name`. |
| | `kind` | `read`, `edit`, `delete`, `move`, `search`, `execute`, `think`, `fetch`, `switch_mode`, `other`. |
| | `input` | Any JSON, shown as the tool's arguments. Ask-user tools require `{ "questions": [...] }`. |
| | `output` | Any JSON, shown as the result. Not allowed on ask-user tools. |
| | `status` / `error` | `"failed"` plus error text makes the tool call fail. Not allowed on ask-user tools. |
| | `durationMs` | Time shown as in progress. Ask-user tools wait for the user instead. |

When you add or rename a scenario in the shipped `demo-config.json`, add it to the scenario
table in the [main README](../README.md#demo-mode) too. A test (`src/demo/config.test.ts`)
fails if a scenario is missing from that table.

The file is validated when the gateway starts, and mistakes are reported with their location,
e.g. `scenarios[1].responses[0].parts[2].kind`. Misspelled keys are rejected, not ignored.
The file is also **re-read whenever a new chat picks its scenario**, so edits take effect in
the next new chat without a restart. Chats already in progress keep the version they started with.

## Options

| | |
|---|---|
| `JARVIS_BRIDGE_DEMO_CONFIG=/path/to/file.json` | Use a different scenario file. |
| `PORT=3002` | Run on another port, e.g. next to a real gateway on 3001. Note the Vite dev server proxies to 3001. |
| `JARVIS_BRIDGE_DEMO=true` | Same as `--demo`, e.g. `JARVIS_BRIDGE_DEMO=true npm start` for the compiled build. |

Demo mode ignores `agents.json`. Its settings, session metadata and logs go to
`<JARVIS_BRIDGE_SYSTEM_DIR>/demo/` (default `~/.jarvis-bridge-system/demo/`), so demo chats never
show up in real use. Demo chats live in the mock agent's memory: they survive a page reload
but not a gateway restart, so every demo run starts clean.
