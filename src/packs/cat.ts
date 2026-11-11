// Meowmeow Cat: hands, face expressions and "spinning in your chair" motion.
import { dist, fmt, indexOnly, pitchFromMatrix, signed, yawFromMatrix } from "../lib/geometry";
import { bs, faceBasics, handBasics, type FaceBasics } from "./shared";
import { FACE_STALE_MS, STREAK_5, type Detector, type Frame, type Pack } from "./types";

const SIDE_EYE_YAW_DEG = 15;
const SIDE_EYE_DOWN_PITCH_DEG = 12;
const EYE_WIDE_THRESHOLD = 0.01;
const HUH_JAW_THRESHOLD = 0.03;
const LAUGH_JAW_THRESHOLD = 0.5;
const DANCE_TOP_ZONE_Y = 0.35;
const DANCE_BOTTOM_ZONE_Y = 0.65;
const SPIN_MAG_THRESHOLD = 0.65;
const SPIN_WINDOW_MS = 2200;
const SPIN_FRACTION_REQUIRED = 0.55;
const COVER_FACE_DIST_FACE_SEEN = 0.7;
// when the hand hides the face, the tracker loses it, so allow a wider gap
const COVER_FACE_DIST_FACE_LOST = 1.3;
const SHHH_DIST = 0.55;
const FINGERS_TOUCH_DIST = 1.4;

function classifyHand(lm: Frame["hands"][number]) {
  const h = handBasics(lm);
  return { ...h, thumbOut: dist(h.pts[4], h.pts[17]) / h.handScale > 1.05 };
}

function createDetector(): Detector {
  let last: (FaceBasics & { yaw: number; pitch: number; jaw: number; eyeWide: number; t: number }) | null = null;
  let faceSeen = false;
  let flow: [number, number][] = []; // [time, magnitude]
  let hands = 0;

  const spinFraction = (now: number) => {
    flow = flow.filter(([t]) => now - t < SPIN_WINDOW_MS);
    if (!flow.length) return 0;
    return flow.filter(([, m]) => m > SPIN_MAG_THRESHOLD).length / flow.length;
  };

  function decide(f: Frame): string {
    const now = f.now;
    const fresh = last && now - last.t < FACE_STALE_MS ? last : null;

    // spinning in the chair beats everything, hands included
    if (spinFraction(now) > SPIN_FRACTION_REQUIRED) return "spin";

    if (f.hands.length === 0) {
      if (fresh && fresh.jaw > HUH_JAW_THRESHOLD && fresh.eyeWide > EYE_WIDE_THRESHOLD) return "huh";
      if (fresh && Math.abs(fresh.yaw) > SIDE_EYE_YAW_DEG) return "sideEye";
      if (fresh && fresh.pitch > SIDE_EYE_DOWN_PITCH_DEG) return "sideEyeDown";
      return "default";
    }

    // mouth wide open with a hand anywhere in frame
    if (fresh && fresh.jaw > LAUGH_JAW_THRESHOLD) return "laugh";

    const hs = f.hands.map(classifyHand);

    if (hs.length === 2) {
      const [a, b] = hs;
      if (indexOnly(a) && indexOnly(b) && dist(a.indexTip, b.indexTip) / ((a.handScale + b.handScale) / 2) < FINGERS_TOUCH_DIST) {
        return "fingersTogether";
      }
      if (fresh) {
        const nearFace = hs.every((h) => dist(h.palmCenter, fresh.mouthCenter) / fresh.faceWidth < 2.2);
        if (nearFace) {
          const headTopY = fresh.mouthCenter.y - fresh.faceWidth * 1.1;
          if (hs.every((h) => h.palmCenter.y < headTopY)) return "handsOnHead";
          if (hs.every((h) => h.curledCount === 4)) return "crashOut";
        }
      }
      if (hs.every((h) => h.curledCount === 0)) {
        const ys = hs.map((h) => h.palmCenter.y).sort((p, q) => p - q);
        if (ys[0] < DANCE_TOP_ZONE_Y && ys[1] > DANCE_BOTTOM_ZONE_Y) return "dance";
      }
    }

    const h = hs[0];
    if (h.curledCount === 4) return "fist";
    if (h.thumbOut && h.pinkyUp && !h.indexUp && !h.middleUp && !h.ringUp) return "rockstar";
    if (indexOnly(h)) {
      if (fresh && dist(h.indexTip, fresh.mouthCenter) / fresh.faceWidth < SHHH_DIST) return "shhh";
      return "fingerUp";
    }
    if (fresh) {
      const d = dist(h.palmCenter, fresh.mouthCenter) / fresh.faceWidth;
      if (d < (faceSeen ? COVER_FACE_DIST_FACE_SEEN : COVER_FACE_DIST_FACE_LOST)) return "coverFace";
    }
    if (h.curledCount === 0) return "palmOut";
    if (fresh && Math.abs(fresh.yaw) > SIDE_EYE_YAW_DEG) return "sideEye";
    return "default";
  }

  return {
    update(f) {
      if (f.flow) flow.push([f.now, f.flow.magnitude]);
      faceSeen = !!f.face;
      if (f.face) {
        const m = f.face.matrix;
        last = {
          ...faceBasics(f.face),
          yaw: m ? yawFromMatrix(m) : 0,
          pitch: m ? pitchFromMatrix(m) : 0,
          jaw: bs(f.face, "jawOpen"),
          eyeWide: Math.max(bs(f.face, "eyeWideLeft"), bs(f.face, "eyeWideRight")),
          t: f.now,
        };
      }
      hands = f.hands.length;
      return decide(f);
    },
    debug() {
      const l = last;
      return [
        `hands ${hands}   yaw ${signed(l?.yaw ?? 0)}° (±${SIDE_EYE_YAW_DEG})   pitch ${signed(l?.pitch ?? 0)}° (>${SIDE_EYE_DOWN_PITCH_DEG})`,
        `spin fraction ${fmt(spinFraction(performance.now()))} (>${SPIN_FRACTION_REQUIRED}, flow >${SPIN_MAG_THRESHOLD})`,
        `jawOpen ${fmt(l?.jaw ?? 0)}  eyeWide ${fmt(l?.eyeWide ?? 0)}  (huh >${HUH_JAW_THRESHOLD}/${EYE_WIDE_THRESHOLD}, laugh >${LAUGH_JAW_THRESHOLD})`,
      ];
    },
  };
}

