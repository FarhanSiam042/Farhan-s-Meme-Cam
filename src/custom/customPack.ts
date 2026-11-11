// Builds a playable cam from the user's saved gestures.
import { memeUrl, stillOf, isVideo } from "../lib/assets";
import type { MediaSource, Pack } from "../packs/types";
import { needsRecording, type CustomGesture } from "./db";
import { extractFeatures } from "./features";
import { Knn } from "./knn";

export const CUSTOM_ID = "custom";

/** Object URLs for uploaded memes, reused while the page is open. */
const uploadUrls = new Map<string, string>();

export function mediaOf(g: CustomGesture): MediaSource {
  if (g.meme.kind === "library") {
    const { folder, file } = g.meme;
    return { src: memeUrl(folder, file), still: memeUrl(folder, stillOf(file)), video: isVideo(file) };
  }
  let url = uploadUrls.get(g.id);
  if (!url) {
    url = URL.createObjectURL(g.meme.blob);
    uploadUrls.set(g.id, url);
  }
  return { src: url, still: url, video: g.meme.blob.type.startsWith("video/") };
}

export function forgetUpload(id: string): void {
  const url = uploadUrls.get(id);
  if (url) URL.revokeObjectURL(url);
  uploadUrls.delete(id);
}

export function buildCustomPack(gestures: CustomGesture[]): Pack {
  const trained = gestures.filter((g) => !needsRecording(g));
  const def = gestures.find((g) => g.isDefault) ?? gestures[0];
  const byId = new Map(gestures.map((g) => [g.id, g]));

  return {
    id: CUSTOM_ID,
    name: "My Cam",
    defaultGesture: def?.id ?? "none",
    needs: {},
    debounce: { mode: "streak", stableFrames: 4, fallbackMs: 600 },
    gestures: Object.fromEntries(
      gestures.map((g) => [g.id, { label: g.label, how: g.isDefault ? "Your resting pose." : "Your recorded pose.", memes: [g.id] }]),
    ),
    media: (id) => {
      const g = byId.get(id);
      return g ? mediaOf(g) : { src: "", still: "", video: false };
    },
    createDetector() {
      const knn = new Knn();
      knn.train(trained.flatMap((g) => g.samples.map((s) => ({ label: g.id, features: s }))));
      let last = "-";
      return {
        update(frame) {
          const p = knn.predict(extractFeatures(frame));
          if (!p) return def?.id ?? "none";
          last = `${byId.get(p.label)?.label ?? p.label} (${Math.round(p.confidence * 100)}% of votes)`;
          // a split vote means "none of these, really": fall back to resting
          return p.confidence < 0.5 && def ? def.id : p.label;
        },
        debug: () => [`best match: ${last}`, `${knn.size} recorded frames across ${knn.labels().size} gestures`],
      };
    },
  };
}
