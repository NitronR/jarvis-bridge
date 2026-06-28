import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: { outDir: "../public", emptyOutDir: true, sourcemap: true },
  server: {
    port: 5173,
    proxy: {
      "/chat": "http://localhost:3001",
      "/health": "http://localhost:3001",
      "/status": "http://localhost:3001",
      "/workspace": "http://localhost:3001",
      "/skills": "http://localhost:3001",
      "/slack": "http://localhost:3001",
      "/analytics": "http://localhost:3001",
      "/tools": "http://localhost:3001",
    },
  },
  test: { environment: "jsdom", globals: true, setupFiles: ["./src/test-setup.ts"] },
});