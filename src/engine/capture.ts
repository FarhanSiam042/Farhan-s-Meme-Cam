// Photo and clip capture: a 9:16 card with the meme on top and you below,
// sized for stories / reels. Everything is drawn locally on a canvas.

const W = 720;
const H = 1280;
const HALF = H / 2;
const CLIP_MAX_MS = 8000;

export interface CaptureSource {
  /** The live camera picture. */
  camera: HTMLCanvasElement;
  /** The meme currently on screen (img or playing video). */
  meme: () => HTMLImageElement | HTMLVideoElement | null;
  /** The current meme's name, drawn as a caption. */
  label: () => string;
}

const out = document.createElement("canvas");
out.width = W;
out.height = H;
const ctx = out.getContext("2d")!;

function mediaSize(m: HTMLImageElement | HTMLVideoElement): [number, number] {
  return m instanceof HTMLVideoElement ? [m.videoWidth, m.videoHeight] : [m.naturalWidth, m.naturalHeight];
}

/** Draw `src` to fill the box, cropping the overflow (CSS object-fit: cover). */
function cover(src: CanvasImageSource, sw: number, sh: number, x: number, y: number, w: number, h: number) {
  if (!sw || !sh) return;
  const k = Math.max(w / sw, h / sh);
  const cw = w / k;
  const ch = h / k;
  ctx.drawImage(src, (sw - cw) / 2, (sh - ch) / 2, cw, ch, x, y, w, h);
}

/** Draw `src` whole inside the box (object-fit: contain). */
function contain(src: CanvasImageSource, sw: number, sh: number, x: number, y: number, w: number, h: number) {
  if (!sw || !sh) return;
  const k = Math.min(w / sw, h / sh);
  const dw = sw * k;
  const dh = sh * k;
  ctx.drawImage(src, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

function pill(text: string, x: number, y: number) {
  ctx.font = "600 34px system-ui, -apple-system, Segoe UI, sans-serif";
  const tw = ctx.measureText(text).width;
  const padX = 22;
  const h = 56;
  ctx.fillStyle = "rgba(0,0,0,0.62)";
  ctx.beginPath();
  ctx.roundRect(x, y - h, tw + padX * 2, h, h / 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + padX, y - h / 2 + 1);
}

function drawCard(s: CaptureSource): void {
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, W, H);

  const meme = s.meme();
  if (meme) {
    const [mw, mh] = mediaSize(meme);
    // blurred-look backdrop: the meme cropped to fill, dimmed, then the whole meme on top
    ctx.globalAlpha = 0.35;
    cover(meme, mw, mh, 0, 0, W, HALF);
    ctx.globalAlpha = 1;
    contain(meme, mw, mh, 0, 0, W, HALF);
  }
  cover(s.camera, s.camera.width, s.camera.height, 0, HALF, W, HALF);

  ctx.fillStyle = "#fff";
  ctx.fillRect(0, HALF - 2, W, 4);
  const label = s.label();
  if (label) pill(label, 28, HALF - 28);

  ctx.font = "600 26px system-ui, -apple-system, Segoe UI, sans-serif";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  const mark = "meme cam";
  ctx.fillText(mark, W - ctx.measureText(mark).width - 28, H - 32);
}

export async function takePhoto(s: CaptureSource): Promise<Blob> {
  drawCard(s);
  return new Promise((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't save photo"))), "image/png"));
}

export const canRecord = (): boolean => typeof MediaRecorder !== "undefined" && "captureStream" in HTMLCanvasElement.prototype;

function pickMime(): string {
  for (const m of ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm"]) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
}

export interface Recording {
  /** Stops early. The promise from startClip resolves with the clip. */
  stop(): void;
  /** 0..1 of the maximum clip length. */
  progress(): number;
  done: Promise<Blob>;
}

export function startClip(s: CaptureSource): Recording {
  const mime = pickMime();
  const stream = out.captureStream(30);
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 4_000_000 } : undefined);
  const chunks: Blob[] = [];
  const started = performance.now();
  let raf = 0;
  let stopped = false;

  const loop = () => {
    drawCard(s);
    if (performance.now() - started >= CLIP_MAX_MS) stop();
    else raf = requestAnimationFrame(loop);
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    rec.stop();
  };

  const done = new Promise<Blob>((resolve, reject) => {
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      resolve(new Blob(chunks, { type: rec.mimeType || mime || "video/webm" }));
    };
    rec.onerror = (e) => reject((e as unknown as { error?: Error }).error ?? new Error("Recording failed"));
  });

  rec.start(250);
  loop();
  return { stop, progress: () => Math.min(1, (performance.now() - started) / CLIP_MAX_MS), done };
}

/** Share via the system sheet where possible (phones), else download. */
export async function shareOrSave(blob: Blob, baseName: string): Promise<"shared" | "saved"> {
  const ext = blob.type.includes("mp4") ? "mp4" : blob.type.includes("webm") ? "webm" : "png";
  const file = new File([blob], `${baseName}.${ext}`, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "Meme Cam" });
      return "shared";
    } catch (err) {
      if ((err as Error).name === "AbortError") return "shared";
    }
  }
  download(blob, file.name);
  return "saved";
}

export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
