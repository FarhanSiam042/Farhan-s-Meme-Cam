// Jigglypuff: head direction is measured against YOUR resting head position
// (a rolling window of how you actually sit), not against zero.
import { dist, fmt, pitchYawFromMatrix, signed } from "../lib/geometry";
import { avgLR, bs, faceBasics, handBasics, WidthBaseline, Window, type FaceBasics } from "./shared";
import { FACE_STALE_MS, STREAK_5, type Detector, type Frame, type Pack } from "./types";

const LEAN_CLOSE_MULTIPLIER = 1.3;
const LOOK_AWAY_YAW_DEG = 12; // from your resting yaw
const CRY_LOOK_DOWN_PITCH_MARGIN = 12; // past your resting pitch
const LOOK_UP_PITCH_MARGIN = 6; // below your median pitch
const HISTORY_FRAMES = 600; // ~20-40 s
const PITCH_BASELINE_PERCENTILE = 25;
const HAPPY_SMILE_TWO_HANDS = 0.25;
const JAW_OPEN_NEAR_HAND = 0.12; // a hand over the mouth hides the jaw, so accept less
const MOUTH_OPEN_RATIO = 0.09;
const FROWN = 0.15;
const NEAR_MOUTH_DIST = 0.75;
// palm this many face widths above the mouth = hand raised (about eye level)
const HAND_UP_MARGIN = 0.5;
const CROSSED_Y_MIN = 0.5;
const CROSSED_Y_MAX = 2.0;
const CROSSED_X_MAX = 1.2;
const CROSSED_MIN_FRAME_Y = 0.5;
const CROSSED_MAX_HAND_GAP = 4.5;

function createDetector(): Detector {
  let last: (FaceBasics & { pitch: number; yaw: number; smile: number; jaw: number; frown: number; t: number }) | null = null;
  const width = new WidthBaseline();
  const pitches = new Window(HISTORY_FRAMES);
  const yaws = new Window(HISTORY_FRAMES);
  let pitchBaseline: number | null = null;
  let pitchMedian: number | null = null;
  let yawBaseline = 0;
  let nearMouthCount = 0;

  function updateFace(f: Frame) {
    const face = f.face;
    if (!face) return;
    const { pitch, yaw } = face.matrix ? pitchYawFromMatrix(face.matrix) : { pitch: 0, yaw: 0 };
    last = {
      ...faceBasics(face),
      pitch,
      yaw,
      smile: avgLR(face, "mouthSmile"),
      jaw: bs(face, "jawOpen"),
      // grumpy = a mouth frown OR angry eyebrows
      frown: Math.max(avgLR(face, "mouthFrown"), avgLR(face, "browDown")),
      t: f.now,
    };
    width.update(last.faceWidth);
    pitches.push(pitch);
    yaws.push(yaw);
    const p = pitches.sorted();
    pitchMedian = p[p.length >> 1];
    pitchBaseline = p.length < 30 ? pitchMedian : p[Math.floor((p.length * PITCH_BASELINE_PERCENTILE) / 100)];
    yawBaseline = yaws.sorted()[yaws.length >> 1];
  }

  function decide(f: Frame): string {
    const fresh = last && f.now - last.t < FACE_STALE_MS ? last : null;
    nearMouthCount = 0;

    if (f.hands.length) {
      const hs = f.hands.map(handBasics);
      if (fresh) {
        const { mouthCenter, faceWidth } = fresh;
        const near = hs.filter((h) => dist(h.palmCenter, mouthCenter) / faceWidth < NEAR_MOUTH_DIST).length;
        nearMouthCount = near;
        if (near >= 2) return fresh.smile > HAPPY_SMILE_TWO_HANDS ? "happy" : "coverMouth";
        if (near === 1) return fresh.jaw > JAW_OPEN_NEAR_HAND || fresh.mouthRatio > MOUTH_OPEN_RATIO ? "openMouth" : "handOverMouth";
        const headTopY = mouthCenter.y - faceWidth * HAND_UP_MARGIN;
        if (hs.some((h) => h.palmCenter.y < headTopY)) return "holdUpPen";
        if (hs.length === 2) {
          const avgY = (hs[0].palmCenter.y + hs[1].palmCenter.y) / 2;
          const avgX = (hs[0].palmCenter.x + hs[1].palmCenter.x) / 2;
          const xOff = Math.abs(avgX - mouthCenter.x) / faceWidth;
          const gap = Math.abs(hs[0].palmCenter.x - hs[1].palmCenter.x) / faceWidth;
          if (
            mouthCenter.y + faceWidth * CROSSED_Y_MIN < avgY &&
            avgY < mouthCenter.y + faceWidth * CROSSED_Y_MAX &&
            xOff < CROSSED_X_MAX &&
            avgY > CROSSED_MIN_FRAME_Y &&
            gap < CROSSED_MAX_HAND_GAP
          ) {
            return "faint";
          }
        }
      }
      return hs[0].curledCount === 4 ? "slap" : "default";
    }

    if (fresh) {
      if (width.ratio(fresh.faceWidth) > LEAN_CLOSE_MULTIPLIER) {
        return pitchMedian !== null && fresh.pitch < pitchMedian - LOOK_UP_PITCH_MARGIN ? "evil" : "zoom";
      }
      if (Math.abs(fresh.yaw - yawBaseline) > LOOK_AWAY_YAW_DEG) return fresh.frown > FROWN ? "grump" : "hmph";
      if (pitchBaseline !== null && fresh.pitch > pitchBaseline + CRY_LOOK_DOWN_PITCH_MARGIN) return "cry";
    }
    return "default";
  }

  return {
    update(f) {
      updateFace(f);
      return decide(f);
    },
    debug() {
      const l = last;
      if (!l) return [];
      return [
        `hands near mouth ${nearMouthCount}   smile ${fmt(l.smile)}  jaw ${fmt(l.jaw)}  lip gap ${fmt(l.mouthRatio)}  frown ${fmt(l.frown)}`,
        `pitch ${signed(l.pitch)}° resting ${signed(pitchBaseline ?? 0)}° (cry > +${CRY_LOOK_DOWN_PITCH_MARGIN})   yaw ${signed(l.yaw)}° resting ${signed(yawBaseline)}° (±${LOOK_AWAY_YAW_DEG})`,
        `face size ×${fmt(width.ratio(l.faceWidth))} (lean in >${LEAN_CLOSE_MULTIPLIER})`,
      ];
    },
  };
}

