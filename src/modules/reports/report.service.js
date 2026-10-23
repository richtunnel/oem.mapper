/**
 * Report module — the technician/estimator-facing artefact (SPEC §7).
 *
 * Design rules encoded here:
 *   - Every line shows operation, decision, evidence and source. No line is dropped.
 *   - Unresolved items, coverage gaps and pending facts live in their OWN sections,
 *     so nothing "not required" can be produced by omission.
 *   - The impact matrix is included but labelled as candidate generation, so a reader
 *     cannot mistake matrix cells for calibration requirements.
 *   - The report is self-describing about data provenance: it carries the
 *     ILLUSTRATIVE/UNVERIFIED label and the count of verified rules (always 0 today).
 */
import { DECISION, DECISION_VALUES } from "../../shared/constants.js";
import { MATRIX_NOTE, summarizeImpactMatrix } from "../parts-mapping/impact-matrix.js";
import { NOT_INDICATED_IS_NOT_PROOF } from "../decision-engine/decision.service.js";

export const REPORT_VERSION = "0.1.0";

export const DISCLAIMER =
  "NO REAL OEM PROCEDURE DATA EXISTS IN THIS SYSTEM. Every procedure, condition and source below is ILLUSTRATIVE and UNVERIFIED, invented to exercise the data model. This report may not be used to decide work on a real vehicle. Deterministic rules — not an AI model — produced every decision; an unverified rule still cannot authorise a procedure.";

export function buildReport({ estimate, vehicle, impactMatrix, decisions, coverageGaps, review, warnings = [], provenance = {} }) {
  const byCategory = Object.fromEntries(DECISION_VALUES.map((category) => [category, 0]));
  for (const decision of decisions) byCategory[decision.category] += 1;

  const lines = impactMatrix.map((row) => {
    const decision = decisions.find((item) => item.lineId === row.lineId);
    return {
      lineId: row.lineId,
      description: row.originalDescription,
      normalizedDescription: row.normalizedDescription,
      operation: row.operation,
      position: row.position,
      partNumber: row.partNumber,
      match: {
        status: row.matchStatus,
        componentId: row.componentId,
        componentDisplayName: row.component?.displayName ?? null,
        systems: row.affectedSystems,
        confidence: row.matchConfidence,
        reason: row.matchReason,
        candidates: row.candidates ?? [],
      },
      decision: decision
        ? {
            category: decision.category,
            headline: decision.headline,
            detail: decision.detail,
            procedures: decision.procedures,
            pendingFacts: decision.pendingFacts,
            reviewNotes: decision.reviewNotes,
          }
        : { category: DECISION.UNRESOLVED, headline: "No decision was produced for this line.", detail: "", procedures: [], pendingFacts: [], reviewNotes: [] },
      evidence: buildLineEvidence(row, decision),
    };
  });

  const unresolved = [
    ...decisions
      .filter((decision) => decision.category === DECISION.UNRESOLVED)
      .map((decision) => ({
        lineId: decision.lineId,
        kind: "MAPPING",
        detail: decision.detail,
        candidates: decision.candidates,
        missingFields: [],
      })),
    ...decisions.flatMap((decision) =>
      decision.pendingFacts.map((pending) => ({
        lineId: decision.lineId,
        kind: "MISSING_FACT",
        detail: `Rule(s) ${pending.ruleIds.join(", ")} cannot be evaluated without "${pending.field}".`,
        candidates: [],
        missingFields: [pending.field],
      })),
    ),
    ...coverageGaps.map((gap) => ({
      lineId: gap.lineId,
      kind: gap.kind,
      detail: gap.detail,
      candidates: [],
      missingFields: [],
    })),
  ];

  const sourcesCited = dedupeSources(
    decisions.flatMap((decision) => decision.procedures.map((procedure) => procedure.source)),
  );

  return {
    reportVersion: REPORT_VERSION,
    generatedAt: new Date().toISOString(),
    estimateId: estimate.estimateId,
    status: decisions.some((decision) => decision.category === DECISION.UNRESOLVED) ? "ANALYZED_WITH_OPEN_ITEMS" : "ANALYZED",
    vehicle: {
      vehicleKey: vehicle.vehicleKey,
      resolutionStatus: vehicle.status,
      configurationVerified: vehicle.configurationVerified,
      reason: vehicle.reason,
      unchecked: vehicle.unchecked,
      input: estimate.vehicle,
    },
    dataProvenance: {
      componentDataset: provenance.components ?? null,
      procedureDataset: provenance.procedures ?? null,
      verifiedRuleCount: provenance.verifiedRuleCount ?? 0,
      decisionAuthority: "DETERMINISTIC_RULES",
      aiInDecisionPath: false,
      disclaimer: DISCLAIMER,
    },
    summary: {
      totalLines: lines.length,
      byCategory,
      impactMatrix: summarizeImpactMatrix(impactMatrix),
      humanReviewRequired: review.humanReviewRequired,
      unresolvedItemCount: unresolved.length,
      coverageGapCount: coverageGaps.length,
      pendingFactCount: decisions.reduce((total, decision) => total + decision.pendingFacts.length, 0),
      sourcesCited: sourcesCited.length,
    },
    impactMatrix: { note: MATRIX_NOTE, rows: impactMatrix },
    lines,
    // Kept apart on purpose: these are the three ways this report can be wrong.
    unresolved,
    coverageGaps,
    humanReview: review,
    inputWarnings: warnings,
    sourcesCited,
    notIndicatedIsNotProof: NOT_INDICATED_IS_NOT_PROOF,
    disclaimer: DISCLAIMER,
  };
}

