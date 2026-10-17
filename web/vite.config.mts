import babel from "@rolldown/plugin-babel";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { resolve } from "path";
import { defineConfig, type Plugin } from "vite";
import tailwindcss from "@tailwindcss/vite";

let devProxyServer = "http://localhost:8081";
if (process.env.DEV_PROXY_SERVER && process.env.DEV_PROXY_SERVER.length > 0) {
  console.log("Use devProxyServer from environment: ", process.env.DEV_PROXY_SERVER);
  devProxyServer = process.env.DEV_PROXY_SERVER;
}

// `pnpm dev:mobile`: every page navigation serves the mobile entry, mirroring the
// nginx rewrite on toucan-app.huzhi.dev. API and asset requests are untouched.
const mobileDevFallback = (): Plugin => ({
  name: "mobile-dev-fallback",
  apply: "serve",
  configureServer(server) {
    if (process.env.MOBILE_DEV !== "1") return;
    server.middlewares.use((req, _res, next) => {
      const accept = req.headers.accept ?? "";
      const path = (req.url ?? "/").split("?")[0];
      if (req.method === "GET" && accept.includes("text/html") && !path.includes(".")) {
        req.url = "/mobile.html";
      }
      next();
    });
  },
});

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), babel({ presets: [reactCompilerPreset()] }), tailwindcss(), mobileDevFallback()],
  server: {
    host: "0.0.0.0",
    port: 3001,
    proxy: {
      "^/api/v1/sse": {
        target: devProxyServer,
        xfwd: true,
        // SSE requires no response buffering and longer timeout.
        timeout: 0,
      },
      "^/api": {
        target: devProxyServer,
        xfwd: true,
      },
      "^/memos.api.v1": {
        target: devProxyServer,
        xfwd: true,
      },
      "^/file": {
        target: devProxyServer,
        xfwd: true,
      },
    },
  },
  resolve: {
    alias: {
      "@/": `${resolve(__dirname, "src")}/`,
    },
  },
  build: {
    rolldownOptions: {
      // The web app and the mobile reader (served on its own host) ship from one build.
      input: {
        main: resolve(__dirname, "index.html"),
        mobile: resolve(__dirname, "mobile.html"),
      },
      output: {
        codeSplitting: {
          groups: [
            {
              name: "utils-vendor",
              test: /node_modules[\\/](dayjs|lodash-es)([\\/]|$)/,
            },
            {
              name: "leaflet-vendor",
              test: /node_modules[\\/]leaflet([\\/]|$)/,
            },
          ],
        },
      },
    },
  },
});
