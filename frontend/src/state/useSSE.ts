import { useCallback, useEffect, useRef, useState } from "react";
import { fetchSSE } from "../api/client";

export interface UseSSEOpts<T> {
  url: string;
  body: object;
  enabled: boolean;
  onPatch: (p: T) => void;
  onDone?: () => void;
  onError?: (e: Error) => void;
}

export interface UseSSEResult {
  start: () => void;
  abort: () => void;
  busy: boolean;
}

export function useSSE<T = unknown>(opts: UseSSEOpts<T>): UseSSEResult {
  const [busy, setBusy] = useState(false);
  const handleRef = useRef<ReturnType<typeof fetchSSE> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      handleRef.current?.abort();
      handleRef.current = null;
    };
  }, []);

  const start = useCallback(() => {
    if (!opts.enabled) return;
    if (handleRef.current) handleRef.current.abort();
    setBusy(true);
    handleRef.current = fetchSSE<T>(opts.url, opts.body, {
      onPatch: (p) => { if (!mountedRef.current) return; opts.onPatch(p); },
      onDone: () => {
        if (!mountedRef.current) return;
        setBusy(false);
        handleRef.current = null;
        opts.onDone?.();
      },
      onError: (e) => {
        if (!mountedRef.current) return;
        setBusy(false);
        handleRef.current = null;
        opts.onError?.(e);
      },
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts]);

  const abort = useCallback(() => {
    handleRef.current?.abort();
    handleRef.current = null;
    if (mountedRef.current) setBusy(false);
  }, []);

  return { start, abort, busy };
}
