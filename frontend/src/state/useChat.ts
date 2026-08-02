import { useCallback, useEffect, useRef, useState } from "react";
import { fetchJSON, fetchSSE } from "../api/client";
import type { ChatHistoryEntry, ChatPatch, ImageAttachment } from "../api/types";
import { useChatContext } from "./ChatContext";

export type TranscriptEntry =
  | { role: "user"; text: string; images?: ImageAttachment[]; queued?: boolean; queueId?: string }
  | { role: "assistant"; patches: ChatPatch[]; streamId?: string };

interface QueuedMessage {
  id: string;
  text: string;
  images: ImageAttachment[];
}

// Appends a streaming patch to the transcript entry tagged with `streamId`.
// Patches target the streaming entry by id, not by "the trailing entry": a
// queued message is appended *below* the in-flight reply, so tail-targeting
// would mistake that queued entry for the streaming one and silently drop
// every patch — the stream would look frozen even while the backend keeps
// sending. Position-based targeting had the same failure for steer messages.
function appendPatchToStream(cur: TranscriptEntry[], streamId: string, patch: ChatPatch): TranscriptEntry[] {
  const next = cur.slice();
  const idx = next.findIndex((e) => e.role === "assistant" && e.streamId === streamId);
  if (idx === -1) return cur;
  next[idx] = { role: "assistant", patches: [...next[idx].patches, patch], streamId };
  return next;
}

function historyToTranscript(history: ChatHistoryEntry[]): TranscriptEntry[] {
  return history.map((h) =>
    h.kind === "user"
      ? { role: "user", text: h.content }
      : { role: "assistant", patches: h.patches },
  );
}

export interface UseChatResult {
  context: ReturnType<typeof useChatContext>;
  busy: boolean;
  transcript: TranscriptEntry[];
  sendMessage: (text: string, images?: ImageAttachment[]) => Promise<void>;
  enqueueMessage: (text: string, images?: ImageAttachment[]) => void;
  dequeueMessage: (queueId: string) => void;
  cancel: () => void;
  sendSteer: (text: string) => Promise<void>;
  resolveApproval: (requestId: string, optionId: string) => Promise<void>;
  resolveElicitation: (
    requestId: string,
    action: "accept" | "decline" | "cancel",
    content?: Record<string, unknown>,
  ) => Promise<void>;
  startNewChat: (opts?: { fork?: boolean }) => Promise<void>;
  startNewChatInWorkspace: (cwd: string, backend?: string) => Promise<void>;
  openSessionInNewTab: (sessionId: string) => void;
  openWorkspaceInNewTab: (cwd: string, backend?: string) => void;
  openNewChatInNewTab: () => void;
  switchSession: (sessionId: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  forkCurrent: () => Promise<void>;
  setModel: (modelId: string) => Promise<void>;
  setAutoApprove: (enabled: boolean) => Promise<void>;
}

export function useChat(): UseChatResult {
  const ctx = useChatContext();
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const sseRef = useRef<ReturnType<typeof fetchSSE> | null>(null);
  // True only while this tab is actively driving a sendMessage()-initiated
  // turn (as opposed to merely watching a reattached background turn via the
  // reattach effect below). Used to distinguish a real in-flight send from a
  // reattach-watch when deciding whether navigating away should really
  // cancel the backend turn (see switchSession/startNewChat/
  // startNewChatInWorkspace) — only the former should.
  const sendingRef = useRef(false);
  // FIFO queue of messages to send once the current turn finishes. Only the
  // ref matters for logic (the drain effect reads it synchronously); the
  // queued entries themselves render via the transcript's `queued` flags.
  const queueSeqRef = useRef(0);
  const queueRef = useRef<QueuedMessage[]>([]);
  const streamSeqRef = useRef(0);

  useEffect(() => {
    if (!ctx.state.sessionId) return;
    // History-derived entries come first; anything still queued locally is
    // kept at the tail (it isn't part of the backend's history yet), so a
    // re-init mid-queue (e.g. the error resync below) doesn't drop them.
    setTranscript((cur) => [
      ...historyToTranscript(ctx.state.history),
      ...cur.filter((e) => e.role === "user" && e.queued),
    ]);
  }, [ctx.state.sessionId, ctx.state.history]);

  useEffect(() => {
    if (!ctx.state.sessionId || !ctx.state.activeTurn) return;
    ctx.setBusy(true);
    // /chat/stream always replays this turn's complete buffered patch list as
    // its first batch (see src/server.ts's GET /chat/stream), and the
    // transcript's last assistant entry was already seeded from history with
    // that same buffered content — clear it here so the replay doesn't double
    // up. Target by streamId (not position) so the reply keeps updating even
    // while queued messages sit below it at the tail.
    const streamId = `stream-${++streamSeqRef.current}`;
    setTranscript((cur) => {
      const next = cur.slice();
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].role === "assistant") {
          next[i] = { role: "assistant", patches: [], streamId };
          break;
        }
      }
      return next;
    });
    sseRef.current?.abort();
    sseRef.current = fetchSSE<ChatPatch>(
      `/chat/stream?sessionId=${encodeURIComponent(ctx.state.sessionId)}`,
      null,
      {
        onPatch: (patch) => {
          setTranscript((cur) => appendPatchToStream(cur, streamId, patch));
          if (patch.type === "slash-commands") ctx.setSlashCommands(patch.commands);
        },
        onDone: () => { ctx.setBusy(false); sseRef.current = null; },
        onError: () => {
          ctx.setBusy(false);
          sseRef.current = null;
          // The turn may have finished in the window between /chat/init
          // reporting activeTurn: true and this /chat/stream request
          // landing (a 404 surfaces here as onError). We already cleared
          // the turn's assistant entry above expecting the stream to
          // repopulate it, so without a resync the user is left staring at
          // a blanked-out entry even though the real (now-settled) history
          // still exists on the backend. Re-init to fetch and render it.
          if (ctx.state.sessionId) void ctx.init(ctx.state.sessionId, undefined, undefined, undefined, { push: false });
        },
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.state.sessionId, ctx.state.activeTurn]);

