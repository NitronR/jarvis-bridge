import type { Route } from "../routes";
import styles from "./Sidenav.module.css";

export interface SidenavProps {
  current: Route;
  onNavigate: (r: Route) => void;
  healthOk: boolean | null;
}

export function Sidenav({ current, onNavigate, healthOk }: SidenavProps) {
  const dotClass =
    healthOk === null ? styles.dot
    : healthOk ? `${styles.dot} ${styles.ok}`
    : `${styles.dot} ${styles.bad}`;
  return (
    <aside className={styles.sidenav}>
      <div className={styles.brand}>
        <span data-testid="health-dot" className={dotClass} />
        <span>Jarvis Bridge</span>
      </div>
      <div className={styles.groupLabel}>Workspace</div>
      <NavBtn current={current} target="chat" onNavigate={onNavigate}>Chat</NavBtn>
      <div className={styles.groupLabel}>Admin</div>
      <NavBtn current={current} target="status" onNavigate={onNavigate}>Status</NavBtn>
      <NavBtn current={current} target="skills-manage" onNavigate={onNavigate}>Skills</NavBtn>
      <NavBtn current={current} target="settings" onNavigate={onNavigate}>Settings</NavBtn>
    </aside>
  );
}

function NavBtn({
  current, target, onNavigate, children,
}: {
  current: Route;
  target: Route;
  onNavigate: (r: Route) => void;
  children: React.ReactNode;
}) {
  const isActive = current === target;
  return (
    <button
      type="button"
      className={isActive ? `${styles.tab} ${styles.active}` : styles.tab}
      onClick={() => onNavigate(target)}
      data-tab={target}
    >
      {children}
    </button>
  );
}
