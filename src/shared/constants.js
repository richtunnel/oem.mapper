/** Operation vocabulary used by estimate lines. */
export const OPERATIONS = Object.freeze({
  REPLACE: "REPLACE",
  REMOVE_INSTALL: "REMOVE_INSTALL",
  REPAIR: "REPAIR",
  REFINISH: "REFINISH",
  REPLACE_GLASS: "REPLACE_GLASS",
  ALIGNMENT: "ALIGNMENT",
  ADJUST: "ADJUST",
  INSPECT: "INSPECT",
  UNKNOWN: "UNKNOWN",
});

export const OPERATION_VALUES = Object.freeze(Object.values(OPERATIONS));

/** Match statuses produced by the parts matcher. Never "best guess". */
export const MATCH_STATUS = Object.freeze({
  MATCHED: "MATCHED",
  AMBIGUOUS: "AMBIGUOUS",
  UNMATCHED: "UNMATCHED",
});

/** Procedure types. A rule must declare one; they are not interchangeable. */
export const PROCEDURE_TYPES = Object.freeze({
  STATIC_CALIBRATION: "STATIC_CALIBRATION",
  DYNAMIC_CALIBRATION: "DYNAMIC_CALIBRATION",
  INITIALIZATION: "INITIALIZATION",
  AIMING: "AIMING",
  INSPECTION: "INSPECTION",
  DIAGNOSTIC_SCAN: "DIAGNOSTIC_SCAN",
});

export const PROCEDURE_TYPE_VALUES = Object.freeze(Object.values(PROCEDURE_TYPES));

/** Three-valued condition evaluation. UNKNOWN is a first-class outcome. */
export const CHECK = Object.freeze({
  TRUE: "TRUE",
  FALSE: "FALSE",
  UNKNOWN: "UNKNOWN",
});

/** Outcome of evaluating one rule against one impact-matrix row. */
export const RULE_OUTCOME = Object.freeze({
  TRIGGERED: "TRIGGERED",
  NOT_TRIGGERED: "NOT_TRIGGERED",
  INSUFFICIENT_DATA: "INSUFFICIENT_DATA",
  NOT_APPLICABLE: "NOT_APPLICABLE",
});

/** Final per-line decision categories surfaced to the technician. */
export const DECISION = Object.freeze({
  PROCEDURE_INDICATED: "PROCEDURE_INDICATED",
  CONDITIONAL: "CONDITIONAL",
  INSPECTION_REQUIRED: "INSPECTION_REQUIRED",
  NOT_INDICATED_UNDER_RULES: "NOT_INDICATED_UNDER_RULES",
  UNRESOLVED: "UNRESOLVED",
});

export const DECISION_VALUES = Object.freeze(Object.values(DECISION));

/** Rule verification states. Nothing ships as VERIFIED in this MVP. */
export const RULE_STATUS = Object.freeze({
  VERIFIED: "VERIFIED",
  UNVERIFIED: "UNVERIFIED",
  ILLUSTRATIVE: "ILLUSTRATIVE",
});
