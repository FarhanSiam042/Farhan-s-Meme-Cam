import { defineConfig, loadEnv, type Plugin } from "vite";
import { CAMS, COMING_SOON } from "./src/packs/registry";

/** Writes robots.txt and sitemap.xml with the real site address. */
function seoFiles(siteUrl: string): Plugin {
  return {
    name: "seo-files",
    apply: "build",
    generateBundle() {
      const paths = ["", ...CAMS.map((c) => c.id), "make", ...COMING_SOON.map((c) => c.id)];
      const urls = paths.map((p) => `  <url><loc>${siteUrl}/${p}</loc></url>`).join("\n");
      this.emitFile({
        type: "asset",
        fileName: "sitemap.xml",
        source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
      });
      this.emitFile({ type: "asset", fileName: "robots.txt", source: `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}/sitemap.xml\n` });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "VITE_");
  const siteUrl = (env.VITE_SITE_URL || "http://localhost:5173").replace(/\/$/, "");
  return {
    plugins: [seoFiles(siteUrl)],
    build: { target: "es2022" },
    // MediaPipe ships its own WASM loader; don't let Vite pre-bundle it
    optimizeDeps: { exclude: ["@mediapipe/tasks-vision"] },
  };
});
