// Piplup: lots of facial expressions plus where your hands are around your face.
import { dist, fmt, indexOnly, signed, yawFromMatrix } from "../lib/geometry";
import { avgLR, bs, faceBasics, handBasics, type FaceBasics } from "./shared";
import { FACE_STALE_MS, STREAK_5, type Detector, type Frame, type Pack } from "./types";

const DEFAULT = "pokerFace";
const HEAD_TOP_MARGIN = 1.1;
const HAND_ON_HEAD_X_TOLERANCE = 1.5;
// vertical bands, in face widths below the mouth (negative = above)
const FACE_COVER: [number, number] = [-2.4, -0.5];
const MOUTH_BAND: [number, number] = [-0.5, 0.5];
const SHOULDER_BAND: [number, number] = [0.5, 2.0];
const CHEST_BAND: [number, number] = [2.0, 4.5];
const FACE_COVER_X_TOLERANCE = 1.3;
const CROSSED_X_MAX = 1.2;
const FAINT_MIN_FRAME_Y = 0.5;
const HAND_NEAR_MOUTH_DIST = 0.6;
const HAND_MOUTH_OPEN_THRESH = 0.1;
// pointing at the camera foreshortens the index finger in 2D
const POINT_AT_CAMERA_XY_RATIO = 0.55;
const MOUTH_OPEN = 0.3;
const SMILE = 0.35;
const FROWN = 0.2;
const BROW_RAISE = 0.45;
const SQUINT = 0.4;
const LOOK_AWAY_YAW_DEG = 15;

interface Expr {
  mouthOpen: number;
  smile: number;
  frown: number;
  browRaise: number;
  squint: number;
  yaw: number;
}

const inBand = (v: number, [lo, hi]: [number, number]) => lo < v && v < hi;

function createDetector(): Detector {
  let last: (FaceBasics & { e: Expr; t: number }) | null = null;
  let note = "-";

  function expression(): string {
    if (!last) return DEFAULT;
    const e = last.e;
    const open = e.mouthOpen > MOUTH_OPEN;
    const smiling = e.smile > SMILE;
    const frowning = e.frown > FROWN;
    const squinting = e.squint > SQUINT;
    if (open && e.browRaise > BROW_RAISE && !frowning) return "shocked";
    if (Math.abs(e.yaw) > LOOK_AWAY_YAW_DEG && frowning) return "handOnHip";
    if (open && frowning) return "crying";
    if (open) return "yelling";
    if (squinting && smiling) return "smirk";
    if (squinting && frowning) return "headDown";
    if (squinting) return "hmph";
    return DEFAULT;
  }

  function decide(f: Frame): string {
    const fresh = last && f.now - last.t < FACE_STALE_MS ? last : null;
    note = "-";
    if (!f.hands.length) return expression();

    const hs = f.hands.map((lm) => {
      const h = handBasics(lm);
      const p = h.pts;
      const seg3d = dist(p[5], p[8]) || 1e-6;
      return { ...h, foreshorten: Math.hypot(p[8].x - p[5].x, p[8].y - p[5].y) / seg3d };
    });

    if (hs.length === 2 && fresh) {
      const avgX = (hs[0].palmCenter.x + hs[1].palmCenter.x) / 2;
      const avgY = (hs[0].palmCenter.y + hs[1].palmCenter.y) / 2;
      const xOff = Math.abs(avgX - fresh.mouthCenter.x) / fresh.faceWidth;
      const y = (avgY - fresh.mouthCenter.y) / fresh.faceWidth;
      note = `two hands y=${fmt(y)} x=${fmt(xOff)}`;
      if (inBand(y, FACE_COVER) && xOff < FACE_COVER_X_TOLERANCE) return "cryInBed";
      if (inBand(y, MOUTH_BAND) && xOff < FACE_COVER_X_TOLERANCE) return fresh.e.smile > SMILE ? "happy" : "giggle";
      // faint also needs both hands in the lower half of the frame
      if (inBand(y, SHOULDER_BAND) && xOff < CROSSED_X_MAX && avgY > FAINT_MIN_FRAME_Y) return "faint";
      if (inBand(y, CHEST_BAND) && xOff < CROSSED_X_MAX) return "armsCrossed";
    }

    const h = hs[0];
    if (h.curledCount === 4) return "punch";
    if (indexOnly(h)) {
      note = `foreshorten ${fmt(h.foreshorten)} (<${POINT_AT_CAMERA_XY_RATIO} = at camera)`;
      if (fresh && fresh.e.mouthOpen > MOUTH_OPEN) return "pointAndYell";
      if (h.foreshorten < POINT_AT_CAMERA_XY_RATIO) return "pointAndYell";
      return "nerd";
    }
    if (fresh) {
      const d = dist(h.palmCenter, fresh.mouthCenter) / fresh.faceWidth;
      note = `hand to mouth ${fmt(d)} (<${HAND_NEAR_MOUTH_DIST})`;
      if (d < HAND_NEAR_MOUTH_DIST) {
        if (fresh.e.smile > SMILE) return "happy";
        if (fresh.e.mouthOpen > HAND_MOUTH_OPEN_THRESH || fresh.e.browRaise > BROW_RAISE) return "shock";
      }
      const headTopY = fresh.mouthCenter.y - fresh.faceWidth * HEAD_TOP_MARGIN;
      const nearX = Math.abs(h.palmCenter.x - fresh.mouthCenter.x) / fresh.faceWidth < HAND_ON_HEAD_X_TOLERANCE;
      if (h.palmCenter.y < headTopY && nearX) return "scratchHead";
    }
    return DEFAULT;
  }

  return {
    update(f) {
      if (f.face) {
        const face = f.face;
        last = {
          ...faceBasics(face),
          e: {
            mouthOpen: bs(face, "jawOpen"),
            smile: avgLR(face, "mouthSmile"),
            frown: Math.max(avgLR(face, "mouthFrown"), avgLR(face, "browDown")),
            browRaise: bs(face, "browInnerUp"),
            squint: Math.max(avgLR(face, "eyeSquint"), avgLR(face, "eyeBlink")),
            yaw: face.matrix ? yawFromMatrix(face.matrix) : 0,
          },
          t: f.now,
        };
      }
      return decide(f);
    },
    debug() {
      const e = last?.e;
      if (!e) return [note];
      return [
        note,
        `jawOpen ${fmt(e.mouthOpen)} (>${MOUTH_OPEN})  smile ${fmt(e.smile)} (>${SMILE})  frown ${fmt(e.frown)} (>${FROWN})`,
        `browUp ${fmt(e.browRaise)} (>${BROW_RAISE})  squint ${fmt(e.squint)} (>${SQUINT})  yaw ${signed(e.yaw)}° (±${LOOK_AWAY_YAW_DEG})`,
      ];
    },
  };
}