const cat: Pack = {
  id: "cat",
  name: "Meowmeow Cat",
  defaultGesture: "default",
  coverPosition: "50% 25%",
  needs: { flow: true },
  debounce: STREAK_5,
  gestures: {
    spin: { label: "O I I A I", how: "Spin in your chair. Beats everything else.", memes: ["spin cat.mp4"] },
    huh: { label: "Huh", how: "Mouth open and eyes wide, no hands up.", memes: ["huh.png"] },
    sideEye: { label: "Side eye", how: "Turn your head 15° or more.", memes: ["side eye cat.jpg"] },
    sideEyeDown: { label: "Judgy cat munching", how: "Tilt your head down, no hands.", memes: ["side eye.png"] },
    laugh: { label: "Laugh and point", how: "Mouth wide open with a hand anywhere in frame.", memes: ["laugh and point .jpg"] },
    fingersTogether: {
      label: "Muehehe",
      how: "Both index fingers up, tips touching.",
      memes: ["uwucat.jpg", "uwucatt.jpg", "fingers together muehehe .jpg"],
    },
    handsOnHead: { label: "Devastated cat", how: "Both hands up above your head.", memes: ["two hands on head .jpg"] },
    crashOut: { label: "Crash out cat", how: "Two clenched fists up beside your face.", memes: ["crashout cat .jpg"] },
    dance: { label: "Dance cat", how: "Two open palms, one high in the frame, one low.", memes: ["two palms up.mp4"] },
    fist: { label: "Punch", how: "One fist.", memes: ["punchcat.jpg"] },
    rockstar: { label: "Rockstar", how: "Thumb and pinky out (shaka).", memes: ["cat.jpg"] },
    shhh: { label: "Shhh", how: "Index finger on your lips.", memes: ["shhcat.jpg"] },
    fingerUp: { label: "One finger up", how: "Index finger up, away from your face.", memes: ["profcat.jpg", "professorcat.jpg"] },
    coverFace: { label: "Kidnap cat", how: "Hand over your face.", memes: ["hand cover face .jpg"] },
    palmOut: { label: "I have no monies", how: "Open palm out, away from your face.", memes: ["hand stretched out, palm facing up .jpg"] },
    default: { label: "Pokercat", how: "Nothing in particular.", memes: ["pokercat.jpg"] },
  },
  createDetector,
};

export default cat;
