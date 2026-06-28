import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
  type ReactNode,
} from "react";
import { fetchJSON } from "../api/client";
import type {
  AgentCapabilities, AutoApproveState, ChatInitResponse,
  ModelInfo, SlashCommand,
} from "../api/types";

export interface ChatState {
  sessionId: string | null;
  cwd: string | null;
  capabilities: AgentCapabilities | null;
  slashCommands: SlashCommand[];
  models: ModelInfo[];
  currentModel: string | null;
  autoApprove: AutoApproveState;
  busy: boolean;
  title: string;
  resumed: boolean;
}

const INITIAL: ChatState = {
  sessionId: null,
  cwd: null,
  capabilities: null,
  slashCommands: [],
  models: [],
  currentModel: null,
  autoApprove: { supported: true, default: false, override: null, effective: false, enabled: false },
  busy: false,
  title: "New chat",
  resumed: false,
};

export interface ChatContextApi {
  state: ChatState;
  init: (sessionId?: string | null) => Promise<void>;
  setBusy: (b: boolean) => void;
  setTitle: (t: string) => void;
  setSlashCommands: (cmds: SlashCommand[]) => void;
  setModels: (available: ModelInfo[], current: string | null) => void;
  setAutoApprove: (a: AutoApproveState) => void;
  setSession: (sid: string, cwd: string) => void;
  reset: () => void;
}

const ChatContext = createContext<ChatContextApi | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ChatState>(INITIAL);

  const init = useCallback(async (sessionId: string | null = null) => {
    const url = sessionId ? `/chat/init?sessionId=${encodeURIComponent(sessionId)}` : "/chat/init";
    const res = await fetchJSON<ChatInitResponse>(url);
    if (!res.ok || !res.data || !res.data.ok) {
      setState((s) => ({ ...s, sessionId: null }));
      return;
    }
    const d = res.data;
    setState((s) => ({
      ...s,
      sessionId: d.sessionId,
      cwd: d.cwd,
      capabilities: d.capabilities,
      slashCommands: d.slashCommands || [],
      models: d.model?.available || [],
      currentModel: d.model?.current || null,
      autoApprove: d.autoApprove,
      resumed: d.resumed,
    }));
  }, []);

  const setBusy = useCallback((b: boolean) => {
    setState((s) => (s.busy === b ? s : { ...s, busy: b }));
  }, []);
  const setTitle = useCallback((t: string) => setState((s) => ({ ...s, title: t })), []);
  const setSlashCommands = useCallback((cmds: SlashCommand[]) => setState((s) => ({ ...s, slashCommands: cmds })), []);
  const setModels = useCallback((available: ModelInfo[], current: string | null) => {
    setState((s) => ({ ...s, models: available, currentModel: current }));
  }, []);
  const setAutoApprove = useCallback((a: AutoApproveState) => setState((s) => ({ ...s, autoApprove: a })), []);
  const setSession = useCallback((sid: string, cwd: string) => {
    setState((s) => ({ ...s, sessionId: sid, cwd }));
  }, []);
  const reset = useCallback(() => setState(INITIAL), []);

  useEffect(() => { void init(null); }, [init]);

  const api = useMemo<ChatContextApi>(
    () => ({ state, init, setBusy, setTitle, setSlashCommands, setModels, setAutoApprove, setSession, reset }),
    [state, init, setBusy, setTitle, setSlashCommands, setModels, setAutoApprove, setSession, reset],
  );

  return <ChatContext.Provider value={api}>{children}</ChatContext.Provider>;
}

export function useChatContext(): ChatContextApi {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChatContext must be used within ChatProvider");
  return ctx;
}
