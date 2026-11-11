import "./styles.css";
import { setTroubleHandler } from "./engine/tracker";
import { CAMS, COMING_SOON, findCam } from "./packs/registry";
import { settings } from "./store";
import { mountCamView } from "./ui/camView";
import { renderCustom } from "./ui/customView";
import { $, h, icon, toast } from "./ui/dom";
import { renderGallery } from "./ui/gallery";
import { renderHome } from "./ui/home";

/** Credit shown in the footer. */
const CREDITS = {
  name: "Farhan Shahriar Haque",
  url: "https://github.com/FarhanSiam042",
};

const SITE_NAME = "Meme Cam";
const SITE_DESC = "Make faces or gestures at your webcam and the matching meme pops up.";

const root = document.documentElement;
const view = $("#view")!;

// ---- theme
function applyTheme() {
  const t = settings.theme;
  if (t) root.dataset.theme = t;
  else delete root.dataset.theme;
}
applyTheme();

// ---- shell
const navLinks = [
  ...CAMS.map((c) => ({ id: c.id, name: c.name })),
  { id: "make", name: "Make your own" },
];

const nav = h(
  "nav",
  { class: "camnav", "aria-label": "Cams" },
  navLinks.map((l) => h("a", { href: `/${l.id}`, "data-link": true, "data-id": l.id }, l.id === "make" ? icon("spark") : null, l.name)),
);

const themeBtn = h("button", { class: "icon-btn", "aria-label": "Switch light / dark", title: "Switch light / dark" }, icon("sun", "sun"), icon("moon", "moon"));
themeBtn.addEventListener("click", () => {
  const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  settings.theme = dark ? "light" : "dark";
  applyTheme();
});

const linkBtn = h("button", { class: "icon-btn", "aria-label": "Copy link", title: "Copy link" }, icon("link"));
linkBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    toast("Link copied");
  } catch {
    toast(location.href);
  }
});

$("#topbar")!.replaceChildren(
  h("a", { class: "brand", href: "/", "data-link": true }, h("img", { src: "/favicon.svg", alt: "" }), h("span", { text: SITE_NAME })),
  nav,
  h("div", { class: "topbar-actions" }, linkBtn, themeBtn),
);

$("#footer")!.replaceChildren(
  h("span", { text: "Made by " }),
  h("a", { href: CREDITS.url, target: "_blank", rel: "noopener" }, CREDITS.name),
);

setTroubleHandler(toast);

// ---- router
let cleanup: (() => void) | null = null;

function setMeta(title: string, desc = SITE_DESC) {
  document.title = title === SITE_NAME ? `${SITE_NAME}: make a face, get a meme` : `${title} · ${SITE_NAME}`;
  $('meta[name="description"]')?.setAttribute("content", desc);
}

async function route() {
  cleanup?.();
  cleanup = null;
  const id = decodeURIComponent(location.pathname.replace(/^\/+|\/+$/g, ""));
  for (const a of nav.querySelectorAll<HTMLElement>("a")) a.toggleAttribute("aria-current", a.dataset.id === id);
  delete root.dataset.view;
  window.scrollTo(0, 0);

  const cam = findCam(id);
  if (cam) {
    root.dataset.view = "cam";
    settings.lastCam = cam.id;
    setMeta(cam.name, `${cam.name} meme cam: ${Object.keys(cam.gestures).length} gestures. ${SITE_DESC}`);
    const s = mountCamView(view, cam);
    cleanup = () => s.destroy();
    return;
  }
  if (id === "make") {
    root.dataset.view = "cam";
    setMeta("Make your own", "Teach the cam your own gestures and pick the memes they trigger. Runs entirely on your device.");
    cleanup = await renderCustom(view);
    return;
  }
  const soon = COMING_SOON.find((c) => c.id === id);
  if (soon) {
    setMeta(soon.name);
    renderGallery(view, soon);
    return;
  }
  if (id) history.replaceState(null, "", "/");
  setMeta(SITE_NAME);
  renderHome(view);
}

export function navigate(path: string) {
  if (path === location.pathname) return;
  history.pushState(null, "", path);
  route();
}

document.addEventListener("click", (e) => {
  const a = (e.target as HTMLElement).closest<HTMLAnchorElement>("a[data-link]");
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  navigate(a.getAttribute("href")!);
});
window.addEventListener("popstate", route);

// links from the old site used #/cat
if (location.hash.startsWith("#/")) history.replaceState(null, "", `/${location.hash.slice(2)}`);
route();

if (import.meta.env.PROD) {
  // offline cache (not in dev: it would serve stale code)
  if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
  // Vercel Web Analytics (does nothing unless it's switched on in the Vercel project)
  if (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) document.head.append(h("script", { defer: true, src: "/_vercel/insights/script.js" }));
}
