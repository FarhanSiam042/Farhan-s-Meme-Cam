// Saved "Make your own" gestures, in IndexedDB on this device.
import { FEATURE_VERSION } from "./features";

export type MemeRef = { kind: "library"; folder: string; file: string } | { kind: "upload"; blob: Blob; name: string };

export interface CustomGesture {
  id: string;
  label: string;
  /** The resting pose: shown when nothing else matches. Exactly one gesture has this. */
  isDefault: boolean;
  meme: MemeRef;
  samples: number[][];
  featureVersion: number;
  createdAt: number;
}

const DB_NAME = "memecam";
const STORE = "customGestures";

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function listGestures(): Promise<CustomGesture[]> {
  try {
    const all = await run<CustomGesture[]>("readonly", (s) => s.getAll());
    return all.sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.createdAt - b.createdAt);
  } catch (err) {
    console.warn("Couldn't read saved gestures", err);
    return [];
  }
}

export const saveGesture = (g: CustomGesture) => run("readwrite", (s) => s.put(g));
export const deleteGesture = (id: string) => run("readwrite", (s) => s.delete(id));

export function newGesture(label: string, meme: MemeRef, isDefault = false): CustomGesture {
  return {
    id: crypto.randomUUID(),
    label,
    isDefault,
    meme,
    samples: [],
    featureVersion: FEATURE_VERSION,
    createdAt: Date.now(),
  };
}

/** Recordings from an older feature layout can't be compared, so they need recording again. */
export const needsRecording = (g: CustomGesture) => g.samples.length === 0 || g.featureVersion !== FEATURE_VERSION;
