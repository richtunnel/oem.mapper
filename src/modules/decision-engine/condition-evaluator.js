/**
 * Condition evaluator — three-valued logic, per condition (SPEC §5 + production refinements).
 *
 * The spec's sketch returned INSUFFICIENT_DATA whenever ANY condition was unknown,
 * even if another condition had already made the outcome certain. That is wrong in
 * both directions and is the flaw the spec itself flags:
 *
 *   - logic ANY: if a known condition is already TRUE, the rule IS triggered.
 *     Unknown siblings cannot un-trigger it → TRIGGERED (with the unknowns recorded).
 *   - logic ALL: one known FALSE settles it → NOT_TRIGGERED regardless of unknowns.
 *   - Otherwise the known facts cannot establish the outcome → INSUFFICIENT_DATA,
 *     naming the exact missing fields.
 *
 * null and undefined are both UNKNOWN but are reported differently in the evidence
 * trail ("not supplied" vs "explicitly null"), because an integrator needs to know
 * the difference. `false` is a real, known fact and is evaluated normally.
 */
import { CHECK, RULE_OUTCOME } from "../../shared/constants.js";

export const OPERATORS = Object.freeze(["equals", "not_equals", "in", "not_in", "includes", "greater_than", "less_than", "is_present"]);

export function evaluateCondition(condition, context = {}) {
  const { field, operator, value, label = null } = condition ?? {};
  const present = Object.prototype.hasOwnProperty.call(context, field);
  const actual = present ? context[field] : undefined;

  const base = {
    field,
    label,
    operator,
    expected: value === undefined ? null : value,
    actual: actual === undefined ? null : actual,
    present,
  };

  if (typeof field !== "string" || !field) {
    return { ...base, check: CHECK.UNKNOWN, note: "Condition is malformed: it has no field name." };
  }

  // `is_present` is answerable even when the field is absent, so it is handled first.
  if (operator === "is_present") {
    const isPresent = present && actual !== null && actual !== undefined;
    return { ...base, check: isPresent ? CHECK.TRUE : CHECK.FALSE };
  }

  // The three unevaluated states are reported BEFORE the operator is judged, because
  // the reason must name what is actually missing. With no fact supplied, "Fact not
  // supplied" is the true diagnostic; "Unsupported operator" would name the wrong
  // problem and hide the fact that the estimate never provided the evidence
  // (hard constraint #3: missing evidence stays visible).
  if (!present) {
    return { ...base, check: CHECK.UNKNOWN, note: "Fact not supplied for this repair line." };
  }
  if (actual === null) {
    return { ...base, check: CHECK.UNKNOWN, note: "Fact was supplied as null (explicitly unknown)." };
  }
  if (actual === undefined) {
    return { ...base, check: CHECK.UNKNOWN, note: "Fact is present but undefined." };
  }

  // A usable fact with an unusable operator is a defect in the RULE, and is still
  // surfaced as UNKNOWN (never a silent pass or fail).
  if (!OPERATORS.includes(operator)) {
    return { ...base, check: CHECK.UNKNOWN, note: `Unsupported operator "${operator}".` };
  }

  switch (operator) {
    case "equals":
      // Strict comparison: type coercion here would make "false" equal false.
      if (typeof actual !== typeof value && !(Array.isArray(value) && Array.isArray(actual))) {
        return { ...base, check: CHECK.FALSE, note: `Fact type (${typeof actual}) differs from the rule's expected type (${typeof value}).` };
      }
      return { ...base, check: actual === value ? CHECK.TRUE : CHECK.FALSE };
    case "not_equals":
      if (typeof actual !== typeof value) {
        return { ...base, check: CHECK.FALSE, note: `Fact type (${typeof actual}) differs from the rule's expected type (${typeof value}).` };
      }
      return { ...base, check: actual !== value ? CHECK.TRUE : CHECK.FALSE };
    case "in":
      if (!Array.isArray(value)) return { ...base, check: CHECK.UNKNOWN, note: "`in` requires an array value in the rule." };
      return { ...base, check: value.includes(actual) ? CHECK.TRUE : CHECK.FALSE };
    case "not_in":
      if (!Array.isArray(value)) return { ...base, check: CHECK.UNKNOWN, note: "`not_in` requires an array value in the rule." };
      return { ...base, check: value.includes(actual) ? CHECK.FALSE : CHECK.TRUE };
    case "includes":
      if (!Array.isArray(actual)) return { ...base, check: CHECK.UNKNOWN, note: "`includes` requires the fact to be an array." };
      return { ...base, check: actual.includes(value) ? CHECK.TRUE : CHECK.FALSE };
    case "greater_than":
      return typeof actual === "number" ? { ...base, check: actual > value ? CHECK.TRUE : CHECK.FALSE } : { ...base, check: CHECK.UNKNOWN, note: "`greater_than` requires a numeric fact." };
    case "less_than":
      return typeof actual === "number" ? { ...base, check: actual < value ? CHECK.TRUE : CHECK.FALSE } : { ...base, check: CHECK.UNKNOWN, note: "`less_than` requires a numeric fact." };
    default:
      return { ...base, check: CHECK.UNKNOWN, note: `Unsupported operator "${operator}".` };
  }
}

