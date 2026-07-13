import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
  type ReactNode,
} from "react";
import { fetchJSON } from "../api/client";
import type {
  AgentCapabilities, AutoApproveState, ChatHistoryEntry, ChatInitResponse,
  ModelInfo, SlashCommand,
} from "../api/types";

export interface ChatState {
  sessionId: string | null;
  cwd: string | null;
  backendName: string | null;
  capabilities: AgentCapabilities | null;
  slashCommands: SlashCommand[];
  models: ModelInfo[];
  currentModel: string | null;
  autoApprove: AutoApproveState;
  busy: boolean;
  loading: boolean;
  unread: boolean;
  title: string;
  pinned: boolean;
  group: string;
  resumed: boolean;
  history: ChatHistoryEntry[];
  turnCounts: Record<string, number>;
}

const INITIAL: ChatState = {
  sessionId: null,
  cwd: null,
  backendName: null,
  capabilities: null,
  slashCommands: [],
  models: [],
  currentModel: null,
  autoApprove: { supported: true, default: false, override: null, effective: false, enabled: false },
  busy: false,
  loading: false,
  unread: false,
  title: "New chat",
  pinned: false,
  group: "",
  resumed: false,
  history: [],
  turnCounts: {},
};

export interface ChatContextApi {
  state: ChatState;
  init: (sessionId?: string | null, cwd?: string, backend?: string, model?: string) => Promise<void>;
  setBusy: (b: boolean) => void;
  setUnread: (u: boolean) => void;
  setTitle: (t: string) => void;
  setPinned: (p: boolean) => void;
  setGroup: (g: string) => void;
  setSlashCommands: (cmds: SlashCommand[]) => void;
  setModels: (available: ModelInfo[], current: string | null) => void;
  setAutoApprove: (a: AutoApproveState) => void;
  setSession: (sid: string, cwd: string) => void;
  reset: () => void;
  getTurnCount: (sessionId: string) => number | undefined;
  pruneTurnCounts: (keepIds: Set<string>) => void;
}

const ChatContext = createContext<ChatContextApi | null>(null);

const TURN_COUNTS_STORAGE_KEY = "jarvis.turnCounts";

function isValidTurnCounts(v: unknown): v is Record<string, number> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof k !== "string" || typeof val !== "number" || !Number.isFinite(val)) return false;
  }
  return true;
}

function loadTurnCounts(): Record<string, number> {
  try {
    const raw = window.localStorage?.getItem(TURN_COUNTS_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return isValidTurnCounts(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function saveTurnCounts(counts: Record<string, number>): void {
  try {
    window.localStorage?.setItem(TURN_COUNTS_STORAGE_KEY, JSON.stringify(counts));
  } catch {
    // ignore (storage may be unavailable)
  }
}

function getSessionIdFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get("sessionId");
}

// `cwd`/`backend`/`model` in the URL are a one-shot handoff (e.g. a workspace
// or session opened in a new tab) for what to init with on mount — not a
// durable part of the URL, so they're stripped once consumed (see
// setSessionIdInUrl).
function getCwdFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get("cwd");
}

function getBackendFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get("backend");
}

function getModelFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get("model");
}

function setSessionIdInUrl(sessionId: string | null): void {
  const url = new URL(window.location.href);
  if (sessionId) {
    url.searchParams.set("sessionId", sessionId);
  } else {
    url.searchParams.delete("sessionId");
  }
  url.searchParams.delete("cwd");
  url.searchParams.delete("backend");
  url.searchParams.delete("model");
  history.replaceState(null, "", url.pathname + url.search + url.hash);
}

