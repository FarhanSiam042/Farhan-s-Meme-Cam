// MediaPipe loading. Models and the WASM runtime are served by the site itself
// (public/models, public/wasm), so the service worker can cache them for
// instant repeat visits.
import { FaceLandmarker, FilesetResolver, HandLandmarker, PoseLandmarker } from "@mediapipe/tasks-vision";

export type TaskKind = "hand" | "face" | "pose";
type Task = HandLandmarker | FaceLandmarker | PoseLandmarker;

const MODEL_FILES: Record<TaskKind, string> = {
  hand: "/models/hand_landmarker.task",
  face: "/models/face_landmarker.task",
  pose: "/models/pose_landmarker.task",
};
/** Approximate sizes, for the progress bar when the server doesn't send a length. */
const MODEL_BYTES: Record<TaskKind, number> = { hand: 7_819_105, face: 3_758_596, pose: 5_777_746 };

/** Download progress, 0..1, for everything requested so far. */
export type ProgressFn = (fraction: number, label: string) => void;

let fileset: ReturnType<typeof FilesetResolver.forVisionTasks> | null = null;
const tasks: Partial<Record<TaskKind, Promise<Task>>> = {};
const ready: Partial<Record<TaskKind, Task>> = {};

/** Fetch a model, reporting progress as bytes arrive. */
async function fetchModel(url: string, onBytes: (loaded: number, total: number) => void): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Couldn't download ${url} (${res.status})`);
  const total = Number(res.headers.get("content-length")) || 0;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onBytes(loaded, total);
  }
  const out = new Uint8Array(loaded);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

async function create(kind: TaskKind, buffer: Uint8Array): Promise<Task> {
  fileset ??= FilesetResolver.forVisionTasks("/wasm");
  const fs = await fileset;
  // GPU where it works, CPU otherwise (some Safari / older GPU setups)
  for (const delegate of ["GPU", "CPU"] as const) {
    const baseOptions = { modelAssetBuffer: buffer, delegate };
    try {
      if (kind === "hand") return await HandLandmarker.createFromOptions(fs, { baseOptions, runningMode: "VIDEO", numHands: 2 });
      if (kind === "face") {
        return await FaceLandmarker.createFromOptions(fs, {
          baseOptions,
          runningMode: "VIDEO",
          numFaces: 1,
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: true,
        });
      }
      return await PoseLandmarker.createFromOptions(fs, { baseOptions, runningMode: "VIDEO", numPoses: 1 });
    } catch (err) {
      if (delegate === "CPU") throw err;
      console.warn(`${kind}: GPU failed, retrying on CPU`, err);
    }
  }
  throw new Error("unreachable");
}

/** Load the given trackers (once each), reporting combined download progress. */
export async function loadTasks(kinds: TaskKind[], onProgress?: ProgressFn): Promise<void> {
  const pending = kinds.filter((k) => !ready[k]);
  if (!pending.length) return;
  const loaded: Partial<Record<TaskKind, number>> = {};
  const totals: Partial<Record<TaskKind, number>> = {};
  const report = () => {
    const l = pending.reduce((s, k) => s + (loaded[k] ?? 0), 0);
    const t = pending.reduce((s, k) => s + (totals[k] ?? 0), 0);
    onProgress?.(t ? l / t : 0, "Downloading face and hand tracking");
  };
  await Promise.all(
    pending.map((kind) => {
      totals[kind] = MODEL_BYTES[kind];
      tasks[kind] ??= fetchModel(MODEL_FILES[kind], (l, t) => {
        loaded[kind] = Math.min(l, t || MODEL_BYTES[kind]);
        if (t) totals[kind] = t;
        report();
      })
        .then((buf) => {
          onProgress?.(1, "Starting the trackers");
          return create(kind, buf);
        })
        .then((task) => (ready[kind] = task))
        .catch((err) => {
          delete tasks[kind]; // allow a retry
          throw err;
        });
      return tasks[kind];
    }),
  );
}

export const hand = () => ready.hand as HandLandmarker | undefined;
export const face = () => ready.face as FaceLandmarker | undefined;
export const pose = () => ready.pose as PoseLandmarker | undefined;

/** Per-cam confidence (the hamster cam uses 0.6), or back to 0.5. */
export async function setConfidence(c: { hand?: number; face?: number } = {}): Promise<void> {
  const h = c.hand ?? 0.5;
  const f = c.face ?? 0.5;
  await ready.hand?.setOptions({ minHandDetectionConfidence: h, minHandPresenceConfidence: 0.5, minTrackingConfidence: h });
  await ready.face?.setOptions({ minFaceDetectionConfidence: f, minFacePresenceConfidence: 0.5, minTrackingConfidence: f });
}
