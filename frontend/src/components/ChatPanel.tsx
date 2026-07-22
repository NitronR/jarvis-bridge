import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "../state/useChat";
import { useToast } from "../state/ToastContext";
import { fetchJSON } from "../api/client";
import { Transcript } from "./Transcript";
import { Composer } from "./Composer";
import { InfoPanel } from "./InfoPanel";
import { ApprovalModal } from "./ApprovalModal";
import { ElicitationModal } from "./ElicitationModal";
import { ChatsDrawer } from "./ChatsDrawer";
import { WorkspacesDrawer } from "./WorkspacesDrawer";
import { loadRecentWorkspaces, pushRecentWorkspace } from "../state/recentWorkspaces";
import type { ImageAttachment, SessionSummary, ChatPatch, UsageTotals, RateLimitWindow } from "../api/types";
import styles from "./ChatPanel.module.css";
import { Button } from "./ui/Button";

// Per-window field merge (not a wholesale replace) — a manual /chat/usage
// refresh contributes {utilization, resetsAtText} while the passive
// rate_limit_event stream contributes {status, resetsAt}; neither channel
// should blank out fields the other already knows.
function mergeRateLimits(
  a: Record<string, RateLimitWindow> | undefined,
  b: Record<string, RateLimitWindow> | undefined,
): Record<string, RateLimitWindow> | undefined {
  if (!a && !b) return undefined;
  const out: Record<string, RateLimitWindow> = { ...a };
  for (const [key, w] of Object.entries(b ?? {})) {
    out[key] = { ...out[key], ...w };
  }
  return out;
}

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

const INFO_HIDDEN_STORAGE_KEY = "jarvis.infoHidden";

