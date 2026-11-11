// Pick a meme: any file from the library, or upload your own.
import type { MemeRef } from "../custom/db";
import { loadManifest, memeUrl, stillOf } from "../lib/assets";
import { CAMS, COMING_SOON } from "../packs/registry";
import { h, icon, openDialog, toast } from "./dom";

const MAX_UPLOAD_MB = 15;

const folderName = (id: string) => CAMS.find((c) => c.id === id)?.name ?? COMING_SOON.find((c) => c.id === id)?.name ?? id;

export function pickMeme(onPick: (meme: MemeRef) => void): void {
  const tabs = h("div", { class: "tabs", role: "tablist" });
  const grid = h("div", { class: "picker-grid" });
  let close = () => {};

  const upload = h("input", { type: "file", accept: "image/*,video/mp4,video/webm", hidden: true });
  upload.addEventListener("change", () => {
    const file = upload.files?.[0];
    if (!file) return;
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      toast(`That file is over ${MAX_UPLOAD_MB} MB. Try a smaller one.`);
      return;
    }
    onPick({ kind: "upload", blob: file, name: file.name });
    close();
  });
  const uploadBtn = h("button", { class: "btn", onclick: () => upload.click() }, icon("upload"), h("span", { text: "Upload your own" }));

  const showFolder = (folder: string, files: string[]) => {
    for (const t of tabs.children) t.setAttribute("aria-selected", String((t as HTMLElement).dataset.folder === folder));
    grid.replaceChildren(
      ...files.map((file) =>
        h(
          "button",
          {
            class: "picker-item",
            title: file,
            onclick: () => {
              onPick({ kind: "library", folder, file });
              close();
            },
          },
          h("img", { src: memeUrl(folder, stillOf(file)), alt: file, loading: "lazy" }),
        ),
      ),
    );
  };

  loadManifest().then((m) => {
    const folders = Object.keys(m);
    for (const f of folders) {
      tabs.append(h("button", { class: "tab", role: "tab", "data-folder": f, onclick: () => showFolder(f, m[f]) }, folderName(f)));
    }
    if (folders.length) showFolder(folders[0], m[folders[0]]);
  });

  close = openDialog("Pick a meme", h("div", { class: "picker" }, h("div", { class: "picker-top" }, tabs, uploadBtn, upload), grid), { wide: true });
}
