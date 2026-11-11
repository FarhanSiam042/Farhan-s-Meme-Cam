// The cam page: live camera + meme side by side, an action bar for photo /
// clip capture, and a side panel with the gesture list and settings.
import { canRecord, shareOrSave, startClip, takePhoto, type CaptureSource, type Recording } from "../engine/capture";
import { cameraAllowed, CameraError, startCamera } from "../engine/camera";
import { HAND_STYLES } from "../engine/overlay";
import { Stabilizer } from "../engine/stabilizer";
import * as tracker from "../engine/tracker";
import { loadTasks, setConfidence, type TaskKind } from "../engine/vision";
import { mediaFor } from "../lib/assets";
import type { Detector, Frame, Pack } from "../packs/types";
import { settings } from "../store";
import { h, icon, openDialog, toast } from "./dom";

export interface CamViewOptions {
  /** Replaces the built-in gesture list (the "Make your own" page uses this). */
  panelBody?: HTMLElement;
  /** Every tracked frame, after the detector ran. */
  onFrame?: (f: Frame) => void;
  /** Shown over the meme pane when the cam has nothing to show yet. */
  emptyNote?: string;
}

export interface CamSession {
  readonly pack: Pack;
  setPack(pack: Pack): void;
  setEmptyNote(note: string | null): void;
  destroy(): void;
}

const videoCache = new Map<string, HTMLVideoElement>();

function preload(pack: Pack): void {
  for (const g of Object.values(pack.gestures)) {
    for (const file of g.memes) {
      const m = mediaFor(pack, file);
      if (!m.src) continue;
      if (m.video) {
        if (!videoCache.has(m.src)) {
          const v = h("video", { src: m.src, loop: true, playsinline: true, preload: "auto", crossorigin: "anonymous" });
          v.muted = true;
          videoCache.set(m.src, v);
        }
      } else {
        const img = new Image();
        img.decoding = "async";
        img.src = m.src;
      }
    }
  }
}

export function guideList(pack: Pack): HTMLElement {
  return h(
    "ol",
    { class: "guide" },
    Object.entries(pack.gestures).map(([id, g]) =>
      h(
        "li",
        { class: "guide-item", "data-gesture": id },
        h("img", { class: "guide-thumb", src: mediaFor(pack, g.memes[0]).still, alt: "", loading: "lazy" }),
        h("div", {}, h("div", { class: "guide-name", text: g.label }), h("div", { class: "guide-how", text: g.how })),
      ),
    ),
  );
}

function settingsBlock(): HTMLElement {
  const toggle = (label: string, title: string, get: () => boolean, set: (v: boolean) => void) => {
    const b = h("button", { class: "chip", "aria-pressed": String(get()), title }, label);
    b.addEventListener("click", () => {
      set(!get());
      document.dispatchEvent(new Event("settingschange"));
    });
    // stays in sync when a keyboard shortcut flips the setting
    document.addEventListener("settingschange", () => b.setAttribute("aria-pressed", String(get())));
    return b;
  };

  const swatches = h("div", { class: "swatches", role: "radiogroup", "aria-label": "Tracking colour" });
  const select = (key: string) => {
    settings.handColor = key;
    for (const b of swatches.querySelectorAll<HTMLElement>("[data-key]")) b.setAttribute("aria-checked", String(b.dataset.key === key));
    customWrap.setAttribute("aria-checked", String(!HAND_STYLES[key]));
  };
  for (const [key, st] of Object.entries(HAND_STYLES)) {
    swatches.append(
      h("button", {
        class: "swatch",
        role: "radio",
        "data-key": key,
        "aria-checked": String(settings.handColor === key),
        "aria-label": st.label,
        title: st.label,
        style: `--sw-line:${st.line};--sw-joint:${st.joint}`,
        onclick: () => select(key),
      }),
    );
  }
  const custom = h("input", { type: "color", value: HAND_STYLES[settings.handColor] ? "#ff6ec7" : settings.handColor, "aria-label": "Custom colour" });
  custom.addEventListener("input", () => select(custom.value));
  const customWrap = h("label", { class: "swatch custom", title: "Custom colour", "aria-checked": String(!HAND_STYLES[settings.handColor]) }, custom);
  swatches.append(customWrap);

  return h(
    "section",
    { class: "panel-section" },
    h("h3", { class: "eyebrow", text: "Display" }),
    h(
      "div",
      { class: "chips" },
      toggle("Hand lines", "Draw the hand skeleton", () => settings.handLines, (v) => (settings.handLines = v)),
      toggle("Face dots", "Draw the face-tracking dots", () => settings.faceDots, (v) => (settings.faceDots = v)),
      toggle("Debug", "Show the numbers the detector is using (D)", () => settings.debug, (v) => (settings.debug = v)),
    ),
    h("h3", { class: "eyebrow", text: "Tracking colour" }),
    swatches,
  );
}

