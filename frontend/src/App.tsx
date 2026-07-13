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
        <Sidenav current={route} onNavigate={navigate} healthOk={healthOk} />
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
