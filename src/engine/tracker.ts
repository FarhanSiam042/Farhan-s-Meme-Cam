// The frame loop: mirror the camera into a canvas, run the trackers, hand the
// results to whoever is listening, and draw the tracking overlay.
import type { FaceFrame, Frame } from "../packs/types";
import { cameraVideo } from "./camera";
import { FLOW_H, FLOW_W, flowSignal, toGray } from "./flow";
import { drawOverlay } from "./overlay";
import * as vision from "./vision";

export interface Consumer {
  needs: { pose?: boolean; flow?: boolean; pixels?: boolean };
  onFrame(frame: Frame): void;
}

/** The mirrored camera picture (with tracking overlay) that the page shows. */
export const canvas = document.createElement("canvas");
canvas.className = "cam-canvas";
const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

const small = document.createElement("canvas");
small.width = FLOW_W;
small.height = FLOW_H;
const sctx = small.getContext("2d", { willReadFrequently: true })!;

let consumer: Consumer | null = null;
let running = false;
let lastVideoTime = -1;
let lastTs = 0;
let failures = 0;
let prevGray: Float32Array | null = null;
let prevFlowT = 0;
let fpsCount = 0;
let fpsT = 0;
export let fps = 0;
export let lastFrame: Frame | null = null;

/** Called when detection keeps failing. */
export let onTrouble: ((message: string) => void) | null = null;
export const setTroubleHandler = (fn: (message: string) => void) => (onTrouble = fn);

export function setConsumer(c: Consumer | null): void {
  consumer = c;
  prevGray = null;
  lastFrame = null;
  if (c && !running) {
    running = true;
    lastVideoTime = -1;
    requestAnimationFrame(tick);
  }
  if (!c) running = false;
}

function blendshapes(res: ReturnType<NonNullable<ReturnType<typeof vision.face>>["detectForVideo"]>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of res.faceBlendshapes?.[0]?.categories ?? []) out[c.categoryName] = c.score;
  return out;
}

/** True when two small grayscale frames are (near enough) pixel-identical. */
function sameImage(a: Float32Array, b: Float32Array): boolean {
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff += Math.abs(a[i] - b[i]);
  return diff / a.length < 0.05;
}

function tick(): void {
  if (!running) return;
  requestAnimationFrame(tick);
  const video = cameraVideo();
  const c = consumer;
  const handTask = vision.hand();
  const faceTask = vision.face();
  if (!c || !video || !handTask || !faceTask || video.readyState < 2 || video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;

  const w = video.videoWidth;
  const h = video.videoHeight;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  // mirror like a selfie camera
  ctx.save();
  ctx.translate(w, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, w, h);
  ctx.restore();

  const now = performance.now();
  // MediaPipe rejects timestamps that aren't strictly increasing
  const ts = Math.max(now, lastTs + 1);
  lastTs = ts;

  let hands;
  let faceRes;
  let poseRes = null;
  try {
    hands = handTask.detectForVideo(canvas, ts);
    faceRes = faceTask.detectForVideo(canvas, ts);
    if (c.needs.pose) poseRes = vision.pose()?.detectForVideo(canvas, ts) ?? null;
    failures = 0;
  } catch (err) {
    if (++failures === 1) console.error(err);
    if (failures === 30) onTrouble?.("Tracking keeps failing. Try reloading the page.");
    return;
  }

  let flow = null;
  if (c.needs.flow) {
    sctx.drawImage(canvas, 0, 0, FLOW_W, FLOW_H);
    const gray = toGray(sctx.getImageData(0, 0, FLOW_W, FLOW_H).data);
    // Browsers sometimes hand over the same camera image twice. A repeat
    // would read as "no motion" and water down the spin signal, so skip it.
    if (!prevGray || !sameImage(prevGray, gray)) {
      if (prevGray) {
        flow = flowSignal(prevGray, gray);
        // tuned at ~30 fps: scale so a slower frame rate doesn't inflate motion
        flow.magnitude *= 33.3 / Math.min(100, Math.max(16, now - prevFlowT));
      }
      prevGray = gray;
      prevFlowT = now;
    }
  }

  const face: FaceFrame | null = faceRes.faceLandmarks?.length
    ? {
        landmarks: faceRes.faceLandmarks[0],
        blendshapes: blendshapes(faceRes),
        matrix: faceRes.facialTransformationMatrixes?.[0] ?? null,
      }
    : null;

  const frame: Frame = {
    now,
    hands: hands.landmarks ?? [],
    face,
    pose: poseRes?.landmarks?.[0] ?? null,
    flow,
    width: w,
    height: h,
    readPixels: c.needs.pixels ? (x, y, rw, rh) => ctx.getImageData(x, y, rw, rh) : null,
  };
  lastFrame = frame;
  c.onFrame(frame);
  drawOverlay(ctx, frame);

  fpsCount++;
  if (now - fpsT > 1000) {
    fps = (fpsCount * 1000) / (now - fpsT);
    fpsCount = 0;
    fpsT = now;
  }
}
