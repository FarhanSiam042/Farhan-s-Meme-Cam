// Monke: hand poses plus leaning in and turning your head.
import { dist, fmt, indexOnly, signed, yawFromMatrix } from "../lib/geometry";
import { faceBasics, handBasics, WidthBaseline, type FaceBasics } from "./shared";
import { FACE_STALE_MS, STREAK_5, type Detector, type Frame, type Pack } from "./types";

const SIDE_EYE_YAW_DEG = 15;
const LEAN_CLOSE_MULTIPLIER = 1.3;
const ARMS_FOLDED_Y_MIN = 0.3;
const ARMS_FOLDED_Y_MAX = 4.5;
const FINGER_IN_MOUTH_DIST = 0.55;
const HEAD_TOP_MARGIN = 1.1;
const HAND_ON_HEAD_X_TOLERANCE = 1.5;
const PRAY_CURL_MAX = 1;
const PRAY_PALM_GAP = 1.6;

function createDetector(): Detector {
  let last: (FaceBasics & { yaw: number; t: number }) | null = null;
  const width = new WidthBaseline();
  let note = "-";

  function decide(f: Frame): string {
    const fresh = last && f.now - last.t < FACE_STALE_MS ? last : null;
    note = "-";

    if (f.hands.length) {
      const hs = f.hands.map(handBasics);
      if (hs.length === 2) {
        if (hs.every((h) => h.curledCount <= PRAY_CURL_MAX)) {
          const gap = dist(hs[0].palmCenter, hs[1].palmCenter) / ((hs[0].handScale + hs[1].handScale) / 2);
          const fingersUp = hs.every((h) => h.middleTip.y < h.wrist.y);
          note = `pray gap ${fmt(gap)} (<${PRAY_PALM_GAP}) up:${fingersUp}`;
          if (gap < PRAY_PALM_GAP && fingersUp) return "pray";
        }
        if (fresh) {
          const avgY = (hs[0].palmCenter.y + hs[1].palmCenter.y) / 2;
          const top = fresh.mouthCenter.y + fresh.faceWidth * ARMS_FOLDED_Y_MIN;
          const bottom = fresh.mouthCenter.y + fresh.faceWidth * ARMS_FOLDED_Y_MAX;
          if (top < avgY && avgY < bottom) return "armsFolded";
        }
      }

      const h = hs[0];
      if (h.curledCount === 4) return "fist";
      if (indexOnly(h)) {
        if (fresh && dist(h.indexTip, fresh.mouthCenter) / fresh.faceWidth < FINGER_IN_MOUTH_DIST) return "fingerInMouth";
        return "fingerUp";
      }
      if (fresh) {
        const headTopY = fresh.mouthCenter.y - fresh.faceWidth * HEAD_TOP_MARGIN;
        const nearX = Math.abs(h.palmCenter.x - fresh.mouthCenter.x) / fresh.faceWidth < HAND_ON_HEAD_X_TOLERANCE;
        if (h.palmCenter.y < headTopY && nearX) return "patHead";
      }
      return "default";
    }

    if (fresh) {
      if (width.ratio(fresh.faceWidth) > LEAN_CLOSE_MULTIPLIER) return "leanClose";
      if (Math.abs(fresh.yaw) > SIDE_EYE_YAW_DEG) return "sideways";
    }
    return "default";
  }

  return {
    update(f) {
      if (f.face) {
        last = { ...faceBasics(f.face), yaw: f.face.matrix ? yawFromMatrix(f.face.matrix) : 0, t: f.now };
        width.update(last.faceWidth);
      }
      return decide(f);
    },
    debug() {
      return [
        note,
        `face size ×${fmt(last ? width.ratio(last.faceWidth) : 1)} (lean in >${LEAN_CLOSE_MULTIPLIER})   yaw ${signed(last?.yaw ?? 0)}° (±${SIDE_EYE_YAW_DEG})`,
      ];
    },
  };
}

const monke: Pack = {
  id: "monke",
  name: "Monke",
  defaultGesture: "default",
  needs: {},
  debounce: STREAK_5,
  gestures: {
    pray: { label: "Pray", how: "Both open hands pressed together, fingers up.", memes: ["pray monke.jpg"] },
    armsFolded: { label: "Arms folded", how: "Both hands resting at chest height.", memes: ["grumpy side monke.jpg"] },
    fist: { label: "Punch", how: "One fist.", memes: ["punche m onke.png"] },
    fingerInMouth: { label: "Finger in mouth", how: "Index finger at your mouth.", memes: ["finger in mouth .jpg"] },
    fingerUp: { label: "Finger up", how: "Index finger up, away from your mouth.", memes: ["finger up .jpg"] },
    patHead: { label: "Pat head", how: "One hand up near or above your forehead.", memes: ["pat head.jpg"] },
    leanClose: { label: "Zoom in", how: "No hands. Lean in close to the camera.", memes: ["zoom in monke.png"] },
    sideways: { label: "Sideways", how: "No hands. Turn your head to the side.", memes: ["sideways monke.jpg"] },
    default: { label: "Normal monke", how: "Nothing in particular.", memes: ["normal monk.png"] },
  },
  createDetector,
};

export default monke;