function safeGetStoredInfoHidden(): boolean {
  try {
    return window.localStorage?.getItem(INFO_HIDDEN_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function safeSetStoredInfoHidden(value: boolean): void {
  try {
    window.localStorage?.setItem(INFO_HIDDEN_STORAGE_KEY, String(value));
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
  const [infoHidden, setInfoHiddenState] = useState(() => safeGetStoredInfoHidden());
  const setInfoHidden = useCallback((value: boolean | ((v: boolean) => boolean)) => {
    setInfoHiddenState((prev) => {
      const next = typeof value === "function" ? (value as (v: boolean) => boolean)(prev) : value;
      safeSetStoredInfoHidden(next);
      return next;
    });
  }, []);
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
  const [pendingElicitation, setPendingElicitation] = useState<(ChatPatch & { type: "elicitation-request" }) | null>(null);
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const [pickingFolder, setPickingFolder] = useState(false);
  const [manualRateLimits, setManualRateLimits] = useState<Record<string, RateLimitWindow> | undefined>();
  const [refreshingUsage, setRefreshingUsage] = useState(false);
  const queueRef = useRef<string | null>(null);

  const latestUsage = useMemo((): UsageTotals | undefined => {
    for (let i = chat.transcript.length - 1; i >= 0; i--) {
      const entry = chat.transcript[i];
      if (entry.role !== "assistant") continue;
      for (let j = entry.patches.length - 1; j >= 0; j--) {
        const p = entry.patches[j];
        if (p.type === "usage") return p.usage;
      }
    }
    // No live usage patch in this tab's transcript yet (e.g. right after a
    // resume/reload) — fall back to the gateway's cached last-known usage,
    // since Claude's own session/load replay doesn't re-emit usage_update
    // for past turns (see docs/acp-notes.md).
    return ctx.state.lastUsage ?? undefined;
  }, [chat.transcript, ctx.state.lastUsage]);

  // A manual "refresh usage" click (see onRefreshUsage below) layers its
  // result over whatever the passive stream already produced, rather than
  // replacing it — see mergeRateLimits.
  const displayedUsage = useMemo((): UsageTotals | undefined => {
    if (!manualRateLimits) return latestUsage;
    return {
      ...(latestUsage ?? { requests: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 }),
      rate_limits: mergeRateLimits(latestUsage?.rate_limits, manualRateLimits),
    };
  }, [latestUsage, manualRateLimits]);

  // Manually-refreshed rate limits are account-level, not persisted, and
  // shouldn't leak from one session's tab into another's.
  useEffect(() => {
    setManualRateLimits(undefined);
  }, [ctx.state.sessionId]);

  const onRefreshUsage = useCallback(async () => {
    if (!ctx.state.sessionId) return;
    setRefreshingUsage(true);
    try {
      const res = await fetchJSON<{ ok: boolean; rate_limits: Record<string, RateLimitWindow> | null; error?: string }>(
        `/chat/usage?sessionId=${encodeURIComponent(ctx.state.sessionId)}`,
      );
      if (!res.ok) {
        toast.push("Usage refresh failed: " + (res.data?.error || res.status), "error");
        return;
      }
      if (res.data.rate_limits) setManualRateLimits(res.data.rate_limits);
    } catch (err) {
      toast.push("Usage refresh failed: " + (err instanceof Error ? err.message : String(err)), "error");
    } finally {
      setRefreshingUsage(false);
    }
  }, [ctx.state.sessionId, toast]);

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

  const onElicitation = useCallback((p: ChatPatch & { type: "elicitation-request" }) => {
    setPendingElicitation(p);
  }, []);

  const onResolveElicitation = useCallback(
    async (requestId: string, action: "accept" | "decline" | "cancel", content?: Record<string, unknown>) => {
      setPendingElicitation(null);
      try {
        await chat.resolveElicitation(requestId, action, content);
      } catch (err) {
        toast.push("Failed to send answer: " + (err instanceof Error ? err.message : String(err)), "error");
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
            {/* Primary group */}
            <Button variant="primary" onClick={onNewChat}>＋ New</Button>
            <Button
              variant={followChat ? "primary" : "default"}
              onClick={() => setFollowChat((v) => !v)}
              title={followChat ? "Following chat — click to stop auto-scrolling" : "Not following — click to auto-scroll to latest"}
            >
              ↓ Follow
            </Button>
            <Button variant="primary" onClick={openPastChats}>☰ Chats</Button>
            {/* Divider */}
            <span className={styles.divider} />
            {/* Secondary group */}
            <Button onClick={() => setInfoHidden((v) => !v)}>Info</Button>
            <Button
              onClick={onNewChatInWorkspace}
              disabled={!ctx.state.capabilities?.customWorkingDirectory || pickingFolder}
            >
              + New in...
            </Button>
            <Button onClick={onForkCurrent} disabled={!ctx.state.capabilities?.canFork || chat.busy}>Fork</Button>
            <Button
              variant={steerEnabled ? "primary" : "default"}
              onClick={() => setSteerEnabled((v) => !v)}
              disabled={!ctx.state.capabilities?.steer}
            >
              Steer
            </Button>
            <Button
              variant={ctx.state.autoApprove.effective ? "primary" : "default"}
              onClick={onAutoApproveToggle}
              disabled={!ctx.state.capabilities?.toolApprovals}
            >
              {ctx.state.autoApprove.effective ? "✓ Auto-approve" : "Auto-approve"}
            </Button>
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
          <Transcript
            entries={chat.transcript}
            loading={ctx.state.loading}
            follow={followChat}
            backendKind={ctx.state.backendKind}
            onApproval={onApproval}
            onElicitation={onElicitation}
            onSteerAck={onSteerAck}
            onImagesSkipped={onImagesSkipped}
          />
          <Composer
            busy={chat.busy}
            steerEnabled={steerEnabled}
            steerSupported={!!ctx.state.capabilities?.steer}
            imagesSupported={!!ctx.state.capabilities?.images}
            attachments={attachments}
            latestUsage={latestUsage}
            onRemoveAttachment={onRemoveAttachment}
            onAttachFiles={onAttachFiles}
            onSend={onSend}
            onSteer={onSteerComposer}
            onCancel={async () => chat.cancel()}
            onQueue={onQueue}
            onToggleSteer={() => setSteerEnabled((v) => !v)}
          />
        </div>
        <div className={infoHidden ? `${styles.infoWrap} ${styles.infoHidden}` : styles.infoWrap} aria-hidden={infoHidden}>
          <InfoPanel
            state={ctx.state}
            title={ctx.state.title}
            group={ctx.state.group}
            pinned={ctx.state.pinned}
            usage={displayedUsage}
            usageQuerySupported={!!ctx.state.capabilities?.usageQuery}
            refreshingUsage={refreshingUsage}
            onRename={onRename}
            onGroup={onGroupChange}
            onPinned={onPinnedChange}
            onModelChange={onModelChange}
            onAutoApproveToggle={onAutoApproveToggle}
            onRefreshUsage={onRefreshUsage}
          />
        </div>
      </div>
      <ApprovalModal patch={pendingApproval} onResolve={onResolveApproval} />
      <ElicitationModal patch={pendingElicitation} onResolve={onResolveElicitation} />
    </div>
  );
}