// Hamster: measures in plain 2D frame units, uses the body pose model for
// crossed arms and bicep, and smooths with a majority vote instead of a streak.
import { asinYawFromMatrix, clamp, dist2, fmt, type Landmark } from "../lib/geometry";
import type { Detector, Frame, Pack } from "./types";

const YAW_THRESHOLD_DEG = 18;
const GLASSES_NEAR_FACE_DIST = 0.28;
const MOUTH_NEAR_DIST = 0.14;
const ELBOW_BEND_MAX_DEG = 100;
const POSE_VISIBILITY_MIN = 0.5;
const MOUTH = 13;
const FINGER_JOINTS: [number, number][] = [
  [8, 5],
  [12, 9],
  [16, 13],
  [20, 17],
];
const POSE = { lShoulder: 11, rShoulder: 12, lElbow: 13, rElbow: 14, lWrist: 15, rWrist: 16, lHip: 23, rHip: 24 };

type Pt = { x: number; y: number };

/** [thumb, index, middle, ring, pinky] as 1 = up, 0 = curled. */
function fingersUp(lm: Landmark[]): number[] {
  const wrist = lm[0];
  const thumb = dist2(lm[4], lm[17]) > dist2(lm[2], lm[17]) * 1.1;
  return [thumb ? 1 : 0, ...FINGER_JOINTS.map(([tip, base]) => (dist2(wrist, lm[tip]) > dist2(wrist, lm[base]) * 1.15 ? 1 : 0))];
}

function singleHandShape([thumb, index, middle, ring, pinky]: number[]): "thumbs_up" | "fist" | "pointer" | null {
  if (!(index || middle || ring || pinky)) return thumb ? "thumbs_up" : "fist";
  if (index && !middle && !ring && !pinky) return "pointer";
  return null;
}

function thumbDyRatio(lm: Landmark[]): number {
  const s = dist2(lm[0], lm[9]);
  return s < 1e-6 ? 0 : (lm[4].y - lm[0].y) / s;
}

function isPinch(lm: Landmark[]): boolean {
  const s = dist2(lm[0], lm[9]);
  if (s < 1e-6) return false;
  const thumbIndex = dist2(lm[4], lm[8]);
  return thumbIndex < s * 0.5 && thumbIndex < dist2(lm[4], lm[12]) * 0.7;
}

const visible = (l: Landmark) => (l.visibility ?? 1) >= POSE_VISIBILITY_MIN;

function elbowAngle(s: Pt, e: Pt, w: Pt): number | null {
  const v1 = [s.x - e.x, s.y - e.y];
  const v2 = [w.x - e.x, w.y - e.y];
  const n1 = Math.hypot(v1[0], v1[1]);
  const n2 = Math.hypot(v2[0], v2[1]);
  if (n1 < 1e-6 || n2 < 1e-6) return null;
  return (Math.acos(clamp((v1[0] * v2[0] + v1[1] * v2[1]) / (n1 * n2), -1, 1)) * 180) / Math.PI;
}

/** Most-bent visible arm: [elbow angle, wrist height above shoulder, elbow out from shoulder]. */
function bicepSignals(pose: Landmark[] | null): [number, number, number] | null {
  if (!pose) return null;
  let best: [number, number, number] | null = null;
  for (const [si, ei, wi] of [
    [POSE.lShoulder, POSE.lElbow, POSE.lWrist],
    [POSE.rShoulder, POSE.rElbow, POSE.rWrist],
  ]) {
    const [s, e, w] = [pose[si], pose[ei], pose[wi]];
    if (!(visible(s) && visible(e) && visible(w))) continue;
    const angle = elbowAngle(s, e, w);
    if (angle === null) continue;
    if (!best || angle < best[0]) best = [angle, s.y - w.y, Math.abs(e.x - s.x)];
  }
  return best;
}

function isBicep(pose: Landmark[] | null): boolean {
  const sig = bicepSignals(pose);
  return !!sig && sig[0] < ELBOW_BEND_MAX_DEG && sig[1] > 0.06 && sig[2] > 0.06;
}

function isCrossArms(pose: Landmark[] | null): boolean {
  if (!pose) return false;
  const [lw, rw, ls, rs] = [pose[POSE.lWrist], pose[POSE.rWrist], pose[POSE.lShoulder], pose[POSE.rShoulder]];
  if (!(visible(lw) && visible(rw) && visible(ls) && visible(rs))) return false;
  const chestTop = Math.min(ls.y, rs.y);
  const [lh, rh] = [pose[POSE.lHip], pose[POSE.rHip]];
  const chestBottom = visible(lh) && visible(rh) ? Math.max(lh.y, rh.y) : chestTop + 0.35;
  const avgY = (lw.y + rw.y) / 2;
  return dist2(lw, rw) < 0.18 && chestTop < avgY && avgY < chestBottom;
}

