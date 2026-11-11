import { dist, fingerStates, mid, pt, type FingerStates, type Landmark, type Vec3 } from "../lib/geometry";
import type { FaceFrame } from "./types";

// MediaPipe face mesh landmark indices used across cams
export const FACE = {
  upperLip: 13,
  lowerLip: 14,
  leftCheekEdge: 234,
  rightCheekEdge: 454,
} as const;

export interface FaceBasics {
  mouthCenter: Vec3;
  /** Cheek-to-cheek width: the unit most distances are measured in. */
  faceWidth: number;
  /** Lip gap / face width. */
  mouthRatio: number;
}

export function faceBasics(face: FaceFrame): FaceBasics {
  const f = face.landmarks;
  const upper = pt(f[FACE.upperLip]);
  const lower = pt(f[FACE.lowerLip]);
  const faceWidth = dist(pt(f[FACE.leftCheekEdge]), pt(f[FACE.rightCheekEdge])) || 1e-6;
  return { mouthCenter: mid(upper, lower), faceWidth, mouthRatio: dist(upper, lower) / faceWidth };
}

export interface HandBasics extends FingerStates {
  pts: Vec3[];
  /** Wrist to middle-finger knuckle. */
  handScale: number;
  wrist: Vec3;
  palmCenter: Vec3;
  indexTip: Vec3;
  middleTip: Vec3;
}

export function handBasics(lm: Landmark[]): HandBasics {
  const pts = lm.map(pt);
  return {
    ...fingerStates(pts),
    pts,
    handScale: dist(pts[0], pts[9]) || 1e-6,
    wrist: pts[0],
    palmCenter: pts[9],
    indexTip: pts[8],
    middleTip: pts[12],
  };
}

/** Blendshape score, 0 when missing. */
export const bs = (face: FaceFrame | null, name: string): number => face?.blendshapes[name] ?? 0;

/** Average of a left/right blendshape pair, e.g. avgLR(face, "mouthSmile"). */
export const avgLR = (face: FaceFrame | null, base: string): number => (bs(face, `${base}Left`) + bs(face, `${base}Right`)) / 2;

/** Slowly-adapting "normal face size" so leaning in can be detected. */
export class WidthBaseline {
  value: number | null = null;
  constructor(
    private alpha = 0.02,
    private freezeMult = 1.15,
  ) {}
  update(width: number): void {
    if (this.value === null) this.value = width;
    // freeze while leaning in, so the lean itself doesn't become the baseline
    else if (width < this.value * this.freezeMult) this.value += (width - this.value) * this.alpha;
  }
  ratio(width: number): number {
    return this.value ? width / this.value : 1;
  }
}

/** Fixed-length rolling window of numbers. */
export class Window {
  readonly values: number[] = [];
  constructor(private size: number) {}
  push(v: number): void {
    this.values.push(v);
    if (this.values.length > this.size) this.values.shift();
  }
  sorted(): number[] {
    return [...this.values].sort((a, b) => a - b);
  }
  get length(): number {
    return this.values.length;
  }
}
