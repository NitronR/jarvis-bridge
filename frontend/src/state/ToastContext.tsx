import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from "react";
import styles from "./ToastContext.module.css";

export type ToastKind = "info" | "success" | "warning" | "error";

export interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}

interface ToastApi {
  toasts: Toast[];
  push: (message: string, kind?: ToastKind, opts?: { durationMs?: number }) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const DEFAULT_DURATION: Record<ToastKind, number | null> = {
  info: 4000,
  success: 3000,
  warning: 5000,
  error: null,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(1);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    setToasts((cur) => cur.filter((t) => t.id !== id));
    const t = timersRef.current.get(id);
    if (t) { clearTimeout(t); timersRef.current.delete(id); }
  }, []);

  const push = useCallback<ToastApi["push"]>((message, kind = "info", opts = {}) => {
    const id = idRef.current++;
    setToasts((cur) => [...cur, { id, message, kind }]);
    const ttl = opts.durationMs !== undefined ? opts.durationMs : DEFAULT_DURATION[kind];
    if (ttl !== null) {
      const handle = setTimeout(() => dismiss(id), ttl);
      timersRef.current.set(id, handle);
    }
  }, [dismiss]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => { timers.forEach((h) => clearTimeout(h)); timers.clear(); };
  }, []);

  const api = useMemo<ToastApi>(() => ({ toasts, push, dismiss }), [toasts, push, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className={styles.stack} aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`${styles.toast} ${styles[t.kind]}`}>{t.message}</div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
