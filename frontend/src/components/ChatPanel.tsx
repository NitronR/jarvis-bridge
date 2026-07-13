import { useCallback, useEffect, useRef, useState } from "react";
import { ChatProvider } from "../state/ChatContext";
import { useChat } from "../state/useChat";
import { useToast } from "../state/ToastContext";
import { fetchJSON } from "../api/client";
import { Transcript } from "./Transcript";
import { Composer } from "./Composer";
import { InfoPanel } from "./InfoPanel";
import { ApprovalModal } from "./ApprovalModal";
import { PastChatsMenu } from "./PastChatsMenu";
import type { ImageAttachment, SessionSummary, ChatPatch } from "../api/types";
import styles from "./ChatPanel.module.css";

export function ChatPanel() {
  return (
    <ChatProvider>
      <ChatPanelInner />
    </ChatProvider>
  );
}

function ChatPanelInner() {
  const chat = useChat();
  const toast = useToast();
  const ctx = chat.context;
  const [infoHidden, setInfoHidden] = useState(false);
  const [pastChatsOpen, setPastChatsOpen] = useState(false);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [steerEnabled, setSteerEnabled] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<ChatPatch | null>(null);
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const [group, setGroup] = useState("");
  const [pinned, setPinned] = useState(false);
  const queueRef = useRef<string | null>(null);

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("jarvis:cwd-changed", { detail: { cwd: ctx.state.cwd } }),
    );
  }, [ctx.state.cwd]);

  const onApproval = useCallback((p: ChatPatch & { type: "approval-request" }) => {
    setPendingApproval(p);
  }, []);

  const onResolveApproval = useCallback(
    async (requestId: string, optionId: string) => {
      setPendingApproval(null);
      try {
        await chat.resolveApproval(requestId, optionId);
      } catch (err) {
        toast.push("Approval failed: " + (err instanceof Error ? err.message : String(err)), "error");
      }
    },
    [chat, toast],
  );

  const onSteerAck = useCallback(
    (p: ChatPatch & { type: "steer-ack" }) => {
      toast.push(p.accepted ? "Steer accepted" : "Steer rejected: " + (p.reason || ""), p.accepted ? "success" : "warning");
    },
    [toast],
  );

  const onImagesSkipped = useCallback(
    (p: ChatPatch & { type: "images-skipped" }) => {
      toast.push("Skipped " + (p.skipped || []).length + " image(s)", "warning");
    },
    [toast],
  );

  const onSend = useCallback(
    (text: string) => {
      const imgs = attachments;
      setAttachments([]);
      void chat.sendMessage(text, imgs);
    },
    [attachments, chat],
  );

  const onAttachFiles = useCallback((files: File[]) => {
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const data = String(reader.result || "");
        const base64 = data.split(",")[1] || "";
        setAttachments((cur) => [...cur, { data: base64, mimeType: file.type, filename: file.name }]);
      };
      reader.readAsDataURL(file);
    });
  }, []);

  const onRemoveAttachment = useCallback((idx: number) => {
    setAttachments((cur) => cur.filter((_, i) => i !== idx));
  }, []);

  const onRename = useCallback(
    (t: string) => {
      ctx.setTitle(t || "Untitled");
      if (ctx.state.sessionId) {
        void fetchJSON(`/chat/sessions/${encodeURIComponent(ctx.state.sessionId)}`, {
          method: "PATCH",
          body: { customTitle: t || null },
        });
      }
    },
    [ctx],
  );

  const onGroupChange = useCallback(
    (g: string) => {
      setGroup(g);
      if (ctx.state.sessionId) {
        void fetchJSON(`/chat/sessions/${encodeURIComponent(ctx.state.sessionId)}`, {
          method: "PATCH",
          body: { group: g || null },
        });
      }
    },
    [ctx],
  );

  const onPinnedChange = useCallback(
    (p: boolean) => {
      setPinned(p);
      if (ctx.state.sessionId) {
        void fetchJSON(`/chat/sessions/${encodeURIComponent(ctx.state.sessionId)}`, {
          method: "PATCH",
          body: { pinned: p },
        });
      }
    },
    [ctx],
  );

  const onModelChange = useCallback(
    (modelId: string) => {
      void chat.setModel(modelId);
    },
    [chat],
  );

  const onAutoApproveToggle = useCallback(() => {
    void chat.setAutoApprove(!ctx.state.autoApprove.effective);
  }, [chat, ctx]);

  const onQueue = useCallback(async (text: string) => {
    queueRef.current = text;
    toast.push("Queued for after current turn", "info");
  }, [toast]);

  const onSteerComposer = useCallback(async (text: string) => {
    await chat.sendSteer(text);
  }, [chat]);

  useEffect(() => {
    if (!chat.busy && queueRef.current) {
      const next = queueRef.current;
      queueRef.current = null;
      setAttachments([]);
      void chat.sendMessage(next);
    }
  }, [chat.busy, chat]);

  const openPastChats = useCallback(async () => {
    const res = await fetchJSON<{ sessions: SessionSummary[] }>("/chat/sessions");
    if (res.ok && res.data) setSessions(res.data.sessions);
    setPastChatsOpen(true);
  }, []);

  const onSwitchSession = useCallback(
    async (sessionId: string) => {
      setPastChatsOpen(false);
      await chat.switchSession(sessionId);
    },
    [chat],
  );

  const onDeleteSession = useCallback(
    async (sessionId: string) => {
      const res = await fetchJSON(`/chat/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
      if (res.ok) {
        const refreshed = await fetchJSON<{ sessions: SessionSummary[] }>("/chat/sessions");
        if (refreshed.ok && refreshed.data) setSessions(refreshed.data.sessions);
        toast.push("Session deleted", "success");
        if (sessionId === ctx.state.sessionId) await chat.startNewChat();
      } else {
        toast.push("Could not delete session", "error");
      }
    },
    [toast, chat, ctx.state.sessionId],
  );

  const onForkCurrent = useCallback(() => {
    void chat.forkCurrent().then(() => toast.push("Forked new session", "success"));
  }, [chat, toast]);

  const onNewChat = useCallback(async () => {
    await chat.startNewChat();
  }, [chat]);

  return (
    <div className={styles.panel}>
      <div className={styles.stage}>
        <div className={styles.main}>
          <div className={styles.header}>
            <h1>{ctx.state.title || "New chat"}</h1>
            <button onClick={() => setInfoHidden((v) => !v)}>Info</button>
            <button onClick={openPastChats}>Chats</button>
            <button onClick={onNewChat}>+ New</button>
            <button onClick={onForkCurrent} disabled={!ctx.state.capabilities?.canFork || chat.busy}>Fork</button>
            <button
              onClick={() => setSteerEnabled((v) => !v)}
              disabled={!ctx.state.capabilities?.steer}
              className={steerEnabled ? "primary" : ""}
            >
              Steer
            </button>
            <button onClick={() => void chat.setAutoApprove(!ctx.state.autoApprove.effective)} disabled={!ctx.state.capabilities?.toolApprovals}>
              {ctx.state.autoApprove.effective ? "AA✓" : "AA"}
            </button>
          </div>
          <PastChatsMenu open={pastChatsOpen} sessions={sessions} onClose={() => setPastChatsOpen(false)} onSwitch={onSwitchSession} onDelete={onDeleteSession} canDelete={!!ctx.state.capabilities?.sessionDelete} />
          <Transcript entries={chat.transcript} onApproval={onApproval} onSteerAck={onSteerAck} onImagesSkipped={onImagesSkipped} />
          <Composer
            busy={chat.busy}
            steerEnabled={steerEnabled}
            steerSupported={!!ctx.state.capabilities?.steer}
            imagesSupported={!!ctx.state.capabilities?.images}
            attachments={attachments}
            onRemoveAttachment={onRemoveAttachment}
            onAttachFiles={onAttachFiles}
            onSend={onSend}
            onSteer={onSteerComposer}
            onCancel={async () => chat.cancel()}
            onQueue={onQueue}
            onToggleSteer={() => setSteerEnabled((v) => !v)}
          />
        </div>
        <div className={infoHidden ? styles.infoHidden : ""}>
          <InfoPanel
            state={ctx.state}
            title={ctx.state.title}
            group={group}
            pinned={pinned}
            onRename={onRename}
            onGroup={onGroupChange}
            onPinned={onPinnedChange}
            onModelChange={onModelChange}
            onAutoApproveToggle={onAutoApproveToggle}
          />
        </div>
      </div>
      <ApprovalModal patch={pendingApproval} onResolve={onResolveApproval} />
    </div>
  );
}