function center(lms: Pt[]): Pt {
  let x = 0;
  let y = 0;
  for (const p of lms) {
    x += p.x;
    y += p.y;
  }
  return { x: x / lms.length, y: y / lms.length };
}

function classify(f: Frame): string {
  const head = f.face ? center(f.face.landmarks) : { x: 0.5, y: 0.3 };
  const mouth = f.face ? f.face.landmarks[MOUTH] : null;

  for (const lm of f.hands) {
    const handC = center(lm);
    if (isPinch(lm)) {
      if (dist2(handC, head) < GLASSES_NEAR_FACE_DIST) return "glasses";
      continue;
    }
    const shape = singleHandShape(fingersUp(lm));
    if (shape === "fist" || shape === "thumbs_up") {
      const dx = Math.abs(handC.x - head.x);
      if (Math.abs(handC.y - head.y) < 0.15 && dx > 0.08 && dx < 0.3) return "lollipop";
      if (shape === "thumbs_up") return thumbDyRatio(lm) > 0.35 ? "thumbsDown" : "thumbsUp";
      continue;
    }
    if (shape === "pointer") return mouth && dist2(lm[8], mouth) < MOUTH_NEAR_DIST ? "fingerMouth" : "nerd";
  }

  if (isCrossArms(f.pose)) return "crossArms";
  if (isBicep(f.pose)) return "bicep";
  if (f.hands.length === 2) return "truck";
  if (f.face?.matrix && Math.abs(asinYawFromMatrix(f.face.matrix)) > YAW_THRESHOLD_DEG) return "sideEye";
  return "default";
}

function createDetector(): Detector {
  let last: Frame | null = null;
  let raw = "default";
  return {
    // hamster only looks at the current frame (no remembered face)
    update(f) {
      last = f;
      raw = classify(f);
      return raw;
    },
    debug() {
      if (!last) return [];
      const lines = [];
      const m = last.face?.matrix;
      lines.push(`raw ${raw}   yaw ${m ? asinYawFromMatrix(m).toFixed(1) : "n/a"}° (±${YAW_THRESHOLD_DEG})`);
      const h = last.hands[0];
      if (h) lines.push(`fingers T,I,M,R,P=${fingersUp(h).join(",")}  pinch=${isPinch(h)}  thumb_dy=${fmt(thumbDyRatio(h))}`);
      const sig = bicepSignals(last.pose);
      lines.push(
        `cross_arms=${isCrossArms(last.pose)}  ` +
          (sig ? `bicep angle=${sig[0].toFixed(0)} wrist_above=${fmt(sig[1])} elbow_out=${fmt(sig[2])}` : "bicep: arm not visible"),
      );
      return lines;
    },
  };
}

const hamster: Pack = {
  id: "hamster",
  name: "Hamster",
  defaultGesture: "default",
  needs: { pose: true },
  confidence: { hand: 0.6, face: 0.6 },
  debounce: { mode: "vote", window: 12, majority: 7 },
  gestures: {
    glasses: { label: "Discord mod", how: "Pinch thumb and index together near your face.", memes: ["discord mod.jpg"] },
    lollipop: { label: "Lollipop", how: "A fist held beside your head.", memes: ["happylollypop.webp"] },
    thumbsUp: { label: "Thumbs up", how: "Thumbs up, away from your face.", memes: ["thumb.jpg"] },
    thumbsDown: { label: "Thumbs down", how: "Thumbs down, away from your face.", memes: ["thumbs down.jpg"] },
    fingerMouth: { label: "Finger mouth", how: "Index finger near your mouth.", memes: ["one finger mouth .jpg"] },
    nerd: { label: "Nerd", how: "Index finger up, away from your mouth.", memes: ["nerd.jpg"] },
    crossArms: { label: "Crossed arms", how: "Fold your arms (hands can be hidden).", memes: ["cross arms .jpg"] },
    bicep: { label: "Bicep", how: "Flex: elbow bent and out, wrist above your shoulder.", memes: ["bicep.jpg"] },
    truck: { label: "Truck", how: "Both hands visible, nothing else matching.", memes: ["2 arms out .jpg"] },
    sideEye: { label: "Side eye", how: "Turn your head to the side.", memes: ["sideyee.jpg"] },
    default: { label: "Poker face", how: "Nothing in particular.", memes: ["pokerham.jpg"] },
  },
  createDetector,
};

export default hamster;
