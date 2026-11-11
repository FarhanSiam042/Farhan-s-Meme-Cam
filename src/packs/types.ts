import type { Landmark, Matrix } from "../lib/geometry";

export interface FaceFrame {
  landmarks: Landmark[];
  /** Blendshape name -> score 0..1 (jawOpen, mouthSmileLeft, ...). */
  blendshapes: Record<string, number>;
  matrix: Matrix | null;
}

export interface FlowSample {
  /** Mean sideways motion across the frame, in 160x90 pixels per frame. */
  magnitude: number;
  /** Share of moving pixels that agree on one direction, 0..1. */
  coherence: number;
}

/** Everything the trackers saw in one camera frame. Coordinates are 0..1, mirrored like a selfie. */
export interface Frame {
  now: number;
  hands: Landmark[][];
  face: FaceFrame | null;
  pose: Landmark[] | null;
  flow: FlowSample | null;
  width: number;
  height: number;
  /** Reads pixels from the mirrored frame. Only set for packs that need pixels. */
  readPixels: ((x: number, y: number, w: number, h: number) => ImageData) | null;
}

export interface Detector {
  /** Returns the gesture id for this frame. */
  update(frame: Frame): string;
  /** Lines for the debug readout. */
  debug(): string[];
}

export type DebounceConfig =
  /** Switch after the same gesture holds for N frames; drop back to default after fallbackMs. */
  | { mode: "streak"; stableFrames: number; fallbackMs: number; perGesture?: Record<string, number> }
  /** Switch when one gesture wins `majority` of the last `window` frames. */
  | { mode: "vote"; window: number; majority: number };

export interface Gesture {
  label: string;
  /** How to trigger it, shown in the gesture list. */
  how: string;
  /** Meme files in public/memes/<pack id>/. One is picked at random each time. */
  memes: string[];
}

export interface Pack {
  id: string;
  name: string;
  /** Folder in public/memes/ (defaults to id). */
  folder?: string;
  defaultGesture: string;
  /** CSS object-position for the home-page cover crop. */
  coverPosition?: string;
  needs: { pose?: boolean; flow?: boolean; pixels?: boolean };
  /** MediaPipe confidence (default 0.5). */
  confidence?: { hand?: number; face?: number };
  debounce: DebounceConfig;
  /** In the order the detector checks them: earlier wins. */
  gestures: Record<string, Gesture>;
  createDetector(): Detector;
  /** Where a meme entry lives. Defaults to public/memes/<folder>/<file>. */
  media?: (file: string) => MediaSource;
}

export interface MediaSource {
  src: string;
  /** Still image for lists and thumbnails. */
  still: string;
  video: boolean;
}

/** Shared "how fresh does the last face reading need to be" window. */
export const FACE_STALE_MS = 1200;

/** The standard 5-frame streak most cams use. */
export const STREAK_5: DebounceConfig = { mode: "streak", stableFrames: 5, fallbackMs: 600 };
