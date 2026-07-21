import type { Route } from "../routes";
import styles from "./Sidenav.module.css";

export interface SidenavProps {
  current: Route;
  onNavigate: (r: Route) => void;
  healthOk: boolean | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

export function Sidenav({ current, onNavigate, healthOk, collapsed, onToggleCollapsed }: SidenavProps) {
  const dotClass =
    healthOk === null ? styles.dot
    : healthOk ? `${styles.dot} ${styles.ok}`
    : `${styles.dot} ${styles.bad}`;

  return (
    <aside className={collapsed ? `${styles.sidenav} ${styles.collapsed}` : styles.sidenav}>
      <div className={styles.topRow}>
        <span data-testid="health-dot" className={dotClass} />
        <button
          type="button"
          className={styles.collapseToggle}
          onClick={onToggleCollapsed}
          title={collapsed ? "Expand navigation" : "Collapse navigation"}
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
        >
          {collapsed ? "»" : "«"}
        </button>
      </div>
      <div className={styles.navBody} aria-hidden={collapsed}>
        <div className={styles.brand}>Jarvis Bridge</div>
        <div className={styles.groupLabel}>Workspace</div>
        <NavBtn current={current} target="chat" onNavigate={onNavigate}>Chat</NavBtn>
        <div className={styles.groupLabel}>Admin</div>
        <NavBtn current={current} target="status" onNavigate={onNavigate}>Status</NavBtn>
        <NavBtn current={current} target="skills-manage" onNavigate={onNavigate}>Skills</NavBtn>
        <NavBtn current={current} target="settings" onNavigate={onNavigate}>Settings</NavBtn>
      </div>
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
