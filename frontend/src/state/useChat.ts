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
  startNewChat: () => Promise<void>;
  switchSession: (sessionId: string) => Promise<void>;
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
          onDone: () => { ctx.setBusy(false); sseRef.current = null; },
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

  const startNewChat = useCallback(async () => {
    if (ctx.state.busy) cancel();
    setTranscript([]);
    await ctx.init(null);
    ctx.setTitle("New chat");
  }, [ctx, cancel]);

  const switchSession = useCallback(async (sessionId: string) => {
    if (ctx.state.busy) cancel();
    setTranscript([]);
    await ctx.init(sessionId);
  }, [ctx, cancel]);

  const forkCurrent = useCallback(async () => {
    if (!ctx.state.sessionId) return;
    const res = await fetchJSON<{ ok: boolean; sessionId: string }>(
      "/chat/sessions/fork",
      { method: "POST", body: { sessionId: ctx.state.sessionId } },
    );
    if (res.ok && res.data?.sessionId) await switchSession(res.data.sessionId);
  }, [ctx, switchSession]);

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
    startNewChat,
    switchSession,
    forkCurrent,
    setModel,
    setAutoApprove,
  };
}
