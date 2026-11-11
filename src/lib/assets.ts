// Meme file locations. Files live in public/memes/<folder>/<file>.
import type { MediaSource, Pack } from "../packs/types";

export const isVideo = (file: string): boolean => /\.mp4$/i.test(file);

/** Still image for a meme: videos have a .poster.jpg next to them. */
export const stillOf = (file: string): string => (isVideo(file) ? file.replace(/\.mp4$/i, ".poster.jpg") : file);

export const memeUrl = (folder: string, file: string): string => `/memes/${encodeURIComponent(folder)}/${encodeURIComponent(file)}`;

/** Resolve a pack's meme entry to a URL. */
export function mediaFor(pack: Pack, file: string): MediaSource {
  if (pack.media) return pack.media(file);
  const folder = pack.folder ?? pack.id;
  return { src: memeUrl(folder, file), still: memeUrl(folder, stillOf(file)), video: isVideo(file) };
}

export type Manifest = Record<string, string[]>;

let manifest: Promise<Manifest> | null = null;

/** Every meme file, by folder. */
export function loadManifest(): Promise<Manifest> {
  manifest ??= fetch("/memes/manifest.json")
    .then((r) => (r.ok ? (r.json() as Promise<Manifest>) : {}))
    .catch(() => ({}));
  return manifest;
}