  // Low-level: opens the /chat/send stream for a turn whose user and assistant
  // entries are already present in the transcript (appended by sendMessage, or
  // by the drain effect's promotion). onPatch/onDone/onError write to the
  // assistant entry tagged `streamId`, which may not be the trailing entry —
  // queued messages appended below it must not stall the stream.
  const streamTurn = useCallback(
    (streamId: string, text: string, images: ImageAttachment[] = []) => {
      if (!ctx.state.sessionId) return;
      ctx.setBusy(true);
      sendingRef.current = true;

      sseRef.current?.abort();
      sseRef.current = fetchSSE<ChatPatch>(
        "/chat/send",
        { message: text, sessionId: ctx.state.sessionId, images },
        {
          onPatch: (patch) => {
            setTranscript((cur) => appendPatchToStream(cur, streamId, patch));
            if (patch.type === "slash-commands") ctx.setSlashCommands(patch.commands);
          },
          onDone: () => { ctx.setBusy(false); sendingRef.current = false; ctx.setUnread(true); sseRef.current = null; },
          onError: (err) => {
            setTranscript((cur) => {
              const next = cur.slice();
              const idx = next.findIndex((e) => e.role === "assistant" && e.streamId === streamId);
              if (idx === -1) return cur;
              next[idx] = {
                role: "assistant",
                patches: [...next[idx].patches, { type: "error", message: err.message }, { type: "done" }],
                streamId,
              };
              return next;
            });
            ctx.setBusy(false);
            sendingRef.current = false;
            sseRef.current = null;
          },
        },
      );
    },
    [ctx],
  );

  const sendMessage = useCallback(
    async (text: string, images: ImageAttachment[] = []) => {
      if (!ctx.state.sessionId) return;
      const streamId = `stream-${++streamSeqRef.current}`;
      const userEntry: TranscriptEntry =
        images.length > 0 ? { role: "user", text, images } : { role: "user", text };
      const assistantEntry: TranscriptEntry = { role: "assistant", patches: [], streamId };
      setTranscript((cur) => [...cur, userEntry, assistantEntry]);
      streamTurn(streamId, text, images);
    },
    [streamTurn],
  );

