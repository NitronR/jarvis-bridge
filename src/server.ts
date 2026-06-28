// HTTP gateway. Localhost-only, unauthenticated. Validates request
// bodies with Zod at the boundary; the agent/backend layers stay
// validator-agnostic.

import express, { type Express, type Request, type Response } from "express";
import path from "node:path";
import fs from "node:fs/promises";
import { z } from "zod";
import type { AgentBackend, AgentSession } from "./agent/types";
import type { BackendPool } from "./agent/backendPool";
import type { ToolHandler } from "./types";

export interface CreateServerOptions {
  workspace: string;
  port: number;
  chatBackend: AgentBackend;
  backendPool: BackendPool;
  autoApprove: { default: boolean };
  tools: Map<string, ToolHandler>;
}

// Per-session metadata store (gateway-side; not on the agent).
const sessionMeta: Map<string, SessionMetadata> = new Map();
interface SessionMetadata {
  sessionId: string;
  customTitle?: string;
  pinned?: boolean;
  group?: string;
}

export function createServer(opts: CreateServerOptions): Express {
  const {
    workspace,
    chatBackend,
    backendPool,
    autoApprove,
    tools,
  } = opts;
  chatBackend.setDefaultAutoApprove?.(autoApprove.default);

  const app = express();

  // JSON body limits: chat path is generous (base64 images), others tight.
  const chatJson = express.json({ limit: "40mb" });
  const smallJson = express.json({ limit: "256kb" });

  // ── Health ─────────────────────────────────────────────────────────
  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });
  app.get("/health/agent", async (_req, res) => {
    try {
      const hc = await chatBackend.healthcheck();
      res.json({ agent: hc.ok });
    } catch {
      res.json({ agent: false });
    }
  });

  // ── Chat lifecycle ────────────────────────────────────────────────
  app.get("/chat/init", smallJson, asyncRoute(async (req, res) => {
    const q = InitQuerySchema.parse(req.query);
    const requestedCwd = q.cwd;
    if (requestedCwd) {
      const stat = await fs.stat(requestedCwd).catch(() => null);
      if (!stat?.isDirectory()) {
        res.status(400).json({ error: "cwd is not a directory" });
        return;
      }
    }
    const backend = requestedCwd
      ? await backendPool.getOrCreate(requestedCwd)
      : chatBackend;
    let session: AgentSession;
    let resumed = false;
    if (q.sessionId) {
      const found = await backendPool.getSession(q.sessionId);
      if (found) {
        session = found;
        resumed = true;
      } else if (backend.loadSession) {
        session = await backend.loadSession(q.sessionId);
      } else {
        res.status(404).json({ error: "session not found" });
        return;
      }
    } else {
      session = await backend.createSession();
    }
    const models = backend.getSessionModels?.(session.id) ?? null;
    const slashCommands = session.getSlashCommands
      ? session.getSlashCommands()
      : backend.getSlashCommands
        ? backend.getSlashCommands()
        : [];
    res.json({
      ok: true,
      backend: {
        kind: chatBackend.kind,
        role: chatBackend.role,
        model: models?.current ?? null,
      },
      sessionId: session.id,
      cwd: requestedCwd ?? workspace,
      resumed,
      capabilities: chatBackend.capabilities,
      slashCommands,
      autoApprove: {
        supported: true,
        default: chatBackend.getDefaultAutoApprove?.() ?? false,
        override:
          chatBackend.getSessionAutoApproveOverride?.(session.id) ?? null,
        effective:
          chatBackend.getSessionAutoApproveOverride?.(session.id) ??
          chatBackend.getDefaultAutoApprove?.() ??
          false,
        enabled:
          (chatBackend.getSessionAutoApproveOverride?.(session.id) ??
            chatBackend.getDefaultAutoApprove?.() ??
            false),
      },
      model: models
        ? {
            supported: true,
            available: models.available,
            current: models.current,
          }
        : { supported: false, available: [], current: null },
    });
  }));

  // ── POST /chat/send (SSE) ──────────────────────────────────────────
  app.post("/chat/send", chatJson, asyncRoute(async (req, res) => {
    const body = SendBodySchema.parse(req.body ?? {});
    const sessionId = body.sessionId ?? (await defaultSessionId(backendPool, chatBackend));
    if (!sessionId) {
      res.status(404).json({ error: "no session available" });
      return;
    }
    const session = await backendPool.getSession(sessionId);
    if (!session) {
      res.status(404).json({ error: "session not found" });
      return;
    }
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    const signal = new AbortController();
    req.on("close", () => signal.abort());
    try {
      for await (const patch of session.sendMessage(body.message ?? "", {
        signal: signal.signal,
        images: (body.images ?? []).map((i) => ({
          data: i.data,
          mimeType: i.mimeType,
          filename: i.filename,
        })),
      })) {
        const line = `data: ${JSON.stringify(patch)}\n\n`;
        res.write(line);
        const pt = (patch as { type?: string }).type;
        if (pt === "done" || pt === "error") break;
      }
      // Guarantee the SSE terminator.
      res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
      res.end();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.write(`data: ${JSON.stringify({ type: "error", message })}\n\n`);
      res.end();
    }
  }));

  app.post("/chat/cancel", smallJson, asyncRoute(async (req, res) => {
    const body = CancelBodySchema.parse(req.body ?? {});
    const session = await resolveSession(backendPool, body.sessionId);
    if (session) await session.cancel();
    res.json({ ok: true });
  }));

  app.post("/chat/approval", smallJson, asyncRoute(async (req, res) => {
    const body = ApprovalBodySchema.parse(req.body ?? {});
    const session = await resolveSession(backendPool, body.sessionId);
    if (!session) {
      res.status(404).json({ error: "session not found" });
      return;
    }
    const ok = session.resolveApproval
      ? session.resolveApproval(body.requestId, body.optionId)
      : false;
    if (!ok) {
      res.status(409).json({ error: "no pending approval" });
      return;
    }
    res.json({ ok: true });
  }));

  app.post("/chat/steer", smallJson, asyncRoute(async (req, res) => {
    const body = SteerBodySchema.parse(req.body ?? {});
    const session = await resolveSession(backendPool, body.sessionId);
    if (!session || !session.steer || !chatBackend.capabilities.steer) {
      res.json({ ok: true, accepted: false, reason: "unsupported" });
      return;
    }
    const result = await session.steer(body.prompt);
    res.json({ ok: true, accepted: result.accepted, reason: result.reason });
  }));

  // ── Models ────────────────────────────────────────────────────────
  app.get("/chat/model", smallJson, asyncRoute(async (req, res) => {
    const q = ModelQuerySchema.parse(req.query);
    const session = await resolveSession(backendPool, q.sessionId);
    if (!session) {
      res.status(404).json({ error: "session not found" });
      return;
    }
    const info = chatBackend.getSessionModels?.(session.id);
    if (!info) {
      res.json({ ok: true, supported: false, available: [], current: null });
      return;
    }
    res.json({ ok: true, supported: true, available: info.available, current: info.current });
  }));

  app.post("/chat/model", smallJson, asyncRoute(async (req, res) => {
    const body = ModelPostBodySchema.parse(req.body ?? {});
    const session = await resolveSession(backendPool, body.sessionId);
    if (!session) {
      res.status(404).json({ error: "session not found" });
      return;
    }
    if (!chatBackend.setSessionModel) {
      res.status(501).json({ error: "model switching not supported" });
      return;
    }
    try {
      await chatBackend.setSessionModel(session.id, body.modelId);
      res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: message });
    }
  }));

  // ── Auto-approve ───────────────────────────────────────────────────
  app.get("/chat/auto-approve", smallJson, asyncRoute(async (req, res) => {
    const q = AutoApproveQuerySchema.parse(req.query);
    const def = chatBackend.getDefaultAutoApprove?.() ?? false;
    if (!q.sessionId) {
      res.json({
        ok: true,
        supported: true,
        default: def,
        override: null,
        effective: def,
        enabled: def,
      });
      return;
    }
    const ov = chatBackend.getSessionAutoApproveOverride?.(q.sessionId);
    res.json({
      ok: true,
      supported: true,
      default: def,
      override: ov ?? null,
      effective: ov ?? def,
      enabled: ov ?? def,
    });
  }));

  app.post("/chat/auto-approve", smallJson, asyncRoute(async (req, res) => {
    const body = AutoApprovePostBodySchema.parse(req.body ?? {});
    if (!body.sessionId) {
      // Backend-wide default.
      chatBackend.setDefaultAutoApprove?.(Boolean(body.enabled));
    } else {
      chatBackend.setSessionAutoApprove?.(body.sessionId, body.enabled);
    }
    const def = chatBackend.getDefaultAutoApprove?.() ?? false;
    const ov = body.sessionId
      ? chatBackend.getSessionAutoApproveOverride?.(body.sessionId)
      : undefined;
    res.json({
      ok: true,
      supported: true,
      default: def,
      override: ov ?? null,
      effective: ov ?? def,
      enabled: ov ?? def,
    });
  }));

  // ── Sessions ──────────────────────────────────────────────────────
  app.get("/chat/sessions", smallJson, asyncRoute(async (_req, res) => {
    const all = await backendPool.listSessions();
    const active = await defaultSessionId(backendPool, chatBackend);
    const sessions = all.map((e) => ({
      sessionId: e.summary.sessionId,
      title: e.summary.title,
      updatedAt: e.summary.updatedAt ?? null,
      cwd: e.cwd,
      customTitle: sessionMeta.get(e.summary.sessionId)?.customTitle,
      pinned: sessionMeta.get(e.summary.sessionId)?.pinned,
      group: sessionMeta.get(e.summary.sessionId)?.group,
      active: e.summary.sessionId === active,
    }));
    res.json({ sessions });
  }));

  app.post("/chat/sessions/fork", smallJson, asyncRoute(async (req, res) => {
    const body = ForkBodySchema.parse(req.body ?? {});
    if (!chatBackend.forkSession) {
      res.status(501).json({ error: "fork not supported" });
      return;
    }
    const src = await resolveSession(backendPool, body.sessionId);
    if (!src) {
      res.status(404).json({ error: "source session not found" });
      return;
    }
    const forked = await chatBackend.forkSession(body.sessionId);
    res.json({ ok: true, sourceSessionId: body.sessionId, sessionId: forked.id, cwd: workspace });
  }));

  app.patch("/chat/sessions/:sessionId", smallJson, asyncRoute(async (req, res) => {
    const body = SessionPatchBodySchema.parse(req.body ?? {});
    const sid = req.params.sessionId;
    const cur = sessionMeta.get(sid) ?? { sessionId: sid };
    if (body.customTitle !== undefined) cur.customTitle = body.customTitle ?? undefined;
    if (body.pinned !== undefined) cur.pinned = body.pinned;
    if (body.group !== undefined) cur.group = body.group ?? undefined;
    sessionMeta.set(sid, cur);
    res.json({ ok: true, sessionId: sid, metadata: cur });
  }));

  // ── Status ────────────────────────────────────────────────────────
  app.get("/status/active", (_req, res) => {
    res.json({
      busy: false,
      now: new Date().toISOString(),
      chat: { activeCount: 0, streams: [] },
    });
  });

  // ── Workspace ──────────────────────────────────────────────────────
  app.get("/workspace/status", (_req, res) => {
    res.json({ onboarded: true, hasIdentity: true, hasUser: true });
  });
  app.get("/workspace/branch", (_req, res) => {
    res.json({ ok: false, branch: null, error: "not a git repo" });
  });
  app.post("/chat/pick-folder", (_req, res) => {
    res.status(501).json({ error: "folder picker not supported on this platform" });
  });
  app.post("/chat/worktree", (_req, res) => {
    res.status(501).json({ error: "worktree creation not yet implemented" });
  });

  // ── Tools ─────────────────────────────────────────────────────────
  app.post("/tools/execute", smallJson, asyncRoute(async (req, res) => {
    const body = ToolsBodySchema.parse(req.body ?? {});
    const handler = tools.get(body.tool);
    if (!handler) {
      res.status(404).json({ error: `unknown tool: ${body.tool}` });
      return;
    }
    try {
      const result = await handler(body.params);
      if (result === undefined) {
        res.json({ ok: true });
      } else {
        res.json({ ok: true, result });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/Path outside workspace/.test(message)) {
        res.status(400).json({ ok: false, error: message });
        return;
      }
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
        res.status(400).json({ ok: false, error: message });
        return;
      }
      res.status(500).json({ ok: false, error: message });
    }
  }));

  // ── Skills (Phase 4 layer not yet implemented; minimal stubs) ─────
  app.get("/skills", (_req, res) => {
    res.json({ skills: [] });
  });
  app.get("/skills/:name/ui/*", (_req, res) => {
    res.status(501).json({ error: "skill UI serving not yet implemented" });
  });
  app.get("/skills/:name/data", (_req, res) => {
    res.json({});
  });
  app.put("/skills/:name/data", smallJson, asyncRoute(async (req, res) => {
    if (!req.body || typeof req.body !== "object") {
      res.status(400).json({ error: "body must be a JSON object" });
      return;
    }
    res.json({ ok: true });
  }));
  app.get("/skills/initial", (_req, res) => {
    res.json({ skills: [] });
  });
  app.post("/skills/sync-to-initial", (_req, res) => {
    res.json({ ok: true });
  });

  // ── Slack (optional) ──────────────────────────────────────────────
  app.post("/slack/message", smallJson, (_req, res) => {
    res.status(503).json({ error: "slack not configured" });
  });

  // ── Analytics (no-op by default) ──────────────────────────────────
  app.get("/analytics/config", (_req, res) => {
    res.json({ enabled: false });
  });
  app.post("/analytics/track", smallJson, (_req, res) => {
    res.status(204).end();
  });

  // ── Static files ──────────────────────────────────────────────────
  const PUBLIC_DIR = path.resolve(process.cwd(), "public");
  app.use(express.static(PUBLIC_DIR));

  return app;
}

