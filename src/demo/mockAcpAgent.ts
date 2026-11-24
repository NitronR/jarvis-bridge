// Scripted mock ACP agent for demo mode (`npm run dev:demo`).
//
// Speaks ACP (newline-delimited JSON-RPC 2.0) over stdio exactly like a real
// agent subprocess, so the gateway drives it through the normal
// AcpAgentBackend path — but every reply comes from the demo config file
// instead of a model: no network, no cost, fully deterministic.
//
//   - Only the first user message of a chat is matched against each
//     scenario's `firstMessage` (case/whitespace-insensitive); a match is
//     answered with `responses[0]`. If it matches nothing, the turn fails with
//     an error listing the trigger messages, and every later message in that
//     chat fails too, telling the user to start a new chat. Failed messages
//     aren't kept, so reloading such a chat shows it empty, and its next
//     message counts as the first one again.
//   - Every later user message gets the next response in order, regardless of
//     what it says. The first message past the last response gets a "no more
//     scripted responses" note; any message after that fails with an error
//     telling the user to start a new chat.
//   - The config is re-read whenever a new chat picks its scenario, so edits
//     apply to the next new chat without restarting the gateway.
//
// Sessions live in memory only: they survive page reloads (session/load
// replays them) but not a gateway restart, so each demo run starts clean.
//
// Run directly: `node dist/demo/mockAcpAgent.js` (reads JARVIS_BRIDGE_DEMO_CONFIG).

import { randomUUID } from "node:crypto";
import readline from "node:readline";
import {
  DEFAULT_DEMO_CONFIG_PATH,
  findScenario,
  loadDemoConfig,
  type DemoConfig,
  type DemoScenario,
  type DemoTiming,
} from "./config";
import { PlaybackCancelledError, playResponse, type AcpUpdateBody } from "./player";

const PROTOCOL_VERSION = 1;
const AGENT_INFO = { name: "jarvis-bridge-demo", title: "Jarvis Bridge demo agent", version: "0.1.0" };

// JSON-RPC error codes.
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;
const RESOURCE_NOT_FOUND = -32002; // ACP
const NO_SCENARIO = -32000; // implementation-defined server errors
const SCENARIO_ENDED = -32001;

class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

interface DemoSession {
  id: string;
  cwd: string;
  title?: string;
  updatedAt: string;
  scenario: DemoScenario | null;
  // The first message matched no scenario, so later messages are refused
  // until the chat is reloaded (which shows it empty again; see session/load).
  matchFailed: boolean;
  timing: DemoTiming;
  // Index into scenario.responses of the next response to play.
  nextResponse: number;
  // The "no more scripted responses" note was sent; later messages are errors.
  ended: boolean;
  // Every update sent for this session, replayed on session/load.
  history: AcpUpdateBody[];
  // Set while a prompt is playing; aborted by session/cancel.
  turn: AbortController | null;
}

export interface MockAcpAgentOptions {
  configPath: string;
  // Write one serialized JSON-RPC message (no trailing newline).
  write(line: string): void;
  // Optional pre-loaded config (skips the initial disk read).
  config?: DemoConfig;
}

export class MockAcpAgent {
  private sessions = new Map<string, DemoSession>();
  private pendingRequests = new Map<string, (result: unknown) => void>();
  private nextRequestId = 1;
  private nextToolCallId = 1;
  private config: DemoConfig | null;

  constructor(private readonly opts: MockAcpAgentOptions) {
    this.config = opts.config ?? null;
  }

  handleLine(line: string): void {
    let msg: { id?: string | number; method?: unknown; params?: unknown; result?: unknown; error?: unknown };
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object") return;

    if (typeof msg.method !== "string") {
      // Response to one of our own requests (elicitation/create).
      if (msg.id === undefined) return;
      const resolve = this.pendingRequests.get(String(msg.id));
      if (!resolve) return;
      this.pendingRequests.delete(String(msg.id));
      resolve(msg.error ? { action: "cancel" } : msg.result);
      return;
    }

    const method = msg.method;
    const params = (msg.params ?? {}) as Record<string, unknown>;
    if (msg.id === undefined) {
      this.handleNotification(method, params);
      return;
    }
    const id = msg.id;
    Promise.resolve()
      .then(() => this.handleRequest(method, params))
      .then(
        (result) => this.send({ jsonrpc: "2.0", id, result }),
        (err: unknown) => {
          const code = err instanceof RpcError ? err.code : INTERNAL_ERROR;
          const message = err instanceof Error ? err.message : String(err);
          this.send({ jsonrpc: "2.0", id, error: { code, message } });
        },
      );
  }

