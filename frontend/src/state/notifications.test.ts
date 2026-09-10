import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { playSound, __resetAudioContextForTests } from "./notifications";

class FakeParam {
  value = 0;
  setValueAtTime(v: number) { this.value = v; }
  linearRampToValueAtTime(v: number) { this.value = v; }
  exponentialRampToValueAtTime(v: number) { this.value = v; }
}

class FakeOsc {
  type = "sine";
  frequency = new FakeParam();
  connect() {}
  start() {}
  stop() {}
}

class FakeGain {
  gain = new FakeParam();
  connect() {}
}

class FakeAudioContext {
  currentTime = 0;
  destination = {};
  state = "running";
  created: { osc: FakeOsc; gain: FakeGain }[] = [];
  createOscillator() { const o = new FakeOsc(); this.created.push({ osc: o, gain: new FakeGain() }); return o; }
  createGain() { return this.created[this.created.length - 1]?.gain ?? new FakeGain(); }
  resume() { this.state = "running"; }
  close() { this.state = "closed"; }
}

let ctx: FakeAudioContext;
let origAudioContext: typeof AudioContext;

beforeEach(() => {
  __resetAudioContextForTests();
  ctx = new FakeAudioContext();
  origAudioContext = (globalThis as any).AudioContext;
  (globalThis as any).AudioContext = class { constructor() { return ctx; } };
});

afterEach(() => {
  if (origAudioContext === undefined) delete (globalThis as any).AudioContext;
  else (globalThis as any).AudioContext = origAudioContext;
});

describe("playSound", () => {
  it("response-complete produces a single oscillator tone", () => {
    playSound("response-complete");
    expect(ctx.created.length).toBe(1);
    expect(ctx.created[0].osc.frequency.value).toBeGreaterThan(0);
  });

  it("input-needed produces two oscillator tones", () => {
    playSound("input-needed");
    expect(ctx.created.length).toBe(2);
  });

  it("no-ops (does not throw) when AudioContext is unavailable", () => {
    delete (globalThis as any).AudioContext;
    expect(() => playSound("response-complete")).not.toThrow();
  });
});