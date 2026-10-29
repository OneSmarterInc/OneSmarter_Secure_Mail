import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { existsSync, readFileSync } from "node:fs";
import { Agent } from "node:https";
import { resolve } from "node:path";

const custody = resolve(import.meta.dirname, "../.runtime/maintenance");
const makeMaintenanceAgent = () =>
  existsSync(resolve(custody, "gateway.key"))
    ? new Agent({
        ca: readFileSync(resolve(custody, "ca.pem")),
        cert: readFileSync(resolve(custody, "gateway.pem")),
        key: readFileSync(resolve(custody, "gateway.key")),
        minVersion: "TLSv1.3",
        maxVersion: "TLSv1.3",
        ecdhCurve: "X25519MLKEM768",
        maxCachedSessions: 0,
      })
    : undefined;

export default defineConfig(({ command }) => {
  const maintenanceAgent =
    command === "serve" ? makeMaintenanceAgent() : undefined;
  return {
    plugins: [
      react(),
      {
        name: "maintenance-route",
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            if (req.url === "/maintenance") {
              res.writeHead(302, { Location: "/maintenance/" });
              res.end();
              return;
            }
            if (req.url?.startsWith("/maintenance/")) {
              const allowed = new Set([
                "/",
                "/portal.js",
                "/portal.css",
                "/login",
                "/v1/custody-status",
                "/v1/unseal",
                "/v1/seal",
                "/v1/rotate-root",
                "/v1/logout",
              ]);
              if (
                !maintenanceAgent ||
                !allowed.has(req.url.slice("/maintenance".length))
              ) {
                res.writeHead(maintenanceAgent ? 404 : 503, {
                  "Content-Type": "text/plain",
                });
                res.end(
                  "Maintenance is unavailable or the route is not allowed.",
                );
                return;
              }
            }
            next();
          });
        },
      },
    ],
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
      proxy: {
        "/maintenance/": {
          target: "https://localhost:8443",
          agent: maintenanceAgent,
          changeOrigin: false,
          secure: true,
          rewrite: (path) => path.slice("/maintenance".length),
          cookiePathRewrite: "/maintenance/",
          proxyTimeout: 15000,
        },
        "/recipient-api": {
          target: process.env.API_TARGET || "http://127.0.0.1:8000",
          changeOrigin: false,
          configure(proxy) {
            proxy.on("proxyReq", (proxyReq, req) => {
              proxyReq.setHeader("X-Real-IP", req.socket.remoteAddress || "");
              proxyReq.removeHeader("X-Forwarded-For");
              proxyReq.removeHeader("Forwarded");
            });
          },
        },
        "/api": {
          target: process.env.API_TARGET || "http://127.0.0.1:8000",
          changeOrigin: false,
          configure(proxy) {
            proxy.on("proxyReq", (proxyReq, req) => {
              proxyReq.setHeader("X-Real-IP", req.socket.remoteAddress || "");
              proxyReq.removeHeader("X-Forwarded-For");
              proxyReq.removeHeader("Forwarded");
            });
          },
        },
      },
    },
  };
});
