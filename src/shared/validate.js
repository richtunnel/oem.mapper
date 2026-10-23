import { ValidationError } from "./errors.js";

/** Collects issues so one call can report every problem at once, not just the first. */
export class IssueCollector {
  constructor() {
    this.errors = [];
    this.warnings = [];
  }

  error(path, message, value) {
    this.errors.push({ path, message, received: describe(value) });
  }

  warn(path, message, value) {
    this.warnings.push({ path, message, received: describe(value) });
  }

  get ok() {
    return this.errors.length === 0;
  }

  throwIfInvalid(context) {
    if (!this.ok) {
      throw new ValidationError(
        `${context} failed validation: ${summarizeIssues(this.errors)}`,
        { errors: this.errors, warnings: this.warnings },
      );
    }
  }
}

/**
 * One-line summary of the collected problems, for the thrown message.
 *
 * The message must NAME the problems: a bare "1 problem(s)" hides the actual
 * defect from whoever is holding the estimate, which contradicts this project's
 * rule that missing or invalid evidence stays visible rather than being
 * summarised away. The full list always remains on `error.details.errors`.
 *
 * Bounded to `max` problems so a payload with dozens of defects still produces a
 * readable message instead of a wall of text; the overflow is counted, and the
 * HTTP layer surfaces every problem from `details.errors`, not from this string.
 */
export function summarizeIssues(errors, max = 3) {
  const shown = errors.slice(0, max).map((issue) => `${issue.path}: ${issue.message}`);
  const remaining = errors.length - shown.length;
  return remaining > 0
    ? `${shown.join(" ")} (+${remaining} more problem(s); see details.errors for the full list)`
    : shown.join(" ");
}

export function describe(value) {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "object") return Array.isArray(value) ? "array" : "object";
  return String(value);
}

/**
 * True only for a plain data object (`{...}` / `JSON.parse` output).
 *
 * Deliberately NOT true for arrays, Buffers, typed arrays, Dates or class
 * instances: a Buffer has numeric own keys, so a loose `typeof === "object"` test
 * makes an uploaded file look like an estimate object and it gets validated
 * key-by-key (one bogus warning per byte). Adapters must be able to recognise a
 * file/string upload and parse it as text instead.
 */
export function isPlainObject(value) {
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function toTrimmedOrNull(value) {
  return isNonEmptyString(value) ? value.trim() : null;
}
