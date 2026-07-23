import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "../state/useChat";
import { useToast } from "../state/ToastContext";
import { fetchJSON } from "../api/client";
import { Transcript } from "./Transcript";
import { Composer } from "./Composer";
import { InfoPanel } from "./InfoPanel";
import { ApprovalModal } from "./ApprovalModal";
import { ElicitationModal } from "./ElicitationModal";
import { SettingsDialog } from "./SettingsDialog";
import { ChatsDrawer } from "./ChatsDrawer";
import { WorkspacesDrawer } from "./WorkspacesDrawer";
import { loadRecentWorkspaces, pushRecentWorkspace } from "../state/recentWorkspaces";
import type { ImageAttachment, SessionSummary, ChatPatch, UsageTotals, RateLimitWindow } from "../api/types";
import styles from "./ChatPanel.module.css";
import { Button } from "./ui/Button";
import { Select } from "./ui/Select";
import { Dot, type DotStatus } from "./ui/Dot";

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

export function ChatPanel({ healthOk }: { healthOk: boolean | null }) {
  return <ChatPanelInner healthOk={healthOk} />;
}

function ChatPanelInner({ healthOk }: { healthOk: boolean | null }) {
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
  const [settingsOpen, setSettingsOpen] = useState(false);
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
    if (ctx.state.title) {
      history.pushState(null, "", `#${encodeURIComponent(ctx.state.title)}`);
    }
  }, [ctx.state.title]);

  useEffect(() => {
    const onPopState = () => {
      const hash = decodeURIComponent(window.location.hash.replace(/^#/, ""));
      if (hash) {
        document.title = `${hash} — Jarvis Bridge`;
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

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

  const onAddGroup = useCallback(
    async (name: string) => {
      const res = await fetchJSON<{ groups: string[] }>("/chat/groups", {
        method: "POST",
        body: { name },
      });
      if (res.ok && Array.isArray(res.data?.groups)) {
        ctx.setGroups(res.data.groups);
      }
    },
    [ctx],
  );

  const [addGroupOpen, setAddGroupOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");

  const handleGroupChange = useCallback(
    (value: string) => {
      if (value === "__add_group__") {
        setAddGroupOpen(true);
        setNewGroupName("");
        return;
      }
      onGroupChange(value);
    },
    [onGroupChange],
  );

  const handleCreateGroup = useCallback(async () => {
    const name = newGroupName.trim();
    if (!name) return;
    await onAddGroup(name);
    onGroupChange(name);
    setAddGroupOpen(false);
    setNewGroupName("");
  }, [newGroupName, onAddGroup, onGroupChange]);

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

  // Composer's Steer button now only renders while busy — if steerEnabled
  // stayed true across a turn ending, there'd be no visible control left to
  // turn it off, silently misrouting the next message through onSteer
  // instead of onSend. Auto-reset it whenever a turn is no longer busy.
  useEffect(() => {
    if (!chat.busy) setSteerEnabled(false);
  }, [chat.busy]);

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

  const onToggleSessionPin = useCallback(
    async (sessionId: string, pinned: boolean) => {
      setSessions((cur) => cur.map((s) => (s.sessionId === sessionId ? { ...s, pinned } : s)));
      if (sessionId === ctx.state.sessionId) {
        ctx.setPinned(pinned);
      }
      await fetchJSON(`/chat/sessions/${encodeURIComponent(sessionId)}`, {
        method: "PATCH",
        body: { pinned },
      });
    },
    [ctx],
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

  const healthStatus: DotStatus = healthOk === null ? "idle" : healthOk ? "ok" : "bad";

  const [titleDraft, setTitleDraft] = useState(ctx.state.title);
  const [editingTitle, setEditingTitle] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);

  const openTitleEdit = () => {
    setTitleDraft(ctx.state.title);
    setEditingTitle(true);
  };

  const commitTitle = () => {
    setEditingTitle(false);
    if (titleDraft !== ctx.state.title) onRename(titleDraft);
  };

  const revertTitle = () => setEditingTitle(false);

  useEffect(() => {
    if (editingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [editingTitle]);

  return (
    <div className={styles.panel}>
      <div className={styles.stage}>
        <div className={styles.main}>
          <div className={styles.header}>
            <Dot status={healthStatus} />
            {editingTitle ? (
              <input
                ref={titleInputRef}
                className={styles.titleInput}
                aria-label="Title"
                placeholder="New chat"
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitTitle();
                  if (e.key === "Escape") revertTitle();
                }}
                onBlur={commitTitle}
              />
            ) : (
              <button
                type="button"
                className={`${styles.titleButton} ${ctx.state.title ? "" : styles.titlePlaceholder}`}
                onClick={openTitleEdit}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openTitleEdit();
                  }
                }}
                aria-label="Edit title"
              >
                {ctx.state.title || "New chat"}
              </button>
            )}
            <span className={styles.headerSpacer}>
              <Select
                value={ctx.state.group || ""}
                options={[
                  { value: "", label: "Add to Group" },
                  ...ctx.state.groups.map((g) => ({ value: g, label: g })),
                  { value: "__add_group__", label: "+ Add Group…" },
                ]}
                onChange={handleGroupChange}
                aria-label="Group"
              />
            </span>
            {/* Primary group */}
            <Button variant="primary" onClick={onNewChat}>＋ New</Button>
            <Button
              variant={followChat ? "primary" : "default"}
              className={followChat ? styles.toggleOn : undefined}
              onClick={() => setFollowChat((v) => !v)}
              title={followChat ? "Following chat — click to stop auto-scrolling" : "Not following — click to auto-scroll to latest"}
            >
              ↓ Follow
            </Button>
            <Button onClick={openPastChats}>☰ Chats</Button>
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
            <button
              type="button"
              className={`${styles.pinBtn} ${ctx.state.pinned ? styles.pinBtnActive : ""}`}
              onClick={() => onPinnedChange(!ctx.state.pinned)}
              aria-label={ctx.state.pinned ? "Unpin session" : "Pin session"}
            >
              <svg viewBox="0 0 24 24" fill={ctx.state.pinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 17v5" />
                <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
              </svg>
            </button>
            <button
              type="button"
              className={styles.settingsBtn}
              onClick={() => setSettingsOpen(true)}
              title="Settings"
              aria-label="Settings"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
          <ChatsDrawer open={pastChatsOpen} sessions={sessions} groups={ctx.state.groups} recentWorkspaces={recentWorkspaces} onClose={() => setPastChatsOpen(false)} onSwitch={onSwitchSession} onOpenInNewTab={onOpenSessionInNewTab} onDelete={onDeleteSession} onTogglePin={onToggleSessionPin} canDelete={!!ctx.state.capabilities?.sessionDelete} getTurnCount={ctx.getTurnCount} />
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
            models={ctx.state.models}
            currentModel={ctx.state.currentModel}
            onModelChange={onModelChange}
            autoApproveEffective={ctx.state.autoApprove.effective}
            autoApproveCapable={!!ctx.state.capabilities?.toolApprovals}
            onAutoApproveToggle={onAutoApproveToggle}
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
            usage={displayedUsage}
            usageQuerySupported={!!ctx.state.capabilities?.usageQuery}
            refreshingUsage={refreshingUsage}
            onRefreshUsage={onRefreshUsage}
          />
        </div>
      </div>
      <ApprovalModal patch={pendingApproval} onResolve={onResolveApproval} />
      <ElicitationModal patch={pendingElicitation} onResolve={onResolveElicitation} />
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      {addGroupOpen && (
        <div className={styles.dialogBackdrop} onClick={() => setAddGroupOpen(false)}>
          <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
            <h4>Add Group</h4>
            <input
              placeholder="Group name"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleCreateGroup(); }}
              autoFocus
            />
            <div className={styles.dialogActions}>
              <Button type="button" onClick={() => setAddGroupOpen(false)}>Cancel</Button>
              <Button type="button" variant="primary" onClick={handleCreateGroup}>Create</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
