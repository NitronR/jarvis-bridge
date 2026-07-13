import { useCallback, useEffect, useRef, useState } from "react";
import { useChat } from "../state/useChat";
import { useToast } from "../state/ToastContext";
import { fetchJSON } from "../api/client";
import { Transcript } from "./Transcript";
import { Composer } from "./Composer";
import { InfoPanel } from "./InfoPanel";
import { ApprovalModal } from "./ApprovalModal";
import { ChatsDrawer } from "./ChatsDrawer";
import { WorkspacesDrawer } from "./WorkspacesDrawer";
import { loadRecentWorkspaces, pushRecentWorkspace } from "../state/recentWorkspaces";
import type { ImageAttachment, SessionSummary, ChatPatch } from "../api/types";
import styles from "./ChatPanel.module.css";

const FOLLOW_CHAT_STORAGE_KEY = "jarvis.followChat";

function safeGetStoredFollowChat(): boolean {
  try {
    const raw = window.localStorage?.getItem(FOLLOW_CHAT_STORAGE_KEY);
    return raw === null ? true : raw === "true";
  } catch {
    return true;
  }
}

function safeSetStoredFollowChat(value: boolean): void {
  try {
    window.localStorage?.setItem(FOLLOW_CHAT_STORAGE_KEY, String(value));
  } catch {
    // ignore (storage may be unavailable)
  }
}

export function ChatPanel() {
  return <ChatPanelInner />;
}

