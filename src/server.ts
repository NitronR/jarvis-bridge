// HTTP gateway. Localhost-only, unauthenticated. Validates request
// bodies with Zod at the boundary; the agent/backend layers stay
// validator-agnostic.

import express, { type Express, type Request, type Response } from "express";
import path from "node:path";
import fs from "node:fs/promises";
import { z } from "zod";
import type { AgentBackend, AgentSession, ChatPatch, UsageTotals } from "./agent/types";
import type { BackendRegistry } from "./agent/backendRegistry";
import type { ToolHandler } from "./types";
import type { SessionConfigStore, SessionMetadataPatch } from "./agent/sessionConfigStore";
import { pickFolderNative, type PickFolderFn } from "./pickFolder";

export interface CreateServerOptions {
  workspace: string;
  port: number;
  registry: BackendRegistry;
  tools: Map<string, ToolHandler>;
  sessionConfig?: SessionConfigStore;
  pickFolder?: PickFolderFn;
  logFile?: string;
}

export function createServer(opts: CreateServerOptions): Express {
  const {
    workspace,
    registry,
    tools,
    pickFolder = pickFolderNative,
    logFile,
  } = opts;

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
      const backend = await registry.getDefaultBackend();
      const hc = await backend.healthcheck();
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
    let backend: AgentBackend;
    let backendName: string;
    let session: AgentSession;
    let resumed = false;
    let effectiveCwd: string;
    if (q.sessionId) {
      // Resume has to run in the cwd the session was stored under: Claude's
      // session/load is per-project and answers "Resource not found" anywhere
      // else. When neither the request nor our own metadata knows it (a chat
      // started by the agent's own CLI, or before cwd persistence existed),
      // ask the agents where they filed it rather than falling back to the
      // workspace, which is what used to 500 the whole request.
      let located: { backendName: string; cwd: string } | null = null;
      let knownCwd = requestedCwd ?? opts.sessionConfig?.getSessionCwd(q.sessionId);
      if (!knownCwd) {
        located = await registry.resolveSessionCwd(q.sessionId);
        if (located) {
          knownCwd = located.cwd;
          console.log(`[INIT] resolved cwd for ${q.sessionId} → ${located.cwd} (${located.backendName})`);
        }
      }
      effectiveCwd = knownCwd ?? workspace;
      const owner = await registry.findSession(q.sessionId);
      backend = owner
        ? owner.backend
        : located
          ? await registry.getBackend(located.backendName, effectiveCwd)
          : await registry.getDefaultBackend(effectiveCwd);
      backendName = owner ? owner.backendName : located ? located.backendName : registry.getDefaultBackendName();
      const resident = owner ? await registry.getSession(q.sessionId) : null;
      const liveTurn = resident?.getActiveTurn?.() ?? null;
      if (liveTurn) {
        // A turn is still streaming in this process — reuse the resident
        // session as-is. Calling loadSession() here would replace its
        // SessionContext and orphan the in-flight turn's patch pump (see
        // docs/acp-notes.md). History is limited to this turn's buffered
        // tail in this branch; prior settled turns aren't replayed here —
        // they were already shown before this reload.
        session = resident!;
        resumed = true;
      } else if (backend.loadSession) {
        console.log(`[INIT] loadSession sessionId=${q.sessionId} cwd=${effectiveCwd}`);
        try {
          session = await backend.loadSession(q.sessionId, { cwd: effectiveCwd });
        } catch (err) {
          // The agent doesn't have this session (deleted, or belongs to a cwd
          // we couldn't resolve). Answer inside the JSON contract so the
          // frontend can drop the stale ?sessionId and start a fresh chat,
          // instead of Express's default HTML 500 + stack trace.
          const detail = err instanceof Error ? err.message : String(err);
          console.log(`[INIT]   loadSession failed: ${detail}`);
          res.status(404).json({ error: `session not found: ${detail}` });
          return;
        }
        // Remember where it actually loaded from, so the next plain resume of
        // this tab skips the lookup (and still works if the agent's session
        // index is unavailable).
        if (opts.sessionConfig?.getSessionCwd(q.sessionId) !== effectiveCwd) {
          await opts.sessionConfig?.setSessionCwd(q.sessionId, effectiveCwd);
        }
        const storedModel = opts.sessionConfig?.getModelOverride(q.sessionId);
        console.log(`[INIT]   storedModel=${storedModel ?? "(none)"}`);
        if (storedModel) {
          try {
            await backend.setSessionModel?.(q.sessionId, storedModel);
            console.log(`[INIT]   re-applied model ${storedModel}`);
          } catch (e) {
            console.log(`[INIT]   re-apply failed: ${e instanceof Error ? e.message : e}`);
          }
        }
        // Best-effort by design: a stale override for an option the agent no
        // longer reports must not fail the resume.
        const storedConfig = opts.sessionConfig?.getConfigOverrides(q.sessionId) ?? {};
        for (const [configId, value] of Object.entries(storedConfig)) {
          try {
            await backend.setSessionConfigOption?.(q.sessionId, configId, value);
          } catch (e) {
            console.log(`[INIT]   re-apply ${configId}=${value} failed: ${e instanceof Error ? e.message : e}`);
          }
        }
        resumed = true;
      } else {
        const found = await registry.getSession(q.sessionId);
        if (!found) {
          res.status(404).json({ error: "session not found" });
          return;
        }
        session = found;
        resumed = true;
      }
    } else {
      backendName = q.backend ?? registry.getDefaultBackendName();
      effectiveCwd = requestedCwd ?? workspace;
      if (q.backend) {
        try {
          backend = await registry.getBackend(q.backend, effectiveCwd);
        } catch {
          res.status(400).json({ error: "unknown backend" });
          return;
        }
      } else {
        backend = await registry.getDefaultBackend(effectiveCwd);
      }
      session = await backend.createSession({ cwd: effectiveCwd });
      if (q.model) {
        // Best-effort: same as the model pin in AcpAgentBackend.createSession,
        // the agent may not support switching models (or this modelId) — don't
        // fail the whole session handoff over it, just fall back to whatever
        // model the session actually started with.
        try {
          await backend.setSessionModel?.(session.id, q.model);
        } catch {
          // ignore — agent may not support it
        }
      }
      await opts.sessionConfig?.setSessionCwd(session.id, effectiveCwd);
    }
    // Cache what this backend reports so the Settings dialog can offer defaults
    // for it later, even with no live session. Then apply those defaults to any
    // option this session hasn't explicitly overridden — the session's own
    // choice always wins, and nothing is stamped into session_metadata.json.
    const sessionConfigOptions = backend.getSessionConfigOptions?.(session.id) ?? null;
    if (sessionConfigOptions) {
      await registry.setConfigCatalog(
        backendName,
        sessionConfigOptions.map(({ id, name, category, options }) => ({ id, name, category, options })),
      );
    }
    // A streaming turn owns this session's context — touching its config here
    // is the same hazard loadSession has (see docs/acp-notes.md).
    if (!session.getActiveTurn?.()) {
      const configDefaults = registry.getConfigDefaults(backendName);
      const sessionOverrides = opts.sessionConfig?.getConfigOverrides(session.id) ?? {};
      for (const [configId, value] of Object.entries(configDefaults)) {
        if (sessionOverrides[configId] !== undefined) continue;
        try {
          await backend.setSessionConfigOption?.(session.id, configId, value);
        } catch (e) {
          console.log(`[INIT]   default ${configId}=${value} failed: ${e instanceof Error ? e.message : e}`);
        }
      }
    }
    // Backend instances hold auto-approve state in memory only; reseed a
    // persisted per-session override in case this instance was just spawned
    // (gateway restart, or first touch of a lazily-spawned backend) and
    // wouldn't otherwise know about it.
    const storedOverride = opts.sessionConfig?.getAutoApproveOverride(session.id);
    if (storedOverride !== undefined) backend.setSessionAutoApprove?.(session.id, storedOverride);
    const history = session.consumeReplayHistory?.() ?? [];
    const liveTurnForResponse = session.getActiveTurn?.() ?? null;
    if (liveTurnForResponse && liveTurnForResponse.patches.length > 0) {
      history.push({ kind: "assistant", patches: liveTurnForResponse.patches });
    }
    const models = backend.getSessionModels?.(session.id) ?? null;
    console.log(`[INIT]   getSessionModels → current=${models?.current} available=${models?.available?.map(m => m.modelId).join(",") ?? "(none)"}`);
    const slashCommands = session.getSlashCommands
      ? session.getSlashCommands()
      : backend.getSlashCommands
        ? backend.getSlashCommands()
        : [];
    res.json({
      ok: true,
      backend: {
        kind: backend.kind,
        role: backend.role,
        model: models?.current ?? null,
        name: backendName,
      },
      sessionId: session.id,
      cwd: effectiveCwd,
      resumed,
      history,
      activeTurn: liveTurnForResponse != null,
      customTitle: opts.sessionConfig?.getMetadata(session.id)?.customTitle ?? null,
      pinned: opts.sessionConfig?.getMetadata(session.id)?.pinned ?? false,
      group: opts.sessionConfig?.getMetadata(session.id)?.group ?? null,
      lastUsage: opts.sessionConfig?.getLastUsage(session.id) ?? null,
      capabilities: backend.capabilities,
      slashCommands,
      autoApprove: {
        supported: true,
        default: backend.getDefaultAutoApprove?.() ?? false,
        override: backend.getSessionAutoApproveOverride?.(session.id) ?? null,
        effective:
          backend.getSessionAutoApproveOverride?.(session.id) ??
          backend.getDefaultAutoApprove?.() ??
          false,
        enabled:
          backend.getSessionAutoApproveOverride?.(session.id) ??
          backend.getDefaultAutoApprove?.() ??
          false,
      },
      model: models
        ? { supported: true, available: models.available, current: models.current }
        : { supported: false, available: [], current: null },
      configOptions: backend.getSessionConfigOptions?.(session.id) ?? [],
    });
  }));

  // ── POST /chat/send (SSE) ──────────────────────────────────────────
  app.post("/chat/send", chatJson, asyncRoute(async (req, res) => {
    const body = SendBodySchema.parse(req.body ?? {});
    const sessionId = body.sessionId ?? (await defaultSessionId(registry));
    if (!sessionId) {
      res.status(404).json({ error: "no session available" });
      return;
    }
    let session = await registry.getSession(sessionId);
    if (!session) {
      const entry = await registry.findSession(sessionId);
      if (entry?.backend.loadSession) {
        try {
          await entry.backend.loadSession(sessionId, { cwd: entry.cwd });
        } catch {
          // Session not found or can't be reloaded.
        }
        session = await registry.getSession(sessionId);
      }
      if (!session) {
        res.status(404).json({ error: "session not found" });
        return;
      }
    }
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    const writePatch = (patch: ChatPatch) => {
      if (res.writableEnded || res.destroyed) return;
      res.write(`data: ${JSON.stringify(patch)}\n\n`);
      const pt = (patch as { type?: string }).type;
      if (pt === "usage") {
        opts.sessionConfig
          ?.setLastUsage(sessionId, (patch as { usage: UsageTotals }).usage)
          .catch(() => {});
      }
    };
    // A disconnect (refresh, network blip, tab close) must not cancel the
    // turn — only an explicit /chat/cancel does. This handler keeps
    // iterating the generator to completion regardless of `res`'s state, so
    // the turn (and its activeTurn buffering — see AcpAgentSession) keeps
    // running; a reconnecting tab catches up via GET /chat/stream. `detach`
    // marks this connection as no longer watching, arming the idle-turn
    // grace-period reaper if nobody else attaches (see index.ts's
    // getIdleTurnGraceMs()).
    let detach: (() => void) | null = null;
    let attached = false;
    req.on("close", () => detach?.());

    try {
      const gen = session.sendMessage(body.message ?? "", {
        images: (body.images ?? []).map((i) => ({
          data: i.data,
          mimeType: i.mimeType,
          filename: i.filename,
        })),
      });
      for await (const patch of gen) {
        if (!attached) {
          attached = true;
          detach = session.getActiveTurn?.()?.attach(null) ?? null;
        }
        writePatch(patch);
        const pt = (patch as { type?: string }).type;
        if (pt === "done" || pt === "error") break;
      }
      if (!res.writableEnded) res.end();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      writePatch({ type: "error", message } as ChatPatch);
      if (!res.writableEnded) res.end();
    }
  }));

  // ── GET /chat/stream (reattach to an in-flight turn) ──────────────
  app.get("/chat/stream", smallJson, asyncRoute(async (req, res) => {
    const q = StreamQuerySchema.parse(req.query);
    const session = await registry.getSession(q.sessionId);
    if (!session) {
      res.status(404).json({ error: "session not found" });
      return;
    }
    const handle = session.getActiveTurn?.();
    if (!handle) {
      res.status(404).json({ error: "no active turn" });
      return;
    }
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    const writePatch = (patch: ChatPatch) => {
      if (res.writableEnded || res.destroyed) return;
      res.write(`data: ${JSON.stringify(patch)}\n\n`);
      const pt = (patch as { type?: string }).type;
      if (pt === "usage") {
        opts.sessionConfig
          ?.setLastUsage(q.sessionId, (patch as { usage: UsageTotals }).usage)
          .catch(() => {});
      }
      if ((pt === "done" || pt === "error") && !res.writableEnded) res.end();
    };
    // No await between the snapshot and attach() below — single-threaded JS
    // guarantees no patch can arrive and be missed in that gap.
    for (const p of handle.patches) writePatch(p);
    const detach = handle.attach(writePatch);
    req.on("close", () => detach());
  }));

  app.post("/chat/cancel", smallJson, asyncRoute(async (req, res) => {
    const body = CancelBodySchema.parse(req.body ?? {});
    const session = await resolveSession(registry, body.sessionId);
    if (session) await session.cancel();
    res.json({ ok: true });
  }));

  app.post("/chat/approval", smallJson, asyncRoute(async (req, res) => {
    const body = ApprovalBodySchema.parse(req.body ?? {});
    const session = await resolveSession(registry, body.sessionId);
    if (!session) {
      res.status(404).json({ error: "session not found" });
      return;
    }
    const ok = session.resolveApproval ? session.resolveApproval(body.requestId, body.optionId) : false;
    if (!ok) {
      res.status(409).json({ error: "no pending approval" });
      return;
    }
    res.json({ ok: true });
  }));

  app.post("/chat/elicitation", smallJson, asyncRoute(async (req, res) => {
    const body = ElicitationBodySchema.parse(req.body ?? {});
    const session = await resolveSession(registry, body.sessionId);
    if (!session) {
      res.status(404).json({ error: "session not found" });
      return;
    }
    const ok = session.resolveElicitation
      ? session.resolveElicitation(body.requestId, body.action, body.content)
      : false;
    if (!ok) {
      res.status(409).json({ error: "no pending elicitation" });
      return;
    }
    res.json({ ok: true });
  }));

  // ── Models ────────────────────────────────────────────────────────
  app.get("/chat/model", smallJson, asyncRoute(async (req, res) => {
    const q = ModelQuerySchema.parse(req.query);
    const entry = await resolveSessionEntry(registry, q.sessionId, opts.sessionConfig);
    if (!entry) {
      res.status(404).json({ error: "session not found" });
      return;
    }
    const info = entry.backend.getSessionModels?.(entry.summary.sessionId);
    if (!info) {
      res.json({ ok: true, supported: false, available: [], current: null });
      return;
    }
    res.json({ ok: true, supported: true, available: info.available, current: info.current });
  }));

  app.post("/chat/model", smallJson, asyncRoute(async (req, res) => {
    const body = ModelPostBodySchema.parse(req.body ?? {});
    const entry = await resolveSessionEntry(registry, body.sessionId, opts.sessionConfig);
    if (!entry) {
      res.status(404).json({ error: "session not found" });
      return;
    }
    if (!entry.backend.setSessionModel) {
      res.status(501).json({ error: "model switching not supported" });
      return;
    }
    try {
      console.log(`[MODEL] POST /chat/model sessionId=${body.sessionId} modelId=${body.modelId}`);
      await entry.backend.setSessionModel(body.sessionId, body.modelId);
      // Persist/report what the backend ended up on, not what was asked for —
      // an agent may resolve the requested id to a different concrete model,
      // and a persisted override that disagrees with the agent's own state gets
      // re-applied (and re-resolved) on every resume.
      const current =
        entry.backend.getSessionModels?.(body.sessionId)?.current ?? body.modelId;
      console.log(`[MODEL]   setSessionModel OK, persisting override ${current}`);
      await opts.sessionConfig?.setModelOverride(body.sessionId, current);
      console.log(`[MODEL]   override persisted`);
      res.json({ ok: true, current });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: message });
    }
  }));

  // ── Session config options (mode / effort / agent / …) ─────────────
  // Deliberately generic: whatever select-style options the connected backend
  // reports get a picker. `model` is excluded by the backend and rejected on
  // POST — /chat/model owns it, including its persisted override.
  app.get("/chat/config-options", smallJson, asyncRoute(async (req, res) => {
    const q = ConfigOptionsQuerySchema.parse(req.query);
    const entry = await resolveSessionEntry(registry, q.sessionId, opts.sessionConfig);
    if (!entry) {
      res.status(404).json({ error: "session not found" });
      return;
    }
    const options = entry.backend.getSessionConfigOptions?.(entry.summary.sessionId) ?? null;
    if (!options) {
      res.json({ ok: true, supported: false, options: [] });
      return;
    }
    res.json({ ok: true, supported: true, options });
  }));

  app.post("/chat/config-option", smallJson, asyncRoute(async (req, res) => {
    const body = ConfigOptionPostBodySchema.parse(req.body ?? {});
    if (body.configId === "model") {
      res.status(400).json({ error: "use POST /chat/model to change the model" });
      return;
    }
    const entry = await resolveSessionEntry(registry, body.sessionId, opts.sessionConfig);
    if (!entry) {
      res.status(404).json({ error: "session not found" });
      return;
    }
    if (!entry.backend.setSessionConfigOption) {
      res.status(501).json({ error: "config options not supported" });
      return;
    }
    try {
      await entry.backend.setSessionConfigOption(body.sessionId, body.configId, body.value);
      const options = entry.backend.getSessionConfigOptions?.(body.sessionId) ?? [];
      // Persist what the backend landed on, not what was asked for — an agent
      // may resolve the requested value, and a stored override that disagrees
      // gets re-applied on every resume.
      const landed = options.find((o) => o.id === body.configId)?.currentValue ?? body.value;
      await opts.sessionConfig?.setConfigOverride(body.sessionId, body.configId, landed);
      res.json({ ok: true, options });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: message });
    }
  }));

  // On-demand subscription rate-limit query — shells out to a one-off `claude
  // --print "/usage"` CLI invocation (see src/agent/acp/claudeUsage.ts). Only
  // supported when the resolved session's backend advertises usageQuery.
  app.get("/chat/usage", smallJson, asyncRoute(async (req, res) => {
    const q = UsageQuerySchema.parse(req.query);
    const entry = await resolveSessionEntry(registry, q.sessionId, opts.sessionConfig);
    if (!entry) {
      res.status(404).json({ error: "session not found" });
      return;
    }
    if (!entry.backend.queryUsage) {
      res.status(501).json({ error: "usage query not supported" });
      return;
    }
    try {
      const rate_limits = await entry.backend.queryUsage();
      res.json({ ok: true, rate_limits: rate_limits ?? null });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(502).json({ error: message });
    }
  }));

  // ── Auto-approve ───────────────────────────────────────────────────
  app.get("/chat/auto-approve", smallJson, asyncRoute(async (req, res) => {
    const q = AutoApproveQuerySchema.parse(req.query);
    if (!q.sessionId) {
      const backend = await registry.getDefaultBackend();
      const def = backend.getDefaultAutoApprove?.() ?? false;
      res.json({ ok: true, supported: true, default: def, override: null, effective: def, enabled: def });
      return;
    }
    const entry = await resolveSessionEntry(registry, q.sessionId, opts.sessionConfig);
    if (!entry) {
      res.status(404).json({ error: "session not found" });
      return;
    }
    const def = entry.backend.getDefaultAutoApprove?.() ?? false;
    const ov = entry.backend.getSessionAutoApproveOverride?.(q.sessionId);
    res.json({ ok: true, supported: true, default: def, override: ov ?? null, effective: ov ?? def, enabled: ov ?? def });
  }));

  app.post("/chat/auto-approve", smallJson, asyncRoute(async (req, res) => {
    const body = AutoApprovePostBodySchema.parse(req.body ?? {});
    if (!body.sessionId) {
      const backend = await registry.getDefaultBackend();
      backend.setDefaultAutoApprove?.(Boolean(body.enabled));
      await opts.sessionConfig?.setAutoApproveDefault(Boolean(body.enabled));
      const def = backend.getDefaultAutoApprove?.() ?? false;
      res.json({ ok: true, supported: true, default: def, override: null, effective: def, enabled: def });
      return;
    }
    const entry = await resolveSessionEntry(registry, body.sessionId, opts.sessionConfig);
    if (!entry) {
      res.status(404).json({ error: "session not found" });
      return;
    }
    entry.backend.setSessionAutoApprove?.(body.sessionId, body.enabled);
    await opts.sessionConfig?.setAutoApproveOverride(body.sessionId, body.enabled);
    const def = entry.backend.getDefaultAutoApprove?.() ?? false;
    const ov = entry.backend.getSessionAutoApproveOverride?.(body.sessionId);
    res.json({ ok: true, supported: true, default: def, override: ov ?? null, effective: ov ?? def, enabled: ov ?? def });
  }));

  // ── Sessions ──────────────────────────────────────────────────────
  app.get("/chat/sessions", smallJson, asyncRoute(async (_req, res) => {
    const all = await registry.listSessions();
    const active = await defaultSessionId(registry);
    const sessions = all.map((e) => {
      const meta = opts.sessionConfig?.getMetadata(e.summary.sessionId);
      return {
        sessionId: e.summary.sessionId,
        title: e.summary.title,
        updatedAt: e.summary.updatedAt ?? null,
        cwd: e.cwd,
        backendName: e.backendName,
        customTitle: meta?.customTitle,
        pinned: meta?.pinned,
        group: meta?.group,
        active: e.summary.sessionId === active,
      };
    });
    res.json({ sessions });
  }));

  app.post("/chat/sessions/fork", smallJson, asyncRoute(async (req, res) => {
    const body = ForkBodySchema.parse(req.body ?? {});
    const entry = await resolveSessionEntry(registry, body.sessionId, opts.sessionConfig);
    if (!entry) {
      res.status(404).json({ error: "source session not found" });
      return;
    }
    if (!entry.backend.forkSession) {
      res.status(501).json({ error: "fork not supported" });
      return;
    }
    const forked = await entry.backend.forkSession(body.sessionId, { cwd: entry.cwd });
    await opts.sessionConfig?.setSessionCwd(forked.id, entry.cwd);
    res.json({ ok: true, sourceSessionId: body.sessionId, sessionId: forked.id, cwd: entry.cwd });
  }));

  app.patch("/chat/sessions/:sessionId", smallJson, asyncRoute(async (req, res) => {
    const body = SessionPatchBodySchema.parse(req.body ?? {});
    const sid = req.params.sessionId;
    const cur = opts.sessionConfig?.getMetadata(sid) ?? {};
    const patch: SessionMetadataPatch = {};
    if (body.customTitle !== undefined) patch.customTitle = body.customTitle ?? null;
    if (body.pinned !== undefined) patch.pinned = body.pinned;
    if (body.group !== undefined) patch.group = body.group ?? null;
    if (opts.sessionConfig) await opts.sessionConfig.setMetadata(sid, patch);
    const merged = opts.sessionConfig?.getMetadata(sid) ?? cur;
    res.json({ ok: true, sessionId: sid, metadata: { ...merged, sessionId: sid } });
  }));

  app.delete("/chat/sessions/:sessionId", smallJson, asyncRoute(async (req, res) => {
    const sid = req.params.sessionId;
    try {
      await registry.deleteSession(sid);
      await opts.sessionConfig?.setMetadata(sid, { customTitle: null, group: null });
      res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/not found/i.test(message)) {
        res.status(404).json({ error: message });
      } else if (/not supported/i.test(message)) {
        res.status(501).json({ error: message });
      } else {
        res.status(500).json({ error: message });
      }
    }
  }));

  // ── Groups ──────────────────────────────────────────────────────────
  app.get("/chat/groups", smallJson, (_req, res) => {
    const groups = opts.sessionConfig?.getGroups() ?? [];
    res.json({ groups });
  });

  app.post("/chat/groups", smallJson, asyncRoute(async (req, res) => {
    const body = CreateGroupBodySchema.parse(req.body ?? {});
    if (!opts.sessionConfig) {
      res.status(500).json({ error: "session config not available" });
      return;
    }
    const groups = await opts.sessionConfig.addGroup(body.name);
    res.json({ ok: true, groups });
  }));

  // ── Status ────────────────────────────────────────────────────────
  app.get("/status/active", (_req, res) => {
    res.json({
      busy: false,
      now: new Date().toISOString(),
      chat: { activeCount: 0, streams: [] },
    });
  });

  // ── Settings ──────────────────────────────────────────────────────
  app.get("/settings/default-backend", smallJson, (_req, res) => {
    res.json({
      ok: true,
      available: registry.listBackendNames(),
      default: registry.getDefaultBackendName(),
    });
  });

  app.put("/settings/default-backend", smallJson, asyncRoute(async (req, res) => {
    const body = SetDefaultBackendBodySchema.parse(req.body ?? {});
    try {
      await registry.setDefaultBackendName(body.name);
      res.json({ ok: true, default: registry.getDefaultBackendName() });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: message });
    }
  }));

  app.get("/settings/config-defaults", smallJson, (_req, res) => {
    res.json({
      ok: true,
      backends: registry.listBackendNames().map((name) => ({
        name,
        options: registry.getConfigCatalog(name),
        defaults: registry.getConfigDefaults(name),
      })),
    });
  });

  app.put("/settings/config-default", smallJson, asyncRoute(async (req, res) => {
    const body = SetConfigDefaultBodySchema.parse(req.body ?? {});
    if (body.configId === "model") {
      res.status(400).json({ error: "model has no per-backend default" });
      return;
    }
    if (!registry.listBackendNames().includes(body.backend)) {
      res.status(400).json({ error: `unknown backend name: ${body.backend}` });
      return;
    }
    // Clearing is always allowed — a default for an option the agent stopped
    // reporting must still be removable.
    if (body.value !== null) {
      const option = registry.getConfigCatalog(body.backend).find((o) => o.id === body.configId);
      if (!option) {
        res.status(400).json({ error: `unknown configId for ${body.backend}: ${body.configId}` });
        return;
      }
      if (!option.options.some((o) => o.value === body.value)) {
        res.status(400).json({ error: `unknown value for ${body.configId}: ${body.value}` });
        return;
      }
    }
    await registry.setConfigDefault(body.backend, body.configId, body.value);
    res.json({ ok: true, defaults: registry.getConfigDefaults(body.backend) });
  }));

  // ── Workspace ──────────────────────────────────────────────────────
  app.get("/workspace/status", (_req, res) => {
    res.json({ onboarded: true, hasIdentity: true, hasUser: true });
  });
  app.get("/workspace/branch", (_req, res) => {
    res.json({ ok: false, branch: null, error: "not a git repo" });
  });
  app.post("/chat/pick-folder", smallJson, asyncRoute(async (req, res) => {
    if (process.platform !== "darwin") {
      res.status(501).json({ ok: false, error: "folder picker not supported on this platform" });
      return;
    }
    const body = PickFolderBodySchema.parse(req.body ?? {});
    try {
      const result = await pickFolder(body.initialCwd);
      res.json({ ok: true, ...result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: message });
    }
  }));
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

  // ── Client logging ───────────────────────────────────────────────
  app.post("/chat/client-logs", express.json({ limit: "1mb" }), (req, res) => {
    res.status(204).end();
    const { entries } = req.body as { entries?: Array<{ ts: string; level: string; args: string }> };
    if (!entries?.length || !logFile) return;
    const frontendLogFile = logFile.replace(/gateway\.log$/, "frontend.log");
    const lines = entries.map((e) => `[${e.ts}] [FE ${e.level.toUpperCase().padEnd(5)}] ${e.args}`).join("\n") + "\n";
    void fs.appendFile(frontendLogFile, lines);
  });

  // ── Static files ──────────────────────────────────────────────────
  const PUBLIC_DIR = path.resolve(process.cwd(), "public");
  app.use(express.static(PUBLIC_DIR));

  return app;
}

