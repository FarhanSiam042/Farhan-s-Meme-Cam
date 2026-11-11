// Turns one tracked frame into a fixed-length list of numbers that describes
// the pose: hand shapes, where the hands are relative to the face, facial
// expression and head angle. The "Make your own" classifier compares these.
import { dist, pitchFromMatrix, rollFromMatrix, yawFromMatrix } from "../lib/geometry";
import { faceBasics } from "../packs/shared";
import type { Frame } from "../packs/types";

/** MediaPipe's 51 face blendshapes (minus "_neutral"), in a fixed order. */
export const BLENDSHAPES = [
  "browDownLeft", "browDownRight", "browInnerUp", "browOuterUpLeft", "browOuterUpRight",
  "cheekPuff", "cheekSquintLeft", "cheekSquintRight",
  "eyeBlinkLeft", "eyeBlinkRight", "eyeLookDownLeft", "eyeLookDownRight", "eyeLookInLeft", "eyeLookInRight",
  "eyeLookOutLeft", "eyeLookOutRight", "eyeLookUpLeft", "eyeLookUpRight", "eyeSquintLeft", "eyeSquintRight",
  "eyeWideLeft", "eyeWideRight",
  "jawForward", "jawLeft", "jawOpen", "jawRight",
  "mouthClose", "mouthDimpleLeft", "mouthDimpleRight", "mouthFrownLeft", "mouthFrownRight", "mouthFunnel",
  "mouthLeft", "mouthLowerDownLeft", "mouthLowerDownRight", "mouthPressLeft", "mouthPressRight", "mouthPucker",
  "mouthRight", "mouthRollLower", "mouthRollUpper", "mouthShrugLower", "mouthShrugUpper",
  "mouthSmileLeft", "mouthSmileRight", "mouthStretchLeft", "mouthStretchRight",
  "mouthUpperUpLeft", "mouthUpperUpRight", "noseSneerLeft", "noseSneerRight",
] as const;

/** Feature groups: [start, length, weight]. Each group counts equally (times its weight) in distances. */
export const GROUPS: [number, number, number][] = [];
let offset = 0;
const group = (len: number, weight: number) => {
  GROUPS.push([offset, len, weight]);
  offset += len;
};
// per hand slot: shape (20 points x, y), then presence + position
group(40, 1); // hand A shape
group(3, 1); // hand A presence + position
group(40, 1); // hand B shape
group(3, 1); // hand B presence + position
group(BLENDSHAPES.length, 1.5); // expression
group(5, 1.5); // face presence, yaw, pitch, roll, size
export const FEATURE_LENGTH = offset;
/** Bump when the layout changes, so old recordings are flagged for re-recording. */
export const FEATURE_VERSION = 1;

export function extractFeatures(f: Frame): Float32Array {
  const out = new Float32Array(FEATURE_LENGTH);
  const face = f.face ? faceBasics(f.face) : null;

  // hands in left-to-right order, so two-hand poses line up between frames
  const hands = [...f.hands].sort((a, b) => a[9].x - b[9].x).slice(0, 2);
  hands.forEach((lm, slot) => {
    const base = slot * 43;
    const wrist = lm[0];
    const handScale = dist(lm[0], lm[9]) || 1e-6;
    for (let i = 1; i < 21; i++) {
      out[base + (i - 1) * 2] = (lm[i].x - wrist.x) / handScale;
      out[base + (i - 1) * 2 + 1] = (lm[i].y - wrist.y) / handScale;
    }
    out[base + 40] = 1;
    // palm position in face widths from the mouth, or from the frame centre
    if (face) {
      out[base + 41] = (lm[9].x - face.mouthCenter.x) / face.faceWidth;
      out[base + 42] = (lm[9].y - face.mouthCenter.y) / face.faceWidth;
    } else {
      out[base + 41] = (lm[9].x - 0.5) * 4;
      out[base + 42] = (lm[9].y - 0.5) * 4;
    }
  });

  if (f.face && face) {
    const b = 86;
    BLENDSHAPES.forEach((name, i) => (out[b + i] = f.face!.blendshapes[name] ?? 0));
    const h = b + BLENDSHAPES.length;
    const m = f.face.matrix;
    out[h] = 1;
    if (m) {
      out[h + 1] = yawFromMatrix(m) / 30;
      out[h + 2] = pitchFromMatrix(m) / 30;
      out[h + 3] = rollFromMatrix(m) / 30;
    }
    out[h + 4] = face.faceWidth * 4;
  }
  return out;
}
