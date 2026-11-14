import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// En développement, /v1 et /health vont à l'API locale (en production : relais de serve.mjs).
const API = process.env.FIRMO_API_INTERNAL_URL ?? "http://localhost:8790";

export default defineConfig({
  plugins: [tailwindcss(), tanstackStart(), react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: { proxy: { "/v1": API, "/health": API } },
});
