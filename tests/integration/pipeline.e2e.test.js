import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { analyzeEstimate } from "../../src/modules/estimates/estimate.service.js";
import { renderTextReport } from "../../src/modules/reports/report.service.js";
import { DECISION } from "../../src/shared/constants.js";

const here = dirname(fileURLToPath(import.meta.url));
const estimate = JSON.parse(readFileSync(join(here, "..", "fixtures", "est-10042.json"), "utf8"));

const result = analyzeEstimate(estimate);
const { report } = result;

test("EST-10042 runs end to end against the illustrative dataset", () => {
  assert.equal(report.estimateId, "EST-10042");
  assert.equal(report.vehicle.vehicleKey, "EXAMPLE-2024-SUV");
  assert.equal(report.vehicle.configurationVerified, false, "no VIN decode exists in this MVP");
  assert.equal(report.dataProvenance.verifiedRuleCount, 0);
  assert.equal(report.dataProvenance.decisionAuthority, "DETERMINISTIC_RULES");
  assert.equal(report.dataProvenance.aiInDecisionPath, false);
});

test("the report has the documented top-level shape", () => {
  const expectedKeys = [
    "reportVersion", "generatedAt", "estimateId", "status", "vehicle", "dataProvenance", "summary",
    "impactMatrix", "lines", "unresolved", "coverageGaps", "humanReview", "inputWarnings",
    "sourcesCited", "notIndicatedIsNotProof", "disclaimer",
  ];
  assert.deepEqual(Object.keys(report).sort(), expectedKeys.sort());
  for (const key of ["estimateId", "vehicle", "reportVersion", "status"]) {
    assert.ok(["string", "object"].includes(typeof report[key]) && report[key] !== null);
  }
});

test("every estimate line appears in the report with operation, decision, evidence and source", () => {
  assert.equal(report.lines.length, estimate.lines.length);
  for (const line of report.lines) {
    assert.ok(line.decision.category, `${line.lineId} must have a category`);
    assert.ok(line.decision.headline.length > 0);
    assert.ok(line.evidence.length >= 3, "mapping and matrix evidence are always present");
    assert.ok(line.match.status);
    for (const procedure of line.decision.procedures) {
      assert.ok(procedure.source.documentId, "every cited procedure carries a source document");
      assert.ok(procedure.evidence.length > 0);
      assert.equal(procedure.verified, false, "no rule in the illustrative dataset may be verified");
    }
  }
});

test("all five final categories are represented, and each is decided by a rule", () => {
  const { byCategory } = report.summary;
  assert.deepEqual(byCategory, {
    [DECISION.PROCEDURE_INDICATED]: 2,
    [DECISION.CONDITIONAL]: 1,
    [DECISION.INSPECTION_REQUIRED]: 1,
    [DECISION.NOT_INDICATED_UNDER_RULES]: 1,
    [DECISION.UNRESOLVED]: 1,
  });
  assert.equal(report.summary.totalLines, 6);
});

test("the radar line reports a triggered rule from an unverified source, with no auto-approval", () => {
  const radar = report.lines.find((line) => line.lineId === "L3");
  assert.equal(radar.match.componentId, "front_radar");
  assert.equal(radar.decision.category, DECISION.PROCEDURE_INDICATED);
  const triggered = radar.decision.procedures.find((procedure) => procedure.outcome === "TRIGGERED");
  assert.equal(triggered.procedureId, "ILL-PROC-101");
  assert.equal(triggered.ruleStatus, "ILLUSTRATIVE");
  assert.match(triggered.source.documentId, /^ILLUSTRATIVE-DOC-/);
  assert.match(radar.decision.headline, /verify the OEM procedure/i);
});

test("the bumper line is CONDITIONAL and names the exact missing facts", () => {
  const bumper = report.lines.find((line) => line.lineId === "L1");
  assert.equal(bumper.decision.category, DECISION.CONDITIONAL);
  assert.deepEqual(bumper.decision.pendingFacts.map((pending) => pending.field).sort(), [
    "coverReplacedWithNonOemPart",
    "impactSeverity",
    "radarMountedToCoverStructure",
    "ultrasonicSensorsTransferred",
  ]);
});

