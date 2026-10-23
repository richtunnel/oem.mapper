import test from "node:test";
import assert from "node:assert/strict";

import { validateEstimate } from "../../src/modules/estimates/estimate.schema.js";
import { jsonEstimateAdapter } from "../../src/modules/estimates/adapters/index.js";
import { selectAdapter, listAdapters } from "../../src/modules/estimates/adapters/index.js";
import { CsvEstimateAdapter, PdfEstimateAdapter } from "../../src/modules/estimates/adapters/unimplemented.adapter.js";
import { resolveVehicle } from "../../src/modules/vehicles/vehicle.service.js";

const validRaw = {
  estimateId: "EST-1",
  vehicle: { year: 2024, make: "Example", model: "SUV" },
  lines: [{ lineId: "L1", description: "Front bumper cover", operation: "Replace", position: "FRONT" }],
};

test("valid estimate normalizes operations and reports no errors", () => {
  const { estimate, warnings } = validateEstimate(validRaw);
  assert.equal(estimate.estimateId, "EST-1");
  assert.equal(estimate.lines[0].operation, "REPLACE");
  assert.deepEqual(warnings, []);
});

test("missing estimateId, description, operation and duplicate lineIds are reported together", () => {
  assert.throws(
    () =>
      validateEstimate({
        vehicle: {},
        lines: [
          { lineId: "L1", description: "", operation: "REPLACE" },
          { lineId: "L1", description: "Windshield", operation: "WELD" },
        ],
      }),
    (error) => {
      assert.equal(error.code, "VALIDATION_ERROR");
      assert.equal(error.statusCode, 400);
      const paths = error.details.errors.map((issue) => issue.path);
      assert.ok(paths.includes("estimateId"));
      assert.ok(paths.includes("lines[0].description"));
      assert.ok(paths.includes("lines[1].lineId"));
      assert.ok(paths.includes("lines[1].operation"));
      assert.match(error.details.errors.find((issue) => issue.path === "lines[1].operation").message, /Allowed values/);
      return true;
    },
  );
});

test("empty lines array is rejected: an estimate with no lines has nothing to analyze", () => {
  assert.throws(() => validateEstimate({ ...validRaw, lines: [] }), /lines must be a non-empty array/);
});

test("a missing position warns and defaults, rather than throwing", () => {
  const { estimate, warnings } = validateEstimate({
    ...validRaw,
    lines: [{ lineId: "L1", description: "Windshield", operation: "REPLACE" }],
  });
  assert.equal(estimate.lines[0].position, "UNSPECIFIED");
  assert.ok(warnings.some((warning) => warning.path === "lines[0].position"));
});

test("unknown top-level fields warn, and underscore-prefixed metadata is ignored silently", () => {
  const { warnings } = validateEstimate({ ...validRaw, _fixtureNote: "documentation", mysteryField: 1 });
  const paths = warnings.map((warning) => warning.path);
  assert.ok(paths.includes("mysteryField"));
  assert.ok(!paths.includes("_fixtureNote"));
});

test("a placeholder VIN warns but does not block analysis", () => {
  const { warnings } = validateEstimate({ ...validRaw, vehicle: { ...validRaw.vehicle, vin: "REPLACE_WITH_VALID_VIN" } });
  assert.ok(warnings.some((warning) => warning.path === "vehicle.vin"));
});

test("JSON adapter accepts an object, a JSON string, and a JSON file buffer", () => {
  for (const input of [validRaw, JSON.stringify(validRaw), Buffer.from(JSON.stringify(validRaw))]) {
    const parsed = jsonEstimateAdapter.parse(input);
    assert.equal(parsed.estimate.estimateId, "EST-1");
  }
});

test("JSON adapter rejects malformed JSON with a typed validation error", () => {
  assert.throws(() => jsonEstimateAdapter.parse("{ not json"), (error) => {
    assert.equal(error.code, "VALIDATION_ERROR");
    assert.equal(error.statusCode, 400);
    return true;
  });
});

test("PDF and CSV adapters fail loudly with a typed not-implemented error", () => {
  for (const adapter of [PdfEstimateAdapter, CsvEstimateAdapter]) {
    assert.equal(adapter.implemented, false);
    assert.throws(() => adapter.parse(Buffer.from("anything")), (error) => {
      assert.equal(error.code, "NOT_IMPLEMENTED");
      assert.equal(error.statusCode, 501);
      assert.match(error.details.hint, /separate follow-up|column mapping|OCR/);
      return true;
    });
  }
});

test("adapter selection routes a PDF upload to the unimplemented adapter, not to the JSON parser", () => {
  const adapter = selectAdapter({ contentType: "application/pdf", filename: "estimate.pdf" });
  assert.equal(adapter.id, "pdf");
  assert.equal(adapter.implemented, false);
});

test("adapter selection picks the JSON adapter for JSON bodies and files", () => {
  assert.equal(selectAdapter({ input: validRaw }).id, "structured-json");
  assert.equal(selectAdapter({ contentType: "application/json", filename: "estimate.json" }).id, "structured-json");
});

test("adapter listing advertises exactly one implemented adapter", () => {
  const adapters = listAdapters();
  assert.equal(adapters.filter((adapter) => adapter.implemented).length, 1);
  assert.deepEqual(adapters.filter((adapter) => adapter.implemented).map((a) => a.id), ["structured-json"]);
  assert.deepEqual(adapters.filter((adapter) => !adapter.implemented).map((a) => a.id).sort(), ["csv", "image-ocr", "pdf"]);
});

test("vehicle resolution derives a key, never claims verification, and names what it could not check", () => {
  const resolved = resolveVehicle({ year: 2024, make: "Example", model: "SUV", trim: "ADAS-equipped configuration" });
  assert.equal(resolved.vehicleKey, "EXAMPLE-2024-SUV");
  assert.equal(resolved.configurationVerified, false);
  assert.equal(resolved.vinDecoded, false);
  assert.match(resolved.reason, /has not been checked/);
  assert.ok(resolved.unchecked.length >= 1);
  assert.ok(resolved.unmatchedInput.some((note) => /trim/.test(note)));
});

test("vehicle resolution without year/make/model is UNRESOLVED and names the missing fields", () => {
  const resolved = resolveVehicle({ vin: null });
  assert.equal(resolved.status, "UNRESOLVED");
  assert.equal(resolved.vehicleKey, null);
  assert.deepEqual(resolved.missingFields, ["vehicle.year", "vehicle.make", "vehicle.model"]);
});
