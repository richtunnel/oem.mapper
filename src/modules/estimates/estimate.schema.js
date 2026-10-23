/**
 * Validation for the structured JSON estimate format (SPEC §2) — the one source
 * format this MVP ingests.
 *
 * Deviations from the spec's sample data, both deliberate:
 *   - `lines[].operation` is REQUIRED. The spec's own §2 snippet omits it on L1,
 *     but the rules engine keys applicability on the operation, so a line with no
 *     operation cannot be evaluated. Guessing it would be exactly the silent
 *     guess this product must not make.
 *   - `lines[].position` is optional: a missing position lowers confidence and is
 *     reported as a warning, but does not block analysis (many estimate exports
 *     omit it, and it is not part of rule applicability in this MVP).
 *
 * Top-level keys beginning with "_" are treated as fixture/documentation metadata
 * and ignored, so fixtures can carry notes without corrupting the payload.
 */
import { OPERATION_VALUES } from "../../shared/constants.js";
import { IssueCollector, isPlainObject, isNonEmptyString, toTrimmedOrNull } from "../../shared/validate.js";
import { normalizeOperation } from "../../shared/text.js";

export const ESTIMATE_FORMAT = "STRUCTURED_JSON_V1";

export function validateEstimate(raw) {
  const issues = new IssueCollector();

  if (!isPlainObject(raw)) {
    issues.error("$", "estimate must be an object.", raw);
    issues.throwIfInvalid("Estimate payload");
  }

  const estimateId = toTrimmedOrNull(raw.estimateId);
  if (!estimateId) issues.error("estimateId", "estimateId is required and must be a non-empty string.", raw.estimateId);

  const vehicle = normalizeVehicle(raw.vehicle, issues);

  const lines = normalizeLines(raw.lines, issues);

  for (const key of Object.keys(raw)) {
    if (!key.startsWith("_") && !["estimateId", "vehicle", "lines"].includes(key)) {
      issues.warn(key, "Unknown estimate field ignored by the JSON adapter.", raw[key]);
    }
  }

  issues.throwIfInvalid("Estimate payload");

  return {
    format: ESTIMATE_FORMAT,
    estimate: { estimateId, vehicle, lines },
    warnings: issues.warnings,
  };
}

function normalizeVehicle(rawVehicle, issues) {
  if (!isPlainObject(rawVehicle)) {
    issues.error("vehicle", "vehicle is required and must be an object.", rawVehicle);
    return null;
  }

  const year = rawVehicle.year === undefined || rawVehicle.year === null ? null : Number(rawVehicle.year);
  if (year !== null && (!Number.isInteger(year) || year < 1900 || year > 2100)) {
    issues.error("vehicle.year", "vehicle.year must be an integer between 1900 and 2100.", rawVehicle.year);
  }

  const vehicle = {
    vin: toTrimmedOrNull(rawVehicle.vin),
    year: year !== null && Number.isInteger(year) ? year : null,
    make: toTrimmedOrNull(rawVehicle.make),
    model: toTrimmedOrNull(rawVehicle.model),
    trim: toTrimmedOrNull(rawVehicle.trim),
    vehicleKey: toTrimmedOrNull(rawVehicle.vehicleKey),
    configurationFacts: isPlainObject(rawVehicle.configurationFacts) ? { ...rawVehicle.configurationFacts } : {},
  };

  for (const field of ["make", "model", "year"]) {
    if (vehicle[field] === null && !vehicle.vehicleKey) {
      issues.warn(`vehicle.${field}`, `vehicle.${field} is missing; a vehicleKey cannot be derived without it.`, null);
    }
  }

  if (vehicle.vin && !/^[A-HJ-NPR-Z0-9]{17}$/i.test(vehicle.vin)) {
    issues.warn("vehicle.vin", "vehicle.vin is not a 17-character VIN (placeholders such as REPLACE_WITH_VALID_VIN are expected in this MVP).", vehicle.vin);
  }

  return vehicle;
}

function normalizeLines(rawLines, issues) {
  if (!Array.isArray(rawLines) || rawLines.length === 0) {
    issues.error("lines", "lines must be a non-empty array.", rawLines);
    return [];
  }

  const seen = new Set();
  const lines = [];

  rawLines.forEach((rawLine, index) => {
    const path = `lines[${index}]`;
    if (!isPlainObject(rawLine)) {
      issues.error(path, "each line must be an object.", rawLine);
      return;
    }

    const lineId = toTrimmedOrNull(rawLine.lineId);
    if (!lineId) issues.error(`${path}.lineId`, "lineId is required and must be a non-empty string.", rawLine.lineId);
    else if (seen.has(lineId)) issues.error(`${path}.lineId`, `duplicate lineId "${lineId}".`, rawLine.lineId);
    else seen.add(lineId);

    const description = toTrimmedOrNull(rawLine.description);
    if (!description) {
      issues.error(`${path}.description`, "description is required and must be a non-empty string.", rawLine.description);
    }

    const operation = normalizeOperation(rawLine.operation);
    if (!rawLine.operation) {
      issues.error(`${path}.operation`, `operation is required. Allowed values: ${OPERATION_VALUES.join(", ")}.`, rawLine.operation);
    } else if (!operation) {
      issues.error(`${path}.operation`, `unrecognized operation. Allowed values: ${OPERATION_VALUES.join(", ")}.`, rawLine.operation);
    }

    let position = toTrimmedOrNull(rawLine.position);
    if (!position) {
      position = "UNSPECIFIED";
      issues.warn(`${path}.position`, "position missing; defaulted to UNSPECIFIED (match confidence is capped at MEDIUM).", rawLine.position);
    }

    lines.push({
      lineId,
      description,
      operation,
      position: position.toUpperCase(),
      partNumber: toTrimmedOrNull(rawLine.partNumber),
      // Shop-supplied facts. Free-form by design: the condition evaluator reads
      // whatever a rule asks for and reports UNKNOWN when a fact is absent.
      facts: isPlainObject(rawLine.facts) ? { ...rawLine.facts } : {},
    });
  });

  return lines;
}