const jigglypuff: Pack = {
  id: "jigglypuff",
  name: "Jigglypuff",
  defaultGesture: "default",
  needs: {},
  debounce: STREAK_5,
  gestures: {
    happy: { label: "Happy", how: "Both hands near your mouth, and smile.", memes: ["happy.jpg"] },
    coverMouth: { label: "Cover mouth", how: "Two hands over your mouth.", memes: ["cover mouth.jpg"] },
    openMouth: { label: "Open mouth", how: "Mouth wide open, one hand near it.", memes: ["open mouth.jpg"] },
    handOverMouth: { label: "Hand over mouth", how: "One hand over your mouth.", memes: ["hand over mouth.jpg"] },
    holdUpPen: { label: "Hold up pen", how: "A hand raised above or beside your head.", memes: ["hold up pen.jpg"] },
    faint: { label: "Faint", how: "Arms crossed, hands on your shoulders.", memes: ["faint.jpg"] },
    slap: { label: "Slap", how: "One fist.", memes: ["slap slap.jpg", "slapp.jpg"] },
    zoom: { label: "Zoom", how: "No hands. Lean in close to the camera.", memes: ["zoom.png"] },
    evil: { label: "Evil", how: "No hands. Lean in close and tilt your head up.", memes: ["zoom evil.jpg"] },
    grump: { label: "Grump", how: "No hands. Turn your head and scowl.", memes: ["grump.jpg"] },
    hmph: { label: "Hmph", how: "No hands. Turn your head away.", memes: ["hmph looking away.jpg"] },
    cry: { label: "Cry", how: "No hands. Look down a little.", memes: ["cry look down.jpg"] },
    default: { label: "Sit", how: "Poker face.", memes: ["sit.jpg"] },
  },
  createDetector,
};

export default jigglypuff;
