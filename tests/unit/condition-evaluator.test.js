import test from "node:test";
import assert from "node:assert/strict";

import { evaluateCondition, evaluateConditions, OPERATORS } from "../../src/modules/decision-engine/condition-evaluator.js";

const rule = (conditions, logic = "ANY") => ({ id: "R", logic, conditions });

test("equals / not_equals / in evaluate against known facts", () => {
  const context = { flag: true, name: "REPLACE", severity: "MODERATE" };
  assert.equal(evaluateCondition({ field: "flag", operator: "equals", value: true }, context).check, "TRUE");
  assert.equal(evaluateCondition({ field: "flag", operator: "equals", value: false }, context).check, "FALSE");
  assert.equal(evaluateCondition({ field: "name", operator: "not_equals", value: "REPAIR" }, context).check, "TRUE");
  assert.equal(evaluateCondition({ field: "name", operator: "not_equals", value: "REPLACE" }, context).check, "FALSE");
  assert.equal(evaluateCondition({ field: "severity", operator: "in", value: ["MODERATE", "SEVERE"] }, context).check, "TRUE");
  assert.equal(evaluateCondition({ field: "severity", operator: "in", value: ["MINOR"] }, context).check, "FALSE");
});

test("operator coverage matches the documented operator list", () => {
  for (const operator of ["equals", "not_equals", "in", "not_in", "includes", "greater_than", "less_than", "is_present"]) {
    assert.ok(OPERATORS.includes(operator));
  }
  const context = { list: ["a", "b"], n: 5 };
  assert.equal(evaluateCondition({ field: "list", operator: "includes", value: "a" }, context).check, "TRUE");
  assert.equal(evaluateCondition({ field: "list", operator: "not_in", value: ["z"] }, context).check, "TRUE");
  assert.equal(evaluateCondition({ field: "n", operator: "greater_than", value: 3 }, context).check, "TRUE");
  assert.equal(evaluateCondition({ field: "n", operator: "less_than", value: 3 }, context).check, "FALSE");
  assert.equal(evaluateCondition({ field: "n", operator: "is_present" }, context).check, "TRUE");
});

test("undefined vs false vs null vs absent are distinguished", () => {
  const absent = evaluateCondition({ field: "missing" }, {});
  assert.equal(absent.check, "UNKNOWN");
  assert.equal(absent.present, false);
  assert.match(absent.note, /not supplied/);

  const explicitUndefined = evaluateCondition({ field: "flag" }, { flag: undefined });
  assert.equal(explicitUndefined.check, "UNKNOWN");
  assert.match(explicitUndefined.note, /undefined/);

  const explicitNull = evaluateCondition({ field: "flag" }, { flag: null });
  assert.equal(explicitNull.check, "UNKNOWN");
  assert.equal(explicitNull.present, true, "null is present-but-unknown, not absent");
  assert.match(explicitNull.note, /null/);

  // false is a real fact: it must not be treated as unknown.
  assert.equal(evaluateCondition({ field: "flag", operator: "equals", value: false }, { flag: false }).check, "TRUE");
  assert.equal(evaluateCondition({ field: "flag", operator: "equals", value: true }, { flag: false }).check, "FALSE");
  assert.equal(evaluateConditions(rule([{ field: "flag", operator: "equals", value: false }]), { flag: false }).outcome, "TRIGGERED");
});

test("equals does not coerce types ('false' string never equals false)", () => {
  const check = evaluateCondition({ field: "flag", operator: "equals", value: false }, { flag: "false" });
  assert.equal(check.check, "FALSE");
  assert.match(check.note, /type/);
});

test("logic ANY is TRIGGERED when a known condition is TRUE even though another is UNKNOWN", () => {
  const result = evaluateConditions(
    rule([
      { field: "sensorAffected", operator: "equals", value: true },
      { field: "impactSeverity", operator: "in", value: ["MODERATE", "SEVERE"] },
    ]),
    { sensorAffected: true },
  );
  assert.equal(result.outcome, "TRIGGERED");
  assert.deepEqual(result.missingFields, ["impactSeverity"], "the unevaluated fact is still named");
  assert.ok(result.notes.some((note) => /cannot un-trigger/.test(note)));
});