  const enqueueMessage = useCallback(
    (text: string, images: ImageAttachment[] = []) => {
      const id = `queued-${++queueSeqRef.current}`;
      queueRef.current = [...queueRef.current, { id, text, images }];
      setTranscript((cur) => [...cur, { role: "user", text, images, queued: true, queueId: id }]);
    },
    [],
  );

  const dequeueMessage = useCallback(
    (queueId: string) => {
      queueRef.current = queueRef.current.filter((q) => q.id !== queueId);
      setTranscript((cur) => cur.filter((e) => e.role !== "user" || e.queueId !== queueId));
    },
    [],
  );

  const clearQueue = useCallback(() => {
    queueRef.current = [];
    setTranscript((cur) => cur.filter((e) => e.role !== "user" || !e.queued));
  }, []);

  // Drains the FIFO queue one message at a time: once the current turn is no
  // longer busy, promote the oldest queued entry to a real sent message and
  // stream it. Each drained /chat/send drives busy back to true, so the next
  // queued message only starts after the previous response completes. The
  // transcript is rebuilt so the promoted message and its reply sit above the
  // still-queued entries (which stay at the tail, below the live stream).
  useEffect(() => {
    if (ctx.state.busy || queueRef.current.length === 0) return;
    const next = queueRef.current[0];
    queueRef.current = queueRef.current.slice(1);
    const streamId = `stream-${++streamSeqRef.current}`;
    setTranscript((cur) => {
      const promoted: TranscriptEntry = { role: "user", text: next.text, images: next.images };
      const settled = cur.filter((e) => e.role !== "user" || !e.queued);
      const stillQueued = cur.filter((e) => e.role === "user" && e.queued && e.queueId !== next.id);
      return [...settled, promoted, { role: "assistant", patches: [], streamId }, ...stillQueued];
    });
    streamTurn(streamId, next.text, next.images);
  }, [ctx.state.busy, streamTurn]);

  const cancel = useCallback(() => {
    sseRef.current?.abort();
    sseRef.current = null;
    ctx.setBusy(false);
    sendingRef.current = false;
    if (ctx.state.sessionId) {
      void fetchJSON("/chat/cancel", { method: "POST", body: { sessionId: ctx.state.sessionId } });
    }
  }, [ctx]);

  // Detaches the local stream without sending a real /chat/cancel — used
  // when navigating away while merely watching a reattached background turn
  // (not one this tab actively initiated), so the backend turn keeps running.
  const detachOnly = useCallback(() => {
    sseRef.current?.abort();
    sseRef.current = null;
    ctx.setBusy(false);
  }, [ctx]);

  const sendSteer = useCallback(async (text: string) => {
    if (!ctx.state.sessionId || !ctx.state.capabilities?.steer) return;
    setTranscript((cur) => [...cur, { role: "user", text: "(steer) " + text }]);
    await fetchJSON("/chat/steer", { method: "POST", body: { sessionId: ctx.state.sessionId, prompt: text } });
  }, [ctx]);

  const resolveApproval = useCallback(async (requestId: string, optionId: string) => {
    if (!ctx.state.sessionId) return;
    await fetchJSON("/chat/approval", { method: "POST", body: { sessionId: ctx.state.sessionId, requestId, optionId } });
  }, [ctx]);

  const resolveElicitation = useCallback(
    async (requestId: string, action: "accept" | "decline" | "cancel", content?: Record<string, unknown>) => {
      if (!ctx.state.sessionId) return;
      await fetchJSON("/chat/elicitation", {
        method: "POST",
        body: { sessionId: ctx.state.sessionId, requestId, action, content },
      });
    },
    [ctx],
  );

  const startNewChatInWorkspace = useCallback(async (cwd: string, backend?: string) => {
    if (ctx.state.busy) { if (sendingRef.current) cancel(); else detachOnly(); }
    clearQueue();
    setTranscript([]);
    await ctx.init(null, cwd, backend);
    const base = cwd.split("/").filter(Boolean).pop() ?? cwd;
    ctx.setTitle(`Chat: ${base}`);
  }, [ctx, cancel, detachOnly, clearQueue]);

  const openSessionInNewTab = useCallback((sessionId: string) => {
    const params = new URLSearchParams();
    params.set("sessionId", sessionId);
    const url = `${window.location.pathname}?${params.toString()}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }, []);

  const openWorkspaceInNewTab = useCallback((cwd: string, backend?: string) => {
    const params = new URLSearchParams();
    params.set("cwd", cwd);
    if (backend) params.set("backend", backend);
    const url = `${window.location.pathname}?${params.toString()}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }, []);

