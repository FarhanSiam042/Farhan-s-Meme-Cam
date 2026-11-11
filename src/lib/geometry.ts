// Pure math shared by every cam. No DOM, no MediaPipe, so tests run under Node.
// Formulas match the desktop Python cams, so their tuned thresholds still mean
// the same thing here.

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Landmark extends Vec3 {
  visibility?: number;
}

/** A 4x4 matrix as MediaPipe hands it to JS: packed column-major. */
export interface Matrix {
  rows: number;
  columns: number;
  data: ArrayLike<number>;
}

export const pt = (lm: { x: number; y: number; z?: number }): Vec3 => ({ x: lm.x, y: lm.y, z: lm.z ?? 0 });
export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
export const mid = (a: Vec3, b: Vec3): Vec3 => scale(add(a, b), 0.5);

/** 3D distance. */
export const dist = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));

/** 2D distance on x, y only (the hamster cam measures this way). */
export const dist2 = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);

export function angleDeg(v1: Vec3, v2: Vec3): number {
  const m1 = Math.hypot(v1.x, v1.y, v1.z);
  const m2 = Math.hypot(v2.x, v2.y, v2.z);
  if (m1 < 1e-9 || m2 < 1e-9) return 180;
  const c = clamp((v1.x * v2.x + v1.y * v2.y + v1.z * v2.z) / (m1 * m2), -1, 1);
  return (Math.acos(c) * 180) / Math.PI;
}

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

// ---- hands -------------------------------------------------------------------

export interface FingerStates {
  indexUp: boolean;
  middleUp: boolean;
  ringUp: boolean;
  pinkyUp: boolean;
  /** How many of the four fingers (not the thumb) are curled. */
  curledCount: number;
}

/** A finger is straight when its PIP->TIP bone lines up with MCP->PIP. */
export function fingerExtended(pts: Vec3[], mcp: number, pip: number, tip: number): boolean {
  return angleDeg(sub(pts[pip], pts[mcp]), sub(pts[tip], pts[pip])) < 45;
}

export function fingerStates(pts: Vec3[]): FingerStates {
  const indexUp = fingerExtended(pts, 5, 6, 8);
  const middleUp = fingerExtended(pts, 9, 10, 12);
  const ringUp = fingerExtended(pts, 13, 14, 16);
  const pinkyUp = fingerExtended(pts, 17, 18, 20);
  const curledCount = [indexUp, middleUp, ringUp, pinkyUp].filter((v) => !v).length;
  return { indexUp, middleUp, ringUp, pinkyUp, curledCount };
}

export const indexOnly = (h: FingerStates): boolean => h.indexUp && !h.middleUp && !h.ringUp && !h.pinkyUp;

// ---- face transformation matrix ------------------------------------------------

/** Row/column read of MediaPipe's column-major matrix (Python's r[row, col]). */
export function rot(m: Matrix, row: number, col: number): number {
  return m.data[col * (m.rows || 4) + row];
}

const DEG = 180 / Math.PI;

/** Head yaw in degrees: atan2(-r20, hypot(r00, r10)). */
export function yawFromMatrix(m: Matrix): number {
  const sy = Math.hypot(rot(m, 0, 0), rot(m, 1, 0));
  if (sy < 1e-6) return 0;
  return Math.atan2(-rot(m, 2, 0), sy) * DEG;
}

/** Head pitch in degrees: atan2(r21, r22). Positive = looking down. */
export function pitchFromMatrix(m: Matrix): number {
  return Math.atan2(rot(m, 2, 1), rot(m, 2, 2)) * DEG;
}

/** Pitch and yaw with the gimbal-lock branch (the Jigglypuff cam uses this). */
export function pitchYawFromMatrix(m: Matrix): { pitch: number; yaw: number } {
  const sy = Math.hypot(rot(m, 0, 0), rot(m, 1, 0));
  const pitch = sy < 1e-6 ? Math.atan2(-rot(m, 1, 2), rot(m, 1, 1)) : Math.atan2(rot(m, 2, 1), rot(m, 2, 2));
  return { pitch: pitch * DEG, yaw: Math.atan2(-rot(m, 2, 0), sy) * DEG };
}

/** Head yaw as asin(r02) (the hamster cam's formula). */
export function asinYawFromMatrix(m: Matrix): number {
  return Math.asin(clamp(rot(m, 0, 2), -1, 1)) * DEG;
}

/** Head roll in degrees: atan2(r10, r00). */
export function rollFromMatrix(m: Matrix): number {
  return Math.atan2(rot(m, 1, 0), rot(m, 0, 0)) * DEG;
}

// ---- statistics -----------------------------------------------------------------

/** numpy.percentile with linear interpolation. */
export function percentile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const pos = ((s.length - 1) * q) / 100;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export const median = (values: readonly number[]): number => percentile(values, 50);

// ---- colour ---------------------------------------------------------------------

const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const labF = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);

/** The 8-bit Lab 'a' channel (red vs green) that OpenCV's BGR2LAB gives a pixel. */
export function labA8(r: number, g: number, b: number): number {
  const R = srgbToLinear(r / 255);
  const G = srgbToLinear(g / 255);
  const B = srgbToLinear(b / 255);
  const X = (0.412453 * R + 0.35758 * G + 0.180423 * B) / 0.950456;
  const Y = 0.212671 * R + 0.71516 * G + 0.072169 * B;
  return Math.round(clamp(500 * (labF(X) - labF(Y)) + 128, 0, 255));
}

// ---- formatting (debug readout) ------------------------------------------------

export const fmt = (v: number, digits = 2): string => v.toFixed(digits);
export const signed = (v: number, digits = 1): string => (v >= 0 ? "+" : "") + v.toFixed(digits);
