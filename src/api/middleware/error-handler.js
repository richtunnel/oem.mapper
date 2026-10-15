import { AppError } from "../../shared/errors.js";

/** Maps typed errors to status codes; anything unknown is a 500 with a safe message. */
export function errorHandler(error, _req, res, _next) {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
    });
    return;
  }

  if (error?.code === "LIMIT_FILE_SIZE") {
    res.status(413).json({ error: { code: "FILE_TOO_LARGE", message: "Uploaded estimate exceeds the 15 MB limit." } });
    return;
  }

  if (error?.type === "entity.parse.failed") {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Request body is not valid JSON." } });
    return;
  }

  console.error("Unhandled analysis failure:", error);
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Unable to analyze the estimate." } });
}
