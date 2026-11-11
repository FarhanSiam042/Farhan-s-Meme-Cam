// Per-browser preferences in localStorage. Every read/write is guarded:
// storage can be blocked (private windows, strict settings).

const PREFIX = "memecam.";

function read(key: string): string | null {
  try {
    return localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(PREFIX + key, value);
  } catch {
    /* storage unavailable: setting just won't persist */
  }
}

function bool(key: string, fallback: boolean) {
  return {
    get: () => {
      const v = read(key);
      return v === null ? fallback : v === "1";
    },
    set: (v: boolean) => write(key, v ? "1" : "0"),
  };
}

const faceDots = bool("faceDots", true);
const handLines = bool("handLines", true);
const debug = bool("debug", false);
const panelOpen = bool("panelOpen", true);

export const settings = {
  get faceDots() {
    return faceDots.get();
  },
  set faceDots(v: boolean) {
    faceDots.set(v);
  },
  get handLines() {
    return handLines.get();
  },
  set handLines(v: boolean) {
    handLines.set(v);
  },
  get debug() {
    return debug.get();
  },
  set debug(v: boolean) {
    debug.set(v);
  },
  get panelOpen() {
    return panelOpen.get();
  },
  set panelOpen(v: boolean) {
    panelOpen.set(v);
  },
  get handColor() {
    return read("handColor") ?? "classic";
  },
  set handColor(v: string) {
    write("handColor", v);
  },
  get theme(): "light" | "dark" | null {
    const v = read("theme");
    return v === "light" || v === "dark" ? v : null;
  },
  set theme(v: "light" | "dark" | null) {
    write("theme", v ?? "");
  },
  get lastCam() {
    return read("lastCam");
  },
  set lastCam(v: string | null) {
    write("lastCam", v ?? "");
  },
};