test("the windshield line triggers a dynamic calibration and still reports its unevaluated condition", () => {
  const glass = report.lines.find((line) => line.lineId === "L4");
  assert.equal(glass.decision.category, DECISION.PROCEDURE_INDICATED);
  const outcomes = Object.fromEntries(glass.decision.procedures.map((procedure) => [procedure.procedureId, procedure.outcome]));
  assert.equal(outcomes["ILL-PROC-104"], "TRIGGERED");
  assert.equal(outcomes["ILL-PROC-103"], "INSUFFICIENT_DATA");
  assert.deepEqual(glass.decision.pendingFacts.map((pending) => pending.field), ["glassRemovedFromSensorBracket"]);
});

test("unresolved items stay visible instead of being classified as not required", () => {
  const unresolvedLine = report.lines.find((line) => line.lineId === "L5");
  assert.equal(unresolvedLine.match.status, "UNMATCHED");
  assert.equal(unresolvedLine.decision.category, DECISION.UNRESOLVED);
  assert.deepEqual(unresolvedLine.decision.procedures, []);

  const mappingItem = report.unresolved.find((item) => item.lineId === "L5" && item.kind === "MAPPING");
  assert.ok(mappingItem, "the unmatched line must appear in the unresolved section");
  assert.match(mappingItem.detail, /not in the component catalog/);
  assert.equal(report.summary.unresolvedItemCount, report.unresolved.length);

  const kinds = new Set(report.unresolved.map((item) => item.kind));
  assert.deepEqual([...kinds].sort(), ["MAPPING", "MISSING_FACT", "NO_RULE_FOR_COMPONENT_OPERATION"]);
});

test("a matched line with no applicable rule is recorded as a coverage gap, separately from review items", () => {
  const gap = report.coverageGaps.find((item) => item.lineId === "L2");
  assert.equal(gap.kind, "NO_RULE_FOR_COMPONENT_OPERATION");
  assert.match(gap.detail, /gap in our rule library/);
  const grille = report.lines.find((line) => line.lineId === "L2");
  assert.equal(grille.decision.category, DECISION.NOT_INDICATED_UNDER_RULES);
  assert.match(report.notIndicatedIsNotProof, /not a statement that the vehicle needs no calibration/);
});

test("the human-review flag follows the explicit, versioned policy", () => {
  assert.equal(report.humanReview.policyVersion, "review-policy-v1");
  assert.equal(report.humanReview.humanReviewRequired, true);
  const codes = new Set(report.humanReview.triggers.map((trigger) => trigger.code));
  assert.deepEqual([...codes].sort(), ["MAPPING_UNRESOLVED", "MISSING_TRIGGER_FACTS", "UNVERIFIED_SOURCE"]);
  assert.ok(report.humanReview.policy.every((rule) => typeof rule.humanReviewRequired === "boolean"));
  assert.ok(report.humanReview.manualVerificationRequired.some((item) => item.code === "RULE_LIBRARY_GAP"));
});

test("the report cites its sources and carries the illustrative-data disclaimer", () => {
  assert.ok(report.sourcesCited.length >= 3);
  assert.ok(report.sourcesCited.every((source) => /^ILLUSTRATIVE-DOC-/.test(source.documentId)));
  assert.ok(report.sourcesCited.every((source) => source.fictional === true));
  assert.match(report.disclaimer, /NO REAL OEM PROCEDURE DATA EXISTS/);
});

test("the impact matrix inside the report is labelled candidate-generation-only", () => {
  assert.match(report.impactMatrix.note, /Candidate generation only/);
  assert.equal(report.impactMatrix.rows.length, estimate.lines.length);
  assert.ok(report.impactMatrix.rows.every((row) => row.candidateOnly === true));
});

test("the technician-facing text rendering is produced from the same report", () => {
  const text = renderTextReport(report);
  assert.match(text, /Estimate EST-10042/);
  assert.match(text, /Unresolved \/ needs human review/);
  assert.match(text, /Human review required: YES/);
  assert.match(text, /ILL-PROC-101/);
});

test("the analysis is deterministic: the same estimate produces the same decisions", () => {
  const again = analyzeEstimate(estimate).report;
  assert.deepEqual(
    again.lines.map((line) => ({ lineId: line.lineId, category: line.decision.category, procedures: line.decision.procedures.map((p) => [p.procedureId, p.outcome]) })),
    report.lines.map((line) => ({ lineId: line.lineId, category: line.decision.category, procedures: line.decision.procedures.map((p) => [p.procedureId, p.outcome]) })),
  );
});
