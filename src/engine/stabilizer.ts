// Turns a jittery per-frame gesture into a steady one, so memes don't flicker.
import type { DebounceConfig } from "../packs/types";

export class Stabilizer {
  current: string | null = null;
  private candidate: string;
  private streak = 0;
  private lastNonDefaultAt: number;
  private votes: string[] = [];

  constructor(
    private cfg: DebounceConfig,
    private defaultGesture: string,
    now = 0,
  ) {
    this.candidate = defaultGesture;
    this.lastNonDefaultAt = now;
  }

  /** Feed one frame's raw gesture. Returns the gesture to switch to, or null to keep showing the current one. */
  push(gesture: string, now: number): string | null {
    const cfg = this.cfg;
    let next: string | null = null;

    if (cfg.mode === "vote") {
      this.votes.push(gesture);
      if (this.votes.length > cfg.window) this.votes.shift();
      const counts = new Map<string, number>();
      for (const g of this.votes) counts.set(g, (counts.get(g) ?? 0) + 1);
      let top: string | null = null;
      let topN = 0;
      for (const [g, n] of counts) {
        if (n > topN) [top, topN] = [g, n];
      }
      if (top !== null && topN >= cfg.majority && top !== this.current) next = top;
    } else {
      if (gesture === this.candidate) this.streak++;
      else {
        this.candidate = gesture;
        this.streak = 1;
      }
      const need = cfg.perGesture?.[gesture] ?? cfg.stableFrames;
      if (this.streak >= need && gesture !== this.current) next = gesture;
      if (gesture !== this.defaultGesture) this.lastNonDefaultAt = now;
      else if (now - this.lastNonDefaultAt > cfg.fallbackMs && this.current !== this.defaultGesture) next = this.defaultGesture;
    }

    if (next !== null) this.current = next;
    return next;
  }
}