test("logic ANY with no TRUE and an UNKNOWN is INSUFFICIENT_DATA naming the missing fields", () => {
  const result = evaluateConditions(
    rule([
      { field: "a", operator: "equals", value: true },
      { field: "b", operator: "equals", value: true },
      { field: "c", operator: "equals", value: true },
    ]),
    { a: false, c: null },
  );
  assert.equal(result.outcome, "INSUFFICIENT_DATA");
  // `b` is absent (UNKNOWN — an unevaluated fact, not a FALSE fact) and `c` is an
  // explicit null. Both are unevaluated, so both are named: reporting only `c`
  // would hide the fact that `b` was never established.
  assert.deepEqual(result.missingFields, ["b", "c"]);
});

test("logic ANY with every condition FALSE is NOT_TRIGGERED", () => {
  const result = evaluateConditions(
    rule([
      { field: "a", operator: "equals", value: true },
      { field: "b", operator: "equals", value: true },
    ]),
    { a: false, b: false },
  );
  assert.equal(result.outcome, "NOT_TRIGGERED");
  assert.deepEqual(result.missingFields, []);
});

test("logic ALL: one FALSE settles it even with an UNKNOWN present", () => {
  const result = evaluateConditions(
    rule(
      [
        { field: "a", operator: "equals", value: true },
        { field: "b", operator: "equals", value: true },
      ],
      "ALL",
    ),
    { a: false },
  );
  assert.equal(result.outcome, "NOT_TRIGGERED");
  assert.deepEqual(result.missingFields, ["b"], "the unknown is recorded, not hidden");
});

test("logic ALL: TRUE + UNKNOWN cannot establish the outcome", () => {
  const result = evaluateConditions(
    rule(
      [
        { field: "a", operator: "equals", value: true },
        { field: "b", operator: "equals", value: true },
      ],
      "ALL",
    ),
    { a: true },
  );
  assert.equal(result.outcome, "INSUFFICIENT_DATA");
  assert.deepEqual(result.missingFields, ["b"]);
});

test("logic ALL: all TRUE is TRIGGERED", () => {
  const result = evaluateConditions(
    rule(
      [
        { field: "a", operator: "equals", value: true },
        { field: "b", operator: "in", value: ["x"] },
      ],
      "ALL",
    ),
    { a: true, b: "x" },
  );
  assert.equal(result.outcome, "TRIGGERED");
});

test("a rule with no conditions triggers on applicability alone, and says so", () => {
  const result = evaluateConditions(rule([]), { anything: 1 });
  assert.equal(result.outcome, "TRIGGERED");
  assert.match(result.notes[0], /no additional conditions/);
});

test("an unsupported operator or logic is INSUFFICIENT_DATA, never a silent pass", () => {
  const badOperator = evaluateConditions(rule([{ field: "a", operator: "approximately", value: 1 }]), { a: 1 });
  assert.equal(badOperator.outcome, "INSUFFICIENT_DATA");
  const badLogic = evaluateConditions({ id: "R", logic: "MAYBE", conditions: [] }, {});
  assert.equal(badLogic.outcome, "INSUFFICIENT_DATA");
});

test("checks carry the full evidence for the report", () => {
  const result = evaluateConditions(rule([{ field: "a", operator: "equals", value: true, label: "Fact A" }]), { a: false });
  const [check] = result.checks;
  assert.deepEqual(
    { field: check.field, label: check.label, operator: check.operator, expected: check.expected, actual: check.actual, check: check.check },
    { field: "a", label: "Fact A", operator: "equals", expected: true, actual: false, check: "FALSE" },
  );
});
