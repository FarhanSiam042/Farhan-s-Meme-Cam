// Chiikawa: detailed hand signs, plus tongue-out read from mouth colour
// (the face model has no tongue score).
import { add, dist, fmt, indexOnly, labA8, median, mid, percentile, pt, scale, signed, yawFromMatrix, type Landmark, type Vec3 } from "../lib/geometry";
import { faceBasics, handBasics, Window, type FaceBasics } from "./shared";
import { FACE_STALE_MS, type Detector, type Frame, type Pack } from "./types";

const DEFAULT = "pokerFace";
const THUMB_OUT_DIST = 0.9;
const FINGER_AT_MOUTH_DIST = 0.55;
const CHEEK_TOUCH_DIST = 0.55;
const PALMS_UP_MIN_DY = 0.8;
const PALMS_UP_MAX_TILT = 0.7;
const CHIN_Y: [number, number] = [0.3, 1.1];
const CHIN_X_MAX = 0.6;
const HEAD_TOP_MARGIN = 1.1;
const HEAD_X_TOLERANCE = 1.5;
const EAR_DX: [number, number] = [0.45, 1.4];
const EAR_DY: [number, number] = [-1.1, 0.5];
const PHONE_MIN_CURLED = 2;
const OK_PINCH_DIST = 0.4;
const OK_OTHERS_UP_MIN = 2;
const MONOCLE_EYE_DIST = 0.4;
// tongue-out = the patch under the lower lip gets redder than your cheeks,
// measured as a jump above your own resting level
const TONGUE_OUT_THRESH = 0.12;
const TONGUE_A_MARGIN = 11;
const TONGUE_HISTORY_FRAMES = 150;
const LOOK_AWAY_YAW_DEG = 15;
const EYE_SQUINT_MULTIPLIER = 0.78;

const inRange = (v: number, [lo, hi]: [number, number]) => lo < v && v < hi;

function classifyHand(lm: Landmark[]) {
  const h = handBasics(lm);
  const p = h.pts;
  const thumbDist = dist(p[4], p[5]) / h.handScale;
  const thumbOut = thumbDist > THUMB_OUT_DIST;
  return {
    ...h,
    thumbOut,
    thumbUp: thumbOut && p[4].y < p[3].y && p[3].y < p[2].y,
    pinchDist: dist(p[4], p[8]) / h.handScale,
    othersUp: [h.middleUp, h.ringUp, h.pinkyUp].filter(Boolean).length,
    // centre of the thumb-index loop (for the monocle)
    loopCenter: scale(add(mid(p[4], p[8]), mid(p[2], p[5])), 0.5),
  };
}

/** Share of the under-lip patch that's redder than the cheeks. */
function tongueColorScore(f: Frame, lm: Landmark[]): number {
  if (!f.readPixels) return 0;
  const read = f.readPixels;
  const W = f.width;
  const H = f.height;
  const px = (i: number) => [Math.trunc(lm[i].x * W), Math.trunc(lm[i].y * H)];
  const region = (y0: number, y1: number, x0: number, x1: number) => {
    const cy0 = Math.max(0, Math.min(H, y0));
    const cy1 = Math.max(0, Math.min(H, y1));
    const cx0 = Math.max(0, Math.min(W, x0));
    const cx1 = Math.max(0, Math.min(W, x1));
    if (cy1 <= cy0 || cx1 <= cx0) return null;
    return read(cx0, cy0, cx1 - cx0, cy1 - cy0);
  };
  const aValues = (img: ImageData) => {
    const out: number[] = new Array(img.width * img.height);
    for (let i = 0, j = 0; i < out.length; i++, j += 4) out[i] = labA8(img.data[j], img.data[j + 1], img.data[j + 2]);
    return out;
  };

  const [lx] = px(61);
  const [rx] = px(291);
  const [, innerLip] = px(14);
  const [, lipBottom] = px(17);
  const [, chin] = px(152);
  const cx = Math.trunc((lx + rx) / 2);
  const half = Math.trunc(Math.abs(rx - lx) * 0.25);
  const y1 = lipBottom + Math.trunc((chin - lipBottom) * 0.5);
  const patch = region(innerLip, Math.max(y1, 0), cx - half, Math.max(cx + half, 0));
  if (!patch) return 0;

  const refs: number[] = [];
  for (const i of [50, 280]) {
    const [x, y] = px(i);
    const cheek = region(y - 6, y + 6, x - 6, x + 6);
    if (cheek) refs.push(median(aValues(cheek)));
  }
  if (!refs.length) return 0;
  const refA = refs.reduce((a, b) => a + b, 0) / refs.length;
  const a = aValues(patch);
  return a.filter((v) => v > refA + TONGUE_A_MARGIN).length / a.length;
}

