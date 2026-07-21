import { useCallback, useEffect, useState } from "react";
import { Sidenav } from "./components/Sidenav";
import { HealthDot } from "./components/HealthDot";
import { ChatPanel } from "./components/ChatPanel";
import { StatusPanel } from "./components/StatusPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { SkillsManagePanel } from "./components/SkillsManagePanel";
import { SkillPanel } from "./components/SkillPanel";
import { TerminalDrawer } from "./components/TerminalDrawer";
import { ToastProvider } from "./state/ToastContext";
import { ChatProvider, useChatContext } from "./state/ChatContext";
import { useHashRoute } from "./useHashRoute";
import { useFavicon } from "./useFavicon";

const SIDENAV_COLLAPSED_STORAGE_KEY = "jarvis.sidenavCollapsed";

function safeGetStoredSidenavCollapsed(): boolean {
  try {
    return window.localStorage?.getItem(SIDENAV_COLLAPSED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function safeSetStoredSidenavCollapsed(value: boolean): void {
  try {
    window.localStorage?.setItem(SIDENAV_COLLAPSED_STORAGE_KEY, String(value));
  } catch {
    // ignore (storage may be unavailable)
  }
}

export function App() {
  return (
    <ChatProvider>
      <AppInner />
    </ChatProvider>
  );
}

function AppInner() {
  const { route, navigate } = useHashRoute();
  const [healthOk, setHealthOk] = useState<boolean | null>(null);
  const [sidenavCollapsed, setSidenavCollapsedState] = useState(() => safeGetStoredSidenavCollapsed());
  const setSidenavCollapsed = useCallback((value: boolean | ((v: boolean) => boolean)) => {
    setSidenavCollapsedState((prev) => {
      const next = typeof value === "function" ? (value as (v: boolean) => boolean)(prev) : value;
      safeSetStoredSidenavCollapsed(next);
      return next;
    });
  }, []);
  const [cwd, setCwd] = useState<string | null>(null);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalMounted, setTerminalMounted] = useState(false);

  useFavicon();

  const { setUnread } = useChatContext();
  useEffect(() => {
    const onClick = () => setUnread(false);
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [setUnread]);

  useEffect(() => {
    const onCwd = (e: Event) => {
      const detail = (e as CustomEvent<{ cwd: string | null }>).detail;
      setCwd(detail?.cwd ?? null);
    };
    window.addEventListener("jarvis:cwd-changed", onCwd);
    return () => window.removeEventListener("jarvis:cwd-changed", onCwd);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && (e.code === "Backquote" || e.key === "`")) {
        e.preventDefault();
        setTerminalOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (terminalOpen) setTerminalMounted(true);
  }, [terminalOpen]);

  const onHealthUpdate = useCallback((ok: boolean) => setHealthOk(ok), []);

  return (
    <ToastProvider>
      <HealthDot onUpdate={onHealthUpdate} />
      <div style={{ display: "flex", height: "100vh" }}>
        <Sidenav
          current={route}
          onNavigate={navigate}
          healthOk={healthOk}
          collapsed={sidenavCollapsed}
          onToggleCollapsed={() => setSidenavCollapsed((v) => !v)}
        />
        <main style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}>
          {route === "chat" && <ChatPanel />}
          {route === "status" && <StatusPanel active={true} />}
          {route === "settings" && <SettingsPanel />}
          {route === "skills-manage" && <SkillsManagePanel />}
          {route.startsWith("skill/") && <SkillPanel name={route.slice("skill/".length)} />}
          {terminalMounted && (
            <TerminalDrawer cwd={cwd} open={terminalOpen} onClose={() => setTerminalOpen(false)} />
          )}
        </main>
      </div>
    </ToastProvider>
  );
}
