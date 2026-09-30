import { defineConfig, loadEnv } from "vite";
import { resolve } from "path";
import { copyFileSync, existsSync } from "fs";

// Dev-only plugin: mimics the GitHub Pages routing.
//   <base>login        → login.html  (landing/login script)
//   <base>             → main.html   (main app)
//   <base>:worldName   → main.html   (main app, world boot handled by JS)
function htmlRouterPlugin(base) {
  const baseNoSlash = base.replace(/\/+$/, "");
  return {
    name: "html-router",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if ((req.method || "GET").toUpperCase() !== "GET") return next();

        const acceptHeader = String(req.headers?.accept || "").toLowerCase();
        const fetchDest = String(req.headers?.["sec-fetch-dest"] || "").toLowerCase();
        const isDocumentNavigation =
          acceptHeader.includes("text/html") || fetchDest === "document";

        // Only rewrite top-level document requests; let module/HMR/asset requests pass.
        if (!isDocumentNavigation) return next();

        const raw = req.url || "/";
        const qIdx = raw.indexOf("?");
        const fullPath = qIdx >= 0 ? raw.slice(0, qIdx) : raw;
        const search = qIdx >= 0 ? raw.slice(qIdx) : "";

        if (baseNoSlash && !fullPath.startsWith(baseNoSlash)) return next();
        const pathname = fullPath.slice(baseNoSlash.length) || "/";

        // Let Vite handle real files (assets, source maps, HMR, etc.)
        if (pathname.includes(".")) return next();

        req.url = `${baseNoSlash}${pathname === "/login" ? "/login.html" : "/main.html"}${search}`;
        next();
      });
    },
  };
}

// GitHub Pages has no rewrites: serve the app at index.html and for unknown
// paths (/:worldName) via 404.html. /login resolves to login.html natively.
function githubPagesFallbackPlugin() {
  let outDir = "dist";
  return {
    name: "github-pages-fallback",
    apply: "build",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const mainHtml = resolve(outDir, "main.html");
      if (!existsSync(mainHtml)) return;
      copyFileSync(mainHtml, resolve(outDir, "index.html"));
      copyFileSync(mainHtml, resolve(outDir, "404.html"));
    },
  };
}

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const base = env.VITE_BASE_PATH || (command === "build" ? "/demo-preview/" : "/");

  return {
    base,
    plugins: [htmlRouterPlugin(base), githubPagesFallbackPlugin()],
    server: {
      host: true,
    },
    build: {
      rollupOptions: {
        input: {
          login: resolve(__dirname, "login.html"),
          main: resolve(__dirname, "main.html"),
        },
      },
    },
  };
});