export function mountCamView(root: HTMLElement, initialPack: Pack, opts: CamViewOptions = {}): CamSession {
  let pack = initialPack;
  let detector: Detector = pack.createDetector();
  let stabilizer = new Stabilizer(pack.debounce, pack.defaultGesture, performance.now());
  let current: string | null = null;
  let memeEl: HTMLImageElement | HTMLVideoElement | null = null;
  let recording: Recording | null = null;
  let live = false;
  let destroyed = false;

  // ---- elements
  const hud = h("pre", { class: "hud", hidden: true });
  const recBadge = h("div", { class: "rec-badge", hidden: true }, icon("dot"), h("span", { text: "0s" }));
  const progressBar = h("div", { class: "progress", hidden: true }, h("div", { class: "progress-fill" }));
  const startLabel = h("span", { text: "Turn on camera" });
  const startBtn = h("button", { class: "btn primary" }, icon("camera"), startLabel);
  const startNote = h("p", { class: "start-note", text: "Video stays on this device. Nothing is uploaded." });
  const startStatus = h("p", { class: "start-status" });
  const startOverlay = h("div", { class: "start" }, icon("camera", "start-icon"), startNote, startBtn, progressBar, startStatus);
  const camPane = h("div", { class: "pane cam-pane" }, startOverlay, hud, recBadge);

  const memeLabel = h("div", { class: "meme-label" });
  const emptyNote = h("div", { class: "meme-empty", hidden: true });
  const memePane = h("div", { class: "pane meme-pane" }, memeLabel, emptyNote);

  const photoBtn = h("button", { class: "action", title: "Take a photo (P)", disabled: true }, icon("camera"), h("span", { text: "Photo" }));
  const clipLabel = h("span", { text: "Clip" });
  const clipBtn = h("button", { class: "action", title: "Record a clip, up to 8 s (R)", disabled: true }, icon("record", "rec-icon"), clipLabel);
  if (!canRecord()) clipBtn.hidden = true;
  const panelBtn = h("button", { class: "action", title: "Gestures and settings (G)", "aria-controls": "panel" }, icon("list"), h("span", { text: "Gestures" }));

  const panelTitle = h("h2", { class: "panel-title", text: pack.name });
  const panelCount = h("div", { class: "eyebrow" });
  const panelBody = h("div", { class: "panel-body" });
  const panel = h(
    "aside",
    { class: "panel", id: "panel", "aria-label": "Gestures and settings" },
    h(
      "div",
      { class: "panel-head" },
      h("div", {}, panelCount, panelTitle),
      h("button", { class: "icon-btn", "aria-label": "Close panel", onclick: () => setPanel(false) }, icon("close")),
    ),
    panelBody,
    settingsBlock(),
  );

  root.replaceChildren(
    h(
      "div",
      { class: "cam-page" },
      h("div", { class: "cam-main" }, h("div", { class: "stage" }, camPane, memePane), h("div", { class: "actionbar" }, photoBtn, clipBtn, h("div", { class: "spacer" }), panelBtn)),
      panel,
    ),
  );

  const setPanel = (open: boolean) => {
    document.documentElement.dataset.panel = open ? "open" : "closed";
    panelBtn.setAttribute("aria-expanded", String(open));
    settings.panelOpen = open;
  };
  panelBtn.addEventListener("click", () => setPanel(document.documentElement.dataset.panel !== "open"));
  // on phones the panel covers the stage, so start closed there
  setPanel(settings.panelOpen && window.matchMedia("(min-width: 900px)").matches);

  function renderPanel() {
    panelTitle.textContent = pack.name;
    const n = Object.keys(pack.gestures).length;
    panelCount.textContent = `${n} gesture${n === 1 ? "" : "s"}`;
    panelBody.replaceChildren(opts.panelBody ?? guideList(pack));
    if (!opts.panelBody) {
      panelBody.append(
        h("p", { class: "note", text: "Listed in the order they're checked: when a pose fits two gestures, the earlier one wins. Hold a pose for a moment and the meme switches." }),
      );
    }
    highlight();
  }

  function highlight() {
    for (const li of panel.querySelectorAll<HTMLElement>("[data-gesture]")) li.classList.toggle("active", li.dataset.gesture === current);
  }

  function show(gesture: string) {
    current = gesture;
    const g = pack.gestures[gesture] ?? pack.gestures[pack.defaultGesture];
    if (!g) {
      memeEl?.remove();
      memeEl = null;
      memeLabel.textContent = "";
      return;
    }
    const file = g.memes[Math.floor(Math.random() * g.memes.length)];
    const m = mediaFor(pack, file);
    let el: HTMLImageElement | HTMLVideoElement;
    if (m.video) {
      el = videoCache.get(m.src) ?? h("video", { src: m.src, loop: true, playsinline: true, crossorigin: "anonymous" });
      el.muted = true;
      el.currentTime = 0;
      el.play().catch(() => {});
    } else {
      el = h("img", { src: m.src, alt: g.label, crossorigin: "anonymous" });
    }
    el.classList.add("meme");
    if (memeEl && memeEl !== el) {
      if (memeEl instanceof HTMLVideoElement) memeEl.pause();
      memeEl.remove();
    }
    el.classList.remove("swap");
    void el.offsetWidth; // restart the pop-in animation
    el.classList.add("swap");
    if (!el.isConnected) memePane.prepend(el);
    memeEl = el;
    memeLabel.textContent = g.label;
    highlight();
  }

  const onFrame = (f: Frame) => {
    const raw = detector.update(f);
    const next = stabilizer.push(raw, f.now);
    if (next !== null) show(next);
    opts.onFrame?.(f);
    if (settings.debug) {
      hud.hidden = false;
      hud.textContent = [`showing ${current}   raw ${raw}   ${tracker.fps.toFixed(0)} fps`, ...detector.debug()].join("\n");
    } else hud.hidden = true;
  };

  const consumer: tracker.Consumer = {
    get needs() {
      return pack.needs;
    },
    onFrame,
  };

  const tasksFor = (p: Pack): TaskKind[] => (p.needs.pose ? ["hand", "face", "pose"] : ["hand", "face"]);

  async function go() {
    startBtn.hidden = true;
    startOverlay.classList.remove("error");
    startStatus.textContent = "Starting camera…";
    try {
      await startCamera();
      progressBar.hidden = false;
      const fill = progressBar.firstElementChild as HTMLElement;
      await loadTasks(tasksFor(pack), (frac, label) => {
        fill.style.width = `${Math.round(frac * 100)}%`;
        startStatus.textContent = frac < 1 ? `${label}… ${Math.round(frac * 100)}%` : `${label}…`;
      });
      await setConfidence(pack.confidence);
    } catch (err) {
      console.error(err);
      startOverlay.classList.add("error");
      startNote.textContent = err instanceof CameraError ? err.message : `Something went wrong: ${(err as Error).message}`;
      startLabel.textContent = "Try again";
      startBtn.hidden = false;
      progressBar.hidden = true;
      startStatus.textContent = "";
      return;
    }
    if (destroyed) return;
    startOverlay.remove();
    camPane.prepend(tracker.canvas);
    live = true;
    photoBtn.disabled = false;
    clipBtn.disabled = false;
    tracker.setConsumer(consumer);
  }
  startBtn.addEventListener("click", go);
  // camera already allowed on an earlier visit: start without the click
  cameraAllowed().then((ok) => {
    if (ok && !destroyed && !live) go();
  });

  // ---- capture
  const source: CaptureSource = {
    camera: tracker.canvas,
    meme: () => memeEl,
    label: () => (current ? (pack.gestures[current]?.label ?? "") : ""),
  };
  const fileBase = () => `meme-cam-${pack.id}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}`;

  function showResult(blob: Blob, kind: "photo" | "clip") {
    const url = URL.createObjectURL(blob);
    const preview =
      kind === "photo" ? h("img", { class: "result-media", src: url, alt: "Your photo" }) : h("video", { class: "result-media", src: url, controls: true, autoplay: true, loop: true, playsinline: true });
    if (preview instanceof HTMLVideoElement) preview.muted = true;
    const share = h("button", { class: "btn primary" }, icon("share"), h("span", { text: "Share or save" }));
    let close = () => {};
    share.addEventListener("click", async () => {
      const how = await shareOrSave(blob, fileBase());
      if (how === "saved") toast(kind === "photo" ? "Photo saved to your downloads" : "Clip saved to your downloads");
      close();
    });
    close = openDialog(kind === "photo" ? "Your photo" : "Your clip", h("div", { class: "result" }, preview, h("div", { class: "dialog-actions" }, share)), {
      onClose: () => URL.revokeObjectURL(url),
    });
  }

  async function photo() {
    if (!live) return;
    camPane.classList.remove("flash");
    void camPane.offsetWidth;
    camPane.classList.add("flash");
    try {
      showResult(await takePhoto(source), "photo");
    } catch (err) {
      toast((err as Error).message);
    }
  }

  function toggleClip() {
    if (!live) return;
    if (recording) {
      recording.stop();
      return;
    }
    const rec = startClip(source);
    recording = rec;
    clipBtn.classList.add("recording");
    clipLabel.textContent = "Stop";
    recBadge.hidden = false;
    const tickBadge = () => {
      if (recording !== rec) return;
      (recBadge.lastElementChild as HTMLElement).textContent = `${Math.ceil(rec.progress() * 8)}s / 8s`;
      requestAnimationFrame(tickBadge);
    };
    tickBadge();
    rec.done
      .then((blob) => !destroyed && showResult(blob, "clip"))
      .catch((err) => toast(`Recording failed: ${(err as Error).message}`))
      .finally(() => {
        recording = null;
        clipBtn.classList.remove("recording");
        clipLabel.textContent = "Clip";
        recBadge.hidden = true;
      });
  }
  photoBtn.addEventListener("click", photo);
  clipBtn.addEventListener("click", toggleClip);

  const onKey = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement).closest("input, textarea, select, dialog")) return;
    const k = e.key.toLowerCase();
    if (k === "p") photo();
    else if (k === "r") toggleClip();
    else if (k === "g") setPanel(document.documentElement.dataset.panel !== "open");
    else if (k === "d") {
      settings.debug = !settings.debug;
      document.dispatchEvent(new Event("settingschange"));
    } else return;
    e.preventDefault();
  };
  document.addEventListener("keydown", onKey);

  // ---- start
  preload(pack);
  renderPanel();
  show(pack.defaultGesture);

  const api: CamSession = {
    get pack() {
      return pack;
    },
    setPack(next: Pack) {
      pack = next;
      detector = pack.createDetector();
      stabilizer = new Stabilizer(pack.debounce, pack.defaultGesture, performance.now());
      preload(pack);
      renderPanel();
      show(pack.defaultGesture);
      if (live) {
        loadTasks(tasksFor(pack)).catch((err) => toast(`Couldn't load tracking: ${(err as Error).message}`));
        setConfidence(pack.confidence);
      }
    },
    setEmptyNote(note) {
      emptyNote.hidden = !note;
      emptyNote.textContent = note ?? "";
    },
    destroy() {
      destroyed = true;
      recording?.stop();
      tracker.setConsumer(null);
      memeEl instanceof HTMLVideoElement && memeEl.pause();
      document.removeEventListener("keydown", onKey);
      delete document.documentElement.dataset.panel;
    },
  };
  if (opts.emptyNote) api.setEmptyNote(opts.emptyNote);
  return api;
}
