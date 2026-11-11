import { mediaFor, memeUrl } from "../lib/assets";
import { CAMS, COMING_SOON } from "../packs/registry";
import { h, icon } from "./dom";

export function renderHome(root: HTMLElement): void {
  const tiles = [
    ...CAMS.map((c) => {
      const still = mediaFor(c, c.gestures[c.defaultGesture].memes[0]).still;
      return h(
        "a",
        { class: "tile", href: `/${c.id}`, "data-link": true },
        h("div", { class: "tile-img" }, h("img", { src: still, alt: "", loading: "lazy", style: c.coverPosition ? `object-position:${c.coverPosition}` : null })),
        h("div", { class: "tile-cap" }, h("span", { class: "tile-name", text: c.name }), h("span", { class: "tile-count", text: `${Object.keys(c.gestures).length} gestures` })),
      );
    }),
    h(
      "a",
      { class: "tile tile-make", href: "/make", "data-link": true },
      h("div", { class: "tile-img make-art" }, icon("spark", "make-icon"), h("span", { text: "Your gestures, your memes" })),
      h("div", { class: "tile-cap" }, h("span", { class: "tile-name", text: "Make your own" }), h("span", { class: "tile-tag", text: "New" })),
    ),
    ...COMING_SOON.map((c) =>
      h(
        "a",
        { class: "tile soon", href: `/${c.id}`, "data-link": true },
        h("div", { class: "tile-img" }, h("img", { src: memeUrl(c.id, c.cover), alt: "", loading: "lazy" })),
        h("div", { class: "tile-cap" }, h("span", { class: "tile-name", text: c.name }), h("span", { class: "tile-tag muted", text: "Soon" })),
      ),
    ),
  ];

  root.replaceChildren(
    h(
      "div",
      { class: "home" },
      h(
        "header",
        { class: "hero" },
        h("h1", { class: "hero-title" }, "Make a face.", h("br"), h("em", { text: "Get a meme." })),
        h("p", { class: "hero-sub", text: "Pull a face or a hand gesture at your webcam and the matching meme pops up. Save it as a photo or a clip. Everything runs on your device." }),
      ),
      h("div", { class: "tiles" }, tiles),
      h(
        "section",
        { class: "how" },
        h("div", { class: "how-step" }, h("strong", { text: "1. Pick a cam" }), h("span", { text: "Each one has its own set of gestures and memes." })),
        h("div", { class: "how-step" }, h("strong", { text: "2. Allow your camera" }), h("span", { text: "Video stays in your browser. Nothing is uploaded." })),
        h("div", { class: "how-step" }, h("strong", { text: "3. Strike a pose" }), h("span", { text: "Hold it for a moment, then press P for a photo or R for a clip." })),
      ),
    ),
  );
}
