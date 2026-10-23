/**
 * Review policy — the explicit, versioned policy the spec asks for (SPEC §6
 * correction: "fix the human-review flag so it is based on an explicit policy,
 * rather than treating every non-review result as a reason for review").
 *
 * The sketched flag was `decisions.some(d => d.status !== "REVIEW_REQUIRED")`,
 * which sets review-required when NOTHING is wrong and false when something is.
 * This module replaces it with named rules, and keeps two distinct outputs that
 * must never be collapsed into one another:
 *
 *   humanReviewRequired     a defect in THIS analysis: a line nothing could be
 *                           matched to, a fact the engine needed and did not get,
 *                           or a procedure indicated from an unverified source.
 *   manualVerificationRequired  work a human must do anyway, whether or not the
 *                           analysis is sound: consult OEM service information
 *                           because the rule library has no rule for this
 *                           component/operation. A coverage gap is a gap in OUR
 *                           data, not a defect in the estimate.
 *
 * NOT setting humanReviewRequired is never a claim that no procedure is needed —
 * see the "notIndicatedIsNotProof" note in every report.
 */
import { DECISION, RULE_STATUS } from "../../shared/constants.js";

export const REVIEW_POLICY_VERSION = "review-policy-v1";

export const POLICY_RULES = Object.freeze([
  {
    code: "MAPPING_UNRESOLVED",
    humanReviewRequired: true,
    description: "A line could not be matched to exactly one canonical component (UNMATCHED or AMBIGUOUS). Nothing downstream of the mapping can be trusted for that line.",
  },
  {
    code: "MISSING_TRIGGER_FACTS",
    humanReviewRequired: true,
    description: "A rule that could apply to a line could not be evaluated because named facts are missing. A human or a diagnostic tool must supply them.",
  },
  {
    code: "UNVERIFIED_SOURCE",
    humanReviewRequired: true,
    description: "A procedure is indicated or conditionally indicated by a rule whose source is not VERIFIED. Until real OEM service information is attached, no such indication may be acted on as fact.",
  },
  {
    code: "RULE_LIBRARY_GAP",
    humanReviewRequired: false,
    description: "A matched line has no rule for its component/operation under this vehicle key. Recorded as a coverage gap and in manualVerificationRequired; it is not evidence that no procedure is required.",
  },
  {
    code: "CONDITIONS_EVALUATED_FULLY",
    humanReviewRequired: false,
    description: "All applicable rule conditions were resolved by known facts and none triggered. This is the only case with no review requirement, and it still only means 'not triggered under these rules'.",
  },
]);

export function evaluateReviewPolicy({ decisions = [], coverageGaps = [] } = {}) {
  const triggers = [];

  for (const decision of decisions) {
    if (decision.category === DECISION.UNRESOLVED) {
      triggers.push({
        code: "MAPPING_UNRESOLVED",
        lineId: decision.lineId,
        detail: decision.headline,
        missingFields: [],
      });
      continue;
    }

    const indicated = decision.procedures.filter((procedure) =>
      [RULE_OUTCOME_LIKE.TRIGGERED, RULE_OUTCOME_LIKE.INSUFFICIENT_DATA].includes(procedure.outcome),
    );

    for (const procedure of indicated) {
      if (procedure.ruleStatus !== RULE_STATUS.VERIFIED) {
        triggers.push({
          code: "UNVERIFIED_SOURCE",
          lineId: decision.lineId,
          detail: `Rule ${procedure.procedureId} (${procedure.ruleStatus ?? "UNVERIFIED"}) via ${procedure.source?.documentId ?? "no source document"}.`,
          missingFields: [],
        });
      }
    }

    for (const procedure of decision.procedures) {
      if (procedure.outcome === RULE_OUTCOME_LIKE.INSUFFICIENT_DATA) {
        triggers.push({
          code: "MISSING_TRIGGER_FACTS",
          lineId: decision.lineId,
          detail: `Rule ${procedure.procedureId} needs: ${procedure.missingFields.join(", ") || "unnamed condition"}.`,
          missingFields: procedure.missingFields,
        });
      }
    }
  }

  const manualVerification = [
    ...coverageGaps.map((gap) => ({
      code: "RULE_LIBRARY_GAP",
      lineId: gap.lineId,
      detail: gap.detail,
    })),
    ...triggers.map((trigger) => ({ code: trigger.code, lineId: trigger.lineId, detail: trigger.detail })),
  ];

  const dedupedTriggers = dedupe(triggers);
  const humanReviewRequired = dedupedTriggers.some(
    (trigger) => POLICY_RULES.find((rule) => rule.code === trigger.code)?.humanReviewRequired === true,
  );

  return {
    policyVersion: REVIEW_POLICY_VERSION,
    humanReviewRequired,
    reason: humanReviewRequired
      ? "At least one analysis defect requires a human: " + [...new Set(dedupedTriggers.map((t) => t.code))].join(", ")
      : "No analysis defect was found under this policy. Any listed procedure is still UNVERIFIED and the rule library may have gaps.",
    triggers: dedupedTriggers,
    manualVerificationRequired: dedupe(manualVerification),
    policy: POLICY_RULES.map((rule) => ({ ...rule })),
  };
}

/** Local copy of the outcome enum strings, kept here to avoid a circular import. */
const RULE_OUTCOME_LIKE = Object.freeze({
  TRIGGERED: "TRIGGERED",
  NOT_TRIGGERED: "NOT_TRIGGERED",
  INSUFFICIENT_DATA: "INSUFFICIENT_DATA",
  NOT_APPLICABLE: "NOT_APPLICABLE",
});

function dedupe(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = `${item.code}|${item.lineId ?? ""}|${item.detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
