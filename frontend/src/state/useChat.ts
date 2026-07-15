import { useCallback, useEffect, useRef, useState } from "react";
import { fetchJSON, fetchSSE } from "../api/client";
import type { ChatHistoryEntry, ChatPatch, ImageAttachment } from "../api/types";
import { useChatContext } from "./ChatContext";

export type TranscriptEntry =
  | { role: "user"; text: string; images?: ImageAttachment[]; queued?: boolean }
  | { role: "assistant"; patches: ChatPatch[] };

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
  cancel: () => void;
  sendSteer: (text: string) => Promise<void>;
  resolveApproval: (requestId: string, optionId: string) => Promise<void>;
  resolveElicitation: (
    requestId: string,
    action: "accept" | "decline" | "cancel",
    content?: Record<string, unknown>,
  ) => Promise<void>;
  startNewChat: (opts?: { fork?: boolean }) => Promise<void>;
  startNewChatInWorkspace: (cwd: string) => Promise<void>;
  openSessionInNewTab: (sessionId: string) => void;
  openWorkspaceInNewTab: (cwd: string) => void;
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

  useEffect(() => {
    if (ctx.state.sessionId) setTranscript(historyToTranscript(ctx.state.history));
  }, [ctx.state.sessionId, ctx.state.history]);

  const sendMessage = useCallback(
    async (text: string, images: ImageAttachment[] = []) => {
      if (!ctx.state.sessionId) return;
      const userEntry: TranscriptEntry =
        images.length > 0 ? { role: "user", text, images } : { role: "user", text };
      const assistantEntry: TranscriptEntry = { role: "assistant", patches: [] };
      setTranscript((cur) => [...cur, userEntry, assistantEntry]);
      ctx.setBusy(true);

      sseRef.current?.abort();
      sseRef.current = fetchSSE<ChatPatch>(
        "/chat/send",
        { message: text, sessionId: ctx.state.sessionId, images },
        {
          onPatch: (patch) => {
            setTranscript((cur) => {
              const next = cur.slice();
              const last = next[next.length - 1];
              if (!last || last.role !== "assistant") return cur;
              next[next.length - 1] = { role: "assistant", patches: [...last.patches, patch] };
              if (patch.type === "slash-commands") ctx.setSlashCommands(patch.commands);
              return next;
            });
          },
          onDone: () => { ctx.setBusy(false); ctx.setUnread(true); sseRef.current = null; },
          onError: (err) => {
            setTranscript((cur) => {
              const next = cur.slice();
              const last = next[next.length - 1];
              if (!last || last.role !== "assistant") return cur;
              next[next.length - 1] = {
                role: "assistant",
                patches: [...last.patches, { type: "error", message: err.message }, { type: "done" }],
              };
              return next;
            });
            ctx.setBusy(false);
            sseRef.current = null;
          },
        },
      );
    },
    [ctx],
  );

  const cancel = useCallback(() => {
    sseRef.current?.abort();
    sseRef.current = null;
    ctx.setBusy(false);
    if (ctx.state.sessionId) {
      void fetchJSON("/chat/cancel", { method: "POST", body: { sessionId: ctx.state.sessionId } });
    }
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

  const startNewChatInWorkspace = useCallback(async (cwd: string) => {
    if (ctx.state.busy) cancel();
    setTranscript([]);
    await ctx.init(null, cwd);
    const base = cwd.split("/").filter(Boolean).pop() ?? cwd;
    ctx.setTitle(`Chat: ${base}`);
  }, [ctx, cancel]);

  const openSessionInNewTab = useCallback((sessionId: string) => {
    const params = new URLSearchParams();
    params.set("sessionId", sessionId);
    const url = `${window.location.pathname}?${params.toString()}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }, []);

  const openWorkspaceInNewTab = useCallback((cwd: string) => {
    const params = new URLSearchParams();
    params.set("cwd", cwd);
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
    if (ctx.state.busy) cancel();
    setTranscript([]);
    await ctx.init(sessionId);
  }, [ctx, cancel]);

  const deleteSession = useCallback(async (sessionId: string) => {
    await fetchJSON(`/chat/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
    if (sessionId === ctx.state.sessionId) {
      setTranscript([]);
      await ctx.init(null);
    }
  }, [ctx]);

  const forkCurrent = useCallback(async () => {
    if (!ctx.state.sessionId) return;
    const res = await fetchJSON<{ ok: boolean; sessionId: string }>(
      "/chat/sessions/fork",
      { method: "POST", body: { sessionId: ctx.state.sessionId } },
    );
    if (res.ok && res.data?.sessionId) await switchSession(res.data.sessionId);
  }, [ctx, switchSession]);

  const startNewChat = useCallback(async (opts?: { fork?: boolean }) => {
    if (opts?.fork) {
      await forkCurrent();
      return;
    }
    if (ctx.state.busy) cancel();
    setTranscript([]);
    await ctx.init(null, ctx.state.cwd ?? undefined, ctx.state.backendName ?? undefined);
    ctx.setTitle("New chat");
  }, [ctx, cancel, forkCurrent]);

  const setModel = useCallback(async (modelId: string) => {
    if (!ctx.state.sessionId) return;
    const res = await fetchJSON<{ ok: boolean; current: string }>(
      "/chat/model",
      { method: "POST", body: { sessionId: ctx.state.sessionId, modelId } },
    );
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
