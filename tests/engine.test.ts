import { describe, expect, it } from "vitest";
import { FLOW_H, FLOW_W, flowSignal } from "../src/engine/flow";
import { Stabilizer } from "../src/engine/stabilizer";
import { angleDeg, fingerStates, percentile, yawFromMatrix } from "../src/lib/geometry";

describe("geometry", () => {
  it("measures angles", () => {
    expect(angleDeg({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })).toBeCloseTo(90);
    expect(angleDeg({ x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })).toBeCloseTo(0);
  });

  it("matches numpy.percentile", () => {
    expect(percentile([1, 2, 3, 4], 25)).toBeCloseTo(1.75);
    expect(percentile([5], 50)).toBe(5);
    expect(percentile([], 50)).toBe(0);
  });

  it("reads yaw from a column-major rotation matrix", () => {
    const a = (30 * Math.PI) / 180;
    // rotation about Y by 30°, packed column-major
    const rowMajor = [
      [Math.cos(a), 0, Math.sin(a), 0],
      [0, 1, 0, 0],
      [-Math.sin(a), 0, Math.cos(a), 0],
      [0, 0, 0, 1],
    ];
    const data: number[] = [];
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) data.push(rowMajor[r][c]);
    expect(yawFromMatrix({ rows: 4, columns: 4, data })).toBeCloseTo(30);
  });

  it("tells straight fingers from curled ones", () => {
    // a flat hand pointing up: every finger in a straight line
    const pts = Array.from({ length: 21 }, (_, i) => {
      const finger = Math.floor((i - 1) / 4);
      const joint = (i - 1) % 4;
      return i === 0 ? { x: 0, y: 0, z: 0 } : { x: finger * 0.1, y: -(joint + 1) * 0.1, z: 0 };
    });
    expect(fingerStates(pts).curledCount).toBe(0);
    // fold the index tip back down
    pts[8] = { x: pts[7].x, y: pts[7].y + 0.1, z: 0 };
    const s = fingerStates(pts);
    expect(s.indexUp).toBe(false);
    expect(s.curledCount).toBe(1);
  });
});

describe("stabilizer", () => {
  it("switches only after a gesture holds for N frames", () => {
    const s = new Stabilizer({ mode: "streak", stableFrames: 3, fallbackMs: 600 }, "rest");
    expect(s.push("wave", 0)).toBeNull();
    expect(s.push("wave", 33)).toBeNull();
    expect(s.push("wave", 66)).toBe("wave");
    expect(s.push("wave", 99)).toBeNull(); // already showing
  });

  it("falls back to the default after a quiet spell", () => {
    const s = new Stabilizer({ mode: "streak", stableFrames: 2, fallbackMs: 100 }, "rest");
    s.push("wave", 0);
    s.push("wave", 10);
    expect(s.push("rest", 50)).toBeNull();
    expect(s.push("rest", 200)).toBe("rest");
  });

  it("uses a majority vote in vote mode", () => {
    const s = new Stabilizer({ mode: "vote", window: 5, majority: 3 }, "rest");
    const seq = ["a", "b", "a", "c", "a"];
    const out = seq.map((g, i) => s.push(g, i));
    expect(out.slice(0, 4).every((v) => v === null)).toBe(true);
    expect(out[4]).toBe("a");
  });
});

describe("motion flow", () => {
  function texture(shift: number) {
    const g = new Float32Array(FLOW_W * FLOW_H);
    for (let y = 0; y < FLOW_H; y++) {
      for (let x = 0; x < FLOW_W; x++) {
        const sx = x - shift;
        g[y * FLOW_W + x] = 128 + 60 * Math.sin(sx * 0.7) + 40 * Math.sin(sx * 0.23 + y * 0.31);
      }
    }
    return g;
  }

  it("sees no motion in a still picture", () => {
    const a = texture(0);
    expect(flowSignal(a, a).magnitude).toBeLessThan(0.05);
  });

  it("measures a sideways pan", () => {
    const sig = flowSignal(texture(0), texture(3));
    expect(sig.magnitude).toBeGreaterThan(2);
    expect(sig.magnitude).toBeLessThan(4);
    expect(sig.coherence).toBeGreaterThan(0.9);
  });
});
