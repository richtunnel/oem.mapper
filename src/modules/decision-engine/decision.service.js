/**
 * Decision service — turns the impact matrix into per-line decisions with evidence.
 *
 * The matrix is candidate generation; this is where an actual statement is made,
 * and every statement is attributed to a rule, a procedure type and a source.
 *
 * Category precedence (implemented in `combineCategory`) is deliberately explicit,
 * because "which category wins when a line has both a triggered rule and a rule
 * waiting on facts" is a product decision, not an accident:
 *   1. PROCEDURE_INDICATED            a triggered rule that is not an inspection
 *   2. INSPECTION_REQUIRED            only triggered rules are inspections
 *   3. CONDITIONAL                    nothing triggered, but a rule is pending facts
 *   4. NOT_INDICATED_UNDER_RULES      rules applied, none triggered, nothing pending
 * Pending facts are ALWAYS attached to the line (see `pendingFacts`), so category (1)
 * or (2) never hides an unevaluated condition.
 */
import { DECISION, MATCH_STATUS, RULE_OUTCOME } from "../../shared/constants.js";
import { evaluateReviewPolicy } from "./review-policy.js";
import { NOT_TRIGGERED_MEANING, evaluateRulesForRow } from "./rule-engine.js";

export const NOT_INDICATED_IS_NOT_PROOF =
  "NOT_INDICATED_UNDER_RULES is not a statement that the vehicle needs no calibration. It means no rule in the current (illustrative, unverified) library triggered for this line. Manual verification against OEM service information is still required.";

export function evaluateEstimate({ impactMatrix = [], lines = [], vehicle, resolver, procedureType = null }) {
  const linesById = new Map(lines.map((line) => [line.lineId, line]));
  const coverageGaps = [];

  const decisions = impactMatrix.map((row) => {
    if (row.matchStatus !== MATCH_STATUS.MATCHED) {
      return {
        lineId: row.lineId,
        originalDescription: row.originalDescription,
        operation: row.operation,
        componentId: null,
        category: DECISION.UNRESOLVED,
        headline:
          row.matchStatus === MATCH_STATUS.AMBIGUOUS
            ? `Unresolved: "${row.originalDescription}" matches several catalog components equally well, so no procedure can be evaluated.`
            : `Unresolved: "${row.originalDescription}" is not in the component catalog, so the affected components and sensors are unknown.`,
        detail: row.matchReason ?? row.reason,
        procedures: [],
        pendingFacts: [],
        facts: null,
        candidates: row.candidates ?? [],
        reviewNotes: [
          "An unmatched or ambiguous line must stay visible. It is not evidence that the repair needs nothing — it is evidence that we do not know.",
        ],
      };
    }

    const { procedures, facts, applicableRuleIds } = evaluateRulesForRow({
      row,
      line: linesById.get(row.lineId) ?? null,
      vehicle,
      resolver,
      procedureType,
    });

    if (applicableRuleIds.length === 0) {
      const vehicleKeyKnown = resolver.vehicleKeyInCatalog(vehicle?.vehicleKey ?? null);
      coverageGaps.push({
        lineId: row.lineId,
        componentId: row.componentId,
        operation: row.operation,
        vehicleKey: vehicle?.vehicleKey ?? null,
        kind: vehicleKeyKnown ? "NO_RULE_FOR_COMPONENT_OPERATION" : "NO_RULES_FOR_VEHICLE_KEY",
        detail: vehicleKeyKnown
          ? `No rule in the library covers component "${row.componentId}" with operation "${row.operation}" for ${vehicle?.vehicleKey}. This is a gap in our rule library, not a finding about the vehicle.`
          : `The rule library contains no rules at all for vehicle key ${vehicle?.vehicleKey}. Every line for this vehicle is a coverage gap.`,
      });
    }

    const category = combineCategory(procedures);
    const pendingFacts = collectPendingFacts(procedures);

    return {
      lineId: row.lineId,
      originalDescription: row.originalDescription,
      operation: row.operation,
      position: row.position,
      componentId: row.componentId,
      componentDisplayName: row.component?.displayName ?? row.componentId,
      category,
      headline: headlineFor(category, row, procedures),
      detail: detailFor(category, procedures),
      procedures: procedures.map(toProcedureView),
      pendingFacts,
      facts,
      applicableRuleIds,
      reviewNotes: reviewNotesFor(category),
    };
  });

  const review = evaluateReviewPolicy({ decisions, coverageGaps });

  return { decisions, coverageGaps, review };
}