function buildLineEvidence(row, decision) {
  const evidence = [
    `Estimate line ${row.lineId}: "${row.originalDescription}"${row.normalizedDescription !== row.originalDescription.toLowerCase() ? ` (normalized: "${row.normalizedDescription}")` : ""}`,
    `Operation: ${row.operation} · position: ${row.position}${row.partNumber ? ` · part number: ${row.partNumber}` : " · no part number supplied"}`,
    `Mapping: ${row.matchReason}`,
    `Impact matrix (candidate generation only): sensors in the affected set = ${row.affectedSensors.map((sensor) => sensor.sensorId).join(", ") || "none"}`,
  ];
  if (decision) {
    for (const procedure of decision.procedures) {
      evidence.push(
        `Rule ${procedure.procedureId} (${procedure.procedureType}, logic ${procedure.logic}) → ${procedure.outcome}: ` +
          `${procedure.outcomeNotes.join(" ") || procedure.reason} ` +
          `Source: ${procedure.source?.documentId ?? "none"} ${procedure.source?.revision ? `rev ${procedure.source.revision}` : ""} ${procedure.source?.section ? `§ ${procedure.source.section}` : ""} ` +
          `[${procedure.ruleStatus}${procedure.source?.fictional ? ", fictional source" : ""}]`,
      );
    }
  }
  return evidence;
}

function dedupeSources(sources) {
  const seen = new Map();
  for (const source of sources) {
    if (!source?.documentId) continue;
    const key = `${source.documentId}|${source.revision}`;
    if (!seen.has(key)) seen.set(key, source);
  }
  return [...seen.values()];
}

/** Technician-facing plain text (SPEC §7 layout). Same data, rendered for reading. */
export function renderTextReport(report) {
  const out = [];
  out.push(`Estimate ${report.estimateId} — ${report.vehicle.vehicleKey ?? "vehicle unresolved"} — ${report.status}`);
  out.push(`Report ${report.reportVersion} · generated ${report.generatedAt}`);
  out.push(`Data: ${report.dataProvenance.verifiedRuleCount} verified rule(s). Illustrative dataset only.`);
  out.push("");

  for (const line of report.lines) {
    out.push(`${line.description}  [${line.lineId}]`);
    out.push(`  Operation: ${line.operation}${line.position !== "UNSPECIFIED" ? ` · ${line.position}` : ""}`);
    out.push(`  Component: ${line.match.componentId ?? "unresolved"} (${line.match.status}${line.match.confidence ? `, ${line.match.confidence.level}` : ""})`);
    out.push(`  Decision (${line.decision.category}): ${line.decision.headline}`);
    for (const procedure of line.decision.procedures) {
      out.push(`    - ${procedure.procedureId} ${procedure.procedure} [${procedure.procedureType}] → ${procedure.outcome}` +
        `${procedure.missingFields.length ? ` (needs: ${procedure.missingFields.join(", ")})` : ""}`);
      out.push(`      Source: ${procedure.source?.documentId} ${procedure.source?.revision} § ${procedure.source?.section} [${procedure.ruleStatus}]`);
    }
    for (const note of line.decision.reviewNotes) out.push(`    ! ${note}`);
    out.push("");
  }

  out.push("Unresolved / needs human review");
  if (report.unresolved.length === 0) out.push("  (none)");
  for (const item of report.unresolved) out.push(`  ${item.lineId} [${item.kind}] ${item.detail}`);
  out.push("");
  out.push(`Human review required: ${report.humanReview.humanReviewRequired ? "YES" : "no"} — ${report.humanReview.reason}`);
  out.push("");
  out.push(report.disclaimer);
  return out.join("\n");
}
