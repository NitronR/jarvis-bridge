import { useEffect } from "react";
import { fetchJSON } from "../api/client";

export function HealthDot({ onUpdate }: { onUpdate: (ok: boolean) => void }) {
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const poll = async () => {
      try {
        const res = await fetchJSON<{ agent: boolean }>("/health/agent");
        if (cancelled) return;
        onUpdate(!!(res.data && res.data.agent));
      } catch {
        if (!cancelled) onUpdate(false);
      }
    };

    void poll();
    timer = setInterval(poll, 15000);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [onUpdate]);

  return null;
}
