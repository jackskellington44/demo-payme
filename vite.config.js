import { defineConfig, loadEnv } from "vite";
import { resolve } from "path";

// Dev-only plugin: routes the Vite dev server the same way Caddy does in prod.
//   /login          → login.html  (landing/login script)
//   /               → main.html   (main app)
//   /:worldName     → main.html   (main app, world boot handled by JS)
// Anything with a dot (assets, favicons, etc.) or starting with an API
// prefix passes straight through to Vite's normal handlers.
function htmlRouterPlugin() {
  return {
    name: "html-router",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if ((req.method || 'GET').toUpperCase() !== 'GET') return next();

        const acceptHeader = String(req.headers?.accept || '').toLowerCase();
        const fetchDest = String(req.headers?.['sec-fetch-dest'] || '').toLowerCase();
        const isDocumentNavigation =
          acceptHeader.includes('text/html') || fetchDest === 'document';

        // Only rewrite top-level document requests; let module/HMR/asset requests pass.
        if (!isDocumentNavigation) return next();

        const raw = req.url || "/";
        const qIdx = raw.indexOf("?");
        const pathname = qIdx >= 0 ? raw.slice(0, qIdx) : raw;
        const search   = qIdx >= 0 ? raw.slice(qIdx)    : "";

        // Let Vite handle real files (assets, source maps, HMR, etc.)
        if (pathname.includes(".")) return next();
        // Let Vite proxy handle backend routes
        if (
          pathname.startsWith("/api/") ||
          pathname.startsWith("/auth/") ||
          pathname.startsWith("/worlds/") ||
          pathname.startsWith("/users/")
        ) return next();

        if (pathname === "/login") {
          req.url = "/login.html" + search;
        } else {
          // / and all /:worldName routes → main app
          req.url = "/main.html" + search;
        }
        next();
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiProxyTarget =
    env.VITE_BACKEND_PROXY_TARGET ||
    env.BACKEND_URL ||
    "https://4thworld.army";

  return {
    base: "/",
    plugins: [htmlRouterPlugin()],
    server: {
      host: true,
      proxy: {
        "/api":    { target: apiProxyTarget, changeOrigin: true, secure: true },
        "/auth":   { target: apiProxyTarget, changeOrigin: true, secure: true },
        "/worlds": { target: apiProxyTarget, changeOrigin: true, secure: true },
        "/users":  { target: apiProxyTarget, changeOrigin: true, secure: true },
      },
    },
    build: {
      rollupOptions: {
        input: {
          login: resolve(__dirname, "login.html"),
          index: resolve(__dirname, "index.html"),
          main:  resolve(__dirname, "main.html"),
        },
      },
    },
  };
});