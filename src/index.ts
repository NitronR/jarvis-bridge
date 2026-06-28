import express from "express";
import path from "path";

const PORT = Number(process.env.PORT ?? 3001);
const PUBLIC_DIR = path.resolve(__dirname, "..", "public");

const app = express();

app.use(express.static(PUBLIC_DIR));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

const server = app.listen(PORT, () => {
  console.log(`[jarvis-bridge] dev server listening on http://localhost:${PORT}`);
  console.log(`[jarvis-bridge] serving ${PUBLIC_DIR}`);
});

function shutdown(signal: string): void {
  console.log(`\n[jarvis-bridge] ${signal} received, shutting down`);
  server.close((err) => {
    if (err) {
      console.error("[jarvis-bridge] error during shutdown", err);
      process.exit(1);
    }
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));