// ── helpers ───────────────────────────────────────────────────────────

async function resolveSessionEntry(
  registry: BackendRegistry,
  sessionId: string | undefined,
  sessionConfig?: SessionConfigStore,
): Promise<import("./agent/backendRegistry").RegistrySessionEntry | null> {
  if (!sessionId) return null;
  const owner = await registry.findSession(sessionId);
  if (owner) return owner;
  // findSession()'s ownership index is cwd-based: each resolved backend
  // instance's session/list is filtered to its own spawn cwd (see
  // AcpAgentBackend.listSessions()). That misses a session whose cwd (per
  // the underlying agent) has drifted from the cwd it was created with in
  // Jarvis Bridge — e.g. the agent used EnterWorktree mid-conversation.
  // /chat/init works around exactly this by resuming via the persisted cwd
  // on the default backend, which looks the session up by ID rather than by
  // cwd match; mirror that fallback here so usage/model/auto-approve don't
  // 404 for sessions that are otherwise still perfectly resumable.
  const cwd = sessionConfig?.getSessionCwd(sessionId);
  if (!cwd) return null;
  const backend = await registry.getDefaultBackend(cwd);
  return {
    backend,
    backendName: registry.getDefaultBackendName(),
    cwd,
    summary: { sessionId, cwd },
  };
}

