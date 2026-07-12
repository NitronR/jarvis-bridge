# 07 — Tools & MCP

## Workspace-scoped file tools

The gateway exposes a small registry of tools, all **scoped to the workspace** so the agent (or an
external caller) cannot read/write outside it.

### Types — `src/types.ts`

```ts
interface ReadFileParams { path: string; encoding?: BufferEncoding; }
interface WriteFileParams { path: string; content: string; }
type ToolResult = string | void;
type ToolHandler = (params: unknown) => Promise<ToolResult>;
```

### Registry — `src/tools/index.ts`

```ts
function createToolRegistry(workspace: string): Map<string, ToolHandler>;
```

Registers `read_file` and `write_file`, each closing over the workspace path.

### Path-traversal guard — `src/tools/readFile.ts`, `writeFile.ts`

```ts
function isPathInWorkspace(workspace: string, requestedPath: string): boolean {
  const resolved = path.resolve(workspace, requestedPath);
  const rel = path.relative(workspace, resolved);
  return !rel.startsWith("..") && !path.isAbsolute(rel);
}
```

Both tools throw `Path outside workspace: <p>` on violation.

- `read_file({ path, encoding = "utf-8" })` → file contents (string).
- `write_file({ path, content })` → `mkdir -p` the parent dir, then write UTF-8.

### HTTP surface

`POST /tools/execute` with `{ tool, params }` looks up the handler and returns `{ ok: true, result }`
(or `{ ok: true }` for void). `404` unknown tool; `400` for path-outside-workspace / ENOENT.

### Adding a tool

1. Create `src/tools/myTool.ts` implementing `(params: unknown) => Promise<ToolResult>` (validate
   `params` with Zod).
2. Register it in `createToolRegistry`.
3. (Optional) expose it via MCP — see below.

> These are the gateway's *own* tools. The ACP agent has its own internal toolset; tool calls the
> agent makes are surfaced to the UI as `ChatPatch`es and gated by the approval flow
> ([02-acp-backend.md](02-acp-backend.md)). The two toolsets are independent.

## Optional MCP server — `src/mcp-server.ts`

A standalone **stdio MCP server** that exposes gateway functionality as MCP tools, so MCP-aware
clients can drive the gateway. It is entirely optional and can be skipped.

Key design point: **the MCP server is a thin HTTP client of the running gateway**, not an in-process
integration. It just proxies to gateway endpoints.

- `GATEWAY_URL` from env (default `http://localhost:3001`). A `gatewayFetch(path, opts)` helper wraps
  `fetch` with JSON headers. Helpers shape MCP `textResult` / `errorResult` responses.
- Create an `McpServer` (from `@modelcontextprotocol/sdk`), register tools, and connect a
  `StdioServerTransport`. Send all diagnostics to **stderr** to keep stdout clean for the protocol.
- Run via an `mcp` npm script.

### Built-in tools

With cron removed, the only built-in proxy tool is the optional Slack sender:

- `slack_send_message` → `POST /slack/message` (`channel`, `text`, optional `thread_ts`).

(If you do not need Slack/MCP at all, omit this file entirely.)

### Extensibility pattern (register your own)

Treat the MCP server as the place to add tools that proxy gateway endpoints. For each tool:

```ts
server.registerTool(
  "my_tool",
  {
    description: "What it does",
    inputSchema: { argName: z.string() }, // zod input shape
  },
  async (input) => {
    const res = await gatewayFetch("/some/endpoint", { method: "POST", body: JSON.stringify(input) });
    const data = await res.json();
    return res.ok ? textResult(JSON.stringify(data)) : errorResult(data.error ?? "request failed");
  }
);
```

> Use whichever registration call your installed `@modelcontextprotocol/sdk` version exposes
> (`registerTool({ description, inputSchema }, handler)` in current versions). Keep all diagnostics on
> stderr so stdout stays clean for the protocol.

Good candidates to expose this way: `read_file` / `write_file` (proxy `POST /tools/execute`), session
listing (`GET /chat/sessions`), or workspace status — anything already on the HTTP API.
