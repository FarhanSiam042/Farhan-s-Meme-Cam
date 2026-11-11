// "Make your own": pick memes, record a few seconds of each pose, and an
// on-device classifier learns to tell them apart.
import { buildCustomPack, forgetUpload, mediaOf } from "../custom/customPack";
import { deleteGesture, listGestures, needsRecording, newGesture, saveGesture, type CustomGesture } from "../custom/db";
import { extractFeatures, FEATURE_VERSION } from "../custom/features";
import type { Frame } from "../packs/types";
import { mountCamView, type CamSession } from "./camView";
import { $, h, icon, toast } from "./dom";
import { pickMeme } from "./memePicker";

const RECORD_MS = 3000;
const COUNTDOWN_S = 3;

export async function renderCustom(root: HTMLElement): Promise<() => void> {
  let gestures = await listGestures();
  if (!gestures.length) {
    const resting = newGesture("Resting", { kind: "library", folder: "cat", file: "pokercat.jpg" }, true);
    await saveGesture(resting);
    gestures = [resting];
  }

  let live = false;
  let collecting: { into: number[][] } | null = null;
  let busy = false;

  const list = h("ol", { class: "guide custom-list" });
  const addBtn = h("button", { class: "btn", onclick: () => addGesture() }, icon("plus"), h("span", { text: "Add a gesture" }));
  const panelBody = h(
    "div",
    {},
    h(
      "p",
      { class: "note lead" },
      "Teach the cam your own poses. Pick a meme, press record, and hold the pose for 3 seconds. Move a little while it records so it learns small variations. It all runs on this device.",
    ),
    list,
    addBtn,
  );

  const onFrame = (f: Frame) => {
    live = true;
    if (collecting) collecting.into.push(Array.from(extractFeatures(f)));
  };

  const session: CamSession = mountCamView(root, buildCustomPack(gestures), { panelBody, onFrame });

  const ready = () => gestures.filter((g) => !needsRecording(g));
  function refresh() {
    session.setPack(buildCustomPack(gestures));
    renderList();
    const n = ready().length;
    const resting = gestures.find((g) => g.isDefault);
    if (resting && needsRecording(resting)) session.setEmptyNote("Start by recording your resting pose: just sit normally.");
    else if (n < 2) session.setEmptyNote("Now add a gesture and record it.");
    else session.setEmptyNote(null);
  }

  function renderList() {
    list.replaceChildren(
      ...gestures.map((g) => {
        const m = mediaOf(g);
        const name = h("input", { class: "name-input", value: g.label, "aria-label": "Gesture name", maxlength: 40 });
        name.addEventListener("change", async () => {
          g.label = name.value.trim() || g.label;
          await saveGesture(g);
          refresh();
        });
        const status = needsRecording(g) ? h("span", { class: "status todo", text: "Not recorded" }) : h("span", { class: "status ok", text: `Recorded · ${g.samples.length} frames` });
        const rec = h("button", { class: "chip", title: "Record this pose", onclick: () => record(g, rec) }, icon("record", "rec-icon"), needsRecording(g) ? "Record" : "Redo");
        const del = g.isDefault
          ? null
          : h("button", { class: "icon-btn small", "aria-label": `Delete ${g.label}`, title: "Delete", onclick: () => remove(g) }, icon("trash"));
        return h(
          "li",
          { class: "guide-item custom-item", "data-gesture": g.id },
          h(
            "button",
            { class: "thumb-btn", title: "Change meme", onclick: () => changeMeme(g) },
            m.video ? h("video", { class: "guide-thumb", src: m.src, muted: true, playsinline: true }) : h("img", { class: "guide-thumb", src: m.still, alt: "" }),
          ),
          h("div", { class: "custom-main" }, name, h("div", { class: "custom-meta" }, g.isDefault ? h("span", { class: "tag", text: "Default" }) : null, status)),
          h("div", { class: "custom-actions" }, rec, del),
        );
      }),
    );
  }

  async function record(g: CustomGesture, btn: HTMLButtonElement) {
    if (busy) return;
    if (!live) {
      toast("Turn on the camera first");
      return;
    }
    busy = true;
    const pane = $(".cam-pane", root)!;
    const overlay = h("div", { class: "countdown" });
    pane.append(overlay);
    try {
      for (let s = COUNTDOWN_S; s > 0; s--) {
        overlay.textContent = String(s);
        overlay.dataset.label = `Get ready: ${g.label}`;
        await new Promise((r) => setTimeout(r, 1000));
      }
      overlay.textContent = "";
      overlay.classList.add("recording");
      overlay.dataset.label = "Hold it… move a little";
      const samples: number[][] = [];
      collecting = { into: samples };
      const start = performance.now();
      await new Promise<void>((resolve) => {
        const step = () => {
          const p = (performance.now() - start) / RECORD_MS;
          overlay.style.setProperty("--p", String(Math.min(1, p)));
          if (p >= 1) resolve();
          else requestAnimationFrame(step);
        };
        step();
      });
      collecting = null;
      if (samples.length < 10) {
        toast("Hardly any frames came through. Check the camera and try again.");
        return;
      }
      g.samples = samples;
      g.featureVersion = FEATURE_VERSION;
      await saveGesture(g);
      toast(`Learned "${g.label}" from ${samples.length} frames`);
      refresh();
    } finally {
      collecting = null;
      busy = false;
      overlay.remove();
      btn.blur();
    }
  }

  function addGesture() {
    pickMeme(async (meme) => {
      const label = meme.kind === "library" ? meme.file.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ").trim() : meme.name.replace(/\.[a-z0-9]+$/i, "");
      const g = newGesture(label.slice(0, 40) || "My gesture", meme);
      await saveGesture(g);
      gestures.push(g);
      refresh();
      toast("Now press Record and hold the pose");
    });
  }

  function changeMeme(g: CustomGesture) {
    pickMeme(async (meme) => {
      forgetUpload(g.id);
      g.meme = meme;
      await saveGesture(g);
      refresh();
    });
  }

  async function remove(g: CustomGesture) {
    if (!confirm(`Delete "${g.label}"?`)) return;
    await deleteGesture(g.id);
    forgetUpload(g.id);
    gestures = gestures.filter((x) => x !== g);
    refresh();
  }

  refresh();
  return () => session.destroy();
}