  // Cancel any in-flight turns (stdin closed / shutdown).
  shutdown(): void {
    for (const s of this.sessions.values()) s.turn?.abort();
    for (const resolve of this.pendingRequests.values()) resolve({ action: "cancel" });
    this.pendingRequests.clear();
  }

  private async handleRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      case "initialize":
        if (!this.config) this.config = await loadDemoConfig(this.opts.configPath);
        return {
          protocolVersion: PROTOCOL_VERSION,
          agentCapabilities: {
            loadSession: true,
            promptCapabilities: { image: false, audio: false, embeddedContext: false },
            sessionCapabilities: { list: {}, delete: {} },
          },
          agentInfo: AGENT_INFO,
          authMethods: [],
        };
      case "session/new": {
        const session: DemoSession = {
          id: randomUUID(),
          cwd: typeof params.cwd === "string" ? params.cwd : process.cwd(),
          updatedAt: new Date().toISOString(),
          scenario: null,
          matchFailed: false,
          timing: this.requireConfig().timing,
          nextResponse: 0,
          ended: false,
          history: [],
          turn: null,
        };
        this.sessions.set(session.id, session);
        return { sessionId: session.id };
      }
      case "session/load": {
        const session = this.requireSession(params.sessionId);
        // Failed turns aren't recorded, so a chat whose first message matched
        // nothing reloads empty. Its next message is then the first one the
        // user sees, so let it pick a scenario.
        session.matchFailed = false;
        // Per ACP, history streams back as notifications while the request is
        // still in flight — the gateway captures them into the transcript.
        for (const update of session.history) this.notifyUpdate(session.id, update);
        return {};
      }
      case "session/list":
        return {
          sessions: [...this.sessions.values()]
            .filter((s) => s.title !== undefined)
            .map((s) => ({ sessionId: s.id, cwd: s.cwd, title: s.title, updatedAt: s.updatedAt })),
        };
      case "session/delete": {
        const session = this.requireSession(params.sessionId);
        session.turn?.abort();
        this.sessions.delete(session.id);
        return {};
      }
      case "session/prompt":
        return this.prompt(this.requireSession(params.sessionId), params.prompt);
      default:
        throw new RpcError(METHOD_NOT_FOUND, `Method not found: ${method}`);
    }
  }

  private handleNotification(method: string, params: Record<string, unknown>): void {
    if (method === "session/cancel" && typeof params.sessionId === "string") {
      this.sessions.get(params.sessionId)?.turn?.abort();
    }
  }

  private async prompt(session: DemoSession, prompt: unknown): Promise<{ stopReason: string }> {
    if (session.turn) throw new RpcError(INVALID_PARAMS, "session is busy");
    const text = promptText(prompt);
    const turn = new AbortController();
    session.turn = turn;
    try {
      // Failed turns below are JSON-RPC errors, which the UI shows like any
      // other agent error. Nothing is recorded for them: errors aren't replayed
      // on session/load, and a recorded user message with no reply would be
      // merged into the next one there.
      if (session.matchFailed) {
        throw new RpcError(NO_SCENARIO, noScenarioInChatMessage(this.requireConfig()));
      }
      if (!session.scenario) {
        // Re-read on every scenario pick so config edits land in the next new
        // chat without a restart. A broken edit surfaces as this turn's error
        // and doesn't count as the first message, so a fixed file can be
        // retried in the same chat.
        const config = await loadDemoConfig(this.opts.configPath);
        this.config = config;
        const scenario = findScenario(config, text);
        if (!scenario) {
          session.matchFailed = true;
          throw new RpcError(NO_SCENARIO, noMatchMessage(config, text));
        }
        session.scenario = scenario;
        session.timing = config.timing;
      }
      const scenario = session.scenario;
      if (session.ended) {
        throw new RpcError(SCENARIO_ENDED, scenarioEndedMessage(scenario, this.requireConfig()));
      }
      session.title ??= text.trim().slice(0, 80) || "Demo chat";
      this.record(session, { sessionUpdate: "user_message_chunk", content: { type: "text", text } });
      const response = scenario.responses[session.nextResponse];
      if (!response) {
        // The first message past the script gets a note in the transcript;
        // anything after that is an error (above).
        session.ended = true;
        this.sayText(session, exhaustedText(scenario));
        return { stopReason: "end_turn" };
      }
      session.nextResponse++;
      await playResponse(response, {
        io: {
          sendUpdate: (update) => this.record(session, update),
          request: (method, p) => this.request(method, { sessionId: session.id, ...p }),
        },
        timing: session.timing,
        signal: turn.signal,
        newToolCallId: () => `demo-tool-${this.nextToolCallId++}`,
      });
      return { stopReason: "end_turn" };
    } catch (err) {
      if (err instanceof PlaybackCancelledError) return { stopReason: "cancelled" };
      throw err;
    } finally {
      session.turn = null;
      session.updatedAt = new Date().toISOString();
    }
  }

  private sayText(session: DemoSession, text: string): void {
    this.record(session, { sessionUpdate: "agent_message_chunk", content: { type: "text", text } });
  }

  private record(session: DemoSession, update: AcpUpdateBody): void {
    session.history.push(update);
    // The user's own message is only replayed, never echoed live.
    if (update.sessionUpdate !== "user_message_chunk") this.notifyUpdate(session.id, update);
  }

  private notifyUpdate(sessionId: string, update: AcpUpdateBody): void {
    this.send({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update } });
  }

  private request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = `demo-req-${this.nextRequestId++}`;
    return new Promise((resolve) => {
      this.pendingRequests.set(id, resolve);
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  private requireSession(sessionId: unknown): DemoSession {
    const session = typeof sessionId === "string" ? this.sessions.get(sessionId) : undefined;
    if (!session) throw new RpcError(RESOURCE_NOT_FOUND, `Resource not found: ${String(sessionId)}`);
    return session;
  }

  private requireConfig(): DemoConfig {
    if (!this.config) throw new RpcError(INTERNAL_ERROR, "demo config not loaded (initialize first)");
    return this.config;
  }

  private send(msg: unknown): void {
    this.opts.write(JSON.stringify(msg));
  }
}

function promptText(prompt: unknown): string {
  if (!Array.isArray(prompt)) return "";
  return prompt
    .map((b) => (b && typeof b === "object" && (b as { type?: unknown }).type === "text" ? String((b as { text?: unknown }).text ?? "") : ""))
    .join("");
}

// One line of plain text: the chat's error box renders neither markdown nor
// line breaks.
function noMatchMessage(config: DemoConfig, message: string): string {
  return `Demo mode: no scenario matches "${message.trim()}". ${startNewChatHint(config)}`;
}

function noScenarioInChatMessage(config: DemoConfig): string {
  return `Demo mode: this chat's first message didn't match a scenario, so it can't run one. ${startNewChatHint(config)}`;
}

function scenarioEndedMessage(scenario: DemoScenario, config: DemoConfig): string {
  return `Demo mode: scenario "${scenario.name}" has ended, so this chat has no more responses. ${startNewChatHint(config)}`;
}

function startNewChatHint(config: DemoConfig): string {
  const triggers = config.scenarios.map((s) => `"${s.firstMessage}" (${s.name})`).join(", ");
  return `Start a new chat and send one of these as its first message: ${triggers}.`;
}

function exhaustedText(scenario: DemoScenario): string {
  const n = scenario.responses.length;
  return `**Demo mode:** scenario **${scenario.name}** has no more scripted responses (it has ${n}). Start a new chat to run it again.`;
}

// ── Process entry point ──────────────────────────────────────────────────

function main(): void {
  const configPath = process.env.JARVIS_BRIDGE_DEMO_CONFIG || DEFAULT_DEMO_CONFIG_PATH;
  const agent = new MockAcpAgent({
    configPath,
    write: (line) => process.stdout.write(line + "\n"),
  });
  const rl = readline.createInterface({ input: process.stdin });
  rl.on("line", (line) => agent.handleLine(line));
  rl.on("close", () => {
    agent.shutdown();
    process.exit(0);
  });
}

if (require.main === module) main();
