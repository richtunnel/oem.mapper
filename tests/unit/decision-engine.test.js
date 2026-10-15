import test from "node:test";
import assert from "node:assert/strict";

import { buildImpactMatrix } from "../../src/modules/parts-mapping/impact-matrix.js";
import { evaluateEstimate } from "../../src/modules/decision-engine/decision.service.js";
import { DECISION } from "../../src/shared/constants.js";
import { testComponent, testResolver, testRule, TEST_VEHICLE } from "../helpers/test-doubles.js";

const components = [
  testComponent({ id: "front_radar", displayName: "Front radar sensor", aliases: ["front radar sensor"], systems: ["adas"], nearbySensors: ["front_radar"] }),
  testComponent({ id: "front_grille", displayName: "Front grille", aliases: ["front grille"], systems: ["front_body"], nearbySensors: ["front_radar"] }),
];

const lines = [
  { lineId: "L1", description: "Front radar sensor", operation: "REMOVE_INSTALL", position: "FRONT", partNumber: null, facts: {} },
  { lineId: "L2", description: "Front grille", operation: "REPLACE", position: "FRONT", partNumber: null, facts: {} },
  { lineId: "L3", description: "Mystery bracket", operation: "REPAIR", position: "FRONT", partNumber: null, facts: {} },
];

const matrix = buildImpactMatrix(lines, components, { sensors: [] });
const lineById = (lineId) => lines.find((line) => line.lineId === lineId);
const decide = (resolver, lineId, decisionLines = lines) =>
  evaluateEstimate({
    impactMatrix: matrix.filter((row) => row.lineId === lineId),
    lines: decisionLines,
    vehicle: TEST_VEHICLE,
    resolver,
  });

test("verified-rule path: TRIGGERED becomes PROCEDURE_INDICATED with source and evidence", () => {
  const resolver = testResolver([
    testRule({
      id: "T-1",
      procedure: "TEST_STATIC_CAL",
      conditions: [{ field: "radarDisconnected", operator: "equals", value: true, label: "connector disconnected" }],
    }),
  ]);

  const withFact = `L1`;
  const result = decide(resolver, withFact, lines.map((line) => (line.lineId === "L1" ? { ...line, facts: { radarDisconnected: true } } : line)));
  const decision = result.decisions[0];

  assert.equal(decision.category, DECISION.PROCEDURE_INDICATED);
  assert.equal(decision.procedures.length, 1);
  const procedure = decision.procedures[0];
  assert.equal(procedure.outcome, "TRIGGERED");
  assert.equal(procedure.procedureType, "STATIC_CALIBRATION");
  assert.equal(procedure.verified, true);
  assert.equal(procedure.source.documentId, "TEST-DOUBLE-NOT-A-REAL-OEM-DOCUMENT");
  assert.ok(procedure.evidence.some((item) => /Estimate line L1/.test(item)));
  assert.ok(procedure.checks.length === 1);
  // A verified rule whose conditions were fully resolved needs no human review.
  assert.equal(result.review.humanReviewRequired, false);
});

