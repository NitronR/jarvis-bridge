import { useEffect, useState } from "react";
import { fetchJSON } from "../api/client";

interface ActiveStatus {
  busy: boolean;
  now: string;
  chat: { activeCount: number; streams: Array<{ sessionId: string; preview?: string }> };
}

export function StatusPanel({ active }: { active: boolean }) {
  const [data, setData] = useState<ActiveStatus | null>(null);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const poll = async () => {
      const res = await fetchJSON<ActiveStatus>("/status/active");
      if (!cancelled && res.ok) setData(res.data);
    };
    void poll();
    const t = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(t); };
  }, [active]);

  return (
    <div style={{ padding: 16 }}>
      <h2>Status</h2>
      {data ? (
        <div>
          <div>Busy: {data.busy ? "yes" : "no"}</div>
          <div>Active chat streams: {data.chat.activeCount}</div>
        </div>
      ) : (
        <div style={{ color: "var(--color-text-muted)" }}>(status unavailable)</div>
      )}
    </div>
  );
}