function ChatPanelInner() {
  const chat = useChat();
  const toast = useToast();
  const ctx = chat.context;
  const [infoHidden, setInfoHidden] = useState(false);
  const [followChat, setFollowChatState] = useState(() => safeGetStoredFollowChat());
  const setFollowChat = useCallback((value: boolean | ((v: boolean) => boolean)) => {
    setFollowChatState((prev) => {
      const next = typeof value === "function" ? (value as (v: boolean) => boolean)(prev) : value;
      safeSetStoredFollowChat(next);
      return next;
    });
  }, []);
  const [pastChatsOpen, setPastChatsOpen] = useState(false);
  const [workspacesOpen, setWorkspacesOpen] = useState(false);
  const [recentWorkspaces, setRecentWorkspaces] = useState<string[]>(() => loadRecentWorkspaces());
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [steerEnabled, setSteerEnabled] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<(ChatPatch & { type: "approval-request" }) | null>(null);
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const [pickingFolder, setPickingFolder] = useState(false);
  const queueRef = useRef<string | null>(null);

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("jarvis:cwd-changed", { detail: { cwd: ctx.state.cwd } }),
    );
  }, [ctx.state.cwd]);

  useEffect(() => {
    document.title = `${ctx.state.title || "New chat"} — Jarvis Bridge`;
  }, [ctx.state.title]);

  useEffect(() => {
    return () => {
      document.title = "Jarvis Bridge";
    };
  }, []);

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
      ctx.setGroup(g);
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
      ctx.setPinned(p);
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

  const onForkCurrent = useCallback(async () => {
    await chat.forkCurrent();
  }, [chat]);

  const onSwitchSession = useCallback(
    async (sessionId: string) => {
      setPastChatsOpen(false);
      await chat.switchSession(sessionId);
    },
    [chat],
  );

  const onDeleteSession = useCallback(
    async (sessionId: string) => {
      await chat.deleteSession(sessionId);
      setSessions((cur) => cur.filter((s) => s.sessionId !== sessionId));
    },
    [chat],
  );

  const onOpenSessionInNewTab = useCallback(
    (sessionId: string) => {
      chat.openSessionInNewTab(sessionId);
    },
    [chat],
  );

  const onNewChat = useCallback(
    async (e?: { metaKey?: boolean; ctrlKey?: boolean }) => {
      if (e?.metaKey || e?.ctrlKey) {
        chat.openNewChatInNewTab();
        return;
      }
      await chat.startNewChat();
    },
    [chat],
  );

  const openPastChats = useCallback(async () => {
    const res = await fetchJSON<{ sessions: SessionSummary[] }>("/chat/sessions");
    if (res.ok && res.data) {
      setSessions(res.data.sessions);
      ctx.pruneTurnCounts(new Set(res.data.sessions.map((s) => s.sessionId)));
    }
    setPastChatsOpen(true);
  }, [ctx]);

  const startInCwd = useCallback(
    async (cwd: string) => {
      await chat.startNewChatInWorkspace(cwd);
      setRecentWorkspaces(pushRecentWorkspace(cwd));
    },
    [chat],
  );

  const openWorkspaceInNewTab = useCallback(
    (cwd: string) => {
      setRecentWorkspaces(pushRecentWorkspace(cwd));
      chat.openWorkspaceInNewTab(cwd);
    },
    [chat],
  );

  const onPickFolder = useCallback(async () => {
    setPickingFolder(true);
    try {
      const initialCwd = recentWorkspaces[0];
      const res = await fetchJSON<{ ok: boolean; cancelled: boolean; cwd: string | null; error?: string }>(
        "/chat/pick-folder",
        { method: "POST", body: { initialCwd } },
      );
      if (!res.ok || !res.data?.ok) {
        toast.push(res.data?.error ?? "Folder picker unavailable", "error");
        return;
      }
      if (res.data.cancelled || !res.data.cwd) return;
      setWorkspacesOpen(false);
      await startInCwd(res.data.cwd);
    } finally {
      setPickingFolder(false);
    }
  }, [recentWorkspaces, startInCwd, toast]);

  const openWorkspacesDrawer = useCallback(() => {
    setRecentWorkspaces(loadRecentWorkspaces());
    setWorkspacesOpen(true);
  }, []);

  const onNewChatInWorkspace = useCallback(() => {
    openWorkspacesDrawer();
  }, [openWorkspacesDrawer]);

  return (
    <div className={styles.panel}>
      <div className={styles.stage}>
        <div className={styles.main}>
          <div className={styles.header}>
            <h1>{ctx.state.title || "New chat"}</h1>
            <button onClick={() => setInfoHidden((v) => !v)}>Info</button>
            <button
              onClick={() => setFollowChat((v) => !v)}
              className={followChat ? "primary" : ""}
              title={followChat ? "Following chat — click to stop auto-scrolling" : "Not following — click to auto-scroll to latest"}
            >
              Follow
            </button>
            <button onClick={openPastChats}>Chats</button>
            <button onClick={onNewChat}>+ New</button>
            <button
              onClick={onNewChatInWorkspace}
              disabled={!ctx.state.capabilities?.customWorkingDirectory || pickingFolder}
            >
              + New in...
            </button>
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
          <ChatsDrawer open={pastChatsOpen} sessions={sessions} recentWorkspaces={recentWorkspaces} onClose={() => setPastChatsOpen(false)} onSwitch={onSwitchSession} onOpenInNewTab={onOpenSessionInNewTab} onDelete={onDeleteSession} canDelete={!!ctx.state.capabilities?.sessionDelete} getTurnCount={ctx.getTurnCount} />
          <WorkspacesDrawer
            open={workspacesOpen}
            recentWorkspaces={recentWorkspaces}
            onClose={() => setWorkspacesOpen(false)}
            onOpenInWorkspace={async (cwd) => {
              setWorkspacesOpen(false);
              await startInCwd(cwd);
            }}
            onOpenInNewTab={openWorkspaceInNewTab}
            onPickFolder={onPickFolder}
            pickDisabled={pickingFolder}
          />
          <Transcript entries={chat.transcript} loading={ctx.state.loading} follow={followChat} onApproval={onApproval} onSteerAck={onSteerAck} onImagesSkipped={onImagesSkipped} />
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
            group={ctx.state.group}
            pinned={ctx.state.pinned}
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