# Meme Cam

Make faces or hand gestures at your webcam and the matching meme pops up. Save the moment as a photo or a short clip, or teach the cam your own gestures. Everything runs in the browser: video never leaves your device.

## What's in it

- **6 cams, 83 gestures**: Meowmeow Cat (including "spin in your chair" for O I I A I), Hamster, Monke, Piplup, Jigglypuff and Chiikawa.
- **Make your own**: pick any meme from the library or upload your own, hold a pose for 3 seconds, and an on-device classifier learns it.
- **Photo and clip capture**: a 9:16 card (meme on top, you below) ready for stories and reels. On phones it opens the share sheet.
- **Works offline after the first visit**: a service worker caches the tracking models, runtime and memes.
- **Shareable links**: each cam has its own address (`/cat`, `/hamster`, …), with proper link previews and a sitemap.

Keyboard: **P** photo, **R** start/stop clip, **G** gesture panel, **D** debug readout.

## Run it

Needs Node 18 or newer.

```sh
npm install
npm run dev        # http://localhost:5173
```

No webcam? Add `?source=test` to any cam's address for a fake camera that pans sideways (it triggers spin cat on the cat cam).

```sh
npm test           # unit tests
npm run build      # production build in dist/
npm run preview    # serve the build at http://localhost:4173
```

## Deploy

The repo is ready for Vercel: import it, keep the defaults (Vite is detected), and deploy. Set `VITE_SITE_URL` in `.env` (or in Vercel's environment variables) to your site's full address, so link previews and the sitemap point at the right place.

## How it works

```
camera ─► mirrored canvas ─► MediaPipe (hands, face + expressions, body pose)
                          └► motion signal (spin detection)
                                   │
                                   ▼
                      cam detector (rules, or k-NN for "Make your own")
                                   │
                                   ▼
                stabilizer (hold for a few frames) ─► meme on screen
```

| Folder | What's there |
|---|---|
| `src/packs/` | One file per cam: its detector rules, gestures and memes. `registry.ts` lists them. |
| `src/engine/` | Camera, MediaPipe loading, the frame loop, motion flow, the stabilizer, overlay drawing, photo/clip capture. |
| `src/custom/` | "Make your own": pose features, the k-NN classifier, and saved gestures (IndexedDB). |
| `src/ui/` | Pages: home, cam view, "Make your own", galleries, meme picker. |
| `src/lib/` | Geometry helpers shared by every cam, meme file paths. |
| `public/memes/` | Meme images and videos, one folder per cam, listed in `manifest.json`. |
| `public/models/` | MediaPipe model files. |
| `tests/` | Unit tests (Vitest). |

## Add a cam

1. Put the memes in `public/memes/<id>/` and add them to `public/memes/manifest.json`.
2. Write `src/packs/<id>.ts`. Copy `monke.ts` (the simplest) for the shape.
3. Import it in `src/packs/registry.ts` and add it to `CAMS`.