function createDetector(): Detector {
  let last: (FaceBasics & { yaw: number; tongue: number; eyeOpen: number; cheeks: [Vec3, Vec3]; eyes: [Vec3, Vec3]; t: number }) | null = null;
  let eyeBaseline: number | null = null;
  const tongueHistory = new Window(TONGUE_HISTORY_FRAMES);
  let note = "-";

  const eyeRatio = () => (last && eyeBaseline ? last.eyeOpen / eyeBaseline : 1);

  function updateFace(f: Frame) {
    if (!f.face) return;
    const lm = f.face.landmarks;
    const p = (i: number) => pt(lm[i]);
    const basics = faceBasics(f.face);
    const eyeOpen = (dist(p(386), p(374)) + dist(p(159), p(145))) / 2 / basics.faceWidth;

    const raw = tongueColorScore(f, lm);
    tongueHistory.push(raw);
    const resting = tongueHistory.length >= 30 ? percentile(tongueHistory.values, 25) : raw;

    last = {
      ...basics,
      yaw: f.face.matrix ? yawFromMatrix(f.face.matrix) : 0,
      tongue: Math.max(0, raw - resting),
      eyeOpen,
      cheeks: [p(50), p(280)],
      eyes: [mid(p(33), p(133)), mid(p(263), p(362))],
      t: f.now,
    };

    // your open-eye level: rises fast, drifts down slowly, freezes while you squint
    if (eyeBaseline === null) eyeBaseline = eyeOpen;
    else if (eyeOpen > eyeBaseline) eyeBaseline += (eyeOpen - eyeBaseline) * 0.15;
    else if (eyeOpen > eyeBaseline * EYE_SQUINT_MULTIPLIER) eyeBaseline += (eyeOpen - eyeBaseline) * 0.01;
  }

  function expression(): string {
    if (!last) return DEFAULT;
    if (last.tongue > TONGUE_OUT_THRESH) return "tongueOut";
    if (Math.abs(last.yaw) > LOOK_AWAY_YAW_DEG) return "sideEye";
    if (eyeRatio() < EYE_SQUINT_MULTIPLIER) return "weird";
    return DEFAULT;
  }

  function decide(f: Frame): string {
    const fresh = last && f.now - last.t < FACE_STALE_MS ? last : null;
    note = "-";
    if (!f.hands.length) return expression();
    const hs = f.hands.map(classifyHand);

    if (hs.length === 2 && fresh) {
      const { mouthCenter, faceWidth } = fresh;
      const bothOpen = hs.every((h) => h.curledCount === 0);
      const low = hs.every((h) => (h.palmCenter.y - mouthCenter.y) / faceWidth > PALMS_UP_MIN_DY);
      const flat = hs.every((h) => (h.wrist.y - h.middleTip.y) / h.handScale < PALMS_UP_MAX_TILT);
      if (bothOpen && low && flat) return "palmsUp";

      const [ca, cb] = fresh.cheeks;
      const [t0, t1] = [hs[0].indexTip, hs[1].indexTip];
      const worst = Math.min(Math.max(dist(t0, ca), dist(t1, cb)), Math.max(dist(t0, cb), dist(t1, ca))) / faceWidth;
      note = `cheek touch ${fmt(worst)} (<${CHEEK_TOUCH_DIST})`;
      if (worst < CHEEK_TOUCH_DIST) return "cheekPoke";
    }

    if (fresh) {
      const { mouthCenter, faceWidth } = fresh;
      for (const h of hs) {
        const okSign = h.pinchDist < OK_PINCH_DIST && h.othersUp >= OK_OTHERS_UP_MIN;
        const eyeGap = Math.min(...fresh.eyes.map((e) => dist(h.loopCenter, e))) / faceWidth;
        if (okSign && eyeGap < MONOCLE_EYE_DIST) return "monocle";
        const dx = Math.abs(h.palmCenter.x - mouthCenter.x) / faceWidth;
        const dy = (h.palmCenter.y - mouthCenter.y) / faceWidth;
        if (inRange(dx, EAR_DX) && inRange(dy, EAR_DY) && h.curledCount >= PHONE_MIN_CURLED) return "cashPhone";
      }
    }

    for (const h of hs) {
      note = `curled ${h.curledCount}  thumb out ${h.thumbOut} up ${h.thumbUp}`;
      if (h.indexUp && h.middleUp && !h.ringUp && !h.pinkyUp) return "peace";
      if (indexOnly(h) && h.thumbOut) return "gun";
      if (h.curledCount === 4) return h.thumbUp ? "thumbsUp" : "fist";
    }

    if (fresh) {
      const { mouthCenter, faceWidth } = fresh;
      for (const h of hs) {
        if (indexOnly(h) && dist(h.indexTip, mouthCenter) / faceWidth < FINGER_AT_MOUTH_DIST) return "fingerMouth";
        const dx = Math.abs(h.palmCenter.x - mouthCenter.x) / faceWidth;
        const dy = (h.palmCenter.y - mouthCenter.y) / faceWidth;
        if (inRange(dy, CHIN_Y) && dx < CHIN_X_MAX) return "chinScratch";
        if (dy < -HEAD_TOP_MARGIN && dx < HEAD_X_TOLERANCE) return "headScratch";
      }
    }

    return hs.some(indexOnly) ? "nerd" : DEFAULT;
  }

  return {
    update(f) {
      updateFace(f);
      return decide(f);
    },
    debug() {
      return [
        note,
        `tongue ${fmt(last?.tongue ?? 0)} (>${TONGUE_OUT_THRESH})   yaw ${signed(last?.yaw ?? 0)}° (±${LOOK_AWAY_YAW_DEG})   eye ratio ${fmt(eyeRatio())} (squint <${EYE_SQUINT_MULTIPLIER})`,
      ];
    },
  };
}

