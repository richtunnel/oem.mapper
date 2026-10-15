import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { findComponent, confidenceFromScore, MATCH_MIN_SCORE } from "../../src/modules/parts-mapping/matcher.js";
import { MATCH_STATUS } from "../../src/shared/constants.js";
import { normalizeText, normalizeOperation } from "../../src/shared/text.js";
import { loadComponentCatalog } from "../../src/modules/oem-procedures/oem.repository.js";

const here = dirname(fileURLToPath(import.meta.url));
const testCatalog = JSON.parse(
  readFileSync(join(here, "..", "fixtures", "aliased-components.test-catalog.json"), "utf8"),
).components;

const { components } = loadComponentCatalog();

test("normalizeText collapses punctuation, casing and & without inventing words", () => {
  assert.equal(normalizeText("Bumper  COVER!"), "bumper cover");
  assert.equal(normalizeText("Front Bumper & Grille"), "front bumper and grille");
  assert.equal(normalizeText("  Windshield  "), "windshield");
  assert.equal(normalizeText(null), "");
});

test("normalizeText expands shop abbreviations", () => {
  assert.equal(normalizeText("frt bumper fascia"), "front bumper fascia");
  assert.equal(normalizeText("Fwd cam assy"), "forward camera assembly");
  assert.equal(normalizeText("R&I"), "remove install");
});

test("normalizeOperation maps messy operation strings to the canonical vocabulary", () => {
  assert.equal(normalizeOperation("R&I"), "REMOVE_INSTALL");
  assert.equal(normalizeOperation("Remove and Install"), "REMOVE_INSTALL");
  assert.equal(normalizeOperation("Replace"), "REPLACE");
  assert.equal(normalizeOperation("refin"), "REFINISH");
  assert.equal(normalizeOperation("welding"), null);
  assert.equal(normalizeOperation(""), null);
});

test("matcher: exact description matches the canonical component", () => {
  const match = findComponent("Front bumper cover", components);
  assert.equal(match.status, MATCH_STATUS.MATCHED);
  assert.equal(match.componentId, "front_bumper_cover");
  assert.equal(match.matchConfidence.level, "EXACT");
  assert.equal(match.matchConfidence.matchedAlias, "front bumper cover");
  assert.equal(match.matchConfidence.score, 1);
});

test("matcher: alias 'bumper fascia' resolves to the same component", () => {
  const match = findComponent("bumper fascia", components);
  assert.equal(match.status, MATCH_STATUS.MATCHED);
  assert.equal(match.componentId, "front_bumper_cover");
  assert.equal(match.matchConfidence.level, "EXACT");
});

test("matcher: punctuation and casing do not change the outcome ('Bumper  COVER!')", () => {
  const match = findComponent("Bumper  COVER!", components);
  assert.equal(match.status, MATCH_STATUS.MATCHED);
  assert.equal(match.componentId, "front_bumper_cover");
  assert.equal(match.originalDescription, "Bumper  COVER!", "original shop wording must be preserved");
  assert.equal(match.normalizedDescription, "bumper cover");
});

test("matcher: abbreviations in a description still match ('frt bumper fascia')", () => {
  const match = findComponent("frt bumper fascia", components);
  assert.equal(match.status, MATCH_STATUS.MATCHED);
  assert.equal(match.componentId, "front_bumper_cover");
  assert.equal(match.matchConfidence.level, "HIGH", "an extra descriptive token lowers confidence from EXACT");
});

test("matcher: a weak second candidate does not create ambiguity", () => {
  // "windshield camera" is an exact alias of the camera, and only contains the
  // windshield alias — a real tie is required for AMBIGUOUS, not any multi-match.
  const match = findComponent("Windshield camera", components);
  assert.equal(match.status, MATCH_STATUS.MATCHED);
  assert.equal(match.componentId, "front_camera");
  assert.ok(match.candidates.length >= 2, "the weaker candidate is still reported for review");
});

test("matcher: two components sharing an alias produce AMBIGUOUS, never a guess", () => {
  const match = findComponent("Door mirror", testCatalog);
  assert.equal(match.status, MATCH_STATUS.AMBIGUOUS);
  assert.equal(match.componentId, null);
  assert.equal(match.component, null);
  assert.deepEqual(
    match.candidates.map((candidate) => candidate.componentId).sort(),
    ["test_glass_panel", "test_mirror_assembly"],
  );
  assert.match(match.reason, /equally well/);
});

test("matcher: description absent from the catalog is UNMATCHED with a reason", () => {
  const match = findComponent("Left rear quarter panel", components);
  assert.equal(match.status, MATCH_STATUS.UNMATCHED);
  assert.equal(match.componentId, null);
  assert.deepEqual(match.affectedSensors ?? [], []);
  assert.match(match.reason, /No catalog alias matched/);
});

test("matcher: substring matching is not used (no match inside a longer word)", () => {
  // "grillwork" contains "grill" but not the token "grille"; a substring matcher
  // would invent a front-grille match here.
  const match = findComponent("Decorative grillwork panel", components);
  assert.equal(match.status, MATCH_STATUS.UNMATCHED);
});

test("matcher: confidence levels are derived from score, and the floor is explicit", () => {
  assert.equal(confidenceFromScore(1), "EXACT");
  assert.equal(confidenceFromScore(0.9), "HIGH");
  assert.equal(confidenceFromScore(MATCH_MIN_SCORE), "MEDIUM");
  assert.equal(confidenceFromScore(0.1), "LOW");
});
