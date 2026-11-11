import { loadManifest, memeUrl, stillOf } from "../lib/assets";
import { h, icon } from "./dom";

export function renderGallery(root: HTMLElement, item: { id: string; name: string }): void {
  const grid = h("div", { class: "gallery" });
  root.replaceChildren(
    h(
      "div",
      { class: "page" },
      h("div", { class: "eyebrow", text: "Coming soon" }),
      h("h1", { class: "page-title", text: item.name }),
      h(
        "p",
        { class: "lede" },
        "These memes are ready, but the gesture detector isn't yet. You can already use them in ",
        h("a", { href: "/make", "data-link": true }, icon("spark"), " Make your own"),
        ".",
      ),
      grid,
    ),
  );
  loadManifest().then((m) => {
    const files = m[item.id] ?? [];
    grid.replaceChildren(...files.map((f) => h("img", { src: memeUrl(item.id, stillOf(f)), alt: f, title: f, loading: "lazy" })));
  });
}
