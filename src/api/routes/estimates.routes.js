import { Router } from "express";
import {
  analyzeEstimateHandler,
  datasetProvenanceHandler,
  healthHandler,
  listAdaptersHandler,
} from "../controllers/estimates.controller.js";

/**
 * One orchestration route (SPEC §6), plus three read-only introspection routes that
 * make the system's honesty inspectable: what adapters exist, and where the data
 * came from (every dataset reports itself as illustrative/unverified).
 */
export function buildEstimatesRouter({ upload }) {
  const router = Router();

  router.post("/estimates/analyze", upload.single("estimate"), asyncHandler(analyzeEstimateHandler));
  router.get("/adapters", listAdaptersHandler);
  router.get("/datasets", datasetProvenanceHandler);
  router.get("/health", healthHandler);

  return router;
}

/**
 * Express 4 does not await a handler's promise: a rejection from an `async` handler
 * becomes an unhandled rejection and takes the whole process down with it (the client
 * then sees a dropped connection instead of an answer). Forwarding the rejection to
 * `next` routes it into the typed error handler, so a bad request is a status code,
 * never a crash.
 */
function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}