const chiikawa: Pack = {
  id: "chiikawa",
  name: "Chiikawa",
  defaultGesture: DEFAULT,
  needs: { pixels: true },
  debounce: { mode: "streak", stableFrames: 5, fallbackMs: 600, perGesture: { tongueOut: 2 } },
  gestures: {
    palmsUp: { label: "Palms up", how: "Both open hands held low and flat.", memes: ["fadee.jpg"] },
    cheekPoke: { label: "Cheek poke", how: "A fingertip on each cheek (two hands).", memes: ["cheek poke.jpg"] },
    monocle: { label: "Monocle", how: "OK sign held around one eye.", memes: ["monocle.jpg"] },
    cashPhone: { label: "Cash phone", how: "Hand by your ear like holding a phone.", memes: ["cashhh phone.jpg"] },
    peace: { label: "Peace", how: "Index and middle finger up.", memes: ["2 peace sign.jpg"] },
    gun: { label: "Gun", how: "Finger gun: index out, thumb out.", memes: ["gun .jpg"] },
    thumbsUp: {
      label: "Thumbs up",
      how: "Thumb up, other fingers curled.",
      memes: ["thumbs up .jpg", "thumbs upp .jpg", "6823b4b3eaae8f6fd7bfce26a503ad10.jpg"],
    },
    fist: { label: "Fist up", how: "A fist.", memes: ["fist up .jpg"] },
    fingerMouth: { label: "Finger mouth", how: "Index finger at your mouth.", memes: ["finger mouth.jpg"] },
    chinScratch: { label: "Chin scratch", how: "Hand at your chin.", memes: ["chin scratch.jpg"] },
    headScratch: { label: "Head scratch", how: "Hand on top of your head.", memes: ["head scrtch.jpg"] },
    nerd: { label: "Nerd", how: "One finger up.", memes: ["nerd.jpg"] },
    tongueOut: { label: "Tongue out", how: "No hands. Stick your tongue out.", memes: ["tongue out.jpg"] },
    sideEye: { label: "Side eye", how: "No hands. Turn your head.", memes: ["side eye.jpg"] },
    weird: { label: "Weird face", how: "No hands. Half-close your eyes.", memes: ["weird face.jpg"] },
    pokerFace: { label: "Poker face", how: "Straight face.", memes: ["poker face.jpg"] },
  },
  createDetector,
};

export default chiikawa;
