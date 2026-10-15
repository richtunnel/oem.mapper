import { ValidationError } from "../../../shared/errors.js";
import { isPlainObject } from "../../../shared/validate.js";
import { validateEstimate } from "../estimate.schema.js";
import { SourceAdapterBase } from "./source-adapter.js";

/**
 * The one working adapter in this MVP: the structured JSON estimate format (SPEC §2).
 *
 * Accepts either a parsed object (JSON request body) or a string/file buffer
 * containing JSON (multipart upload, .json file). No heuristics, no repair of
 * malformed input — validation problems are reported, never guessed around.
 */
export class JsonEstimateAdapter extends SourceAdapterBase {
  constructor() {
    super({
      id: "structured-json",
      name: "Structured JSON estimate (SPEC §2)",
      contentTypes: ["application/json", "text/json", "text/plain"],
      extensions: [".json"],
      implemented: true,
    });
  }

  canHandle(input) {
    if (isPlainObject(input)) return true;
    const text = toText(input);
    if (!text) return false;
    const trimmed = text.trim();
    return trimmed.startsWith("{") || trimmed.startsWith("[");
  }

  parse(input) {
    const raw = isPlainObject(input) ? input : parseJsonText(input);
    return validateEstimate(raw);
  }
}

export function toText(input) {
  if (typeof input === "string") return input;
  if (Buffer.isBuffer(input)) return input.toString("utf8");
  return null;
}

function parseJsonText(input) {
  const text = toText(input);
  if (text === null) {
    throw new ValidationError("Expected a JSON object or a JSON string for the structured JSON adapter.", {
      received: typeof input,
    });
  }
  try {
    const parsed = JSON.parse(text);
    if (!isPlainObject(parsed)) {
      throw new ValidationError("Structured JSON estimate must be a JSON object.", { received: Array.isArray(parsed) ? "array" : typeof parsed });
    }
    return parsed;
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError("Uploaded file is not valid JSON.", { parseError: error.message });
  }
}
