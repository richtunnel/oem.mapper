/**
 * Rule engine: applicability + condition evaluation for one impact-matrix row.
 *
 * Two rules the whole product depends on:
 *   1. Applicability (vehicleKey + triggerComponent + operation + optional procedure
 *      type) is only the FIRST test. A rule that is applicable is not a procedure
 *      that is required — its conditions must still be satisfied.
 *   2. NOT_TRIGGERED means "this rule's defined trigger conditions were not met".
 *      It is never rendered as "no procedure needed": other applicable rules may
 *      still trigger, and a rule library with a gap proves nothing about the vehicle.
 */
import { RULE_OUTCOME } from "../../shared/constants.js";
import { evaluateConditions } from "./condition-evaluator.js";

/**
 * Facts available to rules for one line.
 *
 * Three sources, in ascending precedence:
 *   vehicle.configurationFacts  what we know about the configuration
 *   derived facts               read straight off the estimate line (auditable)
 *   line.facts                  what the shop explicitly stated
 * Derived facts are re-derivable from the input, which is what keeps the evidence
 * trail honest — they are not model output and not a guess.
 */
export function buildFactContext({ row, line = null, vehicle = null }) {
  const derivedFacts = {
    operation: row.operation,
    position: row.position,
    componentId: row.componentId,
    componentReplaced: ["REPLACE", "REPLACE_GLASS"].includes(row.operation),
    componentRemovedAndInstalled: row.operation === "REMOVE_INSTALL",
    componentAdjustedOrAligned: ["ADJUST", "ALIGNMENT"].includes(row.operation),
    partNumberSupplied: Boolean(row.partNumber),
    sensorAffected: (row.affectedSensors ?? []).length > 0,
    triggerComponentIsSensor: (row.affectedSensors ?? []).some((sensor) => sensor.isTriggerComponentItself),
    affectedSystemCount: (row.affectedSystems ?? []).length,
  };

  const configurationFacts = vehicle?.configurationFacts ?? {};
  const suppliedFacts = line?.facts ?? {};

  return {
    facts: { ...configurationFacts, ...derivedFacts, ...suppliedFacts },
    derivedFacts,
    suppliedFacts,
    configurationFacts,
  };
}

/**
 * Evaluate every applicable rule against one row.
 * @returns {{procedures: object[], facts: object, applicableRuleIds: string[]}}
 */
export function evaluateRulesForRow({ row, line = null, vehicle = null, resolver, procedureType = null }) {
  const { facts, derivedFacts, suppliedFacts, configurationFacts } = buildFactContext({ row, line, vehicle });

  const { applicable, vehicleKeyKnown } = resolver.findApplicableRules({
    vehicleKey: vehicle?.vehicleKey ?? null,
    componentId: row.componentId,
    operation: row.operation,
    procedureType,
  });

  const procedures = applicable.map((rule) => {
    const evaluation = evaluateConditions(rule, facts);
    return {
      procedureId: rule.id,
      procedure: rule.procedure,
      procedureType: rule.procedureType,
      description: rule.description,
      outcome: evaluation.outcome,
      // Plain-English, reproducible reason. `rule.reason` is the OEM-facing text;
      // the notes explain this evaluation and the checks list every fact read.
      reason: rule.reason,
      outcomeNotes: evaluation.notes,
      checks: evaluation.checks,
      triggeredOn: evaluation.triggeredOn,
      missingFields: evaluation.missingFields,
      evidenceRequired: rule.evidenceRequired ?? [],
      source: rule.source,
      ruleStatus: rule.ruleStatus,
      verified: rule.verified === true,
      logic: rule.logic,
      operations: rule.operations,
      evidence: [
        `Estimate line ${row.lineId} ("${row.originalDescription}")`,
        `Canonical component: ${row.componentId} · operation: ${row.operation}`,
        `Match: ${row.matchStatus}${row.matchConfidence ? ` (${row.matchConfidence.level})` : ""}`,
        `Rule ${rule.id} applicability: vehicleKey=${rule.vehicleKey}, triggerComponent=${rule.triggerComponent}, operations=${rule.operations.join("|")}`,
        `Rule logic: ${rule.logic}; conditions evaluated: ${rule.conditions.length}`,
        `Facts supplied by the estimate: ${Object.keys(suppliedFacts).join(", ") || "none"}`,
        `Facts derived from the estimate: ${Object.keys(derivedFacts).join(", ")}`,
      ],
    };
  });

  return {
    procedures,
    applicableRuleIds: applicable.map((rule) => rule.id),
    facts: { effective: facts, derived: derivedFacts, supplied: suppliedFacts, configuration: configurationFacts },
    vehicleKeyKnown,
  };
}

export const NOT_TRIGGERED_MEANING =
  "NOT_TRIGGERED means only that this rule's own trigger conditions were not met. It does not establish that the vehicle needs no procedure: other applicable rules may still apply, and a rule library with gaps cannot prove a negative.";
