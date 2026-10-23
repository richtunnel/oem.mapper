import express from "express";
import multer from "multer";
import { buildEstimatesRouter } from "./routes/estimates.routes.js";
import { errorHandler } from "./middleware/error-handler.js";
import { notFoundHandler } from "./controllers/estimates.controller.js";

/**
 * App factory (no listen) so tests can mount it on an ephemeral port.
 *
 * Multer is used only because the spec's route sketch takes a multipart `estimate`
 * file. Files are held in memory with a size cap; no file is ever written to disk
 * and no OCR/PDF parsing runs (unimplemented adapters answer 501).
 */
export function createApp({ jsonLimit = "1mb", uploadLimitBytes = 15 * 1024 * 1024 } = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: jsonLimit }));
  app.use(express.urlencoded({ extended: false }));

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: uploadLimitBytes, files: 1 },
  });

  app.use("/api", buildEstimatesRouter({ upload }));
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