// ── helpers ───────────────────────────────────────────────────────────

async function defaultSessionId(
  pool: BackendPool,
  _chat: AgentBackend,
): Promise<string | null> {
  // Phase 4 layer maintains a "current session" — for now we lazily
  // create one on first /chat/init if none exists, so /chat/send has a
  // session to talk to.
  const all = await pool.listSessions();
  return all[0]?.summary.sessionId ?? null;
}

async function resolveSession(
  pool: BackendPool,
  sessionId: string | undefined,
): Promise<AgentSession | null> {
  if (!sessionId) return null;
  return pool.getSession(sessionId);
}

type AsyncRoute = (
  req: Request,
  res: Response,
) => Promise<void> | void;

function asyncRoute(handler: AsyncRoute) {
  return (req: Request, res: Response, next: (e?: unknown) => void): void => {
    Promise.resolve(handler(req, res)).catch(next);
  };
}

// ── Zod schemas ───────────────────────────────────────────────────────

const InitQuerySchema = z.object({
  sessionId: z.string().optional(),
  cwd: z.string().optional(),
});

const SendBodySchema = z.object({
  message: z.string().optional(),
  images: z
    .array(
      z.object({
        data: z.string(),
        mimeType: z.string(),
        filename: z.string().optional(),
      }),
    )
    .max(10)
    .optional(),
  onboarding: z.boolean().optional(),
  hideUserMessage: z.boolean().optional(),
  sessionId: z.string().optional(),
});

