import test from "node:test";
import assert from "node:assert/strict";

import { buildImpactMatrix, summarizeImpactMatrix, MATRIX_NOTE } from "../../src/modules/parts-mapping/impact-matrix.js";
import { loadComponentCatalog } from "../../src/modules/oem-procedures/oem.repository.js";

const { components, sensors } = loadComponentCatalog();

const lines = [
  { lineId: "L1", description: "Front bumper cover", operation: "REPLACE", position: "FRONT", partNumber: null },
  { lineId: "L2", description: "Front radar sensor", operation: "REMOVE_INSTALL", position: "FRONT", partNumber: null },
  { lineId: "L3", description: "Left rear quarter panel", operation: "REPAIR", position: "REAR", partNumber: "QTR-1" },
  { lineId: "L4", description: "Windshield", operation: "REPLACE", position: "FRONT_GLASS", partNumber: null },
];

const matrix = buildImpactMatrix(lines, components, { sensors });

test("impact matrix keeps an unresolved line instead of dropping it", () => {
  assert.equal(matrix.length, lines.length);
  const unmatched = matrix.find((row) => row.lineId === "L3");
  assert.equal(unmatched.matchStatus, "UNMATCHED");
  assert.equal(unmatched.componentId, null);
  assert.deepEqual(unmatched.affectedSensors, []);
  assert.equal(unmatched.partNumber, "QTR-1", "part number is carried through even when unmatched");
});

test("impact matrix carries affected sensors and systems for matched lines", () => {
  const bumper = matrix.find((row) => row.lineId === "L1");
  assert.equal(bumper.matchStatus, "MATCHED");
  assert.equal(bumper.componentId, "front_bumper_cover");
  assert.deepEqual(
    bumper.affectedSensors.map((sensor) => sensor.sensorId),
    ["front_radar", "front_camera", "front_ultrasonic"],
  );
  assert.deepEqual(bumper.affectedSystems, ["front_body"]);
  assert.ok(bumper.affectedSensors.every((sensor) => sensor.displayName), "sensor display names come from the sensor catalog");

  const radar = matrix.find((row) => row.lineId === "L2");
  assert.equal(radar.affectedSensors[0].isTriggerComponentItself, true, "self-referencing sensor is marked");
});

test("impact matrix preserves the original description and the normalized form", () => {
  const glass = matrix.find((row) => row.lineId === "L4");
  assert.equal(glass.originalDescription, "Windshield");
  assert.equal(glass.operation, "REPLACE");
  assert.ok(glass.matchConfidence.level);
});

test("every matrix row is labelled candidate-generation-only", () => {
  for (const row of matrix) {
    assert.equal(row.candidateOnly, true);
    assert.equal(row.note, MATRIX_NOTE);
  }
  assert.match(MATRIX_NOTE, /not that a calibration or any other procedure is required/i);
});

test("matrix summary counts coverage, not requirements", () => {
  const summary = summarizeImpactMatrix(matrix);
  assert.deepEqual(summary, { lines: 4, matched: 3, ambiguous: 0, unmatched: 1, linesCarryingSensors: 3 });
});
