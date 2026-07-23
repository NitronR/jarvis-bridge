import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from "react";
import { fetchJSON } from "../api/client";
import type {
  AgentCapabilities, AutoApproveState, ChatHistoryEntry, ChatInitResponse,
  ModelInfo, SlashCommand, UsageTotals,
} from "../api/types";

export interface ChatState {
  sessionId: string | null;
  cwd: string | null;
  backendName: string | null;
  backendKind: string | null;
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
  groups: string[];
  resumed: boolean;
  activeTurn: boolean;
  history: ChatHistoryEntry[];
  turnCounts: Record<string, number>;
  lastUsage: UsageTotals | null;
}

const INITIAL: ChatState = {
  sessionId: null,
  cwd: null,
  backendName: null,
  backendKind: null,
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
  groups: [],
  resumed: false,
  activeTurn: false,
  history: [],
  turnCounts: {},
  lastUsage: null,
};

export interface ChatContextApi {
  state: ChatState;
  init: (sessionId?: string | null, cwd?: string, backend?: string, model?: string, opts?: { push?: boolean }) => Promise<void>;
  setBusy: (b: boolean) => void;
  setUnread: (u: boolean) => void;
  setTitle: (t: string) => void;
  setPinned: (p: boolean) => void;
  setGroup: (g: string) => void;
  setGroups: (g: string[]) => void;
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

function setSessionIdInUrl(sessionId: string | null, push: boolean): void {
  const url = new URL(window.location.href);
  if (sessionId) {
    url.searchParams.set("sessionId", sessionId);
  } else {
    url.searchParams.delete("sessionId");
  }
  url.searchParams.delete("cwd");
  url.searchParams.delete("backend");
  url.searchParams.delete("model");
  const next = url.pathname + url.search + url.hash;
  const cur = window.location.pathname + window.location.search + window.location.hash;
  if (next === cur) return;
  if (push) {
    history.pushState(null, "", next);
  } else {
    history.replaceState(null, "", next);
  }
}

export function ChatProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ChatState>(() => ({ ...INITIAL, turnCounts: loadTurnCounts() }));

  const init = useCallback(async (sessionId: string | null = null, cwd?: string, backend?: string, model?: string, opts?: { push?: boolean }) => {
    const push = opts?.push ?? true;
    setState((s) => ({ ...s, loading: true, title: "Loading" }));
    try {
      const params = new URLSearchParams();
      if (sessionId) params.set("sessionId", sessionId);
      if (cwd) params.set("cwd", cwd);
      if (backend) params.set("backend", backend);
      if (model) params.set("model", model);
      const url = params.toString() ? `/chat/init?${params.toString()}` : "/chat/init";
      const res = await fetchJSON<ChatInitResponse>(url);
      if (!res.ok || !res.data || !res.data.ok) {
        setState((s) => ({ ...s, sessionId: null, history: [], title: "New chat" }));
        setSessionIdInUrl(null, push);
        return;
      }
      const d = res.data;
      console.log(`[FE] init response sessionId=${d.sessionId} model.current=${d.model?.current} model.available=${d.model?.available?.map(m => m.modelId).join(",")}`);
      const count = (d.history || []).length;
      setState((s) => {
        const nextTurnCounts = { ...s.turnCounts, [d.sessionId]: count };
        saveTurnCounts(nextTurnCounts);
        return {
          ...s,
          sessionId: d.sessionId,
          cwd: d.cwd,
          backendName: d.backend.name,
          backendKind: d.backend.kind,
          capabilities: d.capabilities,
          slashCommands: d.slashCommands || [],
          models: d.model?.available || [],
          currentModel: d.model?.current || null,
          autoApprove: d.autoApprove,
          resumed: d.resumed,
          activeTurn: d.activeTurn ?? false,
          history: d.history || [],
          title: d.customTitle || "New chat",
          pinned: d.pinned ?? false,
          group: d.group || "",
          turnCounts: nextTurnCounts,
          lastUsage: d.lastUsage ?? null,
        };
      });
      // Fetch available groups
      const groupsRes = await fetchJSON<{ groups: string[] }>("/chat/groups");
      if (groupsRes.ok && Array.isArray(groupsRes.data?.groups)) {
        setState((s) => ({ ...s, groups: groupsRes.data!.groups }));
      }
      setSessionIdInUrl(d.sessionId, push);
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
  const setGroups = useCallback((g: string[]) => setState((s) => ({ ...s, groups: g })), []);
  const setSlashCommands = useCallback((cmds: SlashCommand[]) => setState((s) => ({ ...s, slashCommands: cmds })), []);
  const setModels = useCallback((available: ModelInfo[], current: string | null) => {
    setState((s) => ({ ...s, models: available, currentModel: current }));
  }, []);
  const setAutoApprove = useCallback((a: AutoApproveState) => setState((s) => ({ ...s, autoApprove: a })), []);
  const setSession = useCallback((sid: string, cwd: string) => {
    setState((s) => ({ ...s, sessionId: sid, cwd }));
  }, []);
  const reset = useCallback(() => setState((s) => ({ ...INITIAL, turnCounts: s.turnCounts })), []);

  // Guard against React StrictMode's dev-only double-invoke of mount effects:
  // without this, two concurrent /chat/init calls race (each reading the same
  // un-stripped URL params before the other's response resolves), which can
  // create a duplicate session and leave the URL/state on whichever response
  // lands last — including the bare "no session" state if that one lost the
  // param handoff race. The ref survives StrictMode's mount->cleanup->mount
  // replay because the component instance itself isn't actually unmounted.
  const didInitRef = useRef(false);
  useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;
    const sessionId = getSessionIdFromUrl();
    if (sessionId) {
      void init(sessionId, undefined, undefined, undefined, { push: false });
    } else {
      void init(null, getCwdFromUrl() ?? undefined, getBackendFromUrl() ?? undefined, getModelFromUrl() ?? undefined, { push: false });
    }
  }, [init]);

  // Browser back/forward changes the URL natively (no pushState call of ours
  // runs) — this listener is what makes that actually switch the displayed
  // session, instead of just changing the address bar. Re-init with
  // push: false since the history entry already exists; pushing again here
  // would clobber the forward-navigation stack the user just triggered.
  useEffect(() => {
    const onPopState = () => {
      void init(getSessionIdFromUrl(), undefined, undefined, undefined, { push: false });
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [init]);

  const api = useMemo<ChatContextApi>(
    () => ({ state, init, setBusy, setUnread, setTitle, setPinned, setGroup, setGroups, setSlashCommands, setModels, setAutoApprove, setSession, reset, getTurnCount, pruneTurnCounts }),
    [state, init, setBusy, setUnread, setTitle, setPinned, setGroup, setGroups, setSlashCommands, setModels, setAutoApprove, setSession, reset, getTurnCount, pruneTurnCounts],
  );

  return <ChatContext.Provider value={api}>{children}</ChatContext.Provider>;
}

export function useChatContext(): ChatContextApi {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChatContext must be used within ChatProvider");
  return ctx;
}