const CancelBodySchema = z.object({ sessionId: z.string().optional() });
const ApprovalBodySchema = z.object({
  sessionId: z.string().optional(),
  requestId: z.string(),
  optionId: z.string(),
});
const SteerBodySchema = z.object({
  prompt: z.string(),
  sessionId: z.string().optional(),
});
const ModelQuerySchema = z.object({ sessionId: z.string().optional() });
const ModelPostBodySchema = z.object({
  sessionId: z.string(),
  modelId: z.string(),
});
const AutoApproveQuerySchema = z.object({ sessionId: z.string().optional() });
const AutoApprovePostBodySchema = z.object({
  enabled: z.union([z.boolean(), z.null()]),
  sessionId: z.string().optional(),
});
const ForkBodySchema = z.object({
  sessionId: z.string(),
  atMessageIndex: z.number().int().nonnegative().optional(),
});
const SessionPatchBodySchema = z
  .object({
    customTitle: z.union([z.string(), z.null()]).optional(),
    pinned: z.boolean().optional(),
    group: z.union([z.string(), z.null()]).optional(),
  })
  .refine(
    (v) =>
      v.customTitle !== undefined || v.pinned !== undefined || v.group !== undefined,
    { message: "no fields to update" },
  );
const ToolsBodySchema = z.object({
  tool: z.string().min(1),
  params: z.unknown().optional(),
});