const piplup: Pack = {
  id: "piplup",
  name: "Piplup",
  defaultGesture: DEFAULT,
  coverPosition: "50% 12%",
  needs: {},
  debounce: STREAK_5,
  gestures: {
    cryInBed: { label: "Cry in bed", how: "Both hands over your eyes and forehead.", memes: ["cry in bed.jpg", "CRY IN BEDd.jpg"] },
    happy: { label: "Happy", how: "Hands near your mouth and smile. You have to smile.", memes: ["happy piplulp.jpg"] },
    giggle: { label: "Giggle", how: "Two hands over your mouth, not smiling.", memes: ["hand over mouth giggle.jpg"] },
    faint: { label: "Faint", how: "Arms crossed, hands on your shoulders, low in the frame.", memes: ["faint.jpg"] },
    armsCrossed: { label: "Crossed arms", how: "Both hands resting together at chest height.", memes: ["crossed arms.jpg"] },
    punch: { label: "Punch", how: "A fist.", memes: ["punch piplup.jpg"] },
    pointAndYell: { label: "Point and yell", how: "Point straight at the camera, or point while yelling.", memes: ["point and yell.jpg"] },
    nerd: { label: "Nerd", how: "One finger up.", memes: ["nerdd.jpg"] },
    shock: { label: "Shock", how: "One hand by your open mouth, or brows raised.", memes: ["hand over mouth shock.jpg"] },
    scratchHead: { label: "Scratch head", how: "One hand on top of your head.", memes: ["scratch head .jpg"] },
    shocked: { label: "Shocked", how: "No hands. Mouth open, eyebrows up.", memes: ["shocked .jpg"] },
    handOnHip: { label: "Hmph (hand on hip)", how: "No hands. Turn your head and frown.", memes: ["hand on hip hmph.jpg"] },
    crying: { label: "Crying", how: "No hands. Mouth open and frowning.", memes: ["cry piplup.jpg"] },
    yelling: { label: "Yelling", how: "No hands. Mouth open.", memes: ["yelling piplup.jpg"] },
    smirk: { label: "Smirk", how: "No hands. Squint and smile.", memes: ["smirk.jpg"] },
    headDown: { label: "Head down", how: "No hands. Squint and frown.", memes: ["head down.jpg"] },
    hmph: { label: "HMPH", how: "No hands. Eyes narrowed or closed.", memes: ["HMPH.jpg"] },
    pokerFace: { label: "Poker face", how: "Straight face.", memes: ["piplup poker.jpg"] },
  },
  createDetector,
};

export default piplup;
