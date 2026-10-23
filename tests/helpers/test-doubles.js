/**
 * Test doubles.
 *
 * Rules and catalogs defined here are SYNTHETIC and exist only to drive the engine
 * down paths (a VERIFIED source, a specific condition combination) that the
 * illustrative seed dataset must never contain while no real OEM data exists.
 * Nothing here is loaded by src/ — the pipeline's own tests use the illustrative
 * dataset in src/data via the normal code path.
 */
import { createResolver } from "../../src/modules/oem-procedures/procedure-resolver.js";

export function testComponent({ id, displayName = id, aliases = [], systems = [], nearbySensors = [], position = "FRONT" }) {
  return { id, displayName, aliases, systems, nearbySensors, position, illustrative: true };
}

export function testRule(overrides = {}) {
  return {
    id: "TEST-RULE-1",
    ruleStatus: "VERIFIED",
    verified: true,
    procedure: "TEST_PROCEDURE",
    procedureType: "STATIC_CALIBRATION",
    description: "Synthetic rule used only inside the test suite.",
    applicability: {
      vehicleKey: "EXAMPLE-2024-SUV",
      triggerComponent: "front_radar",
      operations: ["REMOVE_INSTALL", "REPLACE"],
      procedureType: null,
    },
    logic: "ANY",
    conditions: [],
    reason: "Synthetic reason text for tests.",
    evidenceRequired: [],
    source: {
      documentId: "TEST-DOUBLE-NOT-A-REAL-OEM-DOCUMENT",
      revision: "T0",
      section: "test fixtures only",
      fictional: true,
    },
    ...overrides,
  };
}

export function testResolver(rules = []) {
  return createResolver(rules);
}

export const TEST_VEHICLE = { vehicleKey: "EXAMPLE-2024-SUV", configurationVerified: false, configurationFacts: {} };