async function defaultSessionId(registry: BackendRegistry): Promise<string | null> {
  const all = await registry.listSessions();
  return all[0]?.summary.sessionId ?? null;
}

async function resolveSession(
  registry: BackendRegistry,
  sessionId: string | undefined,
): Promise<AgentSession | null> {
  if (!sessionId) return null;
  return registry.getSession(sessionId);
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
  backend: z.string().optional(),
  model: z.string().optional(),
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
const ElicitationBodySchema = z.object({
  sessionId: z.string().optional(),
  requestId: z.string(),
  action: z.enum(["accept", "decline", "cancel"]),
  content: z.record(z.string(), z.unknown()).optional(),
});
const ModelQuerySchema = z.object({ sessionId: z.string().optional() });
const ConfigOptionsQuerySchema = z.object({ sessionId: z.string().optional() });
const SetConfigDefaultBodySchema = z.object({
  backend: z.string(),
  configId: z.string(),
  value: z.union([z.string(), z.null()]),
});
const ConfigOptionPostBodySchema = z.object({
  sessionId: z.string(),
  configId: z.string(),
  value: z.string(),
});
const UsageQuerySchema = z.object({ sessionId: z.string().optional() });
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
const PickFolderBodySchema = z.object({
  initialCwd: z.string().optional(),
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

const SetDefaultBackendBodySchema = z.object({ name: z.string().min(1) });

const CreateGroupBodySchema = z.object({ name: z.string().trim().min(1).max(100) });

const StreamQuerySchema = z.object({ sessionId: z.string() });

