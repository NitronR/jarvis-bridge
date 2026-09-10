export type SoundKind = "response-complete" | "input-needed";

let audioContext: AudioContext | null = null;

export function __resetAudioContextForTests(): void {
  audioContext = null;
}

function ensureAudioContext(): AudioContext | null {
  if (typeof window === "undefined" || typeof window.AudioContext === "undefined") return null;
  if (!audioContext) {
    try {
      audioContext = new window.AudioContext();
    } catch {
      audioContext = null;
    }
  }
  if (audioContext && audioContext.state === "suspended") {
    void audioContext.resume().catch(() => {});
  }
  return audioContext;
}

function tone(
  ctx: AudioContext,
  { freq, start, duration, volume }: { freq: number; start: number; duration: number; volume: number },
): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, ctx.currentTime + start);
  gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + start + 0.01);
  gain.gain.linearRampToValueAtTime(0, ctx.currentTime + start + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(ctx.currentTime + start);
  osc.stop(ctx.currentTime + start + duration + 0.02);
}

export function playSound(kind: SoundKind): void {
  const ctx = ensureAudioContext();
  if (!ctx) return;
  try {
    if (kind === "response-complete") {
      tone(ctx, { freq: 660, start: 0, duration: 0.18, volume: 0.15 });
    } else {
      tone(ctx, { freq: 880, start: 0, duration: 0.18, volume: 0.15 });
      tone(ctx, { freq: 1174, start: 0.12, duration: 0.22, volume: 0.15 });
    }
  } catch {
    // never let an audio error crash the UI
  }
}