export interface FetchOpts extends Omit<RequestInit, "body"> {
  body?: unknown;
}

export interface FetchResult<T = unknown> {
  ok: boolean;
  status: number;
  data: T;
}

export async function fetchJSON<T = unknown>(
  url: string,
  opts: FetchOpts = {},
): Promise<FetchResult<T>> {
  const { body, headers, ...rest } = opts;
  const finalHeaders: Record<string, string> = {};
  if (headers) {
    if (headers instanceof Headers) {
      headers.forEach((v, k) => { finalHeaders[k] = v; });
    } else if (Array.isArray(headers)) {
      for (const [k, v] of headers) finalHeaders[k] = v;
    } else {
      Object.assign(finalHeaders, headers as Record<string, string>);
    }
  }
  let finalBody: BodyInit | undefined;
  if (body !== undefined && body !== null) {
    if (typeof body === "string") {
      finalBody = body;
    } else {
      finalBody = JSON.stringify(body);
      finalHeaders["content-type"] = "application/json";
    }
  }
  const res = await fetch(url, { ...rest, headers: finalHeaders, body: finalBody });
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  return { ok: res.ok, status: res.status, data: data as T };
}

export interface SSEHandle {
  abort: () => void;
  done: Promise<void>;
}

export function fetchSSE<T = unknown>(
  url: string,
  body: object | null,
  handlers: {
    onPatch: (p: T) => void;
    onDone?: () => void;
    onError?: (err: Error) => void;
  },
): SSEHandle {
  const controller = new AbortController();
  let aborted = false;
  const done = (async () => {
    try {
      const res = await fetch(
        url,
        body === null
          ? { signal: controller.signal }
          : {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(body),
              signal: controller.signal,
            },
      );
      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => String(res.status));
        handlers.onError?.(new Error(`SSE failed: ${res.status} ${errText}`));
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let sawDone = false;
      while (!aborted) {
        const { value, done: rdone } = await reader.read();
        if (rdone) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const json = line.slice(6).trim();
          if (!json) continue;
          try {
            const patch = JSON.parse(json) as T & { type?: string };
            if (patch && patch.type === "done") {
              sawDone = true;
              handlers.onPatch(patch);
              handlers.onDone?.();
              return;
            }
            handlers.onPatch(patch);
          } catch {
            // skip malformed line; resync on next iteration
          }
        }
      }
      if (!sawDone) {
        handlers.onPatch({ type: "done" } as unknown as T);
        handlers.onDone?.();
      }
    } catch (err) {
      if (aborted) return;
      handlers.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  })();
  return {
    abort: () => { aborted = true; controller.abort(); },
    done,
  };
}