/**
 * Evaluate a rule's condition list.
 * @returns {{outcome: string, checks: object[], missingFields: string[], triggeredOn: object[], notes: string[]}}
 */
export function evaluateConditions(rule, context = {}) {
  const logic = (rule?.logic ?? "ANY").toUpperCase();
  const conditions = rule?.conditions ?? [];

  if (!["ANY", "ALL"].includes(logic)) {
    return {
      outcome: RULE_OUTCOME.INSUFFICIENT_DATA,
      checks: [],
      missingFields: [],
      triggeredOn: [],
      notes: [`Rule declares unsupported logic "${rule?.logic}".`],
    };
  }

  // No conditions: the rule's applicability alone is its trigger. Record it plainly
  // so the report shows that the rule was triggered by applicability, not by a check.
  if (conditions.length === 0) {
    return {
      outcome: RULE_OUTCOME.TRIGGERED,
      checks: [],
      missingFields: [],
      triggeredOn: [],
      notes: ["This rule defines no additional conditions: its trigger is the applicability match (vehicle configuration, component and operation) alone."],
    };
  }

  const checks = conditions.map((condition) => evaluateCondition(condition, context));
  const missing = checks.filter((check) => check.check === CHECK.UNKNOWN);
  const missingFields = missing.map((check) => check.field);
  const trueChecks = checks.filter((check) => check.check === CHECK.TRUE);
  const falseChecks = checks.filter((check) => check.check === CHECK.FALSE);
  const notes = [];

  if (logic === "ANY") {
    if (trueChecks.length > 0) {
      if (missing.length > 0) {
        notes.push(`Triggered by known fact(s): ${trueChecks.map((c) => c.field).join(", ")}. ${missing.length} further condition(s) could not be evaluated (${missingFields.join(", ")}); they cannot un-trigger this rule, but the fact(s) remain unidentified.`);
      }
      return { outcome: RULE_OUTCOME.TRIGGERED, checks, missingFields, triggeredOn: trueChecks, notes };
    }
    if (missing.length > 0) {
      notes.push(`No condition evaluated TRUE, and ${missing.length} condition(s) could not be evaluated: ${missingFields.join(", ")}. The known facts cannot establish the outcome.`);
      return { outcome: RULE_OUTCOME.INSUFFICIENT_DATA, checks, missingFields, triggeredOn: [], notes };
    }
    notes.push("Every condition evaluated FALSE; this rule's trigger conditions are not met.");
    return { outcome: RULE_OUTCOME.NOT_TRIGGERED, checks, missingFields, triggeredOn: [], notes };
  }

  // logic === "ALL"
  if (falseChecks.length > 0) {
    if (missing.length > 0) {
      notes.push(`One FALSE condition (${falseChecks.map((c) => c.field).join(", ")}) settles this rule regardless of ${missing.length} unevaluated condition(s) (${missingFields.join(", ")}).`);
    }
    return { outcome: RULE_OUTCOME.NOT_TRIGGERED, checks, missingFields, triggeredOn: [], notes };
  }
  if (missing.length > 0) {
    notes.push(`All known condition(s) are TRUE, but ${missing.length} condition(s) could not be evaluated: ${missingFields.join(", ")}. Every condition must hold, so the outcome cannot be established.`);
    return { outcome: RULE_OUTCOME.INSUFFICIENT_DATA, checks, missingFields, triggeredOn: [], notes };
  }
  return { outcome: RULE_OUTCOME.TRIGGERED, checks, missingFields, triggeredOn: trueChecks, notes };
}

/** Facts are only "known" to the engine when they are not null/undefined. */
export function knownFacts(context = {}) {
  return Object.entries(context)
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([field, value]) => ({ field, value }));
}
