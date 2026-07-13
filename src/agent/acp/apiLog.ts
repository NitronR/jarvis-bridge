// Per-session API (JSON-RPC) traffic logging, for debugging.
//
// AcpConnection emits one ApiTrafficEntry per request/response/notification
// crossing the wire (either direction). ApiSessionLogWriter fans those out
// into one append-only file per sessionId under a configured logs dir, so a
// single session's full request/response history can be tailed in isolation.
// Traffic that can't be attributed to a session (e.g. `initialize`) goes to
// a shared "_unscoped" file rather than being dropped.

import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import path from "node:path";

export type ApiTrafficDirection = "send" | "recv";
export type ApiTrafficKind = "request" | "response" | "notification";

export interface ApiTrafficEntry {
  ts: string;
  dir: ApiTrafficDirection;
  kind: ApiTrafficKind;
  method: string;
  id?: number | string;
  sessionId?: string;
  payload: unknown;
}

const UNSCOPED_KEY = "_unscoped";

export class ApiSessionLogWriter {
  private streams = new Map<string, WriteStream>();
  private dirReady = false;

  constructor(private readonly logsDir: string) {}

  write(entry: ApiTrafficEntry): void {
    const key = entry.sessionId ?? UNSCOPED_KEY;
    const stream = this.streamFor(key);
    if (!stream) return;
    try {
      stream.write(JSON.stringify(entry) + "\n");
    } catch {
      // best-effort — never let logging break the agent flow
    }
  }

  closeSession(sessionId: string): void {
    const stream = this.streams.get(sessionId);
    if (!stream) return;
    try {
      stream.end();
    } catch {
      /* ignore */
    }
    this.streams.delete(sessionId);
  }

  close(): void {
    for (const stream of this.streams.values()) {
      try {
        stream.end();
      } catch {
        /* ignore */
      }
    }
    this.streams.clear();
  }

  private streamFor(key: string): WriteStream | null {
    const cached = this.streams.get(key);
    if (cached) return cached;
    if (!this.dirReady) {
      try {
        mkdirSync(this.logsDir, { recursive: true });
        this.dirReady = true;
      } catch {
        return null;
      }
    }
    try {
      const stream = createWriteStream(path.join(this.logsDir, `${key}.log`), { flags: "a" });
      this.streams.set(key, stream);
      return stream;
    } catch {
      return null;
    }
  }
}

export function extractSessionId(payload: unknown): string | undefined {
  if (payload && typeof payload === "object" && "sessionId" in payload) {
    const v = (payload as { sessionId?: unknown }).sessionId;
    return typeof v === "string" ? v : undefined;
  }
  return undefined;
}
