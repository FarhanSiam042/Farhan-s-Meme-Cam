// Tiny DOM helpers: h() builds elements, icon() returns inline SVG.

type Child = Node | string | null | undefined | false | Child[];
type Attrs = Record<string, string | number | boolean | null | undefined | EventListener> & { class?: string };

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "text") el.textContent = String(v);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, String(v));
  }
  append(el, children);
  return el;
}

function append(el: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
}

export const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel);

const ICONS = {
  sidebar: '<rect x="2.5" y="3.5" width="15" height="13" rx="2"/><path d="M7.5 3.5v13"/>',
  link: '<path d="M8.5 11.5a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2l-.9.9M11.5 8.5a3 3 0 0 0-4.2 0l-2.6 2.6a3 3 0 0 0 4.2 4.2l.9-.9"/>',
  sun: '<circle cx="10" cy="10" r="3.5"/><path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.3 4.3l1.4 1.4M14.3 14.3l1.4 1.4M4.3 15.7l1.4-1.4M14.3 5.7l1.4-1.4"/>',
  moon: '<path d="M16 12.5A6.5 6.5 0 0 1 7.5 4a6.5 6.5 0 1 0 8.5 8.5z"/>',
  camera: '<circle cx="10" cy="10.5" r="3.5"/><rect x="2.5" y="5" width="15" height="11" rx="2.5"/><path d="M7 5 8 3.5h4L13 5"/>',
  video: '<rect x="2.5" y="5.5" width="11" height="9" rx="2"/><path d="m13.5 9 4-2.5v7l-4-2.5"/>',
  record: '<circle cx="10" cy="10" r="5" fill="currentColor" stroke="none"/>',
  stop: '<rect x="6" y="6" width="8" height="8" rx="1.5" fill="currentColor" stroke="none"/>',
  list: '<path d="M7 5.5h9M7 10h9M7 14.5h9M3.5 5.5h.01M3.5 10h.01M3.5 14.5h.01"/>',
  close: '<path d="M5 5l10 10M15 5 5 15"/>',
  plus: '<path d="M10 4v12M4 10h12"/>',
  trash: '<path d="M4 6h12M8 6V4.5h4V6M6 6l.7 9.5h6.6L14 6"/>',
  share: '<path d="M10 3v10M6 7l4-4 4 4M4 12v4h12v-4"/>',
  download: '<path d="M10 3v10M6 9l4 4 4-4M4 16h12"/>',
  spark: '<path d="M10 2.5 11.8 8.2 17.5 10l-5.7 1.8L10 17.5l-1.8-5.7L2.5 10l5.7-1.8z"/>',
  upload: '<path d="M10 13V3M6 7l4-4 4 4M4 13v3h12v-3"/>',
  dot: '<circle cx="10" cy="10" r="3" fill="currentColor" stroke="none"/>',
} as const;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName, cls = ""): SVGSVGElement {
  const wrap = document.createElement("span");
  wrap.innerHTML = `<svg class="icon ${cls}" viewBox="0 0 20 20" aria-hidden="true">${ICONS[name]}</svg>`;
  return wrap.firstElementChild as SVGSVGElement;
}

let toastTimer = 0;
export function toast(text: string): void {
  const el = $("#toast");
  if (!el) return;
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove("show"), 2600);
}

/** A modal dialog. Returns a close function. */
export function openDialog(title: string, body: Node, opts: { wide?: boolean; onClose?: () => void } = {}): () => void {
  const dlg = h("dialog", { class: `dialog${opts.wide ? " wide" : ""}` });
  const close = () => dlg.close();
  dlg.append(
    h(
      "div",
      { class: "dialog-head" },
      h("h2", { text: title }),
      h("button", { class: "icon-btn", "aria-label": "Close", onclick: close }, icon("close")),
    ),
    body,
  );
  dlg.addEventListener("close", () => {
    dlg.remove();
    opts.onClose?.();
  });
  // click on the backdrop closes
  dlg.addEventListener("click", (e) => e.target === dlg && close());
  document.body.append(dlg);
  dlg.showModal();
  return close;
}