export function combineCategory(procedures = []) {
  const triggered = procedures.filter((procedure) => procedure.outcome === RULE_OUTCOME.TRIGGERED);
  const nonInspectionTriggered = triggered.filter((procedure) => procedure.procedureType !== "INSPECTION");

  if (nonInspectionTriggered.length > 0) return DECISION.PROCEDURE_INDICATED;
  if (triggered.length > 0) return DECISION.INSPECTION_REQUIRED;
  if (procedures.some((procedure) => procedure.outcome === RULE_OUTCOME.INSUFFICIENT_DATA)) return DECISION.CONDITIONAL;
  return DECISION.NOT_INDICATED_UNDER_RULES;
}

function collectPendingFacts(procedures) {
  const pending = new Map();
  for (const procedure of procedures) {
    if (procedure.outcome !== RULE_OUTCOME.INSUFFICIENT_DATA) continue;
    for (const field of procedure.missingFields) {
      if (!pending.has(field)) {
        pending.set(field, { field, ruleIds: [], reasons: [] });
      }
      const entry = pending.get(field);
      entry.ruleIds.push(procedure.procedureId);
      entry.reasons.push(...procedure.outcomeNotes);
    }
  }
  return [...pending.values()].map((entry) => ({ ...entry, reasons: [...new Set(entry.reasons)] }));
}

function headlineFor(category, row, procedures) {
  const triggered = procedures.filter((procedure) => procedure.outcome === RULE_OUTCOME.TRIGGERED);
  const label = row.component?.displayName ?? row.originalDescription;

  switch (category) {
    case DECISION.PROCEDURE_INDICATED:
      return `${label}: ${triggered.map((p) => `${p.procedure} (${p.procedureType})`).join("; ")} indicated by ${triggered.length} triggered rule(s) — source unverified, verify the OEM procedure before performing it.`;
    case DECISION.INSPECTION_REQUIRED:
      return `${label}: inspection indicated — ${triggered.map((p) => p.procedure).join("; ")}. Resolve any pending facts listed for this line before deciding whether calibration follows.`;
    case DECISION.CONDITIONAL:
      return `${label}: conditional — a rule applies to this component and operation, but the facts needed to evaluate it are missing.`;
    case DECISION.NOT_INDICATED_UNDER_RULES:
      return `${label}: no rule triggered for this component and operation under the current rule library. This is not proof that no procedure is required.`;
    default:
      return `${label}: unresolved.`;
  }
}

function detailFor(category, procedures) {
  const parts = [];
  if (category === DECISION.NOT_INDICATED_UNDER_RULES) parts.push(NOT_INDICATED_IS_NOT_PROOF);
  if (procedures.some((procedure) => procedure.outcome === RULE_OUTCOME.NOT_TRIGGERED)) parts.push(NOT_TRIGGERED_MEANING);
  if (procedures.length === 0) parts.push("No rule applied to this line." );
  else parts.push(`${procedures.length} applicable rule(s): ${procedures.map((p) => `${p.procedureId}=${p.outcome}`).join(", ")}.`);
  if (procedures.some((procedure) => !procedure.verified)) {
    parts.push("Every rule cited here is ILLUSTRATIVE/UNVERIFIED: see docs/OEM-DATA.md.");
  }
  return parts.join(" ");
}

function reviewNotesFor(category) {
  const notes = [];
  if (category === DECISION.PROCEDURE_INDICATED || category === DECISION.INSPECTION_REQUIRED) {
    notes.push("A triggered rule is an indication from an unverified rule, not a verified OEM requirement. Confirm against the OEM procedure for the exact configuration.");
  }
  if (category === DECISION.CONDITIONAL) {
    notes.push("The named facts are needed to move this line off CONDITIONAL. Supply them on the estimate line's `facts` object or confirm them at the vehicle.");
  }
  if (category === DECISION.NOT_INDICATED_UNDER_RULES) {
    notes.push("A rule library with gaps cannot prove that no procedure applies; check OEM service information for this component and operation.");
  }
  return notes;
}

function toProcedureView(procedure) {
  return {
    procedureId: procedure.procedureId,
    procedure: procedure.procedure,
    procedureType: procedure.procedureType,
    outcome: procedure.outcome,
    reason: procedure.reason,
    outcomeNotes: procedure.outcomeNotes,
    missingFields: procedure.missingFields,
    triggeredOn: procedure.triggeredOn.map((check) => ({ field: check.field, label: check.label, actual: check.actual })),
    checks: procedure.checks,
    evidenceRequired: procedure.evidenceRequired,
    evidence: procedure.evidence,
    source: procedure.source,
    ruleStatus: procedure.ruleStatus,
    verified: procedure.verified,
    logic: procedure.logic,
  };
}