  const openNewChatInNewTab = useCallback(() => {
    const params = new URLSearchParams();
    if (ctx.state.cwd) params.set("cwd", ctx.state.cwd);
    if (ctx.state.backendName) params.set("backend", ctx.state.backendName);
    if (ctx.state.currentModel) params.set("model", ctx.state.currentModel);
    const url = params.toString() ? `${window.location.pathname}?${params.toString()}` : window.location.pathname;
    window.open(url, "_blank", "noopener,noreferrer");
  }, [ctx.state.cwd, ctx.state.backendName, ctx.state.currentModel]);

  const switchSession = useCallback(async (sessionId: string) => {
    if (ctx.state.busy) { if (sendingRef.current) cancel(); else detachOnly(); }
    clearQueue();
    setTranscript([]);
    await ctx.init(sessionId);
  }, [ctx, cancel, detachOnly, clearQueue]);

  const deleteSession = useCallback(async (sessionId: string) => {
    await fetchJSON(`/chat/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
    if (sessionId === ctx.state.sessionId) {
      clearQueue();
      setTranscript([]);
      await ctx.init(null);
    }
  }, [ctx, clearQueue]);

  const forkCurrent = useCallback(async () => {
    if (!ctx.state.sessionId) return;
    const res = await fetchJSON<{ ok: boolean; sessionId: string }>(
      "/chat/sessions/fork",
      { method: "POST", body: { sessionId: ctx.state.sessionId } },
    );
    // Opens in a new tab (rather than switching the current one) so forking
    // reads as "branch this into a new chat", leaving the original session's
    // tab untouched and still on the source conversation.
    if (res.ok && res.data?.sessionId) openSessionInNewTab(res.data.sessionId);
  }, [ctx, openSessionInNewTab]);

  const startNewChat = useCallback(async (opts?: { fork?: boolean }) => {
    if (opts?.fork) {
      await forkCurrent();
      return;
    }
    if (ctx.state.busy) { if (sendingRef.current) cancel(); else detachOnly(); }
    clearQueue();
    setTranscript([]);
    await ctx.init(null, ctx.state.cwd ?? undefined, ctx.state.backendName ?? undefined);
    ctx.setTitle("New chat");
  }, [ctx, cancel, detachOnly, forkCurrent, clearQueue]);

  const setModel = useCallback(async (modelId: string) => {
    if (!ctx.state.sessionId) return;
    console.log(`[FE] setModel modelId=${modelId} sessionId=${ctx.state.sessionId}`);
    const res = await fetchJSON<{ ok: boolean; current: string }>(
      "/chat/model",
      { method: "POST", body: { sessionId: ctx.state.sessionId, modelId } },
    );
    console.log(`[FE]   setModel response ok=${res.ok} data=${JSON.stringify(res.data)}`);
    if (res.ok && res.data) ctx.setModels(ctx.state.models, res.data.current);
  }, [ctx]);

  const setAutoApprove = useCallback(async (enabled: boolean) => {
    if (!ctx.state.sessionId) return;
    const res = await fetchJSON<{ effective: boolean; default: boolean; override: boolean | null }>(
      "/chat/auto-approve",
      { method: "POST", body: { enabled, sessionId: ctx.state.sessionId } },
    );
    if (res.ok && res.data) {
      ctx.setAutoApprove({
        supported: true,
        default: res.data.default,
        override: res.data.override,
        effective: res.data.effective,
        enabled: res.data.effective,
      });
    }
  }, [ctx]);

  return {
    context: ctx,
    busy: ctx.state.busy,
    transcript,
    sendMessage,
    enqueueMessage,
    dequeueMessage,
    cancel,
    sendSteer,
    resolveApproval,
    resolveElicitation,
    startNewChat,
    startNewChatInWorkspace,
    openSessionInNewTab,
    openWorkspaceInNewTab,
    openNewChatInNewTab,
    switchSession,
    deleteSession,
    forkCurrent,
    setModel,
    setAutoApprove,
  };
}