test("verified-rule path: conditions evaluated FALSE gives NOT_INDICATED_UNDER_RULES, not 'no procedure needed'", () => {
  const resolver = testResolver([
    testRule({ id: "T-2", conditions: [{ field: "radarDisconnected", operator: "equals", value: true }] }),
  ]);
  const result = decide(resolver, "L1", lines.map((line) => (line.lineId === "L1" ? { ...line, facts: { radarDisconnected: false } } : line)));
  const decision = result.decisions[0];

  assert.equal(decision.category, DECISION.NOT_INDICATED_UNDER_RULES);
  assert.equal(decision.procedures[0].outcome, "NOT_TRIGGERED");
  assert.match(decision.detail, /This rule's own trigger conditions were not met|not a statement that the vehicle needs no calibration/i);
  assert.match(decision.headline, /not proof/i);
  assert.equal(result.review.humanReviewRequired, false, "a fully resolved, unverified-rule-free line needs no review under the policy");
});

test("no-rule path: a matched component with no rule is a coverage gap, and stays usable", () => {
  // The rule library DOES cover this vehicle key (the radar rule below), it just has
  // no rule for the grille + REPLACE. That is what makes the gap the specific
  // "no rule for this component and operation" kind; a library with no rules at all
  // for the vehicle key is reported separately as NO_RULES_FOR_VEHICLE_KEY.
  const result = decide(testResolver([testRule({ id: "T-COVERAGE-RADAR" })]), "L2");
  const decision = result.decisions[0];

  assert.equal(decision.category, DECISION.NOT_INDICATED_UNDER_RULES);
  assert.equal(decision.procedures.length, 0);
  assert.equal(result.coverageGaps.length, 1);
  assert.equal(result.coverageGaps[0].kind, "NO_RULE_FOR_COMPONENT_OPERATION");
  // A library gap is our gap, not the estimate's defect: it is flagged for manual
  // verification but does not raise the human-review flag on its own.
  assert.equal(result.review.humanReviewRequired, false);
  assert.ok(result.review.manualVerificationRequired.some((item) => item.code === "RULE_LIBRARY_GAP"));
});

test("an unmatched line becomes per-line UNRESOLVED and raises human review", () => {
  const result = decide(testResolver([]), "L3");
  const decision = result.decisions[0];

  assert.equal(decision.category, DECISION.UNRESOLVED);
  assert.equal(decision.componentId, null);
  assert.deepEqual(decision.procedures, []);
  assert.equal(result.review.humanReviewRequired, true);
  assert.ok(result.review.triggers.some((trigger) => trigger.code === "MAPPING_UNRESOLVED" && trigger.lineId === "L3"));
});

test("INSUFFICIENT_DATA becomes CONDITIONAL with the missing facts named", () => {
  const resolver = testResolver([
    testRule({
      id: "T-3",
      conditions: [
        { field: "mountingBracketDisturbed", operator: "equals", value: true },
        { field: "wheelAlignmentPerformed", operator: "equals", value: true },
      ],
    }),
  ]);
  const result = decide(resolver, "L1");
  const decision = result.decisions[0];

  assert.equal(decision.category, DECISION.CONDITIONAL);
  assert.deepEqual(decision.pendingFacts.map((pending) => pending.field).sort(), ["mountingBracketDisturbed", "wheelAlignmentPerformed"]);
  assert.equal(result.review.humanReviewRequired, true);
  assert.ok(result.review.triggers.some((trigger) => trigger.code === "MISSING_TRIGGER_FACTS"));
});

test("an unverified rule that triggers still raises human review", () => {
  const resolver = testResolver([
    testRule({ id: "T-4", ruleStatus: "ILLUSTRATIVE", verified: false, conditions: [] }),
  ]);
  const result = decide(resolver, "L1");
  assert.equal(result.decisions[0].category, DECISION.PROCEDURE_INDICATED);
  assert.equal(result.review.humanReviewRequired, true);
  assert.ok(result.review.triggers.some((trigger) => trigger.code === "UNVERIFIED_SOURCE"));
});

test("category precedence: a triggered inspection wins over nothing, but pending facts are never hidden", () => {
  const resolver = testResolver([
    testRule({ id: "T-INSPECT", procedureType: "INSPECTION", procedure: "TEST_INSPECTION", conditions: [] }),
    testRule({ id: "T-PENDING", procedureType: "INITIALIZATION", procedure: "TEST_INIT", conditions: [{ field: "coverReplacedWithNonOemPart", operator: "equals", value: true }] }),
  ]);
  const result = decide(resolver, "L1");
  const decision = result.decisions[0];

  assert.equal(decision.category, DECISION.INSPECTION_REQUIRED);
  assert.deepEqual(decision.pendingFacts.map((pending) => pending.field), ["coverReplacedWithNonOemPart"]);
});

test("category precedence: a triggered non-inspection rule outranks a triggered inspection", () => {
  const resolver = testResolver([
    testRule({ id: "T-INSPECT-2", procedureType: "INSPECTION", conditions: [] }),
    testRule({ id: "T-STATIC-2", procedureType: "STATIC_CALIBRATION", conditions: [] }),
  ]);
  const result = decide(resolver, "L1");
  assert.equal(result.decisions[0].category, DECISION.PROCEDURE_INDICATED);
});

test("rules for other vehicle keys are never applied", () => {
  const resolver = testResolver([
    testRule({ id: "T-OTHER", applicability: { vehicleKey: "OTHER-2020-MODEL", triggerComponent: "front_radar", operations: ["REMOVE_INSTALL"] } }),
  ]);
  const result = decide(resolver, "L1");
  assert.equal(result.decisions[0].category, DECISION.NOT_INDICATED_UNDER_RULES);
  assert.equal(result.coverageGaps[0].kind, "NO_RULES_FOR_VEHICLE_KEY");
});

test("the decision carries the fact trail so the same answer can be reproduced", () => {
  const resolver = testResolver([testRule({ id: "T-5", conditions: [] })]);
  const result = decide(resolver, "L1");
  const facts = result.decisions[0].facts;
  assert.equal(facts.derived.componentReplaced, false);
  assert.equal(facts.derived.componentRemovedAndInstalled, true);
  assert.equal(facts.derived.sensorAffected, true);
  assert.equal(facts.supplied.radarDisconnected, undefined);
});

test("shop-supplied facts override derived facts, and derived facts are still reported", () => {
  const resolver = testResolver([testRule({ id: "T-6", conditions: [{ field: "sensorAffected", operator: "equals", value: false }] })]);
  const overridden = lines.map((line) => (line.lineId === "L1" ? { ...line, facts: { sensorAffected: false } } : line));
  const result = decide(resolver, "L1", overridden);
  assert.equal(result.decisions[0].category, DECISION.PROCEDURE_INDICATED);
  assert.equal(result.decisions[0].facts.effective.sensorAffected, false);
  assert.equal(result.decisions[0].facts.derived.sensorAffected, true);
});

test("buildImpactMatrix is not consulted for decisions beyond matching (no requirement leaks from the matrix)", () => {
  // A matched row with sensors must produce no procedure without an applicable rule.
  const resolver = testResolver([]);
  const result = decide(resolver, "L1");
  assert.equal(result.decisions[0].procedures.length, 0);
  assert.equal(result.decisions[0].category, DECISION.NOT_INDICATED_UNDER_RULES);
});

test("line facts are read from the estimate line, not invented", () => {
  const resolver = testResolver([testRule({ id: "T-7", conditions: [{ field: "coverReplacedWithNonOemPart", operator: "equals", value: true }] })]);
  const withoutFact = decide(resolver, "L1");
  assert.equal(withoutFact.decisions[0].category, DECISION.CONDITIONAL);

  const withFact = decide(resolver, "L1", lines.map((line) => (line.lineId === "L1" ? { ...line, facts: { coverReplacedWithNonOemPart: true } } : line)));
  assert.equal(withFact.decisions[0].category, DECISION.PROCEDURE_INDICATED);
});