export function ChatProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ChatState>(() => ({ ...INITIAL, turnCounts: loadTurnCounts() }));

  const init = useCallback(async (sessionId: string | null = null, cwd?: string, backend?: string, model?: string) => {
    setState((s) => ({ ...s, loading: true }));
    try {
      const params = new URLSearchParams();
      if (sessionId) params.set("sessionId", sessionId);
      if (cwd) params.set("cwd", cwd);
      if (backend) params.set("backend", backend);
      if (model) params.set("model", model);
      const url = params.toString() ? `/chat/init?${params.toString()}` : "/chat/init";
      const res = await fetchJSON<ChatInitResponse>(url);
      if (!res.ok || !res.data || !res.data.ok) {
        setState((s) => ({ ...s, sessionId: null, history: [] }));
        setSessionIdInUrl(null);
        return;
      }
      const d = res.data;
      const count = (d.history || []).length;
      setState((s) => {
        const nextTurnCounts = { ...s.turnCounts, [d.sessionId]: count };
        saveTurnCounts(nextTurnCounts);
        return {
          ...s,
          sessionId: d.sessionId,
          cwd: d.cwd,
          backendName: d.backend.name,
          capabilities: d.capabilities,
          slashCommands: d.slashCommands || [],
          models: d.model?.available || [],
          currentModel: d.model?.current || null,
          autoApprove: d.autoApprove,
          resumed: d.resumed,
          history: d.history || [],
          title: d.customTitle || "New chat",
          pinned: d.pinned ?? false,
          group: d.group || "",
          turnCounts: nextTurnCounts,
        };
      });
      setSessionIdInUrl(d.sessionId);
    } finally {
      setState((s) => ({ ...s, loading: false }));
    }
  }, []);

  const getTurnCount = useCallback(
    (sid: string) => state.turnCounts[sid],
    [state.turnCounts],
  );

  const pruneTurnCounts = useCallback((keepIds: Set<string>) => {
    setState((s) => {
      const next: Record<string, number> = {};
      let changed = false;
      for (const [k, v] of Object.entries(s.turnCounts)) {
        if (keepIds.has(k)) next[k] = v;
        else changed = true;
      }
      if (!changed) return s;
      saveTurnCounts(next);
      return { ...s, turnCounts: next };
    });
  }, []);

  const setBusy = useCallback((b: boolean) => {
    setState((s) => (s.busy === b ? s : { ...s, busy: b }));
  }, []);
  const setUnread = useCallback((u: boolean) => {
    setState((s) => (s.unread === u ? s : { ...s, unread: u }));
  }, []);
  const setTitle = useCallback((t: string) => setState((s) => ({ ...s, title: t })), []);
  const setPinned = useCallback((p: boolean) => setState((s) => ({ ...s, pinned: p })), []);
  const setGroup = useCallback((g: string) => setState((s) => ({ ...s, group: g })), []);
  const setSlashCommands = useCallback((cmds: SlashCommand[]) => setState((s) => ({ ...s, slashCommands: cmds })), []);
  const setModels = useCallback((available: ModelInfo[], current: string | null) => {
    setState((s) => ({ ...s, models: available, currentModel: current }));
  }, []);
  const setAutoApprove = useCallback((a: AutoApproveState) => setState((s) => ({ ...s, autoApprove: a })), []);
  const setSession = useCallback((sid: string, cwd: string) => {
    setState((s) => ({ ...s, sessionId: sid, cwd }));
  }, []);
  const reset = useCallback(() => setState((s) => ({ ...INITIAL, turnCounts: s.turnCounts })), []);

  useEffect(() => {
    const sessionId = getSessionIdFromUrl();
    if (sessionId) {
      void init(sessionId);
    } else {
      void init(null, getCwdFromUrl() ?? undefined, getBackendFromUrl() ?? undefined, getModelFromUrl() ?? undefined);
    }
  }, [init]);

  const api = useMemo<ChatContextApi>(
    () => ({ state, init, setBusy, setUnread, setTitle, setPinned, setGroup, setSlashCommands, setModels, setAutoApprove, setSession, reset, getTurnCount, pruneTurnCounts }),
    [state, init, setBusy, setUnread, setTitle, setPinned, setGroup, setSlashCommands, setModels, setAutoApprove, setSession, reset, getTurnCount, pruneTurnCounts],
  );

  return <ChatContext.Provider value={api}>{children}</ChatContext.Provider>;
}

export function useChatContext(): ChatContextApi {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChatContext must be used within ChatProvider");
  return ctx;
}
