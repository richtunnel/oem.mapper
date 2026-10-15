/**
 * Typed error hierarchy. Every error carries a stable `code` so the HTTP layer
 * can map it to a status code without string matching on messages.
 */
export class AppError extends Error {
  constructor(message, { code = "APP_ERROR", statusCode = 500, details = null } = {}) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    Error.captureStackTrace?.(this, new.target);
  }
}

/** Input failed schema validation (shape, missing required fields, bad enums). */
export class ValidationError extends AppError {
  constructor(message, details = null) {
    super(message, { code: "VALIDATION_ERROR", statusCode: 400, details });
  }
}

/**
 * A source format was recognised but is deliberately not implemented in this MVP.
 * We never silently degrade to an LLM guess or a half-parser: we fail loudly.
 */
export class NotImplementedError extends AppError {
  constructor(formatName, hint = null) {
    super(
      `Source adapter for "${formatName}" is not implemented in this MVP.`,
      {
        code: "NOT_IMPLEMENTED",
        statusCode: 501,
        details: {
          format: formatName,
          hint:
            hint ??
            "This MVP ships one working adapter: the structured JSON estimate format (see docs/ARCHITECTURE.md). PDF/OCR/CSV extraction is a separate follow-up.",
        },
      },
    );
  }
}

/** Estimate is well-formed but cannot be analysed (e.g. unusable vehicle key). */
export class UnprocessableEstimateError extends AppError {
  constructor(message, details = null) {
    super(message, { code: "UNPROCESSABLE_ESTIMATE", statusCode: 422, details });
  }
}
