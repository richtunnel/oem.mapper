import { createApp } from "./app.js";

/**
 * HTTP entry point. Port 3100 per the project brief: port 3000 belongs to the team
 * website and must never be bound by this service.
 */
const PORT = Number(process.env.PORT ?? 3100);
// 0.0.0.0 so the process is reachable regardless of how it is launched; set
// HOST=127.0.0.1 when running only locally.
const HOST = process.env.HOST ?? "0.0.0.0";

const app = createApp();

const server = app.listen(PORT, HOST, () => {
  console.log(`Recalibra estimate analysis API listening on http://${HOST}:${PORT}`);
  console.log("All seeded OEM procedures are ILLUSTRATIVE/UNVERIFIED — see docs/OEM-DATA.md");
  console.log("POST /api/estimates/analyze   GET /api/adapters   GET /api/datasets   GET /api/health");
